from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import httpx
from PIL import Image

from app.core.config import settings
from app.services.gemini_api import GeminiApiClient, GeminiApiError, b64encode_bytes
from app.services.media_storage import save_generated_file, save_generated_metadata, get_file_url

logger = logging.getLogger("photo.chat.agent")


_ASSET_REF_PATTERNS = (
    r"\basset\s*#?\s*{n}\b",
    r"\b{n}\s*asset\b",
    r"\bассет\s*#?\s*{n}\b",
    r"\b{n}\s*ассет\b",
    r"\bastest\s*#?\s*{n}\b",
    r"\b{n}\s*astest\b",
)

_LOCALE_ALIASES = {
    "ru": "ru",
    "ru-ru": "ru",
    "russian": "ru",
    "русский": "ru",
    "en": "en",
    "en-us": "en",
    "en-gb": "en",
    "english": "en",
    "английский": "en",
    "uz": "uz",
    "uz-uz": "uz",
    "uzbek": "uz",
    "o'zbek": "uz",
    "uzbekistan": "uz",
    "узбек": "uz",
}

_LANGUAGE_LABELS = {
    "ru": "Russian",
    "en": "English",
    "uz": "Uzbek",
}

_DEFAULT_CLARIFYING_QUESTION = {
    "en": "Could you clarify exactly what you want me to change or create?",
    "ru": "Уточните, пожалуйста, что именно нужно изменить или создать.",
    "uz": "Iltimos, aynan nimani o'zgartirish yoki yaratish kerakligini aniqlashtirib bering.",
}

_UZ_LATIN_HINTS = (
    "iltimos",
    "rasm",
    "surat",
    "yana",
    "qiling",
    "qil",
    "kerak",
    "bo'lsin",
    "bo‘lsin",
    "kiyim",
    "fon",
    "bilan",
    "uchun",
    "o'zgartir",
    "o‘zgartir",
    "yorug'",
    "yorug‘",
    "qora",
    "oq",
)

_SYSTEM_PLACEHOLDER_RE = re.compile(r"^\[user sent \d+ image\(s\) without text", flags=re.IGNORECASE)

_MODEL_PROFILE_ALIASES = {
    "fast": "fast",
    "lite": "fast",
    "smart": "smart",
    "default": "smart",
    "quality": "quality",
    "best": "quality",
    "pro": "quality",
}

_FAST_TEXT_MODEL = "gemini-3.1-flash-lite-preview"
_SMART_TEXT_MODEL = "gemini-3.1-pro-preview"
_QUALITY_TEXT_MODEL = "gemini-3.1-pro-preview"
_FAST_IMAGE_MODEL = "gemini-3.1-flash-image-preview"
_SMART_IMAGE_MODEL = "gemini-3.1-flash-image-preview"
_QUALITY_IMAGE_MODEL = "gemini-3-pro-image-preview"

_IMAGE_EDIT_HINTS = (
    "shu rasm",
    "shu surat",
    "fonni almashtir",
    "fonini almashtir",
    "oq fon",
    "oq background",
    "kiydir",
    "birlashtir",
    "video qil",
    "rasmni yaxshila",
    "фон",
    "переодень",
    "надень",
    "с первого фото",
    "со второго фото",
    "объедини",
    "улучши",
    "remove background",
    "change background",
    "background",
    "put on model",
    "enhance",
    "edit",
    "merge",
    "combine",
    "swap",
    "replace",
    "make it brighter",
    "same but",
    "use the last result",
)

_FOLLOWUP_IMAGE_HINTS = (
    "make it",
    "same but",
    "change it",
    "use the last result",
    "last result",
    "last one",
    "fix it",
    "edit it",
    "uni",
    "shuni",
    "o'shani",
    "это",
    "его",
    "ее",
)

_MULTI_IMAGE_HINTS = (
    "image 1",
    "image 2",
    "photo 1",
    "photo 2",
    "first photo",
    "second photo",
    "1-rasm",
    "2-rasm",
    "birinchi rasm",
    "ikkinchi rasm",
    "2 ta rasm",
    "ikki rasm",
    "2 фото",
    "two images",
    "two photos",
    "both images",
    "both photos",
    "с первого фото",
    "со второго фото",
    "combine",
    "merge",
    "swap",
    "put the",
)


def _normalize_asset_refs(text: str, selected_asset_ids: List[int]) -> str:
    if not text or not selected_asset_ids:
        return text or ""

    out = text
    for idx, aid in enumerate(selected_asset_ids, 1):
        label = f"Image {idx}"
        for pat in _ASSET_REF_PATTERNS:
            rx = re.compile(pat.format(n=re.escape(str(int(aid)))), flags=re.IGNORECASE)
            out = rx.sub(label, out)
    return out


def _normalize_locale(value: Any) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None

    lowered = raw.replace("_", "-").lower()
    if lowered in {"auto", "default"}:
        return None

    primary = lowered.split("-", 1)[0]
    return _LOCALE_ALIASES.get(lowered) or _LOCALE_ALIASES.get(primary) or primary


def _is_synthetic_user_message(text: str) -> bool:
    raw = (text or "").strip()
    return bool(raw and _SYSTEM_PLACEHOLDER_RE.match(raw))


def _detect_message_locale(text: str) -> Optional[str]:
    raw = (text or "").strip()
    if not raw or _is_synthetic_user_message(raw):
        return None

    lowered = raw.lower()

    if re.search(r"[қғҳў]", lowered):
        return "uz"

    if re.search(r"[а-яё]", lowered):
        return "ru"

    if re.search(r"[a-z]", lowered):
        if any(hint in lowered for hint in _UZ_LATIN_HINTS):
            return "uz"
        return "en"

    return None


def resolve_photo_chat_locale(
    *,
    user_message: str,
    history: Optional[List[Dict[str, Any]]] = None,
    thread_context: Optional[Dict[str, Any]] = None,
) -> str:
    explicit_locale = _normalize_locale((thread_context or {}).get("locale"))
    if explicit_locale:
        return explicit_locale

    candidate_texts: List[str] = []
    if user_message and not _is_synthetic_user_message(user_message):
        candidate_texts.append(user_message)

    for item in reversed(history or []):
        if str(item.get("role") or "") != "user":
            continue
        text = str(item.get("text") or "").strip()
        if text:
            candidate_texts.append(text)
            break

    for text in candidate_texts:
        detected = _detect_message_locale(text)
        if detected:
            return detected

    return "en"


def _language_label(locale: str) -> str:
    normalized = _normalize_locale(locale) or "en"
    return _LANGUAGE_LABELS.get(normalized, normalized)


def _default_clarifying_question(locale: str) -> str:
    normalized = _normalize_locale(locale) or "en"
    return _DEFAULT_CLARIFYING_QUESTION.get(normalized, _DEFAULT_CLARIFYING_QUESTION["en"])


def _normalize_model_profile(value: Any) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    return _MODEL_PROFILE_ALIASES.get(raw)


def _normalize_requested_model(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    return raw or None


def _trimmed_text(value: Any, *, limit: int = 240) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].strip()


def _lowered_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _has_any_hint(text: str, hints: Tuple[str, ...]) -> bool:
    lowered = _lowered_text(text)
    return bool(lowered and any(hint in lowered for hint in hints))


def _working_asset_count(
    assets: Optional[List[Dict[str, Any]]],
    recent_image_bytes: Optional[List[Tuple[int, bytes, str]]],
    thread_context: Optional[Dict[str, Any]],
) -> int:
    explicit_assets = len(assets or [])
    recent_assets = len(recent_image_bytes or [])
    working_assets = len((thread_context or {}).get("working_asset_ids") or [])
    generated_asset = 1 if (thread_context or {}).get("last_generated_asset_id") else 0
    return max(explicit_assets, recent_assets, working_assets, generated_asset)


def _actual_model_from_response(resp: Dict[str, Any], fallback: str) -> str:
    return str(resp.get("modelVersion") or fallback or "").strip() or fallback


def _normalize_planner_assets(assets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    compact: List[Dict[str, Any]] = []
    for asset in assets:
        compact.append(
            {
                "asset_id": asset.get("asset_id"),
                "seq": asset.get("seq"),
                "kind": asset.get("kind"),
                "source": asset.get("source"),
                "caption": _trimmed_text(asset.get("caption") or asset.get("prompt"), limit=160),
            }
        )
    return compact


def _normalize_planner_history(history: List[Dict[str, Any]], *, limit: int = 6) -> List[Dict[str, Any]]:
    relevant = [
        {
            "role": item.get("role"),
            "text": _trimmed_text(item.get("text"), limit=400),
            "asset_ids": item.get("asset_ids") or None,
        }
        for item in history
        if _trimmed_text(item.get("text"), limit=400) or item.get("asset_ids")
    ]
    return relevant[-limit:]


def _normalize_thread_context_for_planner(thread_context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    ctx = dict(thread_context or {})
    return {
        "last_generated_asset_id": ctx.get("last_generated_asset_id"),
        "working_asset_ids": list(ctx.get("working_asset_ids") or [])[:4],
        "pending_question": _trimmed_text(ctx.get("pending_question"), limit=240) or None,
        "last_action": ctx.get("last_action"),
        "locale": ctx.get("locale"),
    }


def _parse_planner_response_dict(raw: str, *, response_locale: str) -> Dict[str, Any]:
    if not raw:
        raise GeminiApiError("Planner returned empty response")

    try:
        plan = json.loads(raw)
    except Exception:
        cleaned = raw.strip().strip("`").replace("```json", "").replace("```", "").strip()
        plan = json.loads(cleaned)

    if not isinstance(plan, dict):
        raise GeminiApiError("Planner returned an invalid JSON object")

    intent = str(plan.get("intent") or "chat").strip().lower()
    if intent not in {"chat", "question", "edit_image", "generate_image"}:
        intent = "chat"

    assistant_message = str(plan.get("assistant_message") or "").strip()
    raw_prompt = plan.get("image_prompt")
    image_prompt = str(raw_prompt).strip() if isinstance(raw_prompt, str) else None
    image_prompt = image_prompt or None

    raw_selected_ids = plan.get("selected_asset_ids")
    selected_asset_ids: List[int] | None = None
    if isinstance(raw_selected_ids, list):
        normalized_ids: List[int] = []
        seen_ids: set[int] = set()
        for item in raw_selected_ids:
            try:
                asset_id = int(item)
            except (TypeError, ValueError):
                continue
            if asset_id in seen_ids:
                continue
            seen_ids.add(asset_id)
            normalized_ids.append(asset_id)
        selected_asset_ids = normalized_ids or None

    raw_image_count = plan.get("image_count")
    image_count: Optional[int]
    try:
        image_count = int(raw_image_count) if raw_image_count is not None else None
    except (TypeError, ValueError):
        image_count = None
    if image_count is not None:
        image_count = max(1, min(image_count, 4))

    raw_aspect_ratio = plan.get("aspect_ratio")
    aspect_ratio = str(raw_aspect_ratio).strip() if raw_aspect_ratio is not None else None
    aspect_ratio = aspect_ratio or None

    if intent in {"edit_image", "generate_image"} and not image_prompt:
        intent = "question"
        assistant_message = assistant_message or _default_clarifying_question(response_locale)

    if intent == "question" and not assistant_message:
        assistant_message = _default_clarifying_question(response_locale)

    return {
        "intent": intent,
        "assistant_message": assistant_message,
        "selected_asset_ids": selected_asset_ids,
        "image_prompt": image_prompt,
        "image_count": image_count,
        "aspect_ratio": aspect_ratio,
    }


def _truncate(s: str, n: int = 900) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + " ...[truncated]"


def _ensure_reasonable_image_bytes(raw: bytes, max_side: int = 1536, quality: int = 88) -> Tuple[bytes, str]:
    try:
        im = Image.open(BytesIO(raw))
        im.load()
    except Exception:
        return raw, "application/octet-stream"

    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")

    w, h = im.size
    scale = min(1.0, max_side / float(max(w, h)))
    if scale < 1.0:
        im = im.resize((int(w * scale), int(h * scale)))

    out = BytesIO()
    im.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue(), "image/jpeg"


def build_enhanced_prompt(
    agent: PhotoChatAgent,
    plan: dict,
    assets: List[Dict[str, Any]],
    selected_ids: List[int],
) -> str:
    basic_prompt = plan.get("image_prompt", "")
    
    if not basic_prompt or not selected_ids:
        return basic_prompt
    selected_assets = [
        a for a in assets 
        if int(a.get("asset_id", 0)) in selected_ids
    ]
    
    return agent.build_rich_prompt(
        basic_prompt=basic_prompt,
        selected_assets=selected_assets,
        selected_asset_ids=selected_ids,
    )


class PhotoChatAgent:
    def __init__(self, api_key: str):
        self.api = GeminiApiClient(api_key=api_key)
        self._sem = asyncio.Semaphore(getattr(settings, "GEMINI_MAX_CONCURRENT_REQUESTS", 2))

    async def close(self) -> None:
        await self.api.aclose()

    @staticmethod
    def _normalize_service_tier(value: Any) -> Optional[str]:
        raw = str(value or "").strip().lower()
        if raw in {"standard", "flex", "priority"}:
            return raw
        return None

    @staticmethod
    def _is_gemini_3_model(model: Optional[str]) -> bool:
        return str(model or "").strip().lower().startswith("gemini-3")

    @staticmethod
    def _gemini_3_generation_config(
        *,
        thinking_level: Optional[str] = None,
        **extra: Any,
    ) -> Dict[str, Any]:
        config = {k: v for k, v in extra.items() if v is not None}
        level = str(thinking_level or "").strip().lower()
        if level in {"minimal", "low", "medium", "high"}:
            config["thinkingConfig"] = {"thinkingLevel": level}
        return config

    @staticmethod
    def _allowed_text_models() -> set[str]:
        return {
            _normalize_requested_model(settings.GEMINI_TEXT_MODEL) or "",
            _normalize_requested_model(settings.GEMINI_TEXT_MODEL_FALLBACK) or "",
            _FAST_TEXT_MODEL,
            _SMART_TEXT_MODEL,
            _QUALITY_TEXT_MODEL,
            "gemini-3-flash-preview",
            "gemini-2.5-flash",
        }

    @staticmethod
    def _allowed_vision_models() -> set[str]:
        return {
            _normalize_requested_model(settings.GEMINI_VISION_MODEL) or "",
            _normalize_requested_model(settings.GEMINI_VISION_MODEL_FALLBACK) or "",
            _FAST_TEXT_MODEL,
            _SMART_TEXT_MODEL,
            _QUALITY_TEXT_MODEL,
            "gemini-3-flash-preview",
            "gemini-2.5-flash",
        }

    @staticmethod
    def _allowed_image_models() -> set[str]:
        return {
            _normalize_requested_model(settings.GEMINI_IMAGE_MODEL) or "",
            _normalize_requested_model(settings.GEMINI_IMAGE_MODEL_FALLBACK) or "",
            _FAST_IMAGE_MODEL,
            _SMART_IMAGE_MODEL,
            _QUALITY_IMAGE_MODEL,
            "gemini-2.5-flash-image",
        }

    def _resolve_text_model(self, requested_model: Optional[str], model_profile: Optional[str]) -> str:
        normalized_profile = _normalize_model_profile(model_profile)
        requested = _normalize_requested_model(requested_model)
        default_model = settings.GEMINI_TEXT_MODEL
        if normalized_profile == "fast":
            default_model = settings.GEMINI_TEXT_MODEL_FALLBACK or _FAST_TEXT_MODEL
        elif normalized_profile in {"smart", "quality"}:
            default_model = settings.GEMINI_TEXT_MODEL or _SMART_TEXT_MODEL

        if requested and requested in self._allowed_text_models():
            return requested
        if requested:
            logger.warning("photo.chat.agent: invalid requested text model=%s profile=%s, using default=%s", requested, normalized_profile, default_model)
        return default_model

    def _resolve_vision_model(self, requested_model: Optional[str], model_profile: Optional[str]) -> str:
        normalized_profile = _normalize_model_profile(model_profile)
        requested = _normalize_requested_model(requested_model)
        default_model = settings.GEMINI_VISION_MODEL
        if normalized_profile == "fast":
            default_model = settings.GEMINI_VISION_MODEL_FALLBACK or _FAST_TEXT_MODEL
        elif normalized_profile in {"smart", "quality"}:
            default_model = settings.GEMINI_VISION_MODEL or _SMART_TEXT_MODEL

        if requested and requested in self._allowed_vision_models():
            return requested
        if requested:
            logger.warning("photo.chat.agent: invalid requested vision model=%s profile=%s, using default=%s", requested, normalized_profile, default_model)
        return default_model

    def _resolve_image_model(self, requested_model: Optional[str], model_profile: Optional[str]) -> str:
        normalized_profile = _normalize_model_profile(model_profile)
        requested = _normalize_requested_model(requested_model)
        default_model = settings.GEMINI_IMAGE_MODEL
        if normalized_profile in {"fast", "smart"}:
            default_model = settings.GEMINI_IMAGE_MODEL_FALLBACK or _SMART_IMAGE_MODEL
        elif normalized_profile == "quality":
            default_model = settings.GEMINI_IMAGE_MODEL or _QUALITY_IMAGE_MODEL

        if requested and requested in self._allowed_image_models():
            return requested
        if requested:
            logger.warning("photo.chat.agent: invalid requested image model=%s profile=%s, using default=%s", requested, normalized_profile, default_model)
        return default_model

    def _resolve_text_fallback_model(self, selected_model: str) -> Optional[str]:
        fallback = _normalize_requested_model(settings.GEMINI_TEXT_MODEL_FALLBACK)
        if not fallback or fallback == selected_model:
            return None
        return fallback

    def _resolve_vision_fallback_model(self, selected_model: str) -> Optional[str]:
        fallback = _normalize_requested_model(settings.GEMINI_VISION_MODEL_FALLBACK)
        if not fallback or fallback == selected_model:
            return None
        return fallback

    def _resolve_image_fallback_model(self, selected_model: str) -> Optional[str]:
        fallback = _normalize_requested_model(settings.GEMINI_IMAGE_MODEL_FALLBACK)
        if not fallback or fallback == selected_model:
            return None
        return fallback

    def _is_explicit_multi_image_request(
        self,
        user_message: str,
        assets: Optional[List[Dict[str, Any]]] = None,
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
        thread_context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        if _working_asset_count(assets, recent_image_bytes, thread_context) < 2:
            return False
        return _has_any_hint(user_message, _MULTI_IMAGE_HINTS)

    def planner_image_limit(
        self,
        *,
        user_message: str,
        assets: Optional[List[Dict[str, Any]]] = None,
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
        thread_context: Optional[Dict[str, Any]] = None,
    ) -> int:
        return 4 if self._is_explicit_multi_image_request(user_message, assets, recent_image_bytes, thread_context) else 2

    def _needs_vision_planner(
        self,
        user_message: str,
        assets: Optional[List[Dict[str, Any]]],
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]],
        thread_context: Optional[Dict[str, Any]],
    ) -> bool:
        ctx = thread_context or {}
        if assets:
            return True
        if recent_image_bytes:
            return True
        if ctx.get("working_asset_ids"):
            return True
        if ctx.get("last_generated_asset_id") and _has_any_hint(user_message, _FOLLOWUP_IMAGE_HINTS):
            return True
        if _has_any_hint(user_message, _IMAGE_EDIT_HINTS):
            return True
        return False

    def needs_vision_planner(
        self,
        *,
        user_message: str,
        assets: Optional[List[Dict[str, Any]]] = None,
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
        thread_context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        return self._needs_vision_planner(user_message, assets, recent_image_bytes, thread_context)

    @staticmethod
    def _should_use_fallback_model(exc: Exception) -> bool:
        msg = str(exc or "")
        lowered = msg.lower()
        return (
            "404" in msg
            or "429" in msg
            or "503" in msg
            or "timeout" in lowered
            or "timed out" in lowered
            or "deadline_exceeded" in lowered
            or "not found" in lowered
            or "not_found" in lowered
            or "unavailable" in lowered
            or "high demand" in lowered
        )

    @staticmethod
    def _should_retry_same_model(exc: Exception) -> bool:
        msg = str(exc or "")
        lowered = msg.lower()
        return (
            "429" in msg
            or "503" in msg
            or "timeout" in lowered
            or "timed out" in lowered
            or "deadline_exceeded" in lowered
            or "unavailable" in lowered
            or "high demand" in lowered
        )

    @staticmethod
    def _should_retry_without_service_tier(exc: Exception) -> bool:
        msg = str(exc or "")
        lowered = msg.lower()
        return (
            ("service_tier" in lowered or "service tier" in lowered or "priority" in lowered or "flex" in lowered)
            and (
                "400" in msg
                or "403" in msg
                or "invalid" in lowered
                or "permission" in lowered
                or "tier 2" in lowered
                or "tier 3" in lowered
                or "unsupported" in lowered
                or "not available" in lowered
            )
        )

    async def _generate_content_with_fallback(
        self,
        *,
        model: str,
        contents: List[Dict[str, Any]],
        generation_config: Optional[Dict[str, Any]] = None,
        fallback_model: Optional[str] = None,
        service_tier: Optional[str] = None,
        fallback_service_tier: Optional[str] = None,
        timeout_s: Optional[float] = None,
        fallback_timeout_s: Optional[float] = None,
        max_retries: Optional[int] = None,
        fallback_max_retries: Optional[int] = None,
        allow_quality_fallback: bool = True,
        retry_same_model_once: bool = True,
        trace_id: str = "-",
        operation: str = "generate_content",
    ) -> Dict[str, Any]:
        normalized_service_tier = self._normalize_service_tier(service_tier)
        normalized_fallback_tier = self._normalize_service_tier(fallback_service_tier) or normalized_service_tier
        attempt_count = 0

        async def _call(
            call_model: str,
            call_service_tier: Optional[str],
            call_timeout_s: Optional[float],
            call_max_retries: Optional[int],
        ) -> Dict[str, Any]:
            nonlocal attempt_count
            attempt_count += 1
            t0 = time.perf_counter()
            try:
                async with self._sem:
                    resp = await self.api.generate_content(
                        model=call_model,
                        contents=contents,
                        generation_config=generation_config,
                        service_tier=call_service_tier,
                        timeout_s=call_timeout_s,
                        max_retries=call_max_retries,
                    )
            except GeminiApiError as exc:
                if call_service_tier and self._should_retry_without_service_tier(exc):
                    logger.warning(
                        "[%s] %s: model=%s service_tier=%s unavailable for this key, retrying with standard tier",
                        trace_id,
                        operation,
                        call_model,
                        call_service_tier,
                    )
                    return await _call(call_model, None, call_timeout_s, call_max_retries)
                raise

            dt = (time.perf_counter() - t0) * 1000
            logger.info(
                "[%s] %s:success selected_model=%s actual_model_used=%s retry_count=%s latency_ms=%.1f",
                trace_id,
                operation,
                call_model,
                _actual_model_from_response(resp, call_model),
                max(0, attempt_count - 1),
                dt,
            )
            return resp

        last_error: Optional[GeminiApiError] = None
        try:
            return await _call(model, normalized_service_tier, timeout_s, max_retries)
        except GeminiApiError as exc:
            last_error = exc

        if retry_same_model_once and last_error and self._should_retry_same_model(last_error):
            logger.warning(
                "[%s] %s:retry_same_model model=%s reason=%s retry_count=%s",
                trace_id,
                operation,
                model,
                _truncate(str(last_error), 300),
                attempt_count,
            )
            try:
                return await _call(model, normalized_service_tier, timeout_s, max_retries)
            except GeminiApiError as exc:
                last_error = exc

        fallback = (fallback_model or "").strip()
        if not last_error or not fallback or fallback == model or not self._should_use_fallback_model(last_error):
            raise last_error or GeminiApiError("Unknown Gemini fallback error")

        if not allow_quality_fallback:
            logger.warning(
                "[%s] %s:fallback_blocked from=%s to=%s reason=%s allow_quality_fallback=%s",
                trace_id,
                operation,
                model,
                fallback,
                _truncate(str(last_error), 300),
                allow_quality_fallback,
            )
            raise last_error

        logger.warning(
            "[%s] %s:fallback from=%s to=%s reason=%s allow_quality_fallback=%s retry_count=%s",
            trace_id,
            operation,
            model,
            fallback,
            _truncate(str(last_error), 300),
            allow_quality_fallback,
            attempt_count,
        )
        return await _call(
            fallback,
            normalized_fallback_tier,
            fallback_timeout_s or timeout_s,
            fallback_max_retries,
        )

    
    async def plan_action_with_context(
        self,
        user_message: str,
        history: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
        thread_context: Optional[Dict[str, Any]] = None,
        trace_id: str = "-",
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
        model: Optional[str] = None,
        model_profile: Optional[str] = None,
        allow_quality_fallback: Optional[bool] = None,
    ) -> Dict[str, Any]:
        return await self.plan_action(
            user_message=user_message,
            history=history,
            assets=assets,
            thread_context=thread_context,
            trace_id=trace_id,
            recent_image_bytes=recent_image_bytes,
            model=model,
            model_profile=model_profile,
            allow_quality_fallback=allow_quality_fallback,
        )
    
    def build_rich_prompt(
        self,
        basic_prompt: str,
        selected_assets: List[Dict[str, Any]],
        selected_asset_ids: List[int],
    ) -> str:
        """
        Universal rich prompt builder WITHOUT keyword-based routing.
        The planner must decide what to do; we only add image context.
        """
        if not selected_assets or not selected_asset_ids:
            return (basic_prompt or "").strip()

        # safety: если вдруг planner/юзер упомянул asset_id, заменим на Image N
        basic_prompt = _normalize_asset_refs((basic_prompt or "").strip(), selected_asset_ids).strip()

        asset_by_id = {int(a["asset_id"]): a for a in selected_assets if a.get("asset_id") is not None}

        lines: List[str] = []
        lines.append(f"Task: {basic_prompt}" if basic_prompt else "Task: Edit the provided images as requested.")

        # Add ordered image descriptions strictly by attachment order
        for idx, aid in enumerate(selected_asset_ids, 1):
            a = asset_by_id.get(int(aid))
            if not a:
                lines.append(f"Image {idx}: (no metadata)")
                continue

            clothing = (a.get("clothing") or "").strip()
            colors = a.get("colors") or []
            pose = (a.get("pose") or "").strip()
            background = (a.get("background") or "").strip()
            caption = (a.get("caption") or "").strip()

            details = []
            if clothing:
                details.append(f"Clothing: {clothing}")
            if colors:
                details.append(f"Colors: {', '.join([str(c) for c in colors[:3]])}")
            if pose:
                details.append(f"Pose: {pose}")
            if background:
                details.append(f"Background: {background}")

            desc = " | ".join(details) if details else (caption[:180] if caption else "No description")
            lines.append(f"Image {idx}: {desc}")

        # Universal rules (без "clothing transfer" и без keyword'ов)
        lines.append(
            "General rules:\n"
            "- Do ONLY what the task asks; keep everything else unchanged.\n"
            "- If the task involves combining images: preserve the target person's identity and pose unless requested.\n"
            "- Preserve the existing background, outfit, and framing unless the task explicitly asks to change them.\n"
            "- Ensure realistic lighting, shadows, and proportions.\n"
            "- Only apply marketplace/card styling when the user explicitly asks for it.\n"
        )

        return "\n\n".join(lines).strip()

    async def fetch_url_bytes(self, url: str, *, trace_id: str = "-") -> bytes:
        if not url:
            raise GeminiApiError("Empty URL")
        t0 = time.perf_counter()
        logger.info("[%s] fetch_url_bytes: url=%s", trace_id, url)
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            raw = r.content
        dt = (time.perf_counter() - t0) * 1000
        logger.info("[%s] fetch_url_bytes: ok bytes=%s ms=%.1f", trace_id, len(raw), dt)
        return raw

    async def generate_text(
        self,
        prompt: str,
        history: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
        model_profile: Optional[str] = None,
        *,
        trace_id: str = "-",
    ) -> str:
        requested_model = _normalize_requested_model(model)
        model = self._resolve_text_model(requested_model, model_profile)
        fallback_model = self._resolve_text_fallback_model(model)
        service_tier = settings.GEMINI_TEXT_SERVICE_TIER
        timeout_s = settings.GEMINI_TEXT_TIMEOUT_S
        max_retries = settings.GEMINI_TEXT_MAX_RETRIES
        fallback_max_retries = settings.GEMINI_TEXT_FALLBACK_MAX_RETRIES
        thinking_level = settings.GEMINI_TEXT_THINKING_LEVEL
        contents = []
        if history:
            for h in history[-12:]:
                role = h.get("role") or "user"
                txt = h.get("text") or ""
                if txt.strip():
                    contents.append({"role": role, "parts": [{"text": txt}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        logger.info(
            "[%s] generate_text:start requested_model=%s selected_model=%s fallback_model=%s profile=%s hist=%s prompt=%s",
            trace_id, requested_model, model, fallback_model, _normalize_model_profile(model_profile), len(history or []), _truncate(prompt, 400),
        )

        t0 = time.perf_counter()
        resp = await self._generate_content_with_fallback(
            model=model,
            fallback_model=fallback_model,
            contents=contents,
            generation_config=(
                self._gemini_3_generation_config(thinking_level=thinking_level)
                if self._is_gemini_3_model(model)
                else None
            ),
            service_tier=service_tier,
            timeout_s=timeout_s,
            max_retries=max_retries,
            fallback_max_retries=fallback_max_retries,
            allow_quality_fallback=True,
            retry_same_model_once=True,
            trace_id=trace_id,
            operation="generate_text",
        )
        dt = (time.perf_counter() - t0) * 1000

        text, _parts = self.api.extract_text_and_images(resp)
        out = (text or "").strip()
        logger.info("[%s] generate_text: ok ms=%.1f out=%s", trace_id, dt, _truncate(out, 300))
        return out

    async def describe_image_rich(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        *,
        trace_id: str = "-",
        asset_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        model = settings.GEMINI_VISION_MODEL
        fallback_model = settings.GEMINI_VISION_MODEL_FALLBACK
        service_tier = settings.GEMINI_VISION_SERVICE_TIER
        timeout_s = settings.GEMINI_VISION_TIMEOUT_S
        max_retries = settings.GEMINI_VISION_MAX_RETRIES
        fallback_max_retries = settings.GEMINI_VISION_FALLBACK_MAX_RETRIES
        thinking_level = settings.GEMINI_VISION_THINKING_LEVEL
        safe_bytes, safe_mime = _ensure_reasonable_image_bytes(image_bytes)

        logger.info(
            "[%s] describe_image_rich: model=%s asset_id=%s bytes=%s mime=%s",
            trace_id, model, asset_id, len(image_bytes), mime_type
        )

        instruction = (
            "Верни СТРОГО JSON (без текста вокруг) по схеме:\n"
            "{\n"
            '  "summary": string,\n'
            '  "tags": string[],\n'
            '  "colors": string[],\n'
            '  "clothing": string,\n'
            '  "background": string,\n'
            '  "pose": string\n'
            "}\n"
        )

        contents = [{
            "role": "user",
            "parts": [
                {"text": instruction},
                {"inline_data": {"mime_type": safe_mime if safe_mime.startswith("image/") else (mime_type or "image/jpeg"),
                                "data": b64encode_bytes(safe_bytes)}},
            ],
        }]

        generation_config = (
            self._gemini_3_generation_config(
                responseMimeType="application/json",
                thinking_level=thinking_level,
            )
            if self._is_gemini_3_model(model)
            else {"responseMimeType": "application/json", "temperature": 0.2}
        )

        t0 = time.perf_counter()
        resp = await self._generate_content_with_fallback(
            model=model,
            fallback_model=fallback_model,
            contents=contents,
            generation_config=generation_config,
            service_tier=service_tier,
            timeout_s=timeout_s,
            max_retries=max_retries,
            fallback_max_retries=fallback_max_retries,
            trace_id=trace_id,
            operation="describe_image_rich",
        )
        dt = (time.perf_counter() - t0) * 1000

        text, _parts = self.api.extract_text_and_images(resp)
        txt = (text or "").strip()
        logger.info("[%s] describe_image_rich: ms=%.1f raw_json=%s", trace_id, dt, _truncate(txt, 500))

        if not txt:
            return {}

        try:
            data = json.loads(txt)
        except Exception:
            cleaned = txt.strip().strip("`").replace("```json", "").replace("```", "").strip()
            data = json.loads(cleaned)

        if not isinstance(data, dict):
            return {}

        # normalize
        tags = data.get("tags")
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        if not isinstance(tags, list):
            tags = []

        colors = data.get("colors")
        if isinstance(colors, str):
            colors = [c.strip() for c in colors.split(",") if c.strip()]
        if not isinstance(colors, list):
            colors = []

        out = {
            "summary": str(data.get("summary") or "").strip(),
            "tags": [str(t)[:32] for t in tags[:8]],
            "colors": [str(c)[:24] for c in colors[:6]],
            "clothing": str(data.get("clothing") or "")[:120].strip(),
            "background": str(data.get("background") or "")[:120].strip(),
            "pose": str(data.get("pose") or "")[:120].strip(),
        }
        logger.info("[%s] describe_image_rich: parsed=%s", trace_id, out)
        return out

    async def plan_action(
        self,
        *,
        user_message: str,
        history: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
        thread_context: Optional[Dict[str, Any]] = None,
        session_state: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
        model_profile: Optional[str] = None,
        allow_quality_fallback: Optional[bool] = None,
        trace_id: str = "-",
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,  # [(asset_id, bytes, mime_type), ...]
    ) -> Dict[str, Any]:
        ctx = dict(thread_context or session_state or {})
        use_vision = self._needs_vision_planner(user_message, assets, recent_image_bytes, ctx)

        logger.info(
            "[%s] plan_action:start requested_model=%s profile=%s use_vision=%s assets=%s images=%s allow_quality_fallback=%s",
            trace_id,
            _normalize_requested_model(model),
            _normalize_model_profile(model_profile),
            use_vision,
            len(assets or []),
            len(recent_image_bytes or []),
            allow_quality_fallback,
        )

        if use_vision:
            return await self.plan_action_vision(
                user_message=user_message,
                history=history,
                assets=assets,
                thread_context=ctx,
                model=model,
                model_profile=model_profile,
                allow_quality_fallback=allow_quality_fallback,
                trace_id=trace_id,
                recent_image_bytes=recent_image_bytes,
            )
        return await self.plan_action_text(
            user_message=user_message,
            history=history,
            assets=assets,
            thread_context=ctx,
            model=model,
            model_profile=model_profile,
            allow_quality_fallback=allow_quality_fallback,
            trace_id=trace_id,
        )

    def _planner_instruction(self, *, response_language: str, response_locale: str, use_vision: bool) -> str:
        modality_note = (
            "- You have access to the attached image context for this request.\n"
            if use_vision
            else "- You do not have image pixels for this request. Use only text history and thread_context.\n"
        )
        return (
            "You are the AVEMOD Photo Studio planner. Decide whether the assistant should chat, ask a clarifying question, "
            "edit existing image(s), or generate a brand-new image.\n\n"
            f"Language:\n"
            f"- If thread_context.locale is set, use it.\n"
            f"- Otherwise respond in the language of the latest real user message.\n"
            f"- For this request, write assistant_message and image_prompt in {response_language} (locale: {response_locale}) unless the user explicitly asked for another language.\n\n"
            "Context inputs:\n"
            "- history: recent thread-only conversation. A history item may include asset_ids.\n"
            "- assets: only the images currently relevant to this thread/request.\n"
            "- thread_context: {\n"
            "    last_generated_asset_id,\n"
            "    working_asset_ids,\n"
            "    pending_question,\n"
            "    last_action,\n"
            "    locale\n"
            "  }\n"
            f"{modality_note}\n"
            "Planning rules:\n"
            "- Ambiguous, underspecified, or conflicting requests must return intent='question'. Do not guess.\n"
            "- If pending_question is present, treat the user's latest message as a likely answer to that question.\n"
            "- For follow-up edits like 'make it warmer', 'change the background', 'same but brighter', or 'use the last result', use thread_context to resolve the target image when it is clear.\n"
            "- If it is not clear which image to edit, return intent='question' and ask which image to use.\n"
            "- Use intent='edit_image' only when an existing image or images should be changed.\n"
            "- Use intent='generate_image' only for brand-new images or when the user explicitly wants a new generation.\n"
            "- Use intent='chat' for normal non-image conversation.\n"
            "- If the user asks for multiple output variants, set image_count from 1 to 4. Otherwise use 1.\n\n"
            "Prompt rules:\n"
            "- image_prompt must be concrete, detailed, and faithful to the user's request.\n"
            "- Do not invent critical missing details. Ask a question instead.\n"
            "- Never mention raw asset_id or seq values in assistant_message or image_prompt.\n"
            "- When referencing selected images inside image_prompt, preserve exact positional labels such as 'Image 1', 'Image 2', etc.\n"
            "- Do not translate, rename, remove, or reorder 'Image N' references.\n"
            "- selected_asset_ids must be in the exact same order as the 'Image N' references used in image_prompt.\n"
            "- Do not force background, outfit, framing, or pose changes unless the user asked for them.\n\n"
            "Return STRICT JSON only:\n"
            "{\n"
            "  \"intent\": \"chat\"|\"question\"|\"edit_image\"|\"generate_image\",\n"
            "  \"assistant_message\": string,\n"
            "  \"selected_asset_ids\": number[] | null,\n"
            "  \"image_prompt\": string | null,\n"
            "  \"image_count\": number | null,\n"
            "  \"aspect_ratio\": string | null\n"
            "}\n"
        )

    async def plan_action_text(
        self,
        *,
        user_message: str,
        history: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
        thread_context: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
        model_profile: Optional[str] = None,
        allow_quality_fallback: Optional[bool] = None,
        trace_id: str = "-",
    ) -> Dict[str, Any]:
        requested_model = _normalize_requested_model(model)
        selected_model = self._resolve_text_model(requested_model, model_profile)
        fallback_model = self._resolve_text_fallback_model(selected_model)
        allow_fallback = True if allow_quality_fallback is None else bool(allow_quality_fallback)
        history_compact = _normalize_planner_history(history, limit=6)
        ctx = _normalize_thread_context_for_planner(thread_context)
        response_locale = resolve_photo_chat_locale(
            user_message=user_message,
            history=history,
            thread_context=ctx,
        )
        response_language = _language_label(response_locale)
        payload = {
            "history": history_compact,
            "assets": [],
            "thread_context": ctx,
            "user_message": user_message,
        }
        contents = [{
            "role": "user",
            "parts": [{
                "text": self._planner_instruction(
                    response_language=response_language,
                    response_locale=response_locale,
                    use_vision=False,
                ) + "\n\nCONTEXT:\n" + json.dumps(payload, ensure_ascii=False)
            }],
        }]
        generation_config = (
            self._gemini_3_generation_config(
                responseMimeType="application/json",
                thinking_level=settings.GEMINI_TEXT_THINKING_LEVEL,
            )
            if self._is_gemini_3_model(selected_model)
            else {"responseMimeType": "application/json", "temperature": 0.3}
        )

        logger.info(
            "[%s] plan_action_text:start requested_model=%s selected_model=%s fallback_model=%s profile=%s allow_quality_fallback=%s assets=%s hist=%s",
            trace_id,
            requested_model,
            selected_model,
            fallback_model,
            _normalize_model_profile(model_profile),
            allow_fallback,
            len(assets or []),
            len(history_compact),
        )

        resp = await self._generate_content_with_fallback(
            model=selected_model,
            fallback_model=fallback_model,
            contents=contents,
            generation_config=generation_config,
            service_tier=settings.GEMINI_TEXT_SERVICE_TIER,
            timeout_s=settings.GEMINI_TEXT_TIMEOUT_S,
            max_retries=settings.GEMINI_TEXT_MAX_RETRIES,
            fallback_max_retries=settings.GEMINI_TEXT_FALLBACK_MAX_RETRIES,
            allow_quality_fallback=allow_fallback,
            retry_same_model_once=True,
            trace_id=trace_id,
            operation="plan_action_text",
        )

        text, _parts = self.api.extract_text_and_images(resp)
        raw = (text or "").strip()
        logger.info("[%s] plan_action_text:raw=%s", trace_id, _truncate(raw, 900))
        parsed = _parse_planner_response_dict(raw, response_locale=response_locale)
        logger.info("[%s] plan_action_text:parsed=%s", trace_id, parsed)
        return parsed

    async def plan_action_vision(
        self,
        *,
        user_message: str,
        history: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
        thread_context: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
        model_profile: Optional[str] = None,
        allow_quality_fallback: Optional[bool] = None,
        trace_id: str = "-",
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
    ) -> Dict[str, Any]:
        requested_model = _normalize_requested_model(model)
        selected_model = self._resolve_vision_model(requested_model, model_profile)
        fallback_model = self._resolve_vision_fallback_model(selected_model)
        allow_fallback = True if allow_quality_fallback is None else bool(allow_quality_fallback)
        history_compact = _normalize_planner_history(history, limit=6)
        assets_compact = _normalize_planner_assets(assets)
        ctx = _normalize_thread_context_for_planner(thread_context)
        response_locale = resolve_photo_chat_locale(
            user_message=user_message,
            history=history,
            thread_context=ctx,
        )
        response_language = _language_label(response_locale)
        image_limit = self.planner_image_limit(
            user_message=user_message,
            assets=assets,
            recent_image_bytes=recent_image_bytes,
            thread_context=ctx,
        )
        limited_images = list(recent_image_bytes or [])[:image_limit]
        payload = {
            "history": history_compact,
            "assets": assets_compact,
            "thread_context": ctx,
            "user_message": user_message,
        }
        parts = [{
            "text": self._planner_instruction(
                response_language=response_language,
                response_locale=response_locale,
                use_vision=True,
            ) + "\n\nCONTEXT:\n" + json.dumps(payload, ensure_ascii=False)
        }]
        for asset_id, img_bytes, mime_type in limited_images:
            try:
                safe_bytes, safe_mime = _ensure_reasonable_image_bytes(img_bytes)
                parts.append({
                    "inline_data": {
                        "mime_type": safe_mime if safe_mime.startswith("image/") else (mime_type or "image/jpeg"),
                        "data": b64encode_bytes(safe_bytes),
                    }
                })
                parts.append({"text": f"[This is asset_id={asset_id}]"})
            except Exception as exc:
                logger.warning("[%s] plan_action_vision: failed to include image asset_id=%s: %s", trace_id, asset_id, exc)

        generation_config = (
            self._gemini_3_generation_config(
                responseMimeType="application/json",
                thinking_level=settings.GEMINI_VISION_THINKING_LEVEL,
            )
            if self._is_gemini_3_model(selected_model)
            else {"responseMimeType": "application/json", "temperature": 0.3}
        )

        logger.info(
            "[%s] plan_action_vision:start requested_model=%s selected_model=%s fallback_model=%s profile=%s allow_quality_fallback=%s assets=%s images=%s hist=%s",
            trace_id,
            requested_model,
            selected_model,
            fallback_model,
            _normalize_model_profile(model_profile),
            allow_fallback,
            len(assets_compact),
            len(limited_images),
            len(history_compact),
        )

        resp = await self._generate_content_with_fallback(
            model=selected_model,
            fallback_model=fallback_model,
            contents=[{"role": "user", "parts": parts}],
            generation_config=generation_config,
            service_tier=settings.GEMINI_VISION_SERVICE_TIER,
            timeout_s=settings.GEMINI_VISION_TIMEOUT_S,
            max_retries=settings.GEMINI_VISION_MAX_RETRIES,
            fallback_max_retries=settings.GEMINI_VISION_FALLBACK_MAX_RETRIES,
            allow_quality_fallback=allow_fallback,
            retry_same_model_once=True,
            trace_id=trace_id,
            operation="plan_action_vision",
        )

        text, _parts = self.api.extract_text_and_images(resp)
        raw = (text or "").strip()
        logger.info("[%s] plan_action_vision:raw=%s", trace_id, _truncate(raw, 900))
        parsed = _parse_planner_response_dict(raw, response_locale=response_locale)
        logger.info("[%s] plan_action_vision:parsed=%s", trace_id, parsed)
        return parsed
    
    @staticmethod
    def ensure_wb_3x4(image_bytes: bytes, target_w: int = 900, target_h: int = 1200, quality: int = 90) -> Tuple[bytes, str]:
        im = Image.open(BytesIO(image_bytes))
        im.load()
        im = im.convert("RGB")

        w, h = im.size
        target_ratio = target_w / target_h
        cur_ratio = w / h

        if cur_ratio > target_ratio:
            # too wide -> crop width
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            im = im.crop((left, 0, left + new_w, h))
        else:
            # too tall -> crop height
            new_h = int(w / target_ratio)
            top = (h - new_h) // 2
            im = im.crop((0, top, w, top + new_h))

        im = im.resize((target_w, target_h), Image.LANCZOS)

        out = BytesIO()
        im.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue(), "image/jpeg"

    async def edit_or_generate_image(
        self,
        prompt: str,
        images: List[Tuple[bytes, str]],
        aspect_ratio: Optional[str] = None,
        model: Optional[str] = None,
        model_profile: Optional[str] = None,
        allow_quality_fallback: Optional[bool] = None,
        *,
        trace_id: str = "-",
    ) -> Tuple[str, Optional[bytes], Optional[str]]:
        requested_model = _normalize_requested_model(model)
        model = self._resolve_image_model(requested_model, model_profile)
        fallback_model = self._resolve_image_fallback_model(model)
        allow_fallback = True if allow_quality_fallback is None else bool(allow_quality_fallback)
        service_tier = settings.GEMINI_IMAGE_SERVICE_TIER
        timeout_s = settings.GEMINI_IMAGE_TIMEOUT_S
        fallback_timeout_s = settings.GEMINI_IMAGE_FALLBACK_TIMEOUT_S
        max_retries = settings.GEMINI_IMAGE_MAX_RETRIES
        fallback_max_retries = settings.GEMINI_IMAGE_FALLBACK_MAX_RETRIES

        sizes = [len(b) for b, _m in images]
        mimes = [_m for _b, _m in images]
        logger.info(
            "[%s] edit_or_generate_image:start requested_model=%s selected_model=%s fallback_model=%s profile=%s allow_quality_fallback=%s imgs=%s sizes=%s mimes=%s ar=%s prompt=%s",
            trace_id, requested_model, model, fallback_model, _normalize_model_profile(model_profile), allow_fallback, len(images), sizes, mimes, aspect_ratio, _truncate(prompt, 500)
        )

        parts: List[Dict[str, Any]] = [{"text": prompt}]
        for raw, mime in images:
            safe_bytes, safe_mime = _ensure_reasonable_image_bytes(raw)
            parts.append({"inline_data": {"mime_type": safe_mime if safe_mime.startswith("image/") else (mime or "image/png"),
                                          "data": b64encode_bytes(safe_bytes)}})

        generation_config: Dict[str, Any] = {"responseModalities": ["TEXT", "IMAGE"]}
        if aspect_ratio:
            generation_config["imageConfig"] = {"aspectRatio": aspect_ratio}

        contents = [{"role": "user", "parts": parts}]

        t0 = time.perf_counter()
        resp = await self._generate_content_with_fallback(
            model=model,
            fallback_model=fallback_model,
            contents=contents,
            generation_config=generation_config,
            service_tier=service_tier,
            fallback_service_tier=service_tier,
            timeout_s=timeout_s,
            fallback_timeout_s=fallback_timeout_s,
            max_retries=max_retries,
            fallback_max_retries=fallback_max_retries,
            allow_quality_fallback=allow_fallback,
            retry_same_model_once=True,
            trace_id=trace_id,
            operation="edit_or_generate_image",
        )
        dt = (time.perf_counter() - t0) * 1000

        text, parts_out = self.api.extract_text_and_images(resp)
        out_text = (text or "").strip()

        img_b64 = None
        img_mime = None
        for p in parts_out:
            if p.inline_data_b64:
                img_b64 = p.inline_data_b64
                img_mime = p.inline_mime or "image/png"
                break

        if not img_b64:
            logger.warning("[%s] edit_or_generate_image: ms=%.1f no_image text=%s", trace_id, dt, _truncate(out_text, 300))
            return out_text, None, None

        try:
            img_bytes = base64.b64decode(img_b64)
            if aspect_ratio == "3:4":
                img_bytes, img_mime = self.ensure_wb_3x4(img_bytes, 900, 1200)
        except Exception as e:
            logger.exception("[%s] edit_or_generate_image: decode_failed", trace_id)
            raise GeminiApiError(f"Failed to decode image data: {e}")

        logger.info("[%s] edit_or_generate_image: ok ms=%.1f out_bytes=%s out_mime=%s text=%s",
                    trace_id, dt, len(img_bytes), img_mime, _truncate(out_text, 260))
        return out_text, img_bytes, img_mime

    async def store_generated_image(
        self,
        image_bytes: bytes,
        prompt: str,
        meta: Dict[str, Any] | None = None,
        *,
        trace_id: str = "-",
    ) -> Tuple[str, str]:
        rel = save_generated_file(image_bytes, kind="image", prefix="gemini_")
        save_generated_metadata(rel, {"source": "gemini", "prompt": prompt, **(meta or {})})
        url = get_file_url(rel)
        logger.info("[%s] store_generated_image: rel=%s url=%s bytes=%s", trace_id, rel, url, len(image_bytes))
        return rel, url
