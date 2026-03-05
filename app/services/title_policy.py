from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Tuple

from ..core.config import settings

_WORD_RE = re.compile(r"[а-яёa-z0-9-]+", re.IGNORECASE)
_ALLOWED_TITLE_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9\-\s]+$")

COLOR_WORDS = {
    "черный", "белый", "красный", "синий", "зеленый", "серый", "бежевый",
    "розовый", "голубой", "желтый", "коричневый", "фиолетовый", "оранжевый",
    "бордовый", "бирюзовый", "сиреневый", "малиновый", "салатовый",
    "персиковый", "лавандовый", "мятный", "хаки", "молочный", "айвори",
    "бордо", "индиго", "марсала", "пудровый", "графитовый", "шоколадный",
    "песочный", "кремовый", "изумрудный", "васильковый", "терракотовый",
    "мандариновый", "горчичный", "жемчужный",
}

FORBIDDEN_GENDER_WORDS = {
    "женский", "мужской", "детский", "для", "девочки", "мальчика",
}

FORBIDDEN_MARKETING_WORDS = {
    "топ", "хит", "лучший", "идеальный", "премиум", "люкс", "супер",
    "модный", "трендовый", "качественный", "безупречный", "стильный",
}

FORBIDDEN_EMOTIONAL_WORDS = {
    "красивый", "элегантный", "шикарный", "роскошный", "великолепный",
    "прекрасный", "очаровательный",
}

FORBIDDEN_ATTR_ZONE_WORDS = {
    "хлопок", "полиэстер", "вискоза", "шелк", "лен", "шерсть", "акрил",
    "кашемир", "спандекс", "эластан", "полиамид", "нейлон", "сезон",
    "зима", "лето", "демисезон", "осень", "весна", "страна", "производства",
    "турция", "китай", "россия", "италия", "премиального", "качества",
}

STOPWORDS = {
    "и", "в", "во", "на", "с", "со", "к", "по", "из", "за", "от", "для",
    "или", "а", "но", "под", "над", "при", "о", "об", "без", "не",
    "же", "ли", "для", "под", "подо",
}

NOISY_TOKENS = {
    "подходит", "подходят", "подойдет", "можно", "может", "имеет",
    "имеются", "выполнен", "выполнена", "выполнено", "представлен",
    "представлена", "подчеркивает", "обеспечивает", "создает",
}

KEY_FEATURE_NAME_KEYS = (
    "фасон", "модел", "силуэт", "крой", "тип", "длина", "посад", "особенност",
)
CONSTRUCTIVE_NAME_KEYS = (
    "застеж", "вырез", "ворот", "карман", "пояс", "разрез",
    "баск", "рукав", "борт", "лацкан", "манжет", "кокетк",
)
PURPOSE_NAME_KEYS = ("назнач", "стиль", "повод", "событ", "образ")
COLOR_NAME_KEYS = ("цвет",)

PURPOSE_PHRASE_MAP = {
    "для офиса": "офисный",
    "для работы": "деловой",
    "для вечера": "вечерний",
    "для праздника": "праздничный",
    "для прогулки": "повседневный",
    "на каждый день": "повседневный",
    "повседневной носки": "повседневный",
}

PURPOSE_WORDS = {
    "офисный", "деловой", "вечерний", "повседневный", "праздничный",
    "коктейльный", "сценический",
}

CATEGORY_NORMALIZATION = {
    "костюмы": "костюм",
    "платья": "платье",
    "юбки": "юбка",
    "жакеты": "жакет",
    "рубашки": "рубашка",
    "блузки": "блузка",
    "пиджаки": "пиджак",
    "комбинезоны": "комбинезон",
}


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


def _split_values(raw: str) -> List[str]:
    text = str(raw or "").strip()
    if not text:
        return []
    parts = re.split(r"[,;/]| и | / ", text, flags=re.IGNORECASE)
    out = [_norm_space(p) for p in parts if _norm_space(p)]
    return out or [text]


def _is_forbidden_token(token: str, allow_color: bool = False) -> bool:
    if token in STOPWORDS or token in NOISY_TOKENS:
        return True
    if token in FORBIDDEN_GENDER_WORDS:
        return True
    if token in FORBIDDEN_MARKETING_WORDS or token in FORBIDDEN_EMOTIONAL_WORDS:
        return True
    if token in FORBIDDEN_ATTR_ZONE_WORDS:
        return True
    if not allow_color and token in COLOR_WORDS:
        return True
    return False


def _normalize_slot_phrase(raw: str, max_tokens: int = 2, allow_color: bool = False) -> str:
    text = _norm_space(str(raw or "").replace("«", " ").replace("»", " "))
    if not text:
        return ""

    low = text.lower()
    for source, repl in PURPOSE_PHRASE_MAP.items():
        if source in low:
            return repl

    tokens: List[str] = []
    for token in _tokenize(text):
        if len(token) < 3:
            continue
        if token.isdigit():
            continue
        if _is_forbidden_token(token, allow_color=allow_color):
            continue
        if token in tokens:
            continue
        tokens.append(token)
        if len(tokens) >= max_tokens:
            break

    return " ".join(tokens)


def extract_category(card: Dict[str, Any]) -> str:
    for key in ("subjectName", "subject_name", "category_name"):
        raw = str(card.get(key) or "").strip()
        if not raw:
            continue
        parts = [p.strip() for p in raw.split("/") if p.strip()]
        candidate = parts[-1] if parts else raw
        normalized = _normalize_slot_phrase(candidate, max_tokens=2, allow_color=False)
        if normalized:
            raw_cat = normalized.split()[0]
            return CATEGORY_NORMALIZATION.get(raw_cat, raw_cat)

    title_words = [
        w for w in _tokenize(str(card.get("title") or ""))
        if not _is_forbidden_token(w, allow_color=False)
    ]
    if title_words:
        raw_cat = title_words[0]
        return CATEGORY_NORMALIZATION.get(raw_cat, raw_cat)
    return "товар"


def _extract_slots(card: Dict[str, Any]) -> Dict[str, List[str]]:
    slots = {"feature": [], "constructive": [], "purpose": [], "color": []}
    for name, value in _iter_characteristics(card):
        name_l = name.lower()
        values = _split_values(value)
        for raw in values:
            if any(k in name_l for k in KEY_FEATURE_NAME_KEYS):
                norm = _normalize_slot_phrase(raw, max_tokens=2, allow_color=False)
                if norm:
                    slots["feature"].append(norm)
            if any(k in name_l for k in CONSTRUCTIVE_NAME_KEYS):
                norm = _normalize_slot_phrase(raw, max_tokens=2, allow_color=False)
                if norm:
                    slots["constructive"].append(norm)
            if any(k in name_l for k in PURPOSE_NAME_KEYS):
                norm = _normalize_slot_phrase(raw, max_tokens=2, allow_color=False)
                if norm:
                    slots["purpose"].append(norm)
            if any(k in name_l for k in COLOR_NAME_KEYS):
                for token in _tokenize(raw):
                    if token in COLOR_WORDS:
                        slots["color"].append(token)

    for source, repl in PURPOSE_PHRASE_MAP.items():
        all_text = " ".join([
            str(card.get("title") or ""),
            str(card.get("description") or ""),
        ]).lower()
        if source in all_text:
            slots["purpose"].append(repl)

    return slots


def _unique_phrases(items: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        norm = _norm_space(item).lower()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
    return out


def _collect_evidence_tokens(card: Dict[str, Any]) -> set[str]:
    texts = [
        str(card.get("title") or ""),
        str(card.get("description") or ""),
        str(card.get("subjectName") or ""),
        str(card.get("subject_name") or ""),
        str(card.get("category_name") or ""),
    ]
    for _, value in _iter_characteristics(card):
        texts.append(value)

    out = set()
    full = " ".join(texts).lower()
    for source, repl in PURPOSE_PHRASE_MAP.items():
        if source in full:
            out.add(repl)
    for token in _tokenize(" ".join(texts)):
        if len(token) < 3 or token.isdigit():
            continue
        if token in FORBIDDEN_MARKETING_WORDS or token in FORBIDDEN_EMOTIONAL_WORDS:
            continue
        out.add(token)
    return out


def _ordered_evidence_terms(card: Dict[str, Any]) -> List[str]:
    sources: List[str] = [
        str(card.get("title") or ""),
        str(card.get("description") or ""),
    ]
    for _, value in _iter_characteristics(card):
        sources.append(value)

    ordered: List[str] = []
    seen = set()
    full = " ".join(sources).lower()
    for source, repl in PURPOSE_PHRASE_MAP.items():
        if source in full and repl not in seen:
            seen.add(repl)
            ordered.append(repl)

    for src in sources:
        for token in _tokenize(src):
            if len(token) < 4 or token.isdigit():
                continue
            if _is_forbidden_token(token, allow_color=True):
                continue
            if token in FORBIDDEN_MARKETING_WORDS or token in FORBIDDEN_EMOTIONAL_WORDS:
                continue
            if token in seen:
                continue
            seen.add(token)
            ordered.append(token)
    return ordered


def _pick_title_context_feature(card: Dict[str, Any], category: str) -> str:
    title = str(card.get("title") or "")
    cand = []
    for token in _tokenize(title):
        if len(token) < 4:
            continue
        if token == category:
            continue
        if _is_forbidden_token(token, allow_color=False):
            continue
        cand.append(token)
    if cand:
        return cand[0]
    return ""


def _confirmed_title_color(card: Dict[str, Any]) -> str:
    slots = _extract_slots(card)
    colors = _unique_phrases(slots["color"])
    if len(colors) != 1:
        return ""

    base_title_tokens = set(_tokenize(str(card.get("title") or "")))
    color = colors[0]
    if color in base_title_tokens:
        return color
    return ""


def _append_unique(parts: List[str], phrase: str) -> None:
    phrase = _norm_space(phrase)
    if not phrase:
        return
    phrase_tokens = set(_tokenize(phrase))
    for existing in parts:
        if phrase_tokens & set(_tokenize(existing)):
            return
    parts.append(phrase)


def build_title_from_card(
    card: Dict[str, Any],
    min_len: int | None = None,
    max_len: int | None = None,
) -> str:
    min_len = int(min_len if min_len is not None else settings.MIN_TITLE_LENGTH)
    max_len = int(max_len if max_len is not None else settings.MAX_TITLE_LENGTH)

    category = extract_category(card)
    slots = _extract_slots(card)

    key_feature = (_unique_phrases(slots["feature"]) or [""])[0]
    if not key_feature:
        key_feature = _pick_title_context_feature(card, category)
    if not key_feature:
        evidence = [t for t in _collect_evidence_tokens(card) if len(t) >= 4 and t != category]
        key_feature = sorted(evidence)[0] if evidence else ""

    constructive = (_unique_phrases(slots["constructive"]) or [""])[0]
    purpose = (_unique_phrases([x for x in slots["purpose"] if x in PURPOSE_WORDS]) or [""])[0]
    color = _confirmed_title_color(card)

    parts: List[str] = []
    _append_unique(parts, category)
    _append_unique(parts, key_feature)
    _append_unique(parts, constructive)
    _append_unique(parts, purpose)
    if color:
        _append_unique(parts, color)

    if len(parts) < 2:
        fallback = [p for p in (category, key_feature, constructive, purpose) if p]
        if fallback:
            parts = fallback[:2]

    # Enrich to min length using still-confirmed optional parts.
    backups = _unique_phrases(
        slots["feature"] + slots["constructive"] + slots["purpose"]
    )
    for b in backups:
        if len(_norm_space(" ".join(parts))) >= min_len:
            break
        candidate = _norm_space(" ".join(parts + [b]))
        if len(candidate) <= max_len:
            _append_unique(parts, b)

    # Trim from the end if too long (optional slots first).
    while len(_norm_space(" ".join(parts))) > max_len and len(parts) > 2:
        parts.pop()

    title = _norm_space(" ".join(parts))
    if not title:
        return ""

    title = title[0].upper() + title[1:]
    valid, _ = validate_title(title, card, min_len=min_len, max_len=max_len)
    if valid:
        return title

    # Conservative fallback: enrich with confirmed evidence terms to reach 40-60.
    fallback_parts: List[str] = []
    _append_unique(fallback_parts, category)
    _append_unique(fallback_parts, key_feature)
    _append_unique(fallback_parts, constructive)
    _append_unique(fallback_parts, purpose)
    if color:
        _append_unique(fallback_parts, color)

    for term in _ordered_evidence_terms(card):
        if term == category:
            continue
        candidate = _norm_space(" ".join(fallback_parts + [term]))
        if len(candidate) > max_len:
            continue
        _append_unique(fallback_parts, term)
        if len(candidate) >= min_len:
            break

    while len(_norm_space(" ".join(fallback_parts))) > max_len and len(fallback_parts) > 2:
        fallback_parts.pop()

    fallback = _norm_space(" ".join(fallback_parts))
    if fallback:
        fallback = fallback[0].upper() + fallback[1:]
    return fallback


def _category_match(title_words: List[str], category: str) -> bool:
    if not category:
        return True
    cat = category.lower()
    for w in title_words[:2]:
        if w == cat:
            return True
        if len(cat) >= 4 and (w.startswith(cat[:4]) or cat.startswith(w[:4])):
            return True
    return False


def _stem(w: str, length: int = 6) -> str:
    """Return a simple prefix stem for Russian morphological matching."""
    return w[:length] if len(w) >= length else w


def check_title_facts(title: str, card: Dict[str, Any]) -> Tuple[bool, str]:
    words = _tokenize(title)
    evidence = _collect_evidence_tokens(card)
    allowed_derived = set(PURPOSE_PHRASE_MAP.values()) | PURPOSE_WORDS

    # Build stem-based evidence set for morphological tolerance (Russian inflection, 5-char prefix)
    evidence_stems = {_stem(t, 5) for t in evidence if len(t) >= 5}
    # Also accept category tokens
    category = extract_category(card).lower()
    subj = str(card.get("subjectName") or card.get("subject_name") or "").lower()
    extra_ok = {t for t in _tokenize(subj) if len(t) >= 4}

    for w in words:
        if len(w) < 4:
            continue
        if w in STOPWORDS:
            continue
        if w in allowed_derived:
            continue
        if w in COLOR_WORDS:
            continue
        if w == category:
            continue
        if w in extra_ok:
            continue
        if w in evidence:
            continue
        # Morphological fallback: match by 5-char stem (handles Russian inflections)
        if len(w) >= 5 and _stem(w, 5) in evidence_stems:
            continue
        return False, f"Неподтверждённый признак: {w}"
    return True, ""

def _has_key_model_feature(title_words: List[str], category: str, card: Dict[str, Any]) -> bool:
    expected = set()
    slots = _extract_slots(card)
    for item in slots["feature"]:
        expected.update(_tokenize(item))

    if not expected:
        expected.update(
            t for t in _collect_evidence_tokens(card)
            if len(t) >= 4 and t not in COLOR_WORDS and t != category
        )

    if not expected:
        return len([w for w in title_words if len(w) >= 4 and w != category]) >= 1

    # Build stem set for morphological matching
    expected_stems = {_stem(t, 5) for t in expected if len(t) >= 5}

    for w in title_words:
        if w in expected and w != category and w not in COLOR_WORDS:
            return True
        # Morphological variant match (e.g. двубортный vs двубортная vs двубортным)
        if len(w) >= 5 and w != category and w not in COLOR_WORDS and _stem(w, 5) in expected_stems:
            return True

    # Fallback: accept any word confirmed by evidence tokens (broader check).
    # This handles AI-generated titles using valid forms not in feature slots.
    evidence = _collect_evidence_tokens(card)
    evidence_stems_all = {_stem(t, 5) for t in evidence if len(t) >= 5}
    for w in title_words:
        if (
            len(w) >= 5
            and w != category
            and w not in COLOR_WORDS
            and w not in FORBIDDEN_MARKETING_WORDS
            and w not in FORBIDDEN_EMOTIONAL_WORDS
            and w not in FORBIDDEN_ATTR_ZONE_WORDS
            and w not in STOPWORDS
            and (_stem(w, 5) in evidence_stems_all or w in evidence)
        ):
            return True
    return False


def validate_title(
    title: str,
    card: Dict[str, Any],
    min_len: int | None = None,
    max_len: int | None = None,
) -> Tuple[bool, str]:
    min_len = int(min_len if min_len is not None else settings.MIN_TITLE_LENGTH)
    max_len = int(max_len if max_len is not None else settings.MAX_TITLE_LENGTH)

    if not title or not isinstance(title, str):
        return False, "Пустое название"

    title = _norm_space(title)
    if not title:
        return False, "Пустое название"

    if len(title) < min_len:
        return False, f"Слишком короткое ({len(title)} символов, нужно {min_len}-{max_len})"
    if len(title) > max_len:
        return False, f"Слишком длинное ({len(title)} символов, нужно {min_len}-{max_len})"

    if not _ALLOWED_TITLE_RE.fullmatch(title):
        return False, "Недопустимые символы в названии"
    if re.search(r"[,.!?;:()\"'`~@#$%^&*_+=/\\|<>[\]{}]", title):
        return False, "Запрещена пунктуация и спецсимволы в названии"
    if re.search(r"\b[A-ZА-ЯЁ]{3,}\b", title):
        return False, "Запрещены слова в CAPS"
    if re.search(r"\bдля\s+\w+", title.lower()):
        return False, "Запрещён шаблон 'для + существительное'"

    words = _tokenize(title)
    if not words:
        return False, "Название не содержит слов"
    if len(words) > 9:
        return False, "Слишком много слов в названии"

    counts = Counter(words)
    duplicated = [w for w, c in counts.items() if c > 1]
    if duplicated:
        return False, f"Повтор слов: {', '.join(sorted(duplicated))}"

    forbidden = []
    for w in words:
        if (
            w in FORBIDDEN_GENDER_WORDS
            or w in FORBIDDEN_MARKETING_WORDS
            or w in FORBIDDEN_EMOTIONAL_WORDS
            or w in FORBIDDEN_ATTR_ZONE_WORDS
        ):
            forbidden.append(w)
    if forbidden:
        return False, f"Содержит запрещённые слова: {', '.join(sorted(set(forbidden)))}"

    brand = _norm_space(str(card.get("brand") or ""))
    if brand and len(brand) > 2 and brand.lower() in title.lower():
        return False, f"Содержит бренд '{brand}'"

    category = extract_category(card)
    if not _category_match(words, category):
        return False, "Название должно начинаться с категории товара"

    if not _has_key_model_feature(words, category, card):
        return False, "В названии нет подтверждённого ключевого признака модели"

    title_colors = [w for w in words if w in COLOR_WORDS]
    if len(title_colors) > 1:
        return False, "В названии можно указывать только один подтверждённый цвет"
    if title_colors:
        # Confirm color against characteristics (not original title — AI may generate a fresh title)
        slots = _extract_slots(card)
        char_colors = set(_unique_phrases(slots["color"]))
        if not char_colors:
            return False, "Цвет в названии не подтверждён данными карточки"
        if title_colors[0] not in char_colors:
            return False, f"Цвет '{title_colors[0]}' не совпадает с цветом в характеристиках"

    facts_ok, facts_reason = check_title_facts(title, card)
    if not facts_ok:
        return False, facts_reason

    return True, ""
