"""
GPTService — OpenAI GPT-4o-mini orqali barcha AI operatsiyalarini bajaradi.

AI_PROVIDER=gpt bo'lganda card_service bu serviceni ishlatadi.
Interfeysi GeminiService bilan bir xil: audit_card, generate_fixes,
generate_title, generate_description, refix_value, refix_title, refix_description.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from ..core.config import settings
from .wb_logic_prompt import build_wb_logic_block

logger = logging.getLogger(__name__)

_EMPTY_TOKENS = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}


def _strip_code_fences(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _extract_json(text: str) -> Dict[str, Any]:
    text = _strip_code_fences(text)

    def _ensure_dict(val):
        if isinstance(val, dict):
            return val
        if isinstance(val, list):
            if len(val) == 1 and isinstance(val[0], dict):
                return val[0]
            return {"items": val}
        return {}

    try:
        return _ensure_dict(json.loads(text))
    except Exception:
        pass

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return _ensure_dict(json.loads(text[start:end + 1]))
        except Exception:
            pass

    start, end = text.find("["), text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return _ensure_dict(json.loads(text[start:end + 1]))
        except Exception:
            pass

    return {}


def _load_image_b64(url: str) -> Tuple[Optional[str], Optional[str]]:
    """URL dan rasmni yuklab base64 ga o'giradi."""
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(url, follow_redirects=True)
        if resp.status_code != 200:
            return None, None
        mime = resp.headers.get("content-type", "image/jpeg").split(";")[0]
        return base64.b64encode(resp.content).decode(), mime
    except Exception:
        return None, None


def _get_card_photo(card: Dict[str, Any]) -> Optional[str]:
    photos = card.get("photos") or []
    if not photos:
        return None
    p0 = photos[0]
    if isinstance(p0, dict):
        return p0.get("big") or p0.get("url")
    if isinstance(p0, str):
        return p0
    return None


class GPTService:
    """
    OpenAI GPT-4o-mini orqali barcha AI operatsiyalarini bajaradi.
    GeminiService bilan bir xil interfeys.
    """

    def __init__(self) -> None:
        self._api_key = settings.OPENAI_API_KEY
        self._model = settings.OPENAI_MODEL
        self._base_url = "https://api.openai.com/v1/chat/completions"

    def is_enabled(self) -> bool:
        return bool(self._api_key and settings.AI_ENABLED)

    def _call_api(
        self,
        prompt: str,
        image_url: Optional[str] = None,
        max_tokens: Optional[int] = None,
        retry_count: int = 0,
        max_retries: int = 3,
        **_kwargs,  # thinking_budget va boshqa Gemini-specific paramlarni e'tiborsiz qoldiradi
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """
        OpenAI Chat Completions API ga murojaat qiladi.
        Gemini _call_api interfeysi bilan mos (thinking_budget ignored).
        """
        if not self._api_key:
            return {}, _EMPTY_TOKENS

        mt = max_tokens or settings.GEMINI_MAX_OUTPUT_TOKENS

        # Build message content
        user_content: Any
        if image_url:
            img_b64, mime = _load_image_b64(image_url)
            if img_b64 and mime:
                user_content = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{img_b64}",
                            "detail": "high",
                        },
                    },
                    {"type": "text", "text": prompt},
                ]
            else:
                user_content = prompt
        else:
            user_content = prompt

        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": user_content}],
            "max_tokens": mt,
            "temperature": settings.GEMINI_TEMPERATURE,
            "response_format": {"type": "json_object"},
        }

        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(
                    self._base_url,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code in {429, 503} and retry_count < max_retries:
                wait = 2 ** retry_count
                logger.warning("[gpt] %d error, retry %d/%d after %ds", e.response.status_code, retry_count + 1, max_retries, wait)
                time.sleep(wait)
                return self._call_api(prompt, image_url, max_tokens, retry_count + 1, max_retries)
            logger.error("[gpt] HTTP %d: %s", e.response.status_code, str(e)[:200])
            return {}, _EMPTY_TOKENS
        except Exception as e:
            logger.error("[gpt] API error: %s", e)
            return {}, _EMPTY_TOKENS

        usage = data.get("usage") or {}
        tokens = {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "thinking_tokens": 0,
            "total_tokens": usage.get("total_tokens", 0),
        }

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            return {}, tokens

        result = _extract_json(text) if text else {}
        return result, tokens

    # ── Public methods (same interface as GeminiService) ─────────────────────

    def audit_card(
        self,
        card: Dict[str, Any],
        product_dna: str = "",
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        if not self.is_enabled():
            return [], _EMPTY_TOKENS

        subject_name = card.get("subjectName") or card.get("subject_name") or ""
        subject_id = card.get("subjectID") or card.get("subject_id") or ""

        compact: Dict[str, Any] = {
            "subjectID": subject_id,
            "subjectName": subject_name,
            "vendorCode": card.get("vendorCode") or card.get("vendor_code"),
            "brand": card.get("brand"),
            "title": card.get("title"),
        }
        desc = card.get("description") or ""
        compact["description"] = desc[:1500] if len(desc) > 1500 else desc

        chars_raw = card.get("characteristics") or []
        if isinstance(chars_raw, list):
            char_list = [
                {"id": ch.get("id"), "name": ch.get("name", ""), "value": ch.get("value", ch.get("values"))}
                for ch in chars_raw
            ]
        elif isinstance(chars_raw, dict):
            char_list = [{"name": k, "value": v} for k, v in chars_raw.items()]
        else:
            char_list = []
        # Exclude characteristics controlled by fixed file — they're locked.
        fixed_chars_set = set(
            n.lower() for n in (card.get("_fixed_file_chars") or [])
        )
        if fixed_chars_set:
            char_list = [
                ch for ch in char_list
                if (ch.get("name") or "").lower() not in fixed_chars_set
            ]
        compact["characteristics"] = char_list

        valid_char_names = card.get("_valid_char_names") or []
        valid_chars_section = ""
        if valid_char_names:
            valid_chars_section = f"""
ДОПУСТИМЫЕ ХАРАКТЕРИСТИКИ ДЛЯ КАТЕГОРИИ "{subject_name}":
{json.dumps(valid_char_names, ensure_ascii=False)}
Если в карточке есть характеристики НЕ из этого списка и они заполнены — это ошибка.
"""
        seo_keywords_list = card.get("_seo_keywords") or []
        seo_keywords_section = ""
        if seo_keywords_list:
            seo_keywords_section = f"""
SEO-КЛЮЧЕВЫЕ СЛОВА ДЛЯ КАТЕГОРИИ "{subject_name}":
{', '.join(seo_keywords_list[:20])}
Проверь: есть ли хотя бы 1 ключевое слово в названии, минимум 2 в описании.
"""
        logic_block = build_wb_logic_block(include_output=False)

        dna_block = ""
        if product_dna:
            dna_block = f"\nТЕХНИЧЕСКОЕ ОПИСАНИЕ ТОВАРА ПО ФОТО (источник истины о товаре):\n{product_dna[:2000]}\n"

        prompt = f"""
РОЛЬ: Ты — старший модератор-аудитор маркетплейса Wildberries.

{logic_block}

ЗАДАЧА: Проанализируй карточку товара. Найди РЕАЛЬНЫЕ ошибки и несоответствия.
Не выдумывай — если не уверен, ставь severity="warning".

КАТЕГОРИЯ ТОВАРА: "{subject_name}" (subjectID={subject_id})
{valid_chars_section}{seo_keywords_section}
{dna_block}
ЧТО ПРОВЕРЯТЬ:
1. ОПИСАНИЕ ↔ ХАРАКТЕРИСТИКИ — Цвет, тип, фасон, комплектность соответствуют?
2. КАТЕГОРИЯ ↔ ТЕКСТ — Название/описание соответствуют категории "{subject_name}"?
3. ТЕКСТ ↔ ХАРАКТЕРИСТИКИ — Нет ли обрезанных/неполных значений, логических конфликтов?
4. ХАРАКТЕРИСТИКИ ↔ КАТЕГОРИЯ — Есть ли характеристики НЕ из допустимого списка?
5. АРТИКУЛ / VENDORCODE — Если указан цвет, совпадает с «Цвет»?
6. ДАТЫ/СЕРТИФИКАТЫ — НЕ анализируй, НЕ предлагай исправления.
7. SEO — есть ли ключевые слова категории в названии (≥1) и описании (≥2)?
8. НАЗВАНИЕ — ФОРМУЛА: начинается с категории, есть ключевой признак, 35–60 символов, нет маркетинга/пола.

CARD JSON:
{json.dumps(compact, ensure_ascii=False)[:4000]}

ФОРМАТ ОТВЕТА — строго JSON, без markdown:
{{
  "errors": [
    {{
      "charcId": <int или null>,
      "name": "<название характеристики или поля>",
      "value": <текущее значение>,
      "message": "<краткое описание проблемы, 1-2 предложения>",
      "severity": "critical|error|warning",
      "category": "photo|text|identification|qualification|mixed",
      "fix_action": "replace|clear|swap|compound",
      "swap_to_name": "<если fix_action=swap>",
      "swap_to_value": "<если fix_action=swap>",
      "compound_fixes": [],
      "errors": [{{"type": "vision_mismatch|category_mismatch|text_mismatch|contradiction|other", "message": "<подробнее>"}}]
    }}
  ]
}}

Если ошибок нет — верни: {{"errors": []}}
""".strip()

        image_url = None if product_dna else _get_card_photo(card)
        result, tokens = self._call_api(
            prompt,
            image_url=image_url,
            max_tokens=settings.GEMINI_AUDIT_MAX_OUTPUT_TOKENS,
        )

        if isinstance(result, list):
            return result, tokens
        if isinstance(result, dict):
            errors = result.get("errors") or result.get("items")
            if isinstance(errors, list):
                return errors, tokens
        return [], tokens

    def generate_fixes(
        self,
        card: Dict[str, Any],
        issues: List[Dict[str, Any]],
        product_dna: str = "",
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
        if not self.is_enabled():
            return {}, _EMPTY_TOKENS

        subject = card.get("subjectName") or card.get("subject_name") or ""
        compact_card: Dict[str, Any] = {
            "subjectName": subject,
            "title": card.get("title"),
            "description": (card.get("description") or "")[:1200],
            "brand": card.get("brand"),
            "vendorCode": card.get("vendorCode") or card.get("vendor_code"),
        }
        chars_raw = card.get("characteristics") or []
        if isinstance(chars_raw, list):
            compact_card["characteristics"] = [
                {"name": ch.get("name"), "value": ch.get("value", ch.get("values"))}
                for ch in chars_raw[:30]
            ]
        logic_block = build_wb_logic_block(include_output=True)

        issues_data = []
        for i, iss in enumerate(issues):
            issues_data.append({
                "id": str(i),
                "error_type": iss.get("error_type") or iss.get("code") or "",
                "name": iss.get("name") or iss.get("title") or "",
                "current_value": iss.get("current_value") or iss.get("value"),
                "description": iss.get("description") or iss.get("message") or "",
                "allowed_values": iss.get("allowed_values") or [],
                "errors": iss.get("errors") or [],
            })

        dna_block = ""
        if product_dna:
            dna_block = f"\nТЕХНИЧЕСКОЕ ОПИСАНИЕ ТОВАРА ПО ФОТО:\n{product_dna[:2000]}\n"

        prompt = f"""
РОЛЬ: Ты — SEO-эксперт и копирайтер Wildberries.

{logic_block}

ЗАДАЧА: Для каждой проблемы создай ГОТОВОЕ ИСПРАВЛЕНИЕ с конкретным значением.

КАРТОЧКА ТОВАРА:
{json.dumps(compact_card, ensure_ascii=False)[:3500]}
{dna_block}
СПИСОК ПРОБЛЕМ:
{json.dumps(issues_data, ensure_ascii=False)[:5000]}

ПРАВИЛА:
• Если есть allowed_values → выбирай СТРОГО из этого списка (точное совпадение).
• Для цветовых полей → верни ОДИН parent color строкой.
• Для title → 40-60 символов, без бренда, без пола, без маркетинга.
• Для description → 1000-1800 символов, 3-6 абзацев, без маркетинга.
• recommended_value — ГОТОВОЕ значение для немедленного применения.
• ЗАПРЕЩЕНО: советы, инструкции, пустые строки вместо значений.

ФОРМАТ ОТВЕТА — строго JSON:
{{
  "fixes": {{
    "<id проблемы>": {{
      "recommended_value": "<string или array>",
      "reason": "<почему именно это значение>",
      "fix_action": "replace|clear|swap",
      "swap_to_name": "<только если swap>",
      "swap_to_value": "<только если swap>"
    }}
  }}
}}
""".strip()

        needs_vision = not product_dna and any(
            str((it or {}).get("error_type") or "").startswith("ai_")
            for it in issues_data
        )
        result, tokens = self._call_api(
            prompt,
            image_url=_get_card_photo(card) if needs_vision else None,
            max_tokens=settings.GEMINI_FIX_MAX_OUTPUT_TOKENS,
        )

        if isinstance(result, dict):
            return result.get("fixes", {}), tokens
        return {}, tokens

    def refix_value(
        self,
        card: Dict[str, Any],
        char_name: str,
        current_value: Any,
        failed_reason: str,
        allowed_values: List[str],
        limits: Optional[Dict] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        if not self.is_enabled():
            return {}, _EMPTY_TOKENS

        subject = card.get("subjectName") or card.get("subject_name") or ""
        limit_hint = ""
        if limits:
            mn, mx = limits.get("min"), limits.get("max")
            if mn is not None or mx is not None:
                limit_hint = f"\nЛимит: от {mn} до {mx} значений. Верни массив правильной длины."
        color_hint = ""
        if "цвет" in (char_name or "").lower():
            color_hint = (
                "\nЭто цветовая характеристика: верни ОДИН parent color "
                "(не массив оттенков). Backend сам развернет его в близкие оттенки."
            )
        logic_block = build_wb_logic_block(include_output=False)

        prompt = f"""
ЗАДАЧА: Подобрать правильное значение для характеристики товара на Wildberries.

{logic_block}

Товар: "{card.get('title')}" (категория: {subject})
Характеристика: "{char_name}"
Текущее значение: {json.dumps(current_value, ensure_ascii=False)}
Предыдущая попытка не прошла проверку: {failed_reason}

ДОПУСТИМЫЕ ЗНАЧЕНИЯ (выбирай ТОЛЬКО из этого списка!):
{json.dumps(allowed_values[:80], ensure_ascii=False)}
{limit_hint}
{color_hint}

ВАЖНО: Значение ДОЛЖНО быть ТОЧНО из списка (без изменений регистра/пробелов).

Ответ строго JSON:
{{
  "recommended_value": "<string или array — ТОЧНО из списка>",
  "reason": "<почему именно это>"
}}
""".strip()

        result, tokens = self._call_api(prompt, max_tokens=settings.GEMINI_REFIX_MAX_OUTPUT_TOKENS)
        return (result if isinstance(result, dict) else {}), tokens

    def pick_color_shades(
        self,
        parent_color: str,
        children: List[str],
        product_dna: str = "",
        count: int = 4,
    ) -> Tuple[List[str], Dict[str, int]]:
        """
        AI picks the closest color shades from parent's children list
        for the given product. Returns (selected_shades, tokens).
        """
        if not self.is_enabled() or not children:
            return [], _EMPTY_TOKENS

        dna_block = ""
        if product_dna:
            dna_block = f"\nТЕХНИЧЕСКОЕ ОПИСАНИЕ ТОВАРА ПО ФОТО:\n{product_dna[:1500]}\n"

        prompt = f"""
ЗАДАЧА: Подобрать {count} ближайших оттенков для товара.

Основной цвет товара: "{parent_color}"
{dna_block}
СПИСОК ДОСТУПНЫХ ОТТЕНКОВ (выбирай ТОЛЬКО из этого списка!):
{json.dumps(children, ensure_ascii=False)}

ПРАВИЛА:
• Выбери ровно {count} оттенков из списка, которые БЛИЖЕ ВСЕГО к основному цвету товара.
• Учитывай описание товара — оттенки должны подходить именно этому изделию.
• Верни ТОЧНЫЕ значения из списка (без изменений).
• Порядок: от самого подходящего к менее подходящему.

Ответ строго JSON:
{{
  "shades": ["оттенок1", "оттенок2", ...]
}}
""".strip()

        result, tokens = self._call_api(prompt, max_tokens=300)
        if isinstance(result, dict):
            shades = result.get("shades", [])
            if isinstance(shades, list):
                # Filter to only valid children
                children_norm = {c.lower().strip(): c for c in children}
                valid = []
                for s in shades:
                    s_str = str(s).strip()
                    matched = children_norm.get(s_str.lower())
                    if matched and matched not in valid:
                        valid.append(matched)
                return valid[:count], tokens
        return [], tokens

    def generate_product_dna_text(
        self,
        image_url: str,
        subject_name: str = "",
    ) -> str:
        """
        GPT-4o-mini orqali mahsulot fotosidan Product DNA yaratadi.
        Gemini service bilan bir xil prompt va interfeys.
        """
        if not self.is_enabled():
            return ""

        prompt = f"""Ты — эксперт по анализу fashion-товаров для маркетплейса Wildberries.
Создай техническое описание товара по фотографии.

Проанализируй изображение по блокам:
1. ТИП ТОВАРА — категория, комплект или одиночное, элементы комплекта.
2. КОНСТРУКЦИЯ ИЗДЕЛИЯ — верх и низ: тип, длина, посадка, рукава, воротник, карманы, застёжка.
3. СИЛУЭТ И ПОСАДКА — силуэт, прилегание, линия талии, длина.
4. ЦВЕТ И ВНЕШНИЙ ВИД — цвет, оттенок, принт, фактура ткани.
5. МАТЕРИАЛ — если не определён, укажи "не определено".
6. ДЕКОРАТИВНЫЕ ЭЛЕМЕНТЫ — пуговицы, молнии, строчки, разрезы, накладные элементы.
7. СТИЛЬ — casual / городской / офисный / минимализм.
8. СЕЗОННОСТЬ — лето / демисезон / всесезон / не определено.
9. ОСОБЕННОСТИ МОДЕЛИ — крой, уникальные элементы.
10. КРАТКОЕ ОБОБЩЕНИЕ — 2–3 предложения, только факты.

Категория товара: {subject_name or 'не указана'}
Требования: 300–500 слов, без маркетинга, только наблюдаемые свойства.
Верни ТОЛЬКО текст по блокам."""

        try:
            payload = {
                "model": self._model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": image_url, "detail": "high"},
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
                "max_tokens": 1500,
                "temperature": 0.1,
            }
            import httpx as _httpx
            with _httpx.Client(timeout=90.0) as client:
                resp = client.post(
                    self._base_url,
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
            if resp.status_code != 200:
                return ""
            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
            return text if len(text) > 50 else ""
        except Exception:
            return ""

    def generate_title(
        self,
        card: Dict[str, Any],
        product_dna: str = "",
        seo_keywords: list = None,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        if not self.is_enabled():
            return {}, _EMPTY_TOKENS

        subject = card.get("subjectName") or card.get("subject_name") or ""
        brand = card.get("brand") or ""
        chars_raw = card.get("characteristics") or []
        char_hints = []
        if isinstance(chars_raw, list):
            for ch in chars_raw[:20]:
                nm = ch.get("name", "")
                vl = ch.get("value", ch.get("values"))
                if nm and vl:
                    char_hints.append(f"{nm}: {vl}")
        chars_text = "\n".join(char_hints) if char_hints else "нет данных"
        tech_desc = card.get("tech_description") or card.get("description") or ""
        logic_block = build_wb_logic_block(include_output=False)

        dna_block = ""
        if product_dna:
            dna_block = f"\nВИЗУАЛЬНОЕ ОПИСАНИЕ ТОВАРА (из фото):\n{product_dna[:1500]}\n"

        kw_block = ""
        if seo_keywords:
            kw_block = f"\nSEO-КЛЮЧЕВЫЕ СЛОВА КАТЕГОРИИ \"{subject}\" (используй хотя бы 1-2 естественно):\n{', '.join(seo_keywords[:15])}\n"

        prompt = f"""
ЗАДАЧА: Создай название товара для Wildberries на основе характеристик карточки.

{logic_block}

Категория: "{subject}"
Бренд (НЕ включать в название!): "{brand}"

Характеристики товара:
{chars_text}

{'Техническое описание:' + chr(10) + tech_desc[:800] if tech_desc else ''}
{dna_block}{kw_block}
СТРОГИЕ ПРАВИЛА:
• Формула: [Категория] [ключевой признак] [конструктив] [назначение] [цвет при необходимости]
• Длина: 40–60 символов (идеально 40–50)
• ЗАПРЕЩЕНО включать бренд "{brand}"
• ЗАПРЕЩЕНО: пол, маркетинг (стильный, топ, хит, лучший, идеальный, премиум, красивый)
• ЗАПРЕЩЕНО: CAPS, спецсимволы, эмодзи, запятые, повтор слов
• Верни ОДИН лучший вариант

Ответ строго JSON:
{{
  "recommended_value": "<созданное название>",
  "reason": "<какие признаки использованы>"
}}
""".strip()

        result, tokens = self._call_api(
            prompt,
            image_url=None if product_dna else _get_card_photo(card),
            max_tokens=settings.GEMINI_REFIX_MAX_OUTPUT_TOKENS,
        )
        return (result if isinstance(result, dict) else {}), tokens

    def generate_description(
        self,
        card: Dict[str, Any],
        product_dna: str = "",
        seo_keywords: list = None,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        if not self.is_enabled():
            return {}, _EMPTY_TOKENS

        subject = card.get("subjectName") or card.get("subject_name") or ""
        title = card.get("title") or ""
        chars_raw = card.get("characteristics") or []
        char_hints = []
        if isinstance(chars_raw, list):
            for ch in chars_raw[:25]:
                name = ch.get("name")
                val = ch.get("value", ch.get("values"))
                if name and val:
                    char_hints.append({"name": name, "value": val})
        elif isinstance(chars_raw, dict):
            for k, v in list(chars_raw.items())[:25]:
                if v:
                    char_hints.append({"name": k, "value": v})
        tech_desc = card.get("tech_description") or ""
        logic_block = build_wb_logic_block(include_output=False)

        dna_block = ""
        if product_dna:
            dna_block = f"\nВИЗУАЛЬНОЕ ОПИСАНИЕ ТОВАРА (из фото):\n{product_dna[:1500]}\n"

        kw_block = ""
        if seo_keywords:
            kw_block = f"\nSEO-КЛЮЧЕВЫЕ СЛОВА КАТЕГОРИИ \"{subject}\" (обязательно включи минимум 2-3 из них естественно):\n{', '.join(seo_keywords[:20])}\n"

        prompt = f"""
ЗАДАЧА: Создай описание товара для Wildberries на основе характеристик карточки.

{logic_block}

Категория: "{subject}"
Название: "{title}"

Характеристики товара:
{json.dumps(char_hints, ensure_ascii=False)}

{'Техническое описание (источник истины):' + chr(10) + tech_desc[:1000] if tech_desc else ''}
{dna_block}{kw_block}
СТРОГИЕ ПРАВИЛА:
• Длина: 1000–1800 символов
• Формат: 3–6 абзацев, без списков, маркеров, нумерации
• Каждый абзац: 2–4 предложения
• Структура: вступление → конструкция/посадка → материал (если подтверждён) → назначение → особенности/уход
• Пиши ТОЛЬКО факты из характеристик — не придумывай
• ЗАПРЕЩЕНО: маркетинг, эмоции, обещания эффекта, ссылки, телефоны, CAPS, эмодзи
• Верни готовый текст описания

Ответ строго JSON:
{{
  "recommended_value": "<готовое описание 1000–1800 символов>",
  "reason": "<структура и источники>"
}}
""".strip()

        result, tokens = self._call_api(
            prompt,
            image_url=None if product_dna else _get_card_photo(card),
            max_tokens=max(settings.GEMINI_REFIX_MAX_OUTPUT_TOKENS, 2048),
        )
        return (result if isinstance(result, dict) else {}), tokens

    def refix_title(
        self,
        card: Dict[str, Any],
        current_title: str,
        failed_reason: str,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        if not self.is_enabled():
            return {}, _EMPTY_TOKENS

        subject = card.get("subjectName") or card.get("subject_name") or ""
        brand = card.get("brand") or ""
        chars_raw = card.get("characteristics") or []
        char_hints = []
        if isinstance(chars_raw, list):
            for ch in chars_raw[:15]:
                nm = ch.get("name", "")
                vl = ch.get("value", ch.get("values"))
                if nm and vl:
                    char_hints.append(f"{nm}: {vl}")
        chars_text = "\n".join(char_hints) if char_hints else "нет данных"
        logic_block = build_wb_logic_block(include_output=False)

        prompt = f"""
ЗАДАЧА: Исправь название товара для Wildberries.

{logic_block}

Категория: "{subject}"
Бренд (НЕ включать!): "{brand}"
Текущее предложение: "{current_title}"
Причина отказа: {failed_reason}

Характеристики товара:
{chars_text}

СТРОГИЕ ПРАВИЛА:
• Длина: 40–60 символов
• ЗАПРЕЩЕНО: бренд, пол, маркетинг, CAPS, спецсимволы, эмодзи, запятые
• Структура: [Категория] [ключевой признак] [конструктив] [назначение] [цвет при необходимости]
• Верни ОДИН лучший вариант

Ответ строго JSON:
{{
  "recommended_value": "<исправленное название>",
  "reason": "<что исправлено>"
}}
""".strip()

        result, tokens = self._call_api(prompt, max_tokens=settings.GEMINI_REFIX_MAX_OUTPUT_TOKENS)
        return (result if isinstance(result, dict) else {}), tokens

    def refix_description(
        self,
        card: Dict[str, Any],
        current_description: str,
        failed_reason: str,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        if not self.is_enabled():
            return {}, _EMPTY_TOKENS

        subject = card.get("subjectName") or card.get("subject_name") or ""
        title = card.get("title") or ""
        chars_raw = card.get("characteristics") or []
        char_hints = []
        if isinstance(chars_raw, list):
            for ch in chars_raw[:20]:
                name = ch.get("name")
                val = ch.get("value", ch.get("values"))
                if name and val:
                    char_hints.append({"name": name, "value": val})
        elif isinstance(chars_raw, dict):
            for k, v in list(chars_raw.items())[:20]:
                if v:
                    char_hints.append({"name": k, "value": v})
        logic_block = build_wb_logic_block(include_output=False)

        prompt = f"""
ЗАДАЧА: Исправь описание товара для Wildberries.

{logic_block}

Категория: "{subject}"
Название: "{title}"
Текущее описание:
{current_description[:2800]}

Причина отказа валидатора: {failed_reason}

Характеристики товара:
{json.dumps(char_hints, ensure_ascii=False)}

СТРОГИЕ ПРАВИЛА:
• Длина: 1000-1800 символов
• Формат: 3-6 абзацев, без списков
• Каждый абзац: 2-4 предложения
• Пиши только факты, без маркетинга, CAPS, эмодзи
• Верни ОДИН готовый вариант описания

Ответ строго JSON:
{{
  "recommended_value": "<готовое описание 1000-1800>",
  "reason": "<что исправлено>"
}}
""".strip()

        result, tokens = self._call_api(
            prompt,
            max_tokens=max(settings.GEMINI_REFIX_MAX_OUTPUT_TOKENS, 2048),
        )
        return (result if isinstance(result, dict) else {}), tokens

    def get_suggestions(
        self,
        card: Dict[str, Any],
        issues: List[Dict[str, Any]],
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
        """Legacy method — delegates to generate_fixes"""
        return self.generate_fixes(card, issues)


# Singleton
_gpt_service: Optional[GPTService] = None


def get_gpt_service() -> GPTService:
    global _gpt_service
    if _gpt_service is None:
        _gpt_service = GPTService()
    return _gpt_service
