"""
Gemini AI Service for card analysis
Provides AI-powered validation and suggestions
"""
from __future__ import annotations

import base64
import json
import mimetypes
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from ..core.config import settings
from .wb_logic_prompt import build_wb_logic_block


def _strip_code_fences(text: str) -> str:
    """Remove code fences from response"""
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _extract_json(text: str) -> Dict[str, Any]:
    """Extract JSON from text response — always returns a dict"""
    text = _strip_code_fences(text)

    def _ensure_dict(val):
        """Wrap non-dict JSON values so callers always get a dict"""
        if isinstance(val, dict):
            return val
        if isinstance(val, list):
            # Gemini sometimes returns [{...}] or [{"errors": ...}]
            if len(val) == 1 and isinstance(val[0], dict):
                return val[0]
            return {"items": val}
        return {}

    try:
        return _ensure_dict(json.loads(text))
    except Exception:
        pass

    # Try to find JSON object in text
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return _ensure_dict(json.loads(text[start:end + 1]))
        except Exception:
            pass

    # Try to find JSON array in text
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return _ensure_dict(json.loads(text[start:end + 1]))
        except Exception:
            pass

    # Heuristic fallback for partially valid JSON fragments with recommended_value.
    rec_match = re.search(
        r'"recommended_value"\s*:\s*("(?:(?:\\.)|[^"\\])*"|null|\[[\s\S]*?\])',
        text,
        flags=re.IGNORECASE,
    )
    if rec_match:
        rec_raw = rec_match.group(1)
        rec_value: Any = None
        try:
            rec_value = json.loads(rec_raw)
        except Exception:
            rec_value = rec_raw.strip().strip('"')

        reason = ""
        reason_match = re.search(
            r'"reason"\s*:\s*("(?:(?:\\.)|[^"\\])*")',
            text,
            flags=re.IGNORECASE,
        )
        if reason_match:
            try:
                reason = str(json.loads(reason_match.group(1)))
            except Exception:
                reason = reason_match.group(1).strip().strip('"')

        return {"recommended_value": rec_value, "reason": reason}

    return {}


def _guess_mime(p: str) -> str:
    """Guess MIME type from path"""
    p = (p or "").lower()
    if p.endswith(".webp"):
        return "image/webp"
    if p.endswith(".png"):
        return "image/png"
    if p.endswith(".jpg") or p.endswith(".jpeg"):
        return "image/jpeg"
    mt, _ = mimetypes.guess_type(p)
    return mt or "application/octet-stream"


def _download_bytes(url: str, timeout: float = 30.0) -> bytes:
    """Download bytes from URL"""
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.content


def _load_image_b64(image: str) -> Tuple[Optional[str], Optional[str]]:
    """Load image as base64"""
    if not image:
        return None, None
    try:
        if image.startswith("http://") or image.startswith("https://"):
            data = _download_bytes(image)
            mime = _guess_mime(image)
            return base64.b64encode(data).decode(), mime
        # Local file
        with open(image, "rb") as f:
            data = f.read()
        mime = _guess_mime(image)
        return base64.b64encode(data).decode(), mime
    except Exception:
        return None, None


def _get_card_photo(card: Dict[str, Any]) -> Optional[str]:
    """Get first big photo from card"""
    photos = card.get("photos") or []
    if not photos:
        return None
    
    p0 = photos[0]
    if isinstance(p0, dict):
        return p0.get("big") or p0.get("url")
    if isinstance(p0, str):
        return p0
    return None


class GeminiService:
    """Gemini AI service for card analysis"""
    
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.model = settings.GEMINI_MODEL
        self.max_output_tokens = settings.GEMINI_MAX_OUTPUT_TOKENS
        self.temperature = settings.GEMINI_TEMPERATURE
    
    def is_enabled(self) -> bool:
        """Check if AI is enabled and configured"""
        return bool(self.api_key and settings.AI_ENABLED)
    
    def _call_api(
        self, 
        prompt: str, 
        image_url: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        max_output_tokens: Optional[int] = None,
        retry_count: int = 0,
        max_retries: int = 3,
        raw_text: bool = False,
    ) -> Tuple[Any, Dict[str, int]]:
        """Call Gemini API with JSON response and retry logic.
        Returns (result_dict, token_usage) where token_usage =
        {prompt_tokens, completion_tokens, total_tokens}.
        If raw_text=True, returns (str, token_usage) without JSON parsing.
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}

        if not self.api_key:
            return ("" if raw_text else {}), _empty_tokens
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        params = {"key": self.api_key}
        
        parts: List[Dict[str, Any]] = [{"text": prompt}]
        
        # Add image if provided
        if image_url:
            img_b64, mime = _load_image_b64(image_url)
            if img_b64 and mime:
                parts.insert(0, {
                    "inline_data": {"mime_type": mime, "data": img_b64}
                })
        
        generation_config: Dict[str, Any] = {
            "temperature": self.temperature,
            "maxOutputTokens": max_output_tokens or self.max_output_tokens,
        }
        if not raw_text:
            generation_config["responseMimeType"] = "application/json"
        if thinking_budget is not None and int(thinking_budget) > 0:
            generation_config["thinkingConfig"] = {"thinkingBudget": int(thinking_budget)}

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation_config,
        }
        
        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(url, params=params, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as e:
            # Handle 503 Service Unavailable
            if e.response.status_code == 503:
                if retry_count < max_retries:
                    # Exponential backoff: 2^retry seconds
                    wait_time = 2 ** retry_count
                    print(f"Gemini API 503 error. Retry {retry_count + 1}/{max_retries} after {wait_time}s...")
                    time.sleep(wait_time)
                    return self._call_api(
                        prompt,
                        image_url,
                        thinking_budget=thinking_budget,
                        max_output_tokens=max_output_tokens,
                        retry_count=retry_count + 1,
                        max_retries=max_retries,
                        raw_text=raw_text,
                    )
                else:
                    print(f"Gemini API 503 error after {max_retries} retries. Skipping AI...")
                    return ("" if raw_text else {}), _empty_tokens
            else:
                print(f"Gemini API HTTP error {e.response.status_code}: {e}")
                return ("" if raw_text else {}), _empty_tokens
        except Exception as e:
            print(f"Gemini API error: {e}")
            return ("" if raw_text else {}), _empty_tokens
        
        # Extract token usage from response
        usage_meta = data.get("usageMetadata") or {}
        tokens = {
            "prompt_tokens": usage_meta.get("promptTokenCount", 0),
            "completion_tokens": usage_meta.get("candidatesTokenCount", 0),
            "thinking_tokens": usage_meta.get("thoughtsTokenCount", 0),
            "total_tokens": usage_meta.get("totalTokenCount", 0),
        }

        # Extract text from response (skip thinking parts — gemini-2.5 returns them first)
        try:
            parts = data["candidates"][0]["content"]["parts"]
            text = None
            for part in parts:
                if not part.get("thought", False) and "text" in part:
                    text = part["text"]
                    break
        except (KeyError, IndexError):
            return ("" if raw_text else {}), tokens

        if raw_text:
            return (text or "").strip(), tokens

        result = _extract_json(text) if text else {}
        return result, tokens
    
    def audit_card(
        self,
        card: Dict[str, Any],
        product_dna: str = "",
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        """
        AI audit of card - finds issues by analyzing photo + card data.
        If product_dna is provided (cached text description), it is used instead of photo.
        Returns (issues_list, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return [], _empty_tokens

        subject_name = card.get("subjectName") or card.get("subject_name") or ""
        subject_id = card.get("subjectID") or card.get("subject_id") or ""

        # Build compact card — only what AI needs
        compact: Dict[str, Any] = {
            "subjectID": subject_id,
            "subjectName": subject_name,
            "vendorCode": card.get("vendorCode") or card.get("vendor_code"),
            "brand": card.get("brand"),
        }
        # ❌ НЕ включаем title и description — AI должен анализировать ТОЛЬКО фото и характеристики
        # Title/Description часто неверные и генерируются ПОСЛЕ исправления характеристик

        # Build characteristics — flatten for prompt
        chars_raw = card.get("characteristics") or []
        if isinstance(chars_raw, list):
            char_list = []
            for ch in chars_raw:
                name = ch.get("name", "")
                val = ch.get("value", ch.get("values"))
                cid = ch.get("id")
                char_list.append({"id": cid, "name": name, "value": val})
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
        # Exclude color characteristics — they are validated separately via color_names.json
        _COLOR_NAMES = {"цвет", "color", "основной цвет", "цвет товара"}
        char_list = [
            ch for ch in char_list
            if (ch.get("name") or "").strip().lower() not in _COLOR_NAMES
        ]
        compact["characteristics"] = char_list

        # Include valid characteristic names for this category
        valid_char_names = card.get("_valid_char_names") or []
        valid_chars_section = ""
        if valid_char_names:
            valid_chars_section = f"""
ДОПУСТИМЫЕ ХАРАКТЕРИСТИКИ ДЛЯ КАТЕГОРИИ "{subject_name}":
{json.dumps(valid_char_names, ensure_ascii=False)}
Если в карточке есть характеристики НЕ из этого списка и они заполнены — это ошибка.
"""
        # Include SEO keywords for this category
        seo_keywords_list = card.get("_seo_keywords") or []
        seo_keywords_section = ""
        if seo_keywords_list:
            seo_keywords_section = f"""
SEO-КЛЮЧЕВЫЕ СЛОВА ДЛЯ КАТЕГОРИИ "{subject_name}":
{', '.join(seo_keywords_list[:20])}
Проверь: есть ли хотя бы 1 ключевое слово в названии, минимум 2 в описании.
Если ни одного нет — это проблема SEO (severity="warning", category="text").
"""
        logic_block = build_wb_logic_block(include_output=False)

        prompt = f"""
РОЛЬ: Ты — старший модератор-аудитор маркетплейса Wildberries.

{logic_block}

ЗАДАЧА: Проанализируй фото товара и JSON-карточку. Найди РЕАЛЬНЫЕ ошибки
и несоответствия. Не выдумывай — если не уверен, ставь severity="warning".

КАТЕГОРИЯ ТОВАРА: "{subject_name}" (subjectID={subject_id})
{valid_chars_section}{seo_keywords_section}
ЧТО ПРОВЕРЯТЬ:
1. ФОТО ↔ ХАРАКТЕРИСТИКИ
   - Цвет на фото совпадает с характеристикой «Цвет»?
   - Тип изделия на фото = категория?
   - Комплектность: кол-во предметов на фото = «Комплектация»?
   - Фасон/модель на фото = характеристики (рукав, длина, застежка)?

2. КАТЕГОРИЯ ↔ ТЕКСТ
   - Название/описание соответствуют категории "{subject_name}"?
   - Нет ли упоминания другого типа товара, пола, возраста?

3. ТЕКСТ ↔ ХАРАКТЕРИСТИКИ
   - Описание не противоречит характеристикам?
   - Нет обрезанных/неполных значений (напр. "ж" вместо "жакет")?
   - Нет логических конфликтов (напр. "без рисунка" и "в полоску")?

4. ХАРАКТЕРИСТИКИ ↔ КАТЕГОРИЯ
   - Есть ли заполненные характеристики, которых НЕТ в списке допустимых выше?
   - Если да — fix_action: "clear" для каждой такой характеристики

5. АРТИКУЛ / VENDORCODE
   - Если в артикуле указан цвет — совпадает с «Цвет»?

6. ДАТЫ/СЕРТИФИКАТЫ/ДЕКЛАРАЦИИ
   - НЕ анализируй поля дат, регистрации сертификатов/деклараций, сроки действия.
   - НЕ предлагай исправления дат.
   - Эти поля обрабатываются только по эталонному fixed-файлу на backend.

9. ЦВЕТ
   - НЕ анализируй характеристику «Цвет», она проверяется отдельно.

7. SEO — КЛЮЧЕВЫЕ СЛОВА
   - Если список SEO-ключевых слов приведён выше:
     • Есть ли хотя бы 1 ключевое слово в названии?
     • Есть ли минимум 2 ключевых слова в описании?
   - Если нет — сообщи как "warning" с name="title" или name="description", category="text".
   - Пример: name="description", message="Описание не содержит SEO-ключевых слов категории..."

8. НАЗВАНИЕ — ФОРМУЛА
   - Название должно начинаться с категории товара ("{subject_name}") или её синонима.
   - Должен быть ключевой признак модели (фасон, силуэт, конструктив).
   - Запрещены: маркетинг, пол, эмоции, CAPS, эмодзи, запятые.
   - Длина: 35–60 символов.
   - Если нарушено — ошибка с name="title", severity="error", category="text".

CARD JSON:
{json.dumps(compact, ensure_ascii=False)[:4000]}

{"" if not product_dna else "ТЕХНИЧЕСКОЕ ОПИСАНИЕ ТОВАРА ПО ФОТО (извлечено один раз, использовать как источник истины о товаре):" + chr(10) + product_dna[:2000]}

ФОРМАТ ОТВЕТА — строго JSON, без markdown:
{{
  "errors": [
    {{
      "charcId": <int id характеристики или null>,
      "name": "<название характеристики или поля>",
      "value": <текущее значение>,
      "message": "<краткое описание проблемы, 1-2 предложения>",
      "severity": "critical|error|warning",
      "category": "photo|text|identification|qualification|mixed",
      "fix_action": "replace|clear|swap|compound",
      "swap_to_name": "<название ПРАВИЛЬНОЙ характеристики, если fix_action=swap>",
      "swap_to_value": "<значение для правильной характеристики, если fix_action=swap>",
      "compound_fixes": [
        {{
          "name": "<название поля>",
          "charcId": <int или null>,
          "action": "replace|set|clear",
          "value": "<новое значение или null для clear>"
        }}
      ],
      "errors": [
        {{
          "type": "vision_mismatch|category_mismatch|text_mismatch|contradiction|other",
          "message": "<подробное объяснение>"
        }}
      ]
    }}
  ]
}}

ПРАВИЛА fix_action:
• "replace" — текущее значение неправильное, нужно заменить (цвет, фасон и т.д.)
• "clear" — характеристика не применима к товару, нужно очистить
• "swap" — характеристика заполнена НЕ для того типа товара (1 поле ↔ 1 поле).
  Пример: на фото брюки, но заполнена «Модель юбки» = «карандаш».
    - fix_action: "swap", name: "Модель юбки", value: "карандаш"
    - swap_to_name: "Модель брюк", swap_to_value: "широкие"
• "compound" — несоответствие затрагивает 2+ полей одновременно.
  Пример: на фото костюм (пиджак + брюки), но:
    - «Тип низа» = «юбка» (неверно)
    - «Модель юбки» = «карандаш» (должно быть пусто)
    - «Модель брюк» = пусто (должно быть заполнено)
  В этом случае:
    - fix_action: "compound"
    - name: "Тип низа" (главное ошибочное поле)
    - value: "юбка" (текущее значение)
    - compound_fixes: [
        {{"name": "Тип низа", "charcId": <id или null>, "action": "replace", "value": "брюки"}},
        {{"name": "Модель юбки", "charcId": <id или null>, "action": "clear", "value": null}},
        {{"name": "Модель брюк", "charcId": <id или null>, "action": "set", "value": "карандаш"}}
      ]
  Используй "compound" ТОЛЬКО когда исправление ОДНОГО поля недостаточно — нужно изменить 2+ полей.

Если ошибок нет — верни: {{"errors": []}}
""".strip()

        image_url = None if product_dna else _get_card_photo(card)
        result, tokens = self._call_api(
            prompt,
            image_url,
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_AUDIT", 512),
            max_output_tokens=getattr(settings, "GEMINI_AUDIT_MAX_OUTPUT_TOKENS", self.max_output_tokens),
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
        """
        Generate fix suggestions for a batch of issues.
        Returns (fixes_dict, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled() or not issues:
            return {}, _empty_tokens

        # ── Build issues payload ──
        issues_data = []
        for issue in issues:
            av = issue.get("allowed_values") or []
            entry: Dict[str, Any] = {
                "id": issue.get("id"),
                "name": issue.get("name"),
                # ❌ НЕ включаем current_value — AI должен выбирать только из allowed_values на основе фото
                "error_type": issue.get("error_type") or issue.get("category"),
                "message": issue.get("message"),
            }
            # Include description for AI-detected issues (contradictions)
            if issue.get("description"):
                entry["description"] = issue["description"]
            # Only include allowed_values/limits when they exist
            if av:
                entry["allowed_values"] = av[:60]
            for err in (issue.get("errors") or []):
                if err.get("type") == "limit":
                    entry["min_limit"] = err.get("min")
                    entry["max_limit"] = err.get("max")
            issues_data.append(entry)

        # ── Compact card context ──
        subject = card.get("subjectName") or card.get("subject_name") or ""
        
        compact_card = {
            "brand": card.get("brand"),
            "subjectName": subject,
        }
        # ❌ ВСЕГДА исключаем title и description — AI генерирует их ПОСЛЕ исправления характеристик
        # Генерация идёт на основе НОВЫХ исправленных характеристик, старый текст не нужен
        # Add current characteristics for context
        chars_raw = card.get("characteristics") or []
        if isinstance(chars_raw, list):
            compact_card["characteristics"] = [
                {"name": ch.get("name"), "value": ch.get("value", ch.get("values"))}
                for ch in chars_raw[:30]
            ]
        logic_block = build_wb_logic_block(include_output=True)

        prompt = f"""
РОЛЬ: Ты — SEO-эксперт и копирайтер Wildberries с 5-летним опытом.

{logic_block}

ЗАДАЧА: Для каждой проблемы из списка создай ГОТОВОЕ ИСПРАВЛЕНИЕ.
У каждой проблемы ОБЯЗАТЕЛЬНО должен быть recommended_value с КОНКРЕТНЫМ готовым значением.

КАРТОЧКА ТОВАРА:
{json.dumps(compact_card, ensure_ascii=False)[:3500]}

{"" if not product_dna else "═══ ТЕХНИЧЕСКОЕ ОПИСАНИЕ ТОВАРА ПО ФОТО (используй для выбора характеристик!) ═══" + chr(10) + product_dna[:2500] + chr(10) + "═══ КОНЕЦ ОПИСАНИЯ ═══" + chr(10)}
СПИСОК ПРОБЛЕМ:
{json.dumps(issues_data, ensure_ascii=False)[:5000]}

═══ ПРАВИЛА ДЛЯ ХАРАКТЕРИСТИК ═══
• Если в проблеме есть "allowed_values" → выбирай СТРОГО из этого списка.
  КОПИРУЙ значения ТОЧНО как написано (с тем же регистром, пробелами).
  НЕ придумывай свои значения. Это справочник Wildberries.

• МАКСИМИЗАЦИЯ ЗАПОЛНЕНИЯ (КРИТИЧЕСКИ ВАЖНО!):
  - Если есть min_limit/max_limit → ВСЕГДА возвращай массив МАКСИМАЛЬНОЙ длины (max_limit).
  - Например: min=1, max=5 → верни РОВНО 5 значений (не 1, не 2, а 5!).
  - Выбирай самые подходящие и релевантные значения из allowed_values на основе:
    * Технического описания по фото (если есть)
    * Характеристик товара
    * Описания товара
    * Категории товара
  - ВАЖНО: Выбирай ТОЛЬКО те значения, которые ДЕЙСТВИТЕЛЬНО СООТВЕТСТВУЮТ товару.
  - НЕ добавляй характеристики, которых нет на фото или в описании.
  - ЗАПРЕЩЕНО придумывать несуществующие детали для увеличения количества.
  - Цель: заполнить МАКСИМАЛЬНО, но ПРАВДИВО, без выдумок.
  - Если подходящих значений меньше max_limit — верни только подходящие (НЕ добавляй неподходящие).

• Для цветовых характеристик (например: "Цвет", "Основной цвет", "Дополнительный цвет"):
  - если есть allowed_values: это СПИСОК РОДИТЕЛЬСКИХ ЦВЕТОВ (parent color)
  - выбери ОДИН самый подходящий parent color и верни ТОЛЬКО его в recommended_value (строкой)
  - НЕ возвращай массив оттенков для color-полей: оттенки подберет backend автоматически

• Если allowed_values нет → предложи конкретное логичное значение для категории "{subject}".
• Выбирай самые релевантные значения для КОНКРЕТНОГО товара.
• ВСЕГДА возвращай готовое значение, которое можно сразу использовать.

• ПРИМЕРЫ МАКСИМАЛЬНОГО ЗАПОЛНЕНИЯ:
  ✓ Проблема: "Принт" (min=1, max=3, allowed=["цветочный", "геометрический", "абстрактный", "полоска", "без принта"])
    На фото: платье с цветочным и геометрическим принтом
    ПРАВИЛЬНО: recommended_value: ["цветочный", "геометрический"]  ← 2 подходящих значения
    НЕПРАВИЛЬНО: recommended_value: ["цветочный", "геометрический", "полоска"]  ← добавлена полоска, которой нет!
    НЕПРАВИЛЬНО: recommended_value: "цветочный"  ← всего 1 вместо возможных 2
  
  ✓ Проблема: "Декор" (min=1, max=5, allowed=["вышивка", "стразы", "пайетки", "кружево", "аппликация", "бахрома"])
    На фото: изделие с вышивкой, кружевом и стразами
    ПРАВИЛЬНО: recommended_value: ["вышивка", "кружево", "стразы"]  ← 3 реальных элемента декора
    НЕПРАВИЛЬНО: recommended_value: ["вышивка", "кружево", "стразы", "пайетки", "бахрома"]  ← добавлены пайетки и бахрома, которых нет!
    НЕПРАВИЛЬНО: recommended_value: ["вышивка"]  ← упущены кружево и стразы
  
  ✓ Проблема: "Особенности модели" (min=1, max=4, allowed=["с капюшоном", "с карманами", "с поясом", "на молнии", "с разрезами"])
    На фото: куртка с капюшоном, карманами и молнией
    ПРАВИЛЬНО: recommended_value: ["с капюшоном", "с карманами", "на молнии"]  ← 3 реальные особенности
    НЕПРАВИЛЬНО: recommended_value: ["с капюшоном"]  ← неполно, упущены карманы и молния
  
  ✓ Проблема: "Особенности модели" (min=1, max=4, allowed=["с капюшоном", "с карманами", "с поясом", "на молнии"])
    ПРАВИЛЬНО: recommended_value: ["с капюшоном", "с карманами", "с поясом", "на молнии"]  ← все 4!
    НЕПРАВИЛЬНО: recommended_value: ["с карманами"]  ← только 1 вместо 4!

═══ ПРАВИЛА ДЛЯ AI-ОБНАРУЖЕННЫХ ПРОБЛЕМ (error_type начинается с "ai_") ═══
• Это противоречия и несоответствия, обнаруженные при аудите фото и текста.
• В поле "description" указано подробное описание проблемы.
• В "current_value" — текущее НЕВЕРНОЕ значение характеристики.
• Ты ОБЯЗАН вернуть КОНКРЕТНОЕ ПРАВИЛЬНОЕ значение в recommended_value.
• ЗАПРЕЩЕНО писать абстрактные советы: «Исправьте», «Проверьте», «Измените на...».
• ЗАПРЕЩЕНО возвращать пустую строку, null, или "".
• ОБЯЗАТЕЛЬНО: recommended_value должно быть ГОТОВЫМ значением для вставки в карточку.

• SWAP-ПРОБЛЕМЫ (когда характеристика от ДРУГОГО типа товара):
  Если в description упоминается, что характеристика не применима к товару на фото
  (например: фото брюк, но заполнена «Модель юбки»), тогда:
  - recommended_value: "" (пустая строка — очистить поле)
  - fix_action: "swap"
  - swap_to_name: "<правильная характеристика>" (например "Модель брюк")
  - swap_to_value: "<значение>" (например "широкие")
  - reason: "На фото изображены брюки, характеристика 'Модель юбки' не применима. Нужно заполнить 'Модель брюк'."
  Это значит: УДАЛИТЬ значение из неверной характеристики И предложить заполнить правильную.

• Примеры ПРАВИЛЬНЫХ ответов:
  - Покрой на фото свободный, но в характеристике «приталенный»
    → recommended_value: "свободный", fix_action: "replace"
  - Фото показывает цветочный принт, но в характеристике «без рисунка»
    → recommended_value: "цветочный принт", fix_action: "replace"
  - На товаре нет декора (тесьмы), но в характеристике указано «тесьма»
    → recommended_value: "без отделки", fix_action: "replace"
  - Цвет на фото бежевый, но в характеристике «черный»
    → recommended_value: "бежевый", fix_action: "replace"
  - На фото брюки, но заполнена «Модель юбки» = «карандаш»
    → recommended_value: "", fix_action: "swap", swap_to_name: "Модель брюк", swap_to_value: "широкие"
  - На фото жакет, но заполнена «Длина юбки» = «миди»
    → recommended_value: "", fix_action: "swap", swap_to_name: "Длина рукава", swap_to_value: "длинный"

• Если есть allowed_values для этой характеристики — выбирай ТОЛЬКО из них (точное совпадение).
• Если нет allowed_values — предложи подходящее значение на основе ФОТО и описания.
• В reason — объясни ПОЧЕМУ выбрано именно это значение (что видно на фото / в тексте).

═══ ПРАВИЛА ДЛЯ НАЗВАНИЯ (error_type содержит "title") ═══
• В recommended_value верни ПОЛНОЕ НОВОЕ ГОТОВОЕ НАЗВАНИЕ (40-60 символов).
• НЕ пиши советы типа «Улучшите название» — дай КОНКРЕТНОЕ название целиком.
• Структура: [Категория] [ключевой признак] [конструктив] [назначение] [цвет при необходимости]
• Каждый признак должен быть подтверждён данными карточки (характеристики/описание/фото-контекст).
• СТРОГО ЗАПРЕЩЕНО включать:
  ❌ Бренд (он подставляется отдельно)
  ❌ Пол (женский/мужской/детский)
  ❌ Маркетинг/эмоции: «стильный», «хит», «топ», «лучший», «идеальный», «премиум», «красивый»
  ❌ «для + существительное» → используй прилагательные:
     НЕЛЬЗЯ: «для офиса» → НУЖНО: «офисный»
     НЕЛЬЗЯ: «для праздника» → НУЖНО: «праздничный»
     НЕЛЬЗЯ: «для прогулки» → НУЖНО: «повседневный»
  ❌ CAPS, спецсимволы, эмодзи, запятые
• Цвет можно добавлять ТОЛЬКО если он:
  1) подтверждён характеристиками/визуальным контекстом,
  2) один и не конфликтует с карточкой,
  3) является смысловой частью модели.
• Используй только нейтральный фактический язык.
• Примеры ПРАВИЛЬНЫХ ответов:
  ✓ recommended_value: "Костюм двубортный с жакетом и юбкой макси офисный"
  ✓ recommended_value: "Платье миди приталенное вечернее"
  ✓ recommended_value: "Жакет однобортный удлиненный деловой"
• НЕ давай альтернативы — ОДИН лучший готовый вариант.

═══ ПРАВИЛА ДЛЯ ОПИСАНИЯ (error_type содержит "description") ═══
• В recommended_value верни ПОЛНОЕ НОВОЕ ГОТОВОЕ описание (1000-1800 символов).
• СТРОГО ЗАПРЕЩЕНО писать советы: ❌ «Расширьте описание», ❌ «Добавьте детали».
• ОБЯЗАТЕЛЬНО дай ЦЕЛЫЙ готовый текст, который можно сразу копировать в карточку.
• Формат: 3-6 абзацев, без списков.
• Каждый абзац: 2-4 предложения.
• Структура абзацами (обязательные части):
  1) Вступление (1-2 предложения) — что за товар
  2) Конструкция и посадка — ключевой блок
  3) Материал — только если подтверждено данными карточки
  4) Назначение/сценарии использования
  5) Особенности/уход — опционально
• Пиши нейтрально и фактически, без маркетинга и эмоций.
• Запрещено: «лучший», «премиум», «идеальный», обещания эффекта, CAPS, эмодзи.
• ЕСТЕСТВЕННО вплети ВСЕ ключевые слова из названия товара в текст.

⚠️ КРИТИЧЕСКИ ВАЖНО ДЛЯ ОПИСАНИЙ:
• НЕ СМОТРИ на текущее описание в карточке (current_value)!
• ГЕНЕРИРУЙ ПОЛНОСТЬЮ НОВОЕ описание, основываясь ТОЛЬКО на:
  - ФОТО товара (анализируй что видно на фото)
  - Характеристиках товара
  - Категории товара (subjectName)
• ПИШИ ТО, ЧТО ВИДИШЬ НА ФОТО: цвет, крой, детали, материал (если визуально определяется).
• Твоя задача — создать описание "с нуля", как будто текущего описания не существует.
• Это важно для генерации свежего, качественного контента без повторения ошибок старого текста.

═══ ПРАВИЛА ДЛЯ SEO (error_type = "seo_keywords_missing") ═══
• Ключевые слова из названия отсутствуют в описании.
• В recommended_value верни ПОЛНОЕ НОВОЕ переписанное описание (1000-1800 символов),
  в которое естественно вплетены ВСЕ ключевые слова из названия товара.
• ОБЯЗАТЕЛЬНО используй текущее описание как основу и ДОБАВЬ в него недостающие SEO-слова.
• НЕ пиши "Добавьте слова: ..." — дай ГОТОВЫЙ ПОЛНЫЙ текст описания.
• Текст должен быть цельным, естественным, без повторов.
• В reason — укажи какие конкретно ключевые слова были добавлены в текст.

═══ ПРАВИЛА ДЛЯ СОСТАВА (error_type = "composition_mismatch") ═══
• Состав в описании и характеристиках не совпадает.
• В recommended_value верни ТОЧНЫЙ ПОЛНЫЙ правильный состав с процентами.
• Примеры ПРАВИЛЬНЫХ ответов:
  ✓ recommended_value: "95% хлопок, 5% эластан"
  ✓ recommended_value: "100% полиэстер"
  ✓ recommended_value: "70% шерсть, 25% полиамид, 5% эластан"
• ЗАПРЕЩЕНО: ❌ «Исправьте состав на правильный», ❌ «Укажите точный состав».
• Основывайся на:
  1) Характеристиках товара (приоритет)
  2) Описании товара
  3) Типичном составе для данной категории
• В reason — укажи какое именно несоответствие: «В характеристиках 95% хлопок, но в описании указан полиэстер».

═══ ПРАВИЛА ДЛЯ ОБЯЗАТЕЛЬНЫХ ХАРАКТЕРИСТИК (error_type = "missing_required_chars") ═══
• Не заполнены обязательные характеристики для фильтров WB.
• В recommended_value верни СТРОКУ с перечислением характеристик И их значений.
• Формат: "Характеристика: значение; Характеристика: значение"
• Примеры ПРАВИЛЬНЫХ ответов:
  ✓ recommended_value: "Состав: 95% хлопок, 5% эластан; Цвет: бежевый; Размер: 42-44; Сезон: демисезон"
  ✓ recommended_value: "Материал верха: натуральная кожа; Материал подкладки: текстиль; Тип застежки: молния"
• ЗАПРЕЩЕНО: ❌ «Заполните: Состав, Цвет, Размер» (без значений)
• Определи значения на основе:
  1) Фото товара (цвет, тип, материал)
  2) Описания товара
  3) Других заполненных характеристик
  4) Категории товара (типичные значения)
• В reason — укажи почему эти характеристики критичны: «Без этих характеристик товар не попадёт в фильтры поиска по цвету и составу».

═══ ПРАВИЛА ДЛЯ КАТЕГОРИИ (error_type = "wrong_category") ═══
• Товар размещён в неправильной категории WB.
• В recommended_value верни ТОЧНОЕ НАЗВАНИЕ правильной категории.
• Примеры ПРАВИЛЬНЫХ ответов:
  ✓ recommended_value: "Женская одежда / Платья / Вечерние платья"
  ✓ recommended_value: "Обувь / Женская обувь / Сапоги"
  ✓ recommended_value: "Аксессуары / Сумки / Женские сумки"
• ЗАПРЕЩЕНО: ❌ «Переместите в правильную категорию», ❌ «Проверьте категорию».
• Определи правильную категорию по:
  1) Фото товара
  2) Названию и описанию
  3) Характеристикам
• В reason — объясни почему: «На фото видно платье, но товар находится в категории Юбки. Это снижает показы на 80%.»

═══ ОБЩИЕ ПРАВИЛА (КРИТИЧЕСКИ ВАЖНО!) ═══
• КАЖДАЯ проблема БЕЗ ИСКЛЮЧЕНИЙ должна получить recommended_value.
• recommended_value — это ГОТОВОЕ ЗНАЧЕНИЕ для немедленного использования.
• СТРОГО ЗАПРЕЩЕНО писать рекомендации/советы вместо значений:
  ❌ "Расширьте описание до 1000 символов"
  ❌ "Добавьте ключевые слова"
  ❌ "Исправьте на правильное значение"
  ❌ "Проверьте соответствие"
  ❌ "Укажите точный состав"
• ОБЯЗАТЕЛЬНО давать ГОТОВОЕ значение:
  ✓ Для текста — ПОЛНЫЙ новый текст (не инструкция, а сам текст)
  ✓ Для характеристики — конкретное значение или массив значений
  ✓ Для состава — "95% хлопок, 5% эластан" (не "исправьте состав")
• В reason — кратко объясни ПОЧЕМУ выбрано именно это значение.

ФОРМАТ ОТВЕТА — строго JSON:
{{
  "fixes": {{
    "<id проблемы>": {{
      "recommended_value": "<string или array>",
      "reason": "<почему именно это значение>",
      "fix_action": "replace|clear|swap",
      "swap_to_name": "<название правильной характеристики, только если fix_action=swap>",
      "swap_to_value": "<значение для правильной характеристики, только если fix_action=swap>"
    }}
  }}
}}
""".strip()

        has_text_issue = any(
            str((it or {}).get("error_type") or "").strip().lower() in {
                "title", "description", "seo_keywords_missing",
                "title_too_short", "title_too_long", "no_title", "title_policy_violation",
                "no_description", "description_too_short", "description_too_long", "description_policy_violation",
            }
            for it in issues_data
        )
        if not has_text_issue:
            prompt = f"""
РОЛЬ: Ты — эксперт по характеристикам Wildberries.

{logic_block}

ЗАДАЧА: Сгенерируй точные исправления ТОЛЬКО для характеристик.
Не пиши длинные объяснения, только рабочие значения.

КАРТОЧКА ТОВАРА:
{json.dumps(compact_card, ensure_ascii=False)[:2500]}

{"" if not product_dna else "ТЕХНИЧЕСКОЕ ОПИСАНИЕ ТОВАРА ПО ФОТО:" + chr(10) + product_dna[:1500] + chr(10)}
СПИСОК ПРОБЛЕМ:
{json.dumps(issues_data, ensure_ascii=False)[:3500]}

ПРАВИЛА:
• Если есть allowed_values — выбирай строго из списка (точное совпадение).
• КРИТИЧЕСКИ ВАЖНО: Если есть min_limit/max_limit — СТРЕМИСЬ к максимальному заполнению (max_limit).
  Например: min=1, max=5 → постарайся выбрать до 5 подходящих значений из allowed_values.
  НО: выбирай ТОЛЬКО те, которые ДЕЙСТВИТЕЛЬНО подходят товару (не придумывай несуществующие детали).
  Если реально подходящих меньше max — верни столько, сколько реально есть.
• Для color полей ("Цвет", "Основной цвет") — верни ОДНО значение (parent color), НЕ массив.
• Если min/max не указаны, но allowed_values есть — выбери 1-3 самых релевантных.
• ВСЕГДА давай КОНКРЕТНОЕ готовое значение (не инструкцию).
• Используй Product DNA (техническое описание по фото) для выбора характеристик.
• Верни ГОТОВОЕ значение для применения.
• Не анализируй поля дат/сертификатов/деклараций.

ФОРМАТ ОТВЕТА — строго JSON:
{{
  "fixes": {{
    "<id проблемы>": {{
      "recommended_value": "<string или array>",
      "reason": "<кратко>",
      "fix_action": "replace|clear|swap",
      "swap_to_name": "<только если swap>",
      "swap_to_value": "<только если swap>"
    }}
  }}
}}
""".strip()

        # When product_dna is cached: use text context instead of photo (saves tokens).
        # Otherwise: re-attach image for ai_* issues (visual accuracy).
        needs_vision_context = not product_dna and any(
            str((it or {}).get("error_type") or "").startswith("ai_")
            for it in issues_data
        )
        image_url = _get_card_photo(card) if needs_vision_context else None

        result, tokens = self._call_api(
            prompt,
            image_url=image_url,
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_FIX", 128),
            max_output_tokens=getattr(settings, "GEMINI_FIX_MAX_OUTPUT_TOKENS", self.max_output_tokens),
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
        """
        Re-generate fix when previous AI fix didn't pass allowed_values/limits validation.
        Returns (result_dict, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return {}, _empty_tokens
        
        subject = card.get("subjectName") or card.get("subject_name") or ""
        limit_hint = ""
        if limits:
            mn = limits.get("min")
            mx = limits.get("max")
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

ВАЖНО:
• Значение ДОЛЖНО быть ТОЧНО из списка допустимых — без изменений регистра,
  окончаний, пробелов. Копируй точно как написано в списке.
• Выбирай наиболее подходящее для данного товара.
• Если нужно несколько значений — верни массив.

Ответ строго JSON:
{{
  "recommended_value": "<string или array — ТОЧНО из списка>",
  "reason": "<почему именно это>"
}}
""".strip()
        
        result, tokens = self._call_api(
            prompt,
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_REFIX", 64),
            max_output_tokens=getattr(settings, "GEMINI_REFIX_MAX_OUTPUT_TOKENS", self.max_output_tokens),
        )
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
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled() or not children:
            return [], _empty_tokens

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

        result, tokens = self._call_api(
            prompt,
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_REFIX", 64),
            max_output_tokens=300,
        )
        if isinstance(result, dict):
            shades = result.get("shades", [])
            if isinstance(shades, list):
                children_norm = {c.lower().strip(): c for c in children}
                valid = []
                for s in shades:
                    s_str = str(s).strip()
                    matched = children_norm.get(s_str.lower())
                    if matched and matched not in valid:
                        valid.append(matched)
                return valid[:count], tokens
        return [], _empty_tokens

    def generate_product_dna_text(
        self,
        image_url: str,
        subject_name: str = "",
    ) -> str:
        """
        Mahsulot fotosini bir marta tahlil qilib texnik tavsif (Product DNA) yaratadi.
        Gemini vision orqali ishlaydi. VisionService (GPT) bilan bir xil prompt.
        Returns: 300-500 so'zli texnik tavsif yoki ""
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return ""

        prompt = f"""Ты — эксперт по анализу fashion-товаров для маркетплейса Wildberries.
Твоя задача — по фотографии товара создать максимально подробное и объективное описание изделия,
которое будет использоваться как базовое описание товара для дальнейшей обработки системой.

ВАЖНО: Это техническое описание товара — не финальный текст для карточки. Используй его для:
- проверки характеристик
- поиска ошибок
- генерации названия и SEO-описания
- сравнения с данными карточки

Описание должно быть: точным, детализированным, без маркетинга, без выдуманных характеристик.
Если характеристика не определяется по фото — укажи "не определено".

Проанализируй изображение товара и сформируй техническое описание по блокам:

1. ТИП ТОВАРА
Определи тип изделия: категория одежды, комплект или одиночное, элементы комплекта.

2. КОНСТРУКЦИЯ ИЗДЕЛИЯ
Верх: тип, длина, посадка, рукава, воротник, карманы, застёжка, декоративные элементы.
Низ: тип, длина, посадка, разрезы, карманы, застёжка, декоративные элементы.

3. СИЛУЭТ И ПОСАДКА
Силуэт, степень прилегания, посадка по фигуре, линия талии, длина относительно тела.

4. ЦВЕТ И ВНЕШНИЙ ВИД
Основной цвет, оттенок, принт, фактура ткани (если видна), визуальная плотность.

5. МАТЕРИАЛ
Если не определён — "не определено". Если есть визуальные признаки — укажи как предположение.

6. ДЕКОРАТИВНЫЕ ЭЛЕМЕНТЫ
Кнопки, пуговицы, молнии, строчки, накладные элементы, разрезы, декоративные карманы.

7. СТИЛЬ
casual / городской / офисный / минимализм / базовый.

8. СЕЗОННОСТЬ
лето / демисезон / всесезон / не определено.

9. ОСОБЕННОСТИ МОДЕЛИ
Крой, визуальные акценты, уникальные элементы.

10. КРАТКОЕ ОБОБЩЕНИЕ
2–3 предложения. Без маркетинга. Только факты.

Категория товара: {subject_name or 'не указана'}

ТРЕБОВАНИЯ: 300–500 слов, структурирован по блокам, без рекламных формулировок, без SEO.
Верни ТОЛЬКО структурированный текст. Без JSON, без вводных фраз."""

        try:
            result, _ = self._call_api(
                prompt,
                image_url=image_url,
                thinking_budget=0,
                max_output_tokens=1500,
                raw_text=True,
            )
            if isinstance(result, str) and len(result) > 50:
                return result
            # If _call_api returned dict (JSON parse attempt), extract text
            if isinstance(result, dict):
                for key in ("text", "description", "content", "result"):
                    if isinstance(result.get(key), str) and len(result[key]) > 50:
                        return result[key]
            return ""
        except Exception:
            return ""

    def generate_title(
        self,
        card: Dict[str, Any],
        product_dna: str = "",
        seo_keywords: list = None,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """
        Generate a fresh title for a WB card from scratch using AI.
        Uses card characteristics and category as source of truth.
        Returns (result_dict, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return {}, _empty_tokens

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
        elif isinstance(chars_raw, dict):
            for k, v in list(chars_raw.items())[:20]:
                if v:
                    char_hints.append(f"{k}: {v}")
        chars_text = "\n".join(char_hints) if char_hints else "нет данных"

        tech_desc = card.get("tech_description") or card.get("description") or ""
        logic_block = build_wb_logic_block(include_output=False)

        kw_block = ""
        if seo_keywords:
            kw_sample = seo_keywords[:15]
            kw_block = f"""
SEO-КЛЮЧЕВЫЕ СЛОВА КАТЕГОРИИ "{subject}" (используй хотя бы 1-2 из этих слов естественно):
{', '.join(kw_sample)}
"""

        prompt = f"""
ЗАДАЧА: Создай название товара для Wildberries на основе характеристик карточки.

{logic_block}

Категория: "{subject}"
Бренд (НЕ включать в название!): "{brand}"

Характеристики товара:
{chars_text}

{'Техническое описание:' + chr(10) + tech_desc[:800] if tech_desc else ''}

{"" if not product_dna else "ВИЗУАЛЬНОЕ ОПИСАНИЕ ТОВАРА (из фото):" + chr(10) + product_dna[:1500]}
{kw_block}
СТРОГИЕ ПРАВИЛА:
• Формула: [Категория] [ключевой признак] [конструктив] [назначение] [цвет при необходимости]
• Длина: 40–60 символов (идеально 40–50)
• Используй ТОЛЬКО факты из характеристик выше
• ЗАПРЕЩЕНО включать бренд "{brand}" — он подставляется автоматически
• ЗАПРЕЩЕНО: пол (женский/мужской/детский), маркетинг (стильный, топ, хит, лучший, идеальный, премиум, красивый)
• ЗАПРЕЩЕНО: CAPS, спецсимволы, эмодзи, запятые, повтор слов
• ЗАПРЕЩЕНО: «для + существительное» → пиши прилагательными: «офисный», «праздничный», «повседневный»
• Цвет — только если он подтверждён характеристиками и является ключевой особенностью
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
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_REFIX", 64),
            max_output_tokens=getattr(settings, "GEMINI_REFIX_MAX_OUTPUT_TOKENS", self.max_output_tokens),
        )
        return (result if isinstance(result, dict) else {}), tokens

    def generate_description(
        self,
        card: Dict[str, Any],
        product_dna: str = "",
        seo_keywords: list = None,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """
        Generate a fresh description for a WB card from scratch using AI.
        Uses card characteristics and tech description as source of truth.
        Returns (result_dict, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return {}, _empty_tokens

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

        kw_block = ""
        if seo_keywords:
            kw_sample = seo_keywords[:20]
            kw_block = f"""
SEO-КЛЮЧЕВЫЕ СЛОВА КАТЕГОРИИ "{subject}" (обязательно включи минимум 2-3 из этих слов естественно в текст):
{', '.join(kw_sample)}
"""

        prompt = f"""
ЗАДАЧА: Создай описание товара для Wildberries на основе характеристик карточки.

{logic_block}

Категория: "{subject}"
Название: "{title}"

Характеристики товара:
{json.dumps(char_hints, ensure_ascii=False)}

{'Техническое описание (источник истины):' + chr(10) + tech_desc[:1000] if tech_desc else ''}

{"" if not product_dna else "ВИЗУАЛЬНОЕ ОПИСАНИЕ ТОВАРА (из фото):" + chr(10) + product_dna[:1500]}
{kw_block}
СТРОГИЕ ПРАВИЛА:
• Длина: 1000–1800 символов
• Формат: 3–6 абзацев, без списков, маркеров, нумерации
• Каждый абзац: 2–4 предложения
• Структура: вступление → конструкция/посадка → материал (если подтверждён) → назначение → особенности/уход
• Пиши ТОЛЬКО факты из характеристик выше — не придумывай
• ЗАПРЕЩЕНО: маркетинг, эмоции (стильный, роскошный, идеальный и т.п.), обещания эффекта (делает стройнее и т.п.)
• ЗАПРЕЩЕНО: ссылки, телефоны, CAPS, эмодзи
• Описание должно быть согласовано с названием и характеристиками
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
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_REFIX", 64),
            max_output_tokens=max(
                getattr(settings, "GEMINI_REFIX_MAX_OUTPUT_TOKENS", self.max_output_tokens),
                2048,
            ),
        )
        return (result if isinstance(result, dict) else {}), tokens

    def refix_title(
        self,
        card: Dict[str, Any],
        current_title: str,
        failed_reason: str,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """
        Re-generate title when previous AI suggestion failed validation.
        Returns (result_dict, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return {}, _empty_tokens

        subject = card.get("subjectName") or card.get("subject_name") or ""
        brand = card.get("brand") or ""

        # Build characteristics context for better title
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
• ЗАПРЕЩЕНО включать бренд "{brand}" — он подставляется автоматически
• ЗАПРЕЩЕНО включать пол: "женский", "мужской", "детский"
• ЗАПРЕЩЕНО включать маркетинг/эмоции: "стильный", "топ", "хит", "лучший", "идеальный", "премиум", "красивый"
• ЗАПРЕЩЕНО использовать CAPS, спецсимволы, эмодзи, запятые
• ЗАПРЕЩЕНО использовать «для + существительное» — пиши прилагательными:
  НЕЛЬЗЯ: «для офиса» → НУЖНО: «офисный»
  НЕЛЬЗЯ: «для праздника» → НУЖНО: «праздничный»
  НЕЛЬЗЯ: «для прогулки» → НУЖНО: «повседневный»
• Структура: [Категория] [ключевой признак] [конструктив] [назначение] [цвет при необходимости]
• Каждый признак должен быть подтверждён данными товара.
• Цвет допускается только когда он подтверждён и является смысловой частью модели.
• Верни ОДИН лучший вариант

Ответ строго JSON:
{{
  "recommended_value": "<исправленное название>",
  "reason": "<что исправлено>"
}}
""".strip()

        result, tokens = self._call_api(
            prompt,
            image_url=None,
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_REFIX", 64),
            max_output_tokens=getattr(settings, "GEMINI_REFIX_MAX_OUTPUT_TOKENS", self.max_output_tokens),
        )
        return (result if isinstance(result, dict) else {}), tokens

    def refix_description(
        self,
        card: Dict[str, Any],
        current_description: str,
        failed_reason: str,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """
        Re-generate description when previous AI suggestion failed SEO validation.
        Returns (result_dict, token_usage).
        """
        _empty_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0}
        if not self.is_enabled():
            return {}, _empty_tokens

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
• Длина: 1000-1800 символов.
• Формат: 3-6 абзацев, без списков.
• Каждый абзац: 2-4 предложения.
• Структура: вступление -> конструкция/посадка -> материал (если подтвержден) -> назначение -> особенности.
• Пиши только факты из названия/характеристик/контекста товара.
• ЗАПРЕЩЕНО: маркетинг, эмоции, обещания эффекта, ссылки, телефоны, CAPS, эмодзи.
• Описание должно быть согласовано с названием и характеристиками.
• Верни ОДИН готовый вариант описания.

Ответ строго JSON:
{{
  "recommended_value": "<готовое описание 1000-1800>",
  "reason": "<что исправлено>"
}}
""".strip()

        result, tokens = self._call_api(
            prompt,
            image_url=None,
            thinking_budget=getattr(settings, "GEMINI_THINKING_BUDGET_REFIX", 64),
            max_output_tokens=max(
                getattr(settings, "GEMINI_REFIX_MAX_OUTPUT_TOKENS", self.max_output_tokens),
                2048,
            ),
        )
        return (result if isinstance(result, dict) else {}), tokens

    def get_suggestions(
        self, 
        card: Dict[str, Any], 
        issues: List[Dict[str, Any]]
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
        """Legacy method — delegates to generate_fixes"""
        return self.generate_fixes(card, issues)


# Singleton instance
_gemini_service: Optional[GeminiService] = None


def get_gemini_service() -> GeminiService:
    """Get Gemini service instance"""
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiService()
    return _gemini_service


def get_ai_service():
    """
    AI_PROVIDER sozlamasiga qarab to'g'ri serviceni qaytaradi.
    AI_PROVIDER=gemini → GeminiService
    AI_PROVIDER=gpt / openai → GPTService
    """
    from ..core.config import settings as _settings
    provider = (_settings.AI_PROVIDER or "gemini").lower().strip()
    if provider in ("gpt", "openai"):
        from .gpt_service import get_gpt_service
        return get_gpt_service()
    return get_gemini_service()

