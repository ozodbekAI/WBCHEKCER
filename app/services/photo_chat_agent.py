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
    def _should_use_fallback_model(exc: Exception) -> bool:
        msg = str(exc or "")
        lowered = msg.lower()
        return (
            "404" in msg
            or "429" in msg
            or "503" in msg
            or "not found" in lowered
            or "not_found" in lowered
            or "unavailable" in lowered
            or "high demand" in lowered
        )

    async def _generate_content_with_fallback(
        self,
        *,
        model: str,
        contents: List[Dict[str, Any]],
        generation_config: Optional[Dict[str, Any]] = None,
        fallback_model: Optional[str] = None,
        trace_id: str = "-",
        operation: str = "generate_content",
    ) -> Dict[str, Any]:
        try:
            async with self._sem:
                return await self.api.generate_content(
                    model=model,
                    contents=contents,
                    generation_config=generation_config,
                )
        except GeminiApiError as e:
            fallback = (fallback_model or "").strip()
            if not fallback or fallback == model or not self._should_use_fallback_model(e):
                raise

            logger.warning(
                "[%s] %s: model=%s unavailable, retrying with fallback=%s",
                trace_id,
                operation,
                model,
                fallback,
            )

        async with self._sem:
            return await self.api.generate_content(
                model=fallback,
                contents=contents,
                generation_config=generation_config,
            )

    
    async def plan_action_with_context(
        self,
        user_message: str,
        history: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
        thread_context: Optional[Dict[str, Any]] = None,
        trace_id: str = "-",
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
    ) -> Dict[str, Any]:
        return await self.plan_action(
            user_message=user_message,
            history=history,
            assets=assets,
            thread_context=thread_context,
            trace_id=trace_id,
            recent_image_bytes=recent_image_bytes,
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
        *,
        trace_id: str = "-",
    ) -> str:
        model = model or settings.GEMINI_TEXT_MODEL
        fallback_model = settings.GEMINI_TEXT_MODEL_FALLBACK
        contents = []
        if history:
            for h in history[-12:]:
                role = h.get("role") or "user"
                txt = h.get("text") or ""
                if txt.strip():
                    contents.append({"role": role, "parts": [{"text": txt}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        logger.info(
            "[%s] generate_text: model=%s hist=%s prompt=%s",
            trace_id, model, len(history or []), _truncate(prompt, 400),
        )

        t0 = time.perf_counter()
        resp = await self._generate_content_with_fallback(
            model=model,
            fallback_model=fallback_model,
            contents=contents,
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

        generation_config = {"responseMimeType": "application/json", "temperature": 0.2}

        t0 = time.perf_counter()
        resp = await self._generate_content_with_fallback(
            model=model,
            fallback_model=fallback_model,
            contents=contents,
            generation_config=generation_config,
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
        trace_id: str = "-",
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,  # [(asset_id, bytes, mime_type), ...]
    ) -> Dict[str, Any]:
        model = settings.GEMINI_VISION_MODEL  # Use vision model to see images
        fallback_model = settings.GEMINI_VISION_MODEL_FALLBACK

        assets_compact = [{
            "asset_id": a.get("asset_id"),
            "seq": a.get("seq"),
            "caption": (a.get("caption") or "")[:240],
            "tags": (a.get("tags") or [])[:8],
            "colors": (a.get("colors") or [])[:6],
            "clothing": (a.get("clothing") or "")[:80],
            "background": (a.get("background") or "")[:80],
            "pose": (a.get("pose") or "")[:80],
            "source": a.get("source"),
        } for a in assets]

        history_compact = [{
            "role": h.get("role"),
            "text": (h.get("text") or "")[:800],
            "asset_ids": h.get("asset_ids") or None,
        } for h in history[-12:] if (h.get("text") or "").strip() or h.get("asset_ids")]

        ctx = dict(thread_context or session_state or {})
        response_locale = resolve_photo_chat_locale(
            user_message=user_message,
            history=history,
            thread_context=ctx,
        )
        response_language = _language_label(response_locale)

        instruction = (
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
            "  }\n\n"
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

        payload = {
            "history": history_compact,
            "assets": assets_compact,
            "thread_context": ctx,
            "user_message": user_message,
        }

        # Build content parts: text instruction + optional images
        parts = [{"text": instruction + "\n\nCONTEXT:\n" + json.dumps(payload, ensure_ascii=False)}]
        
        # ✅ FIX: Include recent images so Gemini can actually SEE them
        if recent_image_bytes:
            for asset_id, img_bytes, mime_type in recent_image_bytes[:4]:  # Max 4 images
                try:
                    safe_bytes, safe_mime = _ensure_reasonable_image_bytes(img_bytes)
                    parts.append({
                        "inline_data": {
                            "mime_type": safe_mime if safe_mime.startswith("image/") else (mime_type or "image/jpeg"),
                            "data": b64encode_bytes(safe_bytes)
                        }
                    })
                    parts.append({"text": f"[This is asset_id={asset_id}]"})
                except Exception as e:
                    logger.warning("[%s] plan_action: failed to include image asset_id=%s: %s", trace_id, asset_id, e)
        
        contents = [{"role": "user", "parts": parts}]
        generation_config = {"responseMimeType": "application/json", "temperature": 0.3}

        logger.info(
            "[%s] plan_action: model=%s assets=%s hist=%s thread_context=%s locale=%s user=%s images=%s",
            trace_id, model, len(assets_compact), len(history_compact),
            {k: ctx.get(k) for k in ("last_generated_asset_id", "working_asset_ids", "pending_question", "last_action", "locale")},
            response_locale,
            _truncate(user_message, 300),
            len(recent_image_bytes or []),
        )

        t0 = time.perf_counter()
        try:
            resp = await self._generate_content_with_fallback(
                model=model,
                fallback_model=fallback_model,
                contents=contents,
                generation_config=generation_config,
                trace_id=trace_id,
                operation="plan_action",
            )
        except Exception as e:
            logger.exception("[%s] edit_or_generate_image: generate_content failed", trace_id)
            raise GeminiApiError(f"Image model error: {type(e).__name__}: {e}")
        dt = (time.perf_counter() - t0) * 1000

        text, _parts = self.api.extract_text_and_images(resp)
        raw = (text or "").strip()
        logger.info("[%s] plan_action: ms=%.1f raw=%s", trace_id, dt, _truncate(raw, 900))

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

        plan = {
            "intent": intent,
            "assistant_message": assistant_message,
            "selected_asset_ids": selected_asset_ids,
            "image_prompt": image_prompt,
            "image_count": image_count,
            "aspect_ratio": aspect_ratio,
        }

        logger.info("[%s] plan_action: parsed=%s", trace_id, plan)
        return plan
    
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
        *,
        trace_id: str = "-",
    ) -> Tuple[str, Optional[bytes], Optional[str]]:
        model = model or settings.GEMINI_IMAGE_MODEL
        fallback_model = settings.GEMINI_IMAGE_MODEL_FALLBACK

        sizes = [len(b) for b, _m in images]
        mimes = [_m for _b, _m in images]
        logger.info(
            "[%s] edit_or_generate_image: model=%s imgs=%s sizes=%s mimes=%s ar=%s prompt=%s",
            trace_id, model, len(images), sizes, mimes, aspect_ratio, _truncate(prompt, 500)
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
