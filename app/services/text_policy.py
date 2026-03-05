from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Tuple

from ..core.config import settings
from .title_policy import extract_category

_WORD_RE = re.compile(r"[а-яёa-z0-9-]+", re.IGNORECASE)
_SENTENCE_RE = re.compile(r"[.!?]+")
_EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF\U00002700-\U000027BF]")

FORBIDDEN_WORDS = {
    "стильный", "модный", "тренд", "топ", "хит", "лучший", "идеальный",
    "премиум", "люкс", "супер", "красивый", "элегантный", "роскошный",
    "безупречный", "шикарный", "великолепный", "уникальный",
    "стройнит", "самый",
}

STOPWORDS = {
    "и", "в", "во", "на", "с", "со", "к", "по", "из", "за", "от", "для",
    "или", "а", "но", "под", "над", "при", "о", "об", "без", "не",
}

STRUCTURAL_KEYS = (
    "силуэт", "фасон", "крой", "длина", "рукав", "вырез", "ворот", "застеж",
    "комплект", "тип", "посадк", "карман", "пояс", "подклад",
)

MATERIAL_KEYS = ("состав", "материал", "ткан", "хлоп", "вискоз", "полиэстер", "шерст", "лен")
PURPOSE_HINTS = ("назнач", "офис", "делов", "вечер", "повседнев", "празднич", "на каждый день", "сценари")


def _norm_space(text: str) -> str:
    return " ".join((text or "").strip().split())


def _tokenize(text: str) -> List[str]:
    return _WORD_RE.findall((text or "").lower())


def _iter_characteristics(card: Dict[str, Any]) -> Iterable[Tuple[str, str]]:
    chars = card.get("characteristics") or []
    if isinstance(chars, dict):
        for k, v in chars.items():
            if v is None:
                continue
            if isinstance(v, list):
                vv = ", ".join(str(x) for x in v if x is not None)
            else:
                vv = str(v)
            if vv.strip():
                yield str(k), vv.strip()
        return

    if isinstance(chars, list):
        for ch in chars:
            if not isinstance(ch, dict):
                continue
            name = str(ch.get("name") or "").strip()
            if not name:
                continue
            val = ch.get("value")
            if val is None:
                val = ch.get("values")
            if isinstance(val, list):
                vv = ", ".join(str(x) for x in val if x is not None)
            elif val is not None:
                vv = str(val).strip()
            else:
                vv = ""
            if vv:
                yield name, vv


def _paragraphs(text: str) -> List[str]:
    text = (text or "").replace("\r\n", "\n").strip()
    if not text:
        return []
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _has_bullets(text: str) -> bool:
    for line in (text or "").splitlines():
        ln = line.strip()
        if not ln:
            continue
        if ln.startswith(("-", "*", "•")):
            return True
        if re.match(r"^\d+[\).\:\-]\s*", ln):
            return True
    return False


def _has_forbidden_words(text: str) -> List[str]:
    words = _tokenize(text)
    bad = sorted({w for w in words if w in FORBIDDEN_WORDS})
    return bad


def _sentences_count(paragraph: str) -> int:
    c = len(_SENTENCE_RE.findall(paragraph))
    return c if c > 0 else (1 if paragraph.strip() else 0)


def _meaningful_tokens(text: str) -> List[str]:
    out = []
    for t in _tokenize(text):
        if len(t) < 4:
            continue
        if t in STOPWORDS:
            continue
        out.append(t)
    return out


def _title_keyword_coverage(title: str, description: str) -> float:
    title_tokens = list(dict.fromkeys(_meaningful_tokens(title)))
    if not title_tokens:
        return 1.0
    desc_tokens = set(_meaningful_tokens(description))
    if not desc_tokens:
        return 0.0
    # Use 5-char stem matching to handle Russian morphological variants
    desc_stems = {t[:5] for t in desc_tokens if len(t) >= 5}
    matched = sum(
        1 for t in title_tokens
        if t in desc_tokens or (len(t) >= 5 and t[:5] in desc_stems)
    )
    return matched / max(1, len(title_tokens))


def _has_structure_requirements(text: str, paragraphs: List[str], card: Dict[str, Any]) -> Tuple[bool, str]:
    if not paragraphs:
        return False, "Описание пустое"

    full_lower = text.lower()
    category = extract_category(card)
    title = str(card.get("title") or "").strip()

    # 1) Intro paragraph must reference item/category/title.
    intro = paragraphs[0].lower()
    if category and category not in intro and not any(tok in intro for tok in _meaningful_tokens(title)[:3]):
        return False, "Вступление не содержит категорию/название товара"

    # 2) Construction block.
    if not any(any(k in p.lower() for k in STRUCTURAL_KEYS) for p in paragraphs):
        return False, "Нет блока про конструкцию и посадку"

    # 3) Material block if material exists in characteristics.
    has_material_data = bool(_pick_by_keys(card, MATERIAL_KEYS, limit=1))
    if has_material_data and not any(k in full_lower for k in MATERIAL_KEYS):
        return False, "Не отражены материалы из характеристик"

    # 4) Purpose block.
    if not any(k in full_lower for k in PURPOSE_HINTS):
        return False, "Нет блока с назначением/сценарием использования"

    return True, ""


def validate_description(
    description: str,
    card: Dict[str, Any],
    min_len: int | None = None,
    max_len: int | None = None,
) -> Tuple[bool, str]:
    min_len = int(min_len if min_len is not None else settings.MIN_DESCRIPTION_LENGTH)
    max_len = int(max_len if max_len is not None else getattr(settings, "MAX_DESCRIPTION_LENGTH", 1800))

    if not description or not isinstance(description, str):
        return False, "Пустое описание"

    text = description.strip()
    if not text:
        return False, "Пустое описание"

    if len(text) < min_len:
        return False, f"Описание слишком короткое ({len(text)}, нужно {min_len}-{max_len})"
    if len(text) > max_len:
        return False, f"Описание слишком длинное ({len(text)}, нужно {min_len}-{max_len})"

    if _has_bullets(text):
        return False, "В описании запрещены списки"

    if _EMOJI_RE.search(text):
        return False, "В описании запрещены эмодзи"

    if re.search(r"\b(?:https?://|www\.)", text, re.IGNORECASE):
        return False, "В описании запрещены ссылки"

    if re.search(r"\+?\d[\d\-\s()]{8,}\d", text):
        return False, "В описании запрещены номера телефонов"

    if re.search(r"\b[A-ZА-ЯЁ]{4,}\b", text):
        return False, "В описании запрещены слова в CAPS"

    bad = _has_forbidden_words(text)
    if bad:
        return False, f"Запрещённые слова: {', '.join(bad)}"
    lower = text.lower()
    if re.search(r"(делает\s+стройнее|скрывает\s+недостатк|визуально\s+стройнит)", lower):
        return False, "В описании запрещены обещания эффекта"

    pars = _paragraphs(text)
    if not (3 <= len(pars) <= 6):
        return False, "Описание должно содержать 3-6 абзацев"

    for p in pars:
        sc = _sentences_count(p)
        if not (2 <= sc <= 4):
            return False, "Каждый абзац должен содержать 2-4 предложения"

    structure_ok, structure_reason = _has_structure_requirements(text, pars, card)
    if not structure_ok:
        return False, structure_reason

    # Title consistency: at least 60% meaningful title tokens should appear in description.
    title = str(card.get("title") or "").strip()
    if title:
        coverage = _title_keyword_coverage(title, text)
        if coverage < 0.6:
            return False, "Описание недостаточно согласовано с названием товара"

    return True, ""


def _pick_by_keys(card: Dict[str, Any], keys: Iterable[str], limit: int = 8) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for k, v in _iter_characteristics(card):
        kk = k.lower()
        if any(key in kk for key in keys):
            out.append((k, v))
            if len(out) >= limit:
                break
    return out


def _fallback_value_list(items: List[Tuple[str, str]], limit: int = 6) -> str:
    if not items:
        return ""
    chunks = [f"{k.lower()}: {v}" for k, v in items[:limit]]
    return "; ".join(chunks)


def build_description_from_card(
    card: Dict[str, Any],
    title_hint: str | None = None,
    min_len: int | None = None,
    max_len: int | None = None,
) -> str:
    min_len = int(min_len if min_len is not None else settings.MIN_DESCRIPTION_LENGTH)
    max_len = int(max_len if max_len is not None else getattr(settings, "MAX_DESCRIPTION_LENGTH", 1800))

    title = _norm_space(title_hint or str(card.get("title") or ""))
    category = extract_category(card)
    structural = _pick_by_keys(card, STRUCTURAL_KEYS, limit=8)
    material = _pick_by_keys(card, MATERIAL_KEYS, limit=4)
    purpose = _pick_by_keys(card, ("назнач", "стиль", "повод"), limit=3)
    attrs = list(_iter_characteristics(card))

    p1 = (
        f"{title or category.capitalize()} относится к категории «{category}» и сформирован по подтверждённым данным карточки. "
        "Описание передаёт фактические свойства изделия без маркетинговых формулировок и неподтверждённых обещаний."
    )

    struct_text = _fallback_value_list(structural)
    if struct_text:
        p2 = (
            "Конструкция и посадка сформированы по текущим параметрам карточки: "
            f"{struct_text}. Такой формат сохраняет согласованность между названием, характеристиками и визуальным представлением товара."
        )
    else:
        p2 = (
            "Конструкция и посадка описываются через подтверждённые параметры из карточки. "
            "Приоритет отдан фасону, длине, типу рукава, вырезу и элементам кроя, если эти параметры заполнены в характеристиках."
        )

    mat_text = _fallback_value_list(material)
    if mat_text:
        p3 = (
            "Материалы и состав указываются только в рамках заполненных характеристик: "
            f"{mat_text}. Формулировки даны нейтрально и используются только в пределах подтверждённых значений."
        )
    else:
        p3 = (
            "Сведения о материалах и составе выводятся только из характеристик карточки. "
            "Если параметр не заполнен, в тексте не добавляются предположения о ткани, составе или стране производства."
        )

    purpose_text = _fallback_value_list(purpose)
    p4 = (
        f"Назначение модели определяется конструкцией и фактическими параметрами товара: {purpose_text or 'сценарии использования описаны нейтрально на основе текущих данных'}. "
        "Описание ориентировано на понятные ситуации применения и поддерживает релевантность поиска за счёт согласованности ключевых признаков."
    )

    attrs_text = _fallback_value_list(attrs, limit=7)
    p5 = (
        "Для фильтров WB и корректной индексации используются подтверждённые параметры карточки: "
        f"{attrs_text or 'основные характеристики изделия'}. "
        "Перед публикацией рекомендуется сверить заполнение полей и медиаконтент на отсутствие противоречий. "
        "Уход и эксплуатация должны соответствовать указанным характеристикам и не выходить за пределы подтверждённых данных."
    )

    paragraphs = [_norm_space(p) for p in (p1, p2, p3, p4, p5) if p.strip()]

    # Keep 3-6 paragraphs and 2-4 sentences in each.
    expansions = [
        "Текст синхронизирован с карточкой и не добавляет признаков, которых нет в характеристиках или визуальном контенте.",
        "Такой формат снижает риск противоречий при модерации и улучшает качество индексации по релевантным запросам.",
        "Все ключевые формулировки привязаны к заполненным полям карточки и отражают фактические параметры товара.",
    ]
    exp_idx = 0
    def _join_text() -> str:
        return "\n\n".join(paragraphs)

    while len(_join_text()) < min_len:
        sentence = expansions[exp_idx % len(expansions)]
        exp_idx += 1
        inserted = False
        for i in range(len(paragraphs) - 1, -1, -1):
            if _sentences_count(paragraphs[i]) < 4:
                paragraphs[i] = f"{paragraphs[i]} {sentence}"
                inserted = True
                break
        if not inserted:
            break

    text = _join_text()
    if len(text) > max_len:
        trimmed = text[:max_len]
        cut = max(trimmed.rfind(". "), trimmed.rfind("! "), trimmed.rfind("? "))
        if cut > int(max_len * 0.7):
            trimmed = trimmed[:cut + 1].strip()
        text = trimmed

    # Safety: if trim broke paragraphing, rebuild from current paragraphs and hard-cut last paragraph only.
    pars = _paragraphs(text)
    if not (3 <= len(pars) <= 6):
        text = _join_text()[:max_len].strip()

    return text
