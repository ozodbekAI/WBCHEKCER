"""
VisionService — GPT-4o-mini orqali mahsulot fotosidan Product DNA yaratadi.

Product DNA — bitta so'rov bilan olingan texnik tavsif.
Keyingi barcha AI chaqiruvlarda (audit, title, description) shu matn ishlatiladi —
foto qayta yuborilmaydi. Bu tokenlarni tejaydi va barqaror natija beradi.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Detailed technical description prompt (user-provided) ────────────────────
_PRODUCT_DNA_SYSTEM = """Ты — эксперт по анализу fashion-товаров для маркетплейса Wildberries.
Твоя задача — по 1-3 фотографиям товара создать максимально подробное и объективное описание изделия,
которое будет использоваться как базовое описание товара для дальнейшей обработки системой.
Если первый кадр частично закрыт текстом, плашками или обрезан — используй другие кадры как основной источник истины.

ВАЖНО: Это описание не является финальным текстом для карточки товара.
Это техническое, максимально подробное описание товара для:
- проверки характеристик
- поиска ошибок
- генерации названия
- генерации SEO-описания
- сравнения с данными карточки

Поэтому описание должно быть:
- максимально точным и детализированным
- без маркетинговых фраз и рекламных формулировок
- без выдуманных характеристик
- только наблюдаемые или логически очевидные свойства
- если характеристика не может быть определена по фото — укажи "не определено"

Верни ТОЛЬКО структурированный текст по блокам. Никакого JSON, никаких вводных фраз."""

_PRODUCT_DNA_USER = """Проанализируй 1-3 изображения товара и сформируй максимально подробное техническое описание по следующим блокам:

1. ТИП ТОВАРА
Определи тип изделия:
- категория одежды
- комплект или одиночное изделие
- элементы комплекта

2. КОНСТРУКЦИЯ ИЗДЕЛИЯ
Подробно опиши конструкцию:
верх изделия: тип, длина, посадка, рукава, воротник, карманы, застёжка, декоративные элементы
низ изделия: тип, длина, посадка, разрезы, карманы, застёжка, декоративные элементы

3. СИЛУЭТ И ПОСАДКА
силуэт, степень прилегания, посадка по фигуре, линия талии, длина относительно тела

4. ЦВЕТ И ВНЕШНИЙ ВИД
основной цвет, оттенок, наличие принта, фактура ткани (если видна), визуальная плотность ткани

5. МАТЕРИАЛ
Если не определён — укажи "не определено". Если есть визуальные признаки — укажи как предположение.

6. ДЕКОРАТИВНЫЕ ЭЛЕМЕНТЫ
кнопки, пуговицы, молнии, строчки, накладные элементы, разрезы, декоративные карманы

7. СТИЛЬ
casual / городской / офисный / минимализм / базовый

8. СЕЗОННОСТЬ
лето / демисезон / всесезон / не определено

9. ОСОБЕННОСТИ МОДЕЛИ
крой, визуальные акценты, уникальные элементы

10. КРАТКОЕ ОБОБЩЕНИЕ
2–3 предложения. Без маркетинга. Только факты.

Категория товара: %s

ТРЕБОВАНИЯ: 300–500 слов, структурирован по блокам, без рекламных формулировок, без SEO."""


class VisionService:
    """GPT-4o-mini orqali mahsulot fotosidan texnik tavsif (Product DNA) yaratadi."""

    def __init__(self) -> None:
        self._api_key = settings.OPENAI_API_KEY
        self._model = settings.OPENAI_VISION_MODEL
        self._base_url = "https://api.openai.com/v1/chat/completions"

    @property
    def is_enabled(self) -> bool:
        return bool(self._api_key)

    async def generate_product_dna_text(
        self,
        photo_url: str,
        subject_name: str = "",
        photo_urls: Optional[List[str]] = None,
    ) -> str:
        """
        Mahsulot fotosini bir marta tahlil qilib texnik tavsif yaratadi.
        Bu matn DB da saqlanadi va keyingi barcha AI chaqiruvlarida ishlatiladi.

        Returns:
            Detailed technical text description (~300-500 words) yoki "" (xato bo'lsa)
        """
        if not self.is_enabled:
            logger.warning("[vision] OPENAI_API_KEY sozlanmagan")
            return ""

        try:
            user_prompt = _PRODUCT_DNA_USER % (subject_name or "не указана")

            candidate_urls = list(photo_urls or [])
            if photo_url:
                candidate_urls = [photo_url] + candidate_urls

            content_parts: List[dict[str, Any]] = []
            seen_urls: set[str] = set()
            for u in candidate_urls:
                uu = str(u or "").strip()
                if not uu or uu in seen_urls:
                    continue
                seen_urls.add(uu)

                image_b64, mime_type = await self._fetch_image_b64(uu)
                if not image_b64:
                    continue

                content_parts.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_b64}",
                            "detail": "high",
                        },
                    }
                )
                if len(content_parts) >= 5:
                    break

            if not content_parts:
                return ""

            content_parts.append({"type": "text", "text": user_prompt})

            payload = {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": _PRODUCT_DNA_SYSTEM},
                    {
                        "role": "user",
                        "content": content_parts,
                    },
                ],
                "max_tokens": 1500,
                "temperature": 0.1,
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
                return ""

            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
            logger.info(
                "[vision] Product DNA yaratildi: %d belgi, kategoriya=%s",
                len(text), subject_name,
            )
            return text

        except Exception:
            logger.exception("[vision] generate_product_dna_text xatosi")
            return ""

    async def analyze_photo_dna(
        self,
        photo_url: str,
        subject_name: str = "",
    ) -> dict[str, Any]:
        """
        Mahsulot fotosini tahlil qilib Product DNA JSON qaytaradi.
        Fixed file characteristics generation uchun ishlatiladi.
        """
        if not self.is_enabled:
            logger.warning("[vision] OPENAI_API_KEY sozlanmagan")
            return {}

        dna_text = await self.generate_product_dna_text(photo_url, subject_name)
        if not dna_text:
            return {}

        # Extract structured data from text description
        return self._extract_dna_from_text(dna_text)

    def extract_wb_characteristics(self, dna: dict[str, Any]) -> dict[str, str]:
        """Product DNA dict dan WB xarakteristikalarini chiqaradi."""
        if not dna:
            return {}
        result: dict[str, str] = {}
        wb_chars = dna.get("wb_characteristics", {})
        for char_name, value in wb_chars.items():
            if value and value not in ("unknown", "не определено", "не определён", ""):
                result[char_name] = str(value)
        return result

    def _extract_dna_from_text(self, text: str) -> dict[str, Any]:
        """Texnik tavsif matnidan asosiy ma'lumotlarni ajratib oladi."""
        dna: dict[str, Any] = {"raw_description": text, "wb_characteristics": {}}

        # Extract color
        color_match = re.search(r"(?:основной цвет|цвет)[:\s]+([^\n,\.]+)", text, re.IGNORECASE)
        if color_match:
            dna["wb_characteristics"]["Цвет"] = color_match.group(1).strip()

        # Extract style
        style_match = re.search(r"(?:стиль)[:\s]+([^\n]+)", text, re.IGNORECASE)
        if style_match:
            dna["wb_characteristics"]["Стиль"] = style_match.group(1).strip()

        # Extract seasonality
        season_match = re.search(r"(?:сезонность|сезон)[:\s]+([^\n]+)", text, re.IGNORECASE)
        if season_match:
            dna["wb_characteristics"]["Сезон"] = season_match.group(1).strip()

        # Extract material
        mat_match = re.search(r"(?:материал)[:\s]+([^\n]+)", text, re.IGNORECASE)
        if mat_match and "не определ" not in mat_match.group(1).lower():
            dna["wb_characteristics"]["Фактура материала"] = mat_match.group(1).strip()

        return dna

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


# Singleton
vision_service = VisionService()

