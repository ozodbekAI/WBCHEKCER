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

    
    async def plan_action_with_context(
        self,
        user_message: str,
        history: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Enhanced planner that returns rich context for prompt generation.
        Returns:
        {
            "intent": "edit_image" | "generate_image" | "chat" | "question",
            "assistant_message": "...",
            "selected_asset_ids": [33, 34] or None,
            "image_prompt": "...",  # Basic prompt
            "aspect_ratio": "1:1" | "16:9" | None,
            "context": {  # NEW - rich context for prompt enhancement
                "source_asset_id": 33,  # Kiyim olinadigan rasm
                "target_asset_id": 34,  # Kiyim kiydiradigan model
                "action": "transfer_clothing",  # or "edit", "enhance", etc.
            }
        }
        """
        # Your existing plan_action implementation
        # Then add context extraction logic
        pass
    
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
            "- Keep the target background unless the task explicitly asks to change it.\n"
            "- Ensure realistic lighting, shadows, and proportions."
            "WB requirements:\n"
            "- Output must be vertical 3:4.\n"
            "- Keep the subject fully visible (no cropping), centered, clean background if not specified.\n"
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
        model = model or getattr(settings, "GEMINI_TEXT_MODEL", "gemini-2.5-flash")
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
        async with self._sem:
            resp = await self.api.generate_content(model=model, contents=contents)
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
        model = getattr(settings, "GEMINI_VISION_MODEL", "gemini-2.5-flash")
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
        async with self._sem:
            try:
                resp = await self.api.generate_content(model=model, contents=contents, generation_config=generation_config)
            except GeminiApiError as e:
                # Fallback if Pro image model is not available for this API key/project.
                fb = getattr(settings, "GEMINI_IMAGE_MODEL_FALLBACK", "gemini-2.5-flash-image")
                msg = str(e)
                if fb and fb != model and ("404" in msg or "not found" in msg.lower() or "NOT_FOUND" in msg):
                    logger.warning("[%s] edit_or_generate_image: model=%s unavailable, retrying with fallback=%s", trace_id, model, fb)
                    resp = await self.api.generate_content(model=fb, contents=contents, generation_config=generation_config)
                else:
                    raise
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
        session_state: Optional[Dict[str, Any]] = None,
        trace_id: str = "-",
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,  # [(asset_id, bytes, mime_type), ...]
    ) -> Dict[str, Any]:
        model = getattr(settings, "GEMINI_VISION_MODEL", "gemini-2.5-flash")  # Use vision model to see images

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

        # ✅ "oxirgisi" default (keyword/regex emas, bu dialog konteksti):
        # session_state: {"last_generated_asset_id": 12, "pending_asset_ids": [7], "pending_intent": "edit_image"}
        st = session_state or {}

        instruction = (
            "Ты — фоторедактор и ассистент AVEMOD. "
            "ВСЕГДА отвечай на русском языке, даже если пользователь пишет на другом языке.\n\n"

            "Пользователь может попросить: «Сделай промпт подробно и максимально точно — красиво, идеально и профессионально» — "
            "в таком случае ты обязан сформировать максимально детализированный image_prompt, чтобы результат соответствовал запросу.\n\n"

            "НЕ используй правила, ключевые слова, команды, префиксы или regex в общении с пользователем — только естественный диалог.\n\n"

            "Контекст:\n"
            "- assets: список изображений в сессии.\n"
            "- history: история диалога. history может содержать asset_ids — изображения, прикреплённые к сообщению.\n"
            "- session_state: внутреннее состояние (например last_generated_asset_id, pending_asset_ids).\n\n"

            "КРИТИЧЕСКИ ВАЖНО — УТОЧНЯЮЩИЕ ВОПРОСЫ:\n"
            "- Если запрос слишком общий или неполный (например: 'сделай авот', 'создай изображение', 'нарисуй что-нибудь'), "
            "НЕ генерируй изображение сразу!\n"
            "- Вместо этого используй intent='question' и задай уточняющий вопрос:\n"
            "  * Что именно создать? (тема, объект, стиль)\n"
            "  * Какие цвета предпочтительны?\n"
            "  * Какая композиция? (портрет, пейзаж, продукт)\n"
            "  * Или предложи 2-3 конкретных варианта на выбор\n"
            "- Только после получения конкретных деталей переходи к intent='generate_image'.\n\n"

            "КАК ПИСАТЬ image_prompt (чтобы изображение получилось как пользователь хочет):\n"
            "- image_prompt должен быть подробным и конкретным, не коротким.\n"
            "- Всегда описывай: кто/что в кадре, действие/поза, одежда/внешность, фон/локация, композиция, ракурс, освещение, стиль, настроение, цвета, уровень детализации.\n"
            "- Если это товар/каталог: описывай как для маркетплейса — чистый фон, точные материалы, фактуру, форму, цвет, без лишних объектов.\n"
            "- Если это художественная сцена: уточняй атмосферу, окружение, время суток, свет (мягкий/жёсткий), глубину резкости.\n"
            "- Избегай двусмысленных слов типа 'красиво', 'современно' без конкретики — заменяй конкретными деталями.\n"
            "- Не добавляй выдуманные детали, если они критичны. Если без них нельзя — задай вопрос (intent='question'). Если можно — делай разумные допущения и отражай их в image_prompt аккуратно.\n"
            "- Следи за отсутствием противоречий (например: 'ночь' и 'яркое полуденное солнце' одновременно).\n"
            "- Не упоминай asset_id/seq или номера ассетов в image_prompt — только 'Image 1', 'Image 2', ...\n\n"

            "Важно:\n"
            "- Если пользователь просит несколько вариантов/изображений (например: \"2 варианта\", \"3 картинки\", \"ещё 4\", \"yana 2 ta rasm\"), укажи \"image_count\" = нужное число (1..4). Если не указано — поставь 1.\n"
            "- Если ты ранее задавал уточняющий вопрос, следующее сообщение пользователя — ответ и продолжение.\n"
            "- Если пользователь просит изменить цвет/деталь, но НЕ уточняет изображение, "
            "используй session_state.last_generated_asset_id (или pending_asset_ids если есть).\n"
            "- Выбирай нужные asset_id сам по смыслу.\n"
            "- ВАЖНО ДЛЯ image_prompt: никогда не упоминай asset_id/seq или любые номера ассетов (например 41/42).\n"
            "  Модель обработки изображений понимает только порядок прикреплённых картинок.\n"
            "  Поэтому в image_prompt используй только позиционные ссылки: 'Image 1', 'Image 2', ...\n"
            "- selected_asset_ids ОБЯЗАТЕЛЬНО должен быть в том же порядке, в каком ты называешь картинки в image_prompt.\n"
            "  Например: если пишешь 'возьми одежду с Image 1 и надень на Image 2',\n"
            "  то selected_asset_ids[0] — источник (одежда), selected_asset_ids[1] — цель (модель).\n\n"
            "ДОПОЛНИТЕЛЬНЫЕ ПРОВЕРКИ ПЕРЕД edit_image:\n"
            "- Если пользователь просит перенести полный образ (верх+низ), а Image 1 не в полный рост — задай вопрос и попроси фото в полный рост.\n"
            "- Если Image 1 выглядит как карточка товара/баннер (есть крупный текст, иконки, коллаж, watermark) — предупреди, что нужно чистое фото модели без надписей, или предложи заменить на другое фото.\n"
            "- При переносе одежды ВСЕГДА явно требуй: 'не менять лицо/прическу/телосложение/позу' и 'менять только одежду'.\n"

            "Примеры правильного поведения:\n"
            "Пользователь: 'сделай авот'\n"
            "Ты: {\"intent\": \"question\", \"assistant_message\": \"Что именно вы хотите создать? Например: модная одежда на модели, пейзаж природы или товарное фото. Опишите подробнее: объект, стиль, фон и цвета.\", ...}\n\n"
            "Пользователь: 'создай изображение девушки в красном платье на пляже'\n"
            "Ты: {\"intent\": \"generate_image\", \"image_prompt\": \"Фотореалистичный портрет девушки 25–30 лет в красном летнем платье на песчаном пляже на закате, мягкий тёплый свет, лёгкий ветер развевает волосы, композиция по пояс, камера на уровне глаз, естественные цвета, высокая детализация кожи и ткани, спокойное настроение, без текста и водяных знаков.\", ...}\n\n"

            "Верни СТРОГО JSON:\n"
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
            "session_state": st,
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
            "[%s] plan_action: model=%s assets=%s hist=%s state=%s user=%s images=%s",
            trace_id, model, len(assets_compact), len(history_compact),
            {k: st.get(k) for k in ("last_generated_asset_id", "pending_asset_ids", "pending_intent")},
            _truncate(user_message, 300),
            len(recent_image_bytes or []),
        )

        t0 = time.perf_counter()
        try:
            async with self._sem:
                resp = await self.api.generate_content(model=model, contents=contents, generation_config=generation_config)
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
        model = model or getattr(settings, "GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")

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
        async with self._sem:
            resp = await self.api.generate_content(model=model, contents=contents, generation_config=generation_config)
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