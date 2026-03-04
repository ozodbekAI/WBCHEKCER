"""
VisionService — GPT-4o-mini orqali mahsulot fotosidan Product DNA JSON yaratadi.
Product DNA — keyingi analiz va xarakteristika generatsiyasi uchun asosiy "passport".
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── System prompt (texnik tavsif uchun) ──────────────────────────────────────
_VISION_SYSTEM_PROMPT = """Ты — эксперт по анализу fashion-товаров для маркетплейса Wildberries.
Твоя задача — по фотографии товара создать максимально подробное и объективное описание изделия,
которое будет использоваться как базовое описание товара для дальнейшей обработки системой.

ВАЖНО: Это описание не является финальным текстом для карточки товара. Это техническое,
максимально подробное описание товара для: проверки характеристик, поиска ошибок,
генерации названия, генерации SEO-описания, сравнения с данными карточки.

Поэтому описание должно быть:
- максимально точным и детализированным
- без маркетинговых фраз и рекламных формулировок
- без выдуманных характеристик
- только наблюдаемые или логически очевидные свойства
- если характеристика не может быть определена по фото — укажи "unknown"

Верни результат СТРОГО в JSON формате. Никакого другого текста."""

_DNA_USER_PROMPT = """Проанализируй изображение товара и извлеки структурированные характеристики изделия.

Верни результат строго в JSON формате:
{
  "product_type": "тип изделия (например: женский костюм комплект)",
  "category_candidate": ["костюм женский", "комплект юбка и куртка"],
  "set_items": [
    {
      "item_type": "куртка|юбка|брюки|топ|платье|...",
      "length": "укороченная|стандартная|удлинённая|миди|макси|мини",
      "fit": "прямой|приталенный|свободный|оверсайз",
      "closure": "кнопки|молния|пуговицы|завязки|без застёжки",
      "pockets": "накладные|боковые|без карманов|unknown",
      "sleeves": "длинные|короткие|три четверти|без рукавов|unknown"
    }
  ],
  "color": {
    "primary": "основной цвет",
    "tone": "пастельный|яркий|тёмный|нейтральный|unknown",
    "has_print": false
  },
  "fabric_visual": {
    "texture": "описание фактуры",
    "density": "лёгкая|средняя|плотная|unknown",
    "likely_material": "трикотаж|джинсовая|шёлк|лён|синтетика|unknown"
  },
  "style": ["офисный", "casual", "городской", "минимализм"],
  "seasonality": ["весна", "лето", "осень", "зима", "всесезон"],
  "decor_elements": ["металлические кнопки", "накладные карманы"],
  "silhouette": {
    "type": "прямой|A-силуэт|приталенный|трапеция|unknown",
    "waist": "завышенная|естественная|заниженная|unknown"
  },
  "gender": "женский|мужской|унисекс",
  "wb_characteristics": {
    "Пол": "Женский",
    "Фактура материала": "unknown",
    "Стиль": "Офисный",
    "Сезон": "Лето",
    "Вид застежки": "unknown",
    "Длина": "unknown",
    "Тип посадки": "unknown"
  },
  "confidence": {
    "product_type": 0.95,
    "color": 0.98,
    "seasonality": 0.75
  }
}

Категория товара: %s"""

# Mapping: Product DNA fields → WB characteristic names
_DNA_TO_WB_CHARS = {
    "gender": "Пол",
    "fabric_visual.likely_material": "Материал",
    "fabric_visual.texture": "Фактура материала",
    "style": "Стиль",
    "seasonality": "Сезон",
    "color.primary": "Цвет",
    "silhouette.waist": "Посадка",
}


class VisionService:
    """GPT-4o-mini orqali mahsulot fotosidan Product DNA JSON yaratadi."""

    def __init__(self) -> None:
        self._api_key = settings.OPENAI_API_KEY
        self._model = settings.OPENAI_VISION_MODEL
        self._base_url = "https://api.openai.com/v1/chat/completions"

    @property
    def is_enabled(self) -> bool:
        return bool(self._api_key)

    async def analyze_photo_dna(
        self,
        photo_url: str,
        subject_name: str = "",
    ) -> dict[str, Any]:
        """
        Mahsulot fotosini tahlil qilib Product DNA JSON qaytaradi.
        
        Args:
            photo_url: Mahsulot fotosining URL si
            subject_name: WB kategoriya nomi (masalan: "Костюмы")
        
        Returns:
            Product DNA dict yoki {} (xato bo'lsa)
        """
        if not self.is_enabled:
            logger.warning("[vision] OPENAI_API_KEY sozlanmagan")
            return {}

        try:
            image_b64, mime_type = await self._fetch_image_b64(photo_url)
            if not image_b64:
                return {}

            prompt = _DNA_USER_PROMPT % (subject_name or "не указана")

            payload = {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": _VISION_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_b64}",
                                    "detail": "high",
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    },
                ],
                "max_tokens": 1500,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            }

            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    self._base_url,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )

            if resp.status_code != 200:
                logger.error(
                    "[vision] OpenAI API error %d: %s", resp.status_code, resp.text[:300]
                )
                return {}

            data = resp.json()
            raw_content = data["choices"][0]["message"]["content"]
            dna = self._parse_json(raw_content)
            logger.info(
                "[vision] Product DNA yaratildi: product_type=%s",
                dna.get("product_type", "?"),
            )
            return dna

        except Exception:
            logger.exception("[vision] analyze_photo_dna xatosi")
            return {}

    def extract_wb_characteristics(self, dna: dict[str, Any]) -> dict[str, str]:
        """
        Product DNA JSON dan WB xarakteristikalarini chiqaradi.
        
        Returns: {char_name: value} dict
        """
        if not dna:
            return {}

        result: dict[str, str] = {}

        # wb_characteristics to'g'ridan-to'g'ri olish (agar mavjud bo'lsa)
        wb_chars = dna.get("wb_characteristics", {})
        for char_name, value in wb_chars.items():
            if value and value not in ("unknown", "не определено", ""):
                result[char_name] = str(value)

        # Qo'shimcha mappinglar
        color_info = dna.get("color", {})
        if color_info.get("primary") and color_info["primary"] != "unknown":
            result.setdefault("Цвет", color_info["primary"])

        style_list = dna.get("style", [])
        if style_list:
            result.setdefault("Стиль", style_list[0] if isinstance(style_list, list) else str(style_list))

        season_list = dna.get("seasonality", [])
        if season_list:
            result.setdefault("Сезон", season_list[0] if isinstance(season_list, list) else str(season_list))

        gender = dna.get("gender", "")
        if gender and gender != "unknown":
            # WB da "Пол" uchun standart qiymatlar
            gender_map = {"женский": "Женский", "мужской": "Мужской", "унисекс": "Унисекс"}
            result.setdefault("Пол", gender_map.get(gender.lower(), gender))

        fabric = dna.get("fabric_visual", {})
        if fabric.get("texture") and fabric["texture"] != "unknown":
            result.setdefault("Фактура материала", fabric["texture"])

        return result

    async def _fetch_image_b64(self, url: str) -> tuple[str, str]:
        """URL dan rasmni yuklab base64 ga o'giradi."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, follow_redirects=True)
            if resp.status_code != 200:
                logger.warning("[vision] rasm yuklanmadi: %s → %d", url, resp.status_code)
                return "", "image/jpeg"
            mime_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
            b64 = base64.b64encode(resp.content).decode()
            return b64, mime_type
        except Exception:
            logger.exception("[vision] rasm yuklab olishda xato: %s", url)
            return "", "image/jpeg"

    @staticmethod
    def _parse_json(text: str) -> dict:
        """JSON javobni parse qiladi, markdown code block larni tozalaydi."""
        text = text.strip()
        # ```json ... ``` ni olib tashlash
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.warning("[vision] JSON parse xatosi, raw: %s", text[:200])
            return {}


# Singleton
vision_service = VisionService()
