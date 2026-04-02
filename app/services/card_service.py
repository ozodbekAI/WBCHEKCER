import asyncio
import copy
import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import select, update, delete, func, and_, String
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models import Card, CardConfirmedSection, CardIssue, IssueSeverity, IssueCategory, IssueStatus
from ..services.analyzer import card_analyzer
from ..services.wb_validator import validate_card_characteristics, get_catalog, find_best_match, calculate_card_fcs
from ..services.gemini_service import get_gemini_service, get_ai_service
from ..services.vision_service import vision_service
from ..services.title_policy import validate_title
from ..services.text_policy import validate_description
from ..services.super_validator import super_validator_service
from ..services import fixed_file_service as ffs
from ..services.workflow_service import CARD_WORKFLOW_SECTIONS

# Max retries for AI fix validation loop
MAX_FIX_RETRIES = 2
STALE_CARD_REANALYZE_TIMEOUT_SEC = 45
logger = logging.getLogger(__name__)

_TITLE_CODES = {"title_too_short", "no_title", "title_too_long", "title_policy_violation"}
_TITLE_FIELD_PATHS = {"title"}
_DESCRIPTION_CODES = {"no_description", "description_too_short", "description_too_long", "description_policy_violation"}
_DESCRIPTION_FIELD_PATHS = {"description"}

_DATE_CONTEXT_WORDS = {
    "дата", "сертификат", "сертифика", "декларац", "регистрац",
    "срок", "действия", "годен", "годности", "expiry", "certificate",
    "declaration", "issue date", "valid until", "validity",
}
_DATE_FIELD_HINTS = {"date", "дата", "certificate", "сертификат", "декларац"}

_DESCRIPTION_EDITOR_STOPWORDS = {
    "и", "в", "во", "на", "с", "со", "по", "для", "из", "под", "над", "при", "или",
    "это", "этот", "эта", "эти", "как", "что", "без", "не", "от", "до", "к", "ко",
    "а", "но", "же", "ли", "так", "также", "модель", "товар", "вариант",
}

_NON_VISUAL_AI_FIELDS = {
    "состав",
    "страна производства",
    "материал подкладки",
}

_WEAK_AI_MARKERS = (
    "необходимо проверить",
    "рекомендуется",
    "должно быть одно",
    "должны быть указаны в единственном числе",
    "единственным значением",
    "оставить только одно значение",
)

_STRONG_AI_EVIDENCE_MARKERS = (
    "на фото",
    "видно",
    "не видно",
    "отсутств",
    "не подтвержд",
    "противореч",
    "состоит из",
    "однако",
    "а не ",
)


def _clip(value: object, max_len: int) -> str:
    text = str(value or "")
    if len(text) <= max_len:
        return text
    return text[:max_len]


def _is_color_field(field_name: Optional[str]) -> bool:
    return "цвет" in (field_name or "").lower()


def _norm_text(s: str) -> str:
    return " ".join((s or "").strip().lower().split())


def _extract_seed_colors(value: Optional[str]) -> List[str]:
    if not value:
        return []
    text = str(value).strip()
    if not text:
        return []
    if "," in text:
        return [x.strip() for x in text.split(",") if x.strip()]
    return [text]


def _extract_photo_urls(raw_data: dict, limit: int = 2) -> List[str]:
    """Extract up to N photo URLs from WB card payload in original order."""
    media = raw_data.get("photos") or raw_data.get("mediaFiles") or []
    if not isinstance(media, list) or not media:
        return []

    out: List[str] = []
    seen: set[str] = set()
    safe_limit = max(1, min(int(limit or 1), 5))

    for item in media:
        if len(out) >= safe_limit:
            break
        url = ""
        if isinstance(item, dict):
            url = item.get("big") or item.get("c516x688") or item.get("square") or item.get("url") or ""
        else:
            url = str(item or "")
        url = str(url or "").strip()
        if not url or url in seen:
            continue
        out.append(url)
        seen.add(url)

    return out


def _allowed_values_for_ai(iss: CardIssue) -> List[str]:
    """
    For color fields send only parent color names to AI.
    For other fields keep existing allowed_values.
    """
    if _is_color_field(iss.field_path) or _is_color_field(iss.title):
        try:
            return get_catalog().get_color_parent_names()
        except Exception:
            return iss.allowed_values or []
    return iss.allowed_values or []


def _normalize_issue_field_path(name: Optional[str]) -> Optional[str]:
    """Normalize AI/compound field names to internal field_path format."""
    if not name:
        return None

    raw = str(name).strip()
    if not raw:
        return None

    lower = raw.lower()
    if lower in {"title", "название", "наименование"}:
        return "title"
    if lower in {"description", "описание"}:
        return "description"
    if raw.startswith("characteristics."):
        return raw

    return f"characteristics.{raw}"


def _is_same_issue_field(path_a: Optional[str], path_b: Optional[str]) -> bool:
    a = _normalize_issue_field_path(path_a) if path_a else None
    b = _normalize_issue_field_path(path_b) if path_b else None
    return bool(a and b and a.strip().lower() == b.strip().lower())


def _is_title_issue_obj(issue: CardIssue) -> bool:
    path = (issue.field_path or "").strip().lower()
    return issue.code in _TITLE_CODES or path in _TITLE_FIELD_PATHS


def _is_description_issue_obj(issue: CardIssue) -> bool:
    path = (issue.field_path or "").strip().lower()
    return issue.code in _DESCRIPTION_CODES or path in _DESCRIPTION_FIELD_PATHS


def _issue_has_fix_action(issue: CardIssue, actions: set[str]) -> bool:
    for detail in (issue.error_details or []):
        if not isinstance(detail, dict):
            continue
        marker = str(detail.get("fix_action") or detail.get("type") or "").strip().lower()
        if marker in actions:
            return True
    return False


def _allow_destructive_fix(issue: CardIssue) -> bool:
    """
    Allow clear/swap only for explicitly non-applicable fields.
    For plain allowed-values/limit violations we must suggest a concrete value.
    """
    code = str(issue.code or "").strip().lower()
    if code == "wb_wrong_category":
        return True
    if _issue_has_fix_action(issue, {"swap", "clear", "compound"}):
        return True
    for detail in (issue.error_details or []):
        if isinstance(detail, dict) and str(detail.get("type") or "").strip().lower() == "wrong_category":
            return True
    return False


def _split_issue_values(raw_value: Optional[str]) -> List[str]:
    raw = str(raw_value or "").strip()
    if not raw:
        return []
    normalized = raw.strip().strip("[]")
    if not normalized:
        return []
    parts = re.split(r"[;,]", normalized)
    out: List[str] = []
    for part in parts:
        v = part.strip().strip("'\"")
        if v:
            out.append(v)
    return out


def _normalized_issue_parts(raw_value: Optional[str]) -> List[str]:
    parts = _split_issue_values(raw_value)
    if not parts:
        normalized = _norm_text(str(raw_value or ""))
        return [normalized] if normalized else []

    seen: set[str] = set()
    out: List[str] = []
    for part in parts:
        normalized = _norm_text(part)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


def _issue_values_equivalent(current_value: Optional[str], suggested_value: Optional[str]) -> bool:
    current = _norm_text(str(current_value or ""))
    suggested = _norm_text(str(suggested_value or ""))
    if not current or not suggested:
        return False
    if current == suggested:
        return True

    current_parts = _normalized_issue_parts(current_value)
    suggested_parts = _normalized_issue_parts(suggested_value)
    return bool(current_parts and suggested_parts and current_parts == suggested_parts)


def _issue_value_search_roots(value: str) -> List[str]:
    normalized = _norm_text(value)
    if not normalized:
        return []

    roots: List[str] = [normalized]
    seen = {normalized}
    for token in re.split(r"[^0-9a-zа-яё]+", normalized):
        if len(token) < 4:
            continue
        for variant in (token, token[: min(len(token), 6)]):
            if variant and variant not in seen:
                seen.add(variant)
                roots.append(variant)
    return roots


def _issue_text_signal(text: Optional[str], value: str) -> int:
    normalized_text = _norm_text(str(text or ""))
    if not normalized_text:
        return 0

    matched = False
    for root in _issue_value_search_roots(value):
        cursor = normalized_text.find(root)
        while cursor != -1:
            matched = True
            window_start = max(0, cursor - 48)
            window_end = min(len(normalized_text), cursor + len(root) + 48)
            window = normalized_text[window_start:window_end]
            if any(marker in window for marker in ("не видно", "отсутств", "не подтвержд", " нет ")):
                return -1
            cursor = normalized_text.find(root, cursor + len(root))

    if matched:
        return 1
    return 0


def _suggestion_supported_by_text(text: str, value: str) -> bool:
    if _issue_text_signal(text, value) > 0:
        return True

    normalized_value = _norm_text(value)
    if normalized_value.startswith("без "):
        base_value = normalized_value[4:].strip()
        return _issue_text_signal(text, base_value) < 0

    return False


def _infer_subset_fix_from_issue(issue: CardIssue):
    current_parts = _split_issue_values(issue.current_value)
    if len(current_parts) <= 1:
        return None

    evidence_text = " ".join(
        part for part in [
            str(issue.title or "").strip(),
            str(issue.description or "").strip(),
            str(issue.ai_reason or "").strip(),
        ]
        if part
    )
    if not evidence_text:
        return None

    positives: List[str] = []
    negatives: List[str] = []
    for part in current_parts:
        signal = _issue_text_signal(evidence_text, part)
        if signal > 0:
            positives.append(part)
        elif signal < 0:
            negatives.append(part)

    candidate: Any = None
    if positives and len(positives) < len(current_parts):
        candidate = positives
    elif negatives and len(negatives) < len(current_parts):
        candidate = [part for part in current_parts if part not in negatives]

    if not candidate:
        return None
    if isinstance(candidate, list):
        candidate = [part for part in candidate if str(part).strip()]
        if not candidate:
            return None
        candidate = candidate if len(candidate) > 1 else candidate[0]

    return candidate


def _remove_fix_action_markers(error_details: list | None) -> list:
    cleaned: List[Any] = []
    for item in (error_details or []):
        if not isinstance(item, dict):
            cleaned.append(item)
            continue
        marker = str(item.get("fix_action") or item.get("type") or "").strip().lower()
        if marker in {"swap", "clear"}:
            continue
        cleaned.append(item)
    return cleaned


def _extract_issue_example_values(error_details: list | None, limit: int = 12) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for item in (error_details or []):
        if not isinstance(item, dict):
            continue
        for raw in (item.get("exampleValues") or []):
            value = str(raw or "").strip()
            if not value or value in seen:
                continue
            seen.add(value)
            out.append(value)
            if len(out) >= limit:
                return out
    return out


def _salvage_issue_fix_candidate(issue: CardIssue, product_dna: str = ""):
    candidate = _infer_subset_fix_from_issue(issue)
    if candidate in (None, "", []):
        return None

    valid, _, corrected = _validate_fix_against_constraints(
        candidate,
        issue.allowed_values,
        issue.error_details,
        char_name=issue.field_path or issue.title,
        current_value=issue.current_value,
        product_dna=product_dna,
    )
    if not valid:
        return None
    return corrected if corrected is not None else candidate


def _issue_field_name(issue: CardIssue) -> str:
    path = str(issue.field_path or "").strip()
    if path.lower().startswith("characteristics."):
        return path.split("characteristics.", 1)[1].strip()
    return path


def _issue_evidence_text(issue: CardIssue) -> str:
    parts: List[str] = [
        str(issue.title or "").strip(),
        str(issue.description or "").strip(),
        str(issue.ai_reason or "").strip(),
    ]
    for item in (issue.error_details or []):
        if isinstance(item, dict):
            parts.append(str(item.get("message") or "").strip())
    return _norm_text(" ".join(part for part in parts if part))


def _issue_has_strong_evidence(issue: CardIssue) -> bool:
    text = _issue_evidence_text(issue)
    if not text:
        return False
    return any(marker in text for marker in _STRONG_AI_EVIDENCE_MARKERS)


def _issue_has_reduction_evidence(issue: CardIssue) -> bool:
    text = _issue_evidence_text(issue)
    if not text:
        return False

    current_parts = _split_issue_values(issue.current_value)
    suggested_parts = _split_issue_values(issue.suggested_value or issue.ai_suggested_value)
    if not current_parts or not suggested_parts:
        return False

    current_norm = set(_normalized_issue_parts(issue.current_value))
    negatives = [part for part in current_parts if _issue_text_signal(text, part) < 0]
    if negatives:
        return True

    introduced_parts = [
        part for part in suggested_parts
        if _norm_text(part) not in current_norm
    ]
    if introduced_parts and any(_suggestion_supported_by_text(text, part) for part in introduced_parts):
        return True

    field_name = _issue_field_name(issue)
    limits = get_catalog().get_limits(field_name) or _extract_limits(issue.error_details)
    max_l = limits.get("max") if limits else None
    if (
        isinstance(max_l, int)
        and max_l > 0
        and max_l <= 2
        and "только" in text
        and any(_issue_text_signal(text, part) > 0 for part in suggested_parts)
    ):
        return True

    return False


def _issue_within_catalog_limits(issue: CardIssue) -> bool:
    field_name = _issue_field_name(issue)
    if not field_name:
        return True

    limits = get_catalog().get_limits(field_name) or _extract_limits(issue.error_details)
    if not limits:
        return True

    values_count = len(_split_issue_values(issue.current_value))
    if values_count == 0 and issue.current_value:
        values_count = 1

    min_l = limits.get("min")
    max_l = limits.get("max")
    if isinstance(min_l, int) and min_l > 0 and values_count < min_l:
        return False
    if isinstance(max_l, int) and max_l > 0 and values_count > max_l:
        return False
    return True


def _issue_has_error_type(issue: CardIssue, error_type: str) -> bool:
    target = str(error_type or "").strip().lower()
    if not target:
        return False
    for item in (issue.error_details or []):
        if not isinstance(item, dict):
            continue
        if str(item.get("type") or "").strip().lower() == target:
            return True
    return False


def _issue_context_supports_suggestion(issue: CardIssue, context_text: str) -> bool:
    suggested_raw = issue.ai_suggested_value or issue.suggested_value
    suggested_parts = _split_issue_values(suggested_raw)
    normalized_context = _norm_text(context_text)
    if not suggested_parts or not normalized_context:
        return False
    return all(_suggestion_supported_by_text(normalized_context, part) for part in suggested_parts)


def _strip_unverified_catalog_suggestions(issues: List[CardIssue], context_text: str) -> None:
    normalized_context = _norm_text(context_text)
    for issue in issues:
        code = str(issue.code or "").strip().lower()
        if not code.startswith("wb_"):
            continue
        if not _issue_has_error_type(issue, "allowed_values"):
            continue

        if not issue.alternatives:
            issue.alternatives = _extract_issue_example_values(issue.error_details)

        if str(issue.source or "").strip().lower() == "auto_fix":
            continue

        suggestion = str(issue.ai_suggested_value or issue.suggested_value or "").strip()
        if not suggestion:
            continue

        field_name = _issue_field_name(issue).lower()
        if field_name in _NON_VISUAL_AI_FIELDS or not _issue_context_supports_suggestion(issue, normalized_context):
            issue.ai_suggested_value = None
            issue.suggested_value = None
            issue.ai_reason = "Автозамена скрыта: недостаточно подтверждений для точного значения."
            issue.ai_alternatives = []


def _should_keep_ai_issue(issue: CardIssue) -> bool:
    code = str(issue.code or "").strip().lower()
    if code == "description_refresh_needed":
        return True
    if str(issue.source or "").strip().lower() != "ai":
        return True
    if _is_title_issue_obj(issue) or _is_description_issue_obj(issue):
        return True

    field_name = _issue_field_name(issue).lower()
    if field_name in _NON_VISUAL_AI_FIELDS:
        return False

    suggested_parts = _split_issue_values(issue.suggested_value or issue.ai_suggested_value)
    current_parts = _split_issue_values(issue.current_value)
    evidence_text = _issue_evidence_text(issue)

    if current_parts and suggested_parts and len(suggested_parts) < len(current_parts):
        if _issue_within_catalog_limits(issue) and not _issue_has_reduction_evidence(issue):
            return False

    if not _issue_has_strong_evidence(issue) and any(marker in evidence_text for marker in _WEAK_AI_MARKERS):
        return False

    return True


def _drop_unverified_ai_issues(issues: List[CardIssue]) -> List[CardIssue]:
    filtered = [issue for issue in issues if _should_keep_ai_issue(issue)]

    has_non_text_characteristic_issue = any(
        (issue.category == IssueCategory.CHARACTERISTICS)
        and issue.code != "description_refresh_needed"
        and not _is_title_issue_obj(issue)
        and not _is_description_issue_obj(issue)
        for issue in filtered
    )

    return [
        issue for issue in filtered
        if issue.code != "description_refresh_needed" or has_non_text_characteristic_issue
    ]


def _is_manually_actionable_issue(issue: CardIssue) -> bool:
    if issue.suggested_value is not None:
        return True
    if issue.source in {"fixed_file", "auto_fix"}:
        return True
    if _is_title_issue_obj(issue) or _is_description_issue_obj(issue):
        return True
    if bool(issue.allowed_values):
        return True
    if bool(issue.alternatives or issue.ai_alternatives):
        return True
    return bool((issue.field_path or "").strip().lower().startswith("characteristics."))


def _fallback_value_from_constraints(issue: CardIssue):
    """
    Best-effort fallback when AI returned empty/clear for non-clearable issues.
    Always tries to return a usable value that passes code constraints.
    """
    allowed = list(issue.allowed_values or [])
    if allowed:
        current_parts = _split_issue_values(issue.current_value)
        picked: List[str] = []
        for cur in current_parts:
            match = find_best_match(cur, allowed, threshold=0.68)
            if match and match not in picked:
                picked.append(match)
        if not picked:
            picked.append(allowed[0])

        limits = _extract_limits(issue.error_details)
        min_l = limits.get("min")
        max_l = limits.get("max")
        if isinstance(max_l, int) and max_l > 0 and len(picked) > max_l:
            picked = picked[:max_l]
        if isinstance(min_l, int) and min_l > 0 and len(picked) < min_l:
            for av in allowed:
                if len(picked) >= min_l:
                    break
                if av not in picked:
                    picked.append(av)
            while len(picked) < min_l:
                picked.append(picked[-1])

        candidate = picked if len(picked) > 1 else picked[0]
        ok, _, corrected = _validate_fix_against_constraints(
            candidate,
            issue.allowed_values,
            issue.error_details,
            char_name=issue.field_path or issue.title,
            current_value=issue.current_value,
        )
        if ok:
            return corrected if corrected is not None else candidate
        return None

    limits = _extract_limits(issue.error_details)
    if not limits:
        return None

    values = _split_issue_values(issue.current_value)
    if not values:
        return None

    min_l = limits.get("min")
    max_l = limits.get("max")
    if isinstance(max_l, int) and max_l > 0 and len(values) > max_l:
        values = values[:max_l]
    if isinstance(min_l, int) and min_l > 0 and len(values) < min_l:
        while len(values) < min_l:
            values.append(values[-1])
    return values if len(values) > 1 else values[0]


def _as_text(value: object) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _normalize_compound_fix_value(
    field_path: Optional[str],
    value,
    current_value: Optional[str],
):
    """
    Normalize compound fix values before persisting into error_details.
    For color fields, expand parent color into a palette of closest shades.
    """
    if not _is_color_field(field_path):
        return value
    ok, _, corrected = _validate_fix_against_constraints(
        value=value,
        allowed_values=[],
        error_details=[],
        char_name=field_path,
        current_value=current_value,
    )
    if ok and corrected is not None:
        return corrected
    return value


def _contains_date_context_text(text: Optional[str]) -> bool:
    raw = str(text or "").strip().lower()
    if not raw:
        return False
    if any(word in raw for word in _DATE_CONTEXT_WORDS):
        return True
    # Date format itself is not enough; require date-field hint nearby.
    has_date_value = bool(re.search(r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b", raw))
    has_hint = any(h in raw for h in _DATE_FIELD_HINTS)
    return has_date_value and has_hint


def _is_date_sensitive_ai_issue(ai_issue: dict) -> bool:
    texts: List[str] = [
        str(ai_issue.get("name") or ""),
        str(ai_issue.get("message") or ""),
        str(ai_issue.get("description") or ""),
        str(ai_issue.get("value") or ""),
        str(ai_issue.get("swap_to_name") or ""),
        str(ai_issue.get("swap_to_value") or ""),
    ]
    for err in (ai_issue.get("errors") or []):
        if isinstance(err, dict):
            texts.append(str(err.get("type") or ""))
            texts.append(str(err.get("message") or ""))
    for fx in (ai_issue.get("compound_fixes") or []):
        if isinstance(fx, dict):
            texts.append(str(fx.get("name") or ""))
            texts.append(str(fx.get("value") or ""))
    return any(_contains_date_context_text(t) for t in texts if t)


def _is_text_based_ai_issue(ai_issue: dict) -> bool:
    """True when AI issue is based on title/description text, not photo+characteristics."""
    cat = str(ai_issue.get("category") or "").strip().lower()
    if cat == "text":
        return True

    texts: List[str] = [
        str(ai_issue.get("name") or "").lower(),
        str(ai_issue.get("message") or "").lower(),
        str(ai_issue.get("description") or "").lower(),
    ]
    for err in (ai_issue.get("errors") or []):
        if isinstance(err, dict):
            texts.append(str(err.get("type") or "").lower())
            texts.append(str(err.get("message") or "").lower())

    blob = " | ".join(t for t in texts if t)
    if not blob:
        return False

    # Any direct text/title/description reference should be excluded from AI audit stage.
    text_markers = (
        "text_mismatch", "seo", "ключев", "описан", "description", "title",
        "назван", "текст", "в описании", "по описанию",
    )
    return any(m in blob for m in text_markers)


def _is_vendorcode_ai_issue(ai_issue: dict) -> bool:
    texts: List[str] = [
        str(ai_issue.get("name") or "").lower(),
        str(ai_issue.get("message") or "").lower(),
        str(ai_issue.get("description") or "").lower(),
        str(ai_issue.get("value") or "").lower(),
    ]
    for err in (ai_issue.get("errors") or []):
        if isinstance(err, dict):
            texts.append(str(err.get("type") or "").lower())
            texts.append(str(err.get("message") or "").lower())

    blob = " | ".join(t for t in texts if t)
    if not blob:
        return False
    markers = ("vendorcode", "vendor_code", "vendor code", "артикул")
    return any(m in blob for m in markers)


def _is_allowed_values_ai_issue(ai_issue: dict) -> bool:
    """True when AI issue claims value is not in allowed list; backend validator owns this check."""
    texts: List[str] = [
        str(ai_issue.get("name") or "").lower(),
        str(ai_issue.get("message") or "").lower(),
        str(ai_issue.get("description") or "").lower(),
        str(ai_issue.get("value") or "").lower(),
        str(ai_issue.get("category") or "").lower(),
    ]
    for err in (ai_issue.get("errors") or []):
        if isinstance(err, dict):
            texts.append(str(err.get("type") or "").lower())
            texts.append(str(err.get("message") or "").lower())

    blob = " | ".join(t for t in texts if t)
    if not blob:
        return False

    markers = (
        "allowed_values",
        "списке допустим",
        "допустимым значением",
        "не является допустим",
        "отсутствует в списке допустим",
        "не входит в допустим",
        "значение отсутствует в списке",
    )
    return any(m in blob for m in markers)


def _is_non_fixed_date_issue_obj(issue: CardIssue) -> bool:
    if (issue.source or "").lower() == "fixed_file":
        return False

    texts: List[str] = [
        str(issue.code or ""),
        str(issue.title or ""),
        str(issue.description or ""),
        str(issue.field_path or ""),
        str(issue.current_value or ""),
        str(issue.suggested_value or ""),
    ]
    for err in (issue.error_details or []):
        if isinstance(err, dict):
            texts.append(str(err.get("type") or ""))
            texts.append(str(err.get("message") or ""))
            texts.append(str(err.get("name") or ""))
            texts.append(str(err.get("field_path") or ""))
            texts.append(str(err.get("value") or ""))
            fixes = err.get("fixes")
            if isinstance(fixes, list):
                for fx in fixes:
                    if isinstance(fx, dict):
                        texts.append(str(fx.get("name") or ""))
                        texts.append(str(fx.get("field_path") or ""))
                        texts.append(str(fx.get("value") or ""))
    return any(_contains_date_context_text(t) for t in texts if t)


def _drop_non_fixed_date_issues(issues: List[CardIssue]) -> List[CardIssue]:
    return [iss for iss in issues if not _is_non_fixed_date_issue_obj(iss)]


def _set_characteristic_value_in_context(context: dict, field_path: Optional[str], value) -> None:
    """
    Update context characteristics in-place so title/description prompts
    can use freshly fixed characteristic values.
    """
    if not isinstance(context, dict):
        return
    if not field_path:
        return
    path = str(field_path).strip()
    if not path.lower().startswith("characteristics."):
        return
    name = path.split("characteristics.", 1)[1].strip()
    if not name:
        return

    chars = context.get("characteristics")
    if isinstance(chars, dict):
        chars[name] = value
        return
    if isinstance(chars, list):
        target = None
        for ch in chars:
            if not isinstance(ch, dict):
                continue
            if str(ch.get("name") or "").strip().lower() == name.lower():
                target = ch
                break
        if target is None:
            target = {"name": name}
            chars.append(target)
        if isinstance(value, list):
            target["values"] = value
            target["value"] = value
        else:
            target["value"] = value
            if "values" in target:
                target["values"] = value
        return

    # initialize empty dict structure when characteristics absent
    context["characteristics"] = {name: value}


def _extract_compound_fixes(error_details: list | None) -> List[dict]:
    """Return compound fix list from issue.error_details."""
    for item in (error_details or []):
        if not isinstance(item, dict):
            continue
        if item.get("type") == "compound" or item.get("fix_action") == "compound":
            fixes = item.get("fixes")
            return fixes if isinstance(fixes, list) else []
    return []


def _collapse_compound_overlaps(issues: List[CardIssue]) -> List[CardIssue]:
    """
    Keep compound issue as the single actionable item for covered fields.
    Example: "Тип низа + Модель юбки + Модель брюк" should stay as one issue.
    """
    if not issues:
        return issues

    compound_targets: List[tuple[int, set[str], set[int], set[str]]] = []
    for idx, issue in enumerate(issues):
        fixes = _extract_compound_fixes(issue.error_details)
        if not fixes:
            continue

        target_paths: set[str] = set()
        target_charc_ids: set[int] = set()
        target_names: set[str] = set()

        for fix in fixes:
            if not isinstance(fix, dict):
                continue

            path = fix.get("field_path") or _normalize_issue_field_path(fix.get("name"))
            if path:
                target_paths.add(str(path).strip().lower())

            cid = fix.get("charc_id", fix.get("charcId"))
            if cid is not None:
                try:
                    target_charc_ids.add(int(cid))
                except (TypeError, ValueError):
                    pass

            name = str(fix.get("name") or "").strip().lower()
            if name:
                target_names.add(name)

        if target_paths or target_charc_ids or target_names:
            compound_targets.append((idx, target_paths, target_charc_ids, target_names))

    if not compound_targets:
        return issues

    collapsed: List[CardIssue] = []
    for idx, issue in enumerate(issues):
        remove = False
        issue_path = (issue.field_path or "").strip().lower()
        issue_charc_id = issue.charc_id
        issue_name = ""
        if issue_path.startswith("characteristics."):
            issue_name = issue_path.split("characteristics.", 1)[1].strip().lower()

        for compound_idx, paths, charc_ids, names in compound_targets:
            if idx == compound_idx:
                continue
            # Collapse only data/characteristic style issues; keep photo/video/etc.
            if issue.category not in {
                IssueCategory.CHARACTERISTICS,
                IssueCategory.CATEGORY,
                IssueCategory.TITLE,
                IssueCategory.DESCRIPTION,
            }:
                continue

            if issue_charc_id is not None and issue_charc_id in charc_ids:
                remove = True
                break
            if issue_path and issue_path in paths:
                remove = True
                break
            if issue_name and issue_name in names:
                remove = True
                break

        if not remove:
            collapsed.append(issue)

    return collapsed


def _get_subject_keywords(card: dict) -> list:
    """Return SEO keywords for this card's subject from the catalog."""
    subject = (
        card.get("subjectName")
        or card.get("subject_name")
        or card.get("object")
        or ""
    )
    if not subject:
        return []
    try:
        return get_catalog().get_keywords_for_subject(str(subject))
    except Exception:
        return []


def _normalize_editor_keyword(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _push_editor_keyword(target: List[str], seen: set[str], raw: Any) -> None:
    normalized = _normalize_editor_keyword(raw)
    if not normalized or len(normalized) < 3 or len(normalized) > 40:
        return
    if normalized in _DESCRIPTION_EDITOR_STOPWORDS:
        return
    if normalized in seen:
        return
    seen.add(normalized)
    target.append(normalized)


def _singularize_subject_keyword(raw: Any) -> str:
    value = _normalize_editor_keyword(raw)
    if not value:
        return ""
    if value.endswith("ы") or value.endswith("и"):
        return value[:-1]
    return value


def _extract_title_keywords_for_editor(title: Any) -> List[str]:
    words = re.split(r"[^0-9A-Za-zА-Яа-яЁё-]+", str(title or "").lower())
    out: List[str] = []
    for word in words:
        w = word.strip()
        if len(w) < 4:
            continue
        if w in _DESCRIPTION_EDITOR_STOPWORDS:
            continue
        out.append(w)
    return out


def _coerce_characteristics_dict(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return {str(key): value for key, value in raw.items()}

    out: Dict[str, Any] = {}
    if not isinstance(raw, list):
        return out

    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        value = item.get("value", item.get("values"))
        if isinstance(value, list):
            out[name] = ", ".join(str(v) for v in value if str(v).strip())
        else:
            out[name] = value
    return out


def _extract_editor_value_parts(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]

    text = str(raw).strip()
    if not text:
        return []

    parts = _split_issue_values(text)
    if parts:
        return parts
    return [text]


def _draft_override_value(draft: Dict[str, Any], key: str, fallback: Any) -> Any:
    if key in draft and draft.get(key) is not None:
        return draft.get(key)
    return fallback


def build_card_text_context(card: Card, draft: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    draft_data = dict(draft or {})

    base_raw = copy.deepcopy(card.raw_data or {})
    if not isinstance(base_raw, dict):
        base_raw = {}

    raw_chars = _coerce_characteristics_dict(base_raw.get("characteristics"))
    card_chars = _coerce_characteristics_dict(card.characteristics)
    merged_chars: Dict[str, Any] = {**raw_chars, **card_chars}

    draft_chars = _coerce_characteristics_dict(draft_data.get("characteristics"))
    for key, value in draft_chars.items():
        if value is None:
            continue
        merged_chars[str(key)] = value

    title_fallback = card.title if card.title is not None else base_raw.get("title")
    description_fallback = card.description if card.description is not None else base_raw.get("description")

    title = _draft_override_value(draft_data, "title", title_fallback) or ""
    description = _draft_override_value(draft_data, "description", description_fallback) or ""

    subject_name = (
        card.subject_name
        or base_raw.get("subjectName")
        or base_raw.get("subject_name")
        or ""
    )
    category_name = (
        card.category_name
        or base_raw.get("object")
        or base_raw.get("category_name")
        or ""
    )
    brand = card.brand or base_raw.get("brand") or ""
    photos = list(card.photos or base_raw.get("photos") or [])

    context = dict(base_raw)
    context.update(
        {
            "title": str(title or ""),
            "description": str(description or ""),
            "subjectName": str(subject_name or ""),
            "subject_name": str(subject_name or ""),
            "object": str(category_name or ""),
            "category_name": str(category_name or ""),
            "brand": str(brand or ""),
            "photos": photos,
            "characteristics": merged_chars,
            "tech_description": str(card.product_dna or base_raw.get("tech_description") or ""),
            "product_dna": str(card.product_dna or ""),
        }
    )
    return context


def build_description_editor_keywords(
    card_or_context: Card | Dict[str, Any],
    draft: Optional[Dict[str, Any]] = None,
    limit: int = 15,
) -> List[str]:
    context = (
        build_card_text_context(card_or_context, draft)
        if isinstance(card_or_context, Card)
        else dict(card_or_context or {})
    )

    result: List[str] = []
    seen: set[str] = set()

    subject_name = str(context.get("subject_name") or context.get("subjectName") or "").strip()
    _push_editor_keyword(result, seen, _singularize_subject_keyword(subject_name))
    _push_editor_keyword(result, seen, subject_name)

    for keyword in _extract_title_keywords_for_editor(context.get("title")):
        _push_editor_keyword(result, seen, keyword)

    for keyword in _get_subject_keywords(context):
        _push_editor_keyword(result, seen, keyword)

    chars = _coerce_characteristics_dict(context.get("characteristics"))

    def push_char_values(key: str) -> None:
        for value in _extract_editor_value_parts(chars.get(key)):
            _push_editor_keyword(result, seen, value)

    for key in (
        "Пол",
        "Назначение",
        "Стиль",
        "Тип верха",
        "Тип низа",
        "Модель костюма",
        "Модель брюк",
        "Комплектация",
        "Тип карманов",
        "Вид застежки",
    ):
        push_char_values(key)

    for value in _extract_editor_value_parts(chars.get("Покрой")):
        _push_editor_keyword(result, seen, value)
        _push_editor_keyword(result, seen, f"{value} крой")

    if chars.get("Материал подкладки"):
        _push_editor_keyword(result, seen, "подкладка")
    if chars.get("Комплектация"):
        _push_editor_keyword(result, seen, "комплект")
    if chars.get("Тип карманов"):
        _push_editor_keyword(result, seen, "карманы")
    if chars.get("Вид застежки"):
        _push_editor_keyword(result, seen, "застежка")

    return result[:limit]


def _check_seo_keywords_in_text(text: str, keywords: list, min_count: int = 2) -> tuple:
    """
    Check that at least `min_count` SEO keywords appear in `text`.
    Returns (is_valid, fail_reason_with_missing_keywords).
    """
    if not keywords:
        return True, ""
    text_lower = text.lower()
    found = [kw for kw in keywords if kw.lower() in text_lower]
    if len(found) >= min_count:
        return True, ""
    missing = [kw for kw in keywords if kw.lower() not in text_lower][:5]
    return False, f"Отсутствуют ключевые слова категории: {', '.join(missing)}"


def _resolve_current_value(
    raw_data: dict, field_path: str | None, code: str | None = None, fallback: str | None = None,
) -> str | None:
    """
    Derive current_value from *raw_data* — the single source of truth.
    Prevents wrong values when AI/validator reports a different field's data.
    """
    if not raw_data or not isinstance(raw_data, dict):
        return fallback
    fp = (field_path or "").strip()
    c = (code or "").strip().lower()

    # Title issues
    if fp == "title" or c in {"title_too_short", "no_title", "title_too_long", "title_policy_violation"}:
        v = raw_data.get("title")
        return str(v) if v is not None else fallback

    # Description issues
    if fp == "description" or c in {"no_description", "description_too_short", "description_too_long", "description_policy_violation"}:
        v = raw_data.get("description")
        return str(v) if v is not None else fallback

    # Characteristic issues  (field_path = "characteristics.Цвет")
    if fp.startswith("characteristics."):
        char_name = fp.split("characteristics.", 1)[1].strip()
        chars = raw_data.get("characteristics", [])
        # WB API stores as list of {"name":...,"value":...}
        if isinstance(chars, list):
            for ch in chars:
                if not isinstance(ch, dict):
                    continue
                if (ch.get("name") or "").strip().lower() == char_name.lower():
                    v = ch.get("value", ch.get("values"))
                    if isinstance(v, list):
                        return ", ".join(str(x) for x in v)
                    return str(v) if v is not None else fallback
        # Parsed dict format
        elif isinstance(chars, dict):
            for k, v in chars.items():
                if k.strip().lower() == char_name.lower():
                    if isinstance(v, list):
                        return ", ".join(str(x) for x in v)
                    return str(v) if v is not None else fallback

    return fallback


_RE_REMOVED_TAG = re.compile(
    r"[Уу]дал[её]н[а-яё]*\s+неподтвержд[её]нн[а-яё]*\s+признак[а-яё]*\s+['\'\u2018\u2019\u201c\u201d\"]?([а-яёА-ЯЁa-zA-Z0-9-]+)['\'\u2018\u2019\u201c\u201d\"]?",
    re.IGNORECASE,
)


def _clean_title_ai_reason(reason: str, current_title: str, suggested_title: str) -> str:
    """
    Sanitise ai_reason for title issues.

    The AI refix cycle may report \"Удалён неподтверждённый признак 'X'\"
    where X only existed in an *intermediate* AI draft, never in the
    original title.  This confuses users who see current_value without X.
    """
    if not reason:
        return reason
    m = _RE_REMOVED_TAG.search(reason)
    if m:
        removed_word = m.group(1).lower().strip("'\"")
        title_lower = (current_title or "").lower()
        if removed_word not in title_lower:
            if suggested_title and current_title:
                return "Название приведено к формуле WB"
            return ""
    return reason


def _validate_title_fix(title: str, card: dict) -> tuple:
    """
    Validate AI-generated title against WB quality rules + SEO keywords.
    Returns (is_valid, fail_reason).
    """
    valid, reason = validate_title(title, card)
    if not valid:
        return False, reason

    # Title is short (40-60 chars) — require at least 1 keyword
    keywords = _get_subject_keywords(card)
    kw_valid, kw_reason = _check_seo_keywords_in_text(title, keywords, min_count=1)
    if not kw_valid:
        return False, kw_reason

    return True, ""


async def generate_card_description_suggestion(
    card: Card,
    *,
    draft: Optional[Dict[str, Any]] = None,
    instructions: Optional[str] = None,
) -> Dict[str, Any]:
    context = build_card_text_context(card, draft)
    editor_keywords = build_description_editor_keywords(context)
    seo_keywords = _get_subject_keywords(context) or editor_keywords
    current_description = str(context.get("description") or "")

    ai_svc = get_ai_service()
    if not ai_svc.is_enabled():
        raise RuntimeError("AI generation is disabled")

    extra_instructions = str(instructions or "").strip()
    product_dna = str(card.product_dna or context.get("product_dna") or "")

    gen_result, _gen_tokens = await asyncio.to_thread(
        ai_svc.generate_description,
        card=context,
        product_dna=product_dna,
        seo_keywords=seo_keywords,
        extra_instructions=extra_instructions or None,
    )

    candidate = _as_text(gen_result.get("recommended_value")) or current_description
    reason = str(gen_result.get("reason") or "").strip()
    last_ai_candidate: Optional[str] = candidate if candidate else None

    min_keyword_count = min(2, len(seo_keywords)) if seo_keywords else 0

    valid, fail_reason = validate_description(str(candidate), context)
    if valid and min_keyword_count > 0:
        kw_valid, kw_reason = _check_seo_keywords_in_text(
            str(candidate),
            seo_keywords,
            min_count=min_keyword_count,
        )
        if not kw_valid:
            valid, fail_reason = False, kw_reason

    if not valid:
        retry_reason = fail_reason
        if extra_instructions:
            retry_reason = f"{retry_reason}. Дополнительные инструкции пользователя: {extra_instructions}"

        for _ in range(MAX_FIX_RETRIES):
            refix_result, _refix_tokens = await asyncio.to_thread(
                ai_svc.refix_description,
                card=context,
                current_description=str(candidate),
                failed_reason=retry_reason,
            )
            if not refix_result:
                continue

            candidate = _as_text(refix_result.get("recommended_value")) or candidate
            reason = str(refix_result.get("reason") or reason).strip()
            if candidate:
                last_ai_candidate = candidate

            valid, fail_reason = validate_description(str(candidate), context)
            if valid and min_keyword_count > 0:
                kw_valid, kw_reason = _check_seo_keywords_in_text(
                    str(candidate),
                    seo_keywords,
                    min_count=min_keyword_count,
                )
                if not kw_valid:
                    valid, fail_reason = False, kw_reason
            if valid:
                break
            retry_reason = fail_reason
            if extra_instructions:
                retry_reason = f"{retry_reason}. Дополнительные инструкции пользователя: {extra_instructions}"

    rec_value: Optional[str] = None
    if valid:
        rec_value = candidate
    elif last_ai_candidate and last_ai_candidate.strip().lower() != current_description.strip().lower():
        if len(last_ai_candidate) >= 500:
            rec_value = last_ai_candidate
            reason = reason or "Черновой вариант от AI"

    if not rec_value:
        raise RuntimeError(fail_reason or "AI did not return a usable description")

    return {
        "field": "description",
        "value": rec_value,
        "reason": reason or None,
        "keywords": editor_keywords,
    }


async def sync_cards_from_wb(
    db: AsyncSession,
    store_id: int,
    wb_cards: List[dict],
) -> dict:
    """Sync cards from WB API to database"""
    result = {
        "new": 0,
        "updated": 0,
        "total": len(wb_cards),
    }
    
    for wb_card in wb_cards:
        nm_id = wb_card.get("nmID")
        if not nm_id:
            continue
        
        # Check if card exists
        existing = await db.execute(
            select(Card).where(Card.store_id == store_id, Card.nm_id == nm_id)
        )
        card = existing.scalar_one_or_none()
        
        # Extract card data from WB response
        card_data = _parse_wb_card(wb_card)
        
        if card:
            # Update existing
            for key, value in card_data.items():
                setattr(card, key, value)
            card.updated_at = datetime.utcnow()
            result["updated"] += 1
        else:
            # Create new
            card = Card(store_id=store_id, **card_data)
            db.add(card)
            result["new"] += 1
    
    await db.commit()
    return result


def _parse_wb_card(wb_card: dict) -> dict:
    """Parse WB API card response to our model format"""
    photos = wb_card.get("photos", [])
    videos = wb_card.get("videos", [])
    
    # Extract characteristics
    chars = {}
    for char in wb_card.get("characteristics", []):
        name = char.get("name", "")
        value = char.get("value", char.get("values", []))
        if value:
            chars[name] = value if not isinstance(value, list) else ", ".join(str(v) for v in value)
    
    # Extract dimensions
    dimensions = {}
    if wb_card.get("dimensions"):
        dim = wb_card["dimensions"]
        dimensions = {
            "length": dim.get("length"),
            "width": dim.get("width"),
            "height": dim.get("height"),
        }
    
    return {
        "nm_id": wb_card.get("nmID"),
        "imt_id": wb_card.get("imtID"),
        "vendor_code": wb_card.get("vendorCode"),
        "title": wb_card.get("title"),
        "brand": wb_card.get("brand"),
        "description": wb_card.get("description"),
        "subject_id": wb_card.get("subjectID"),
        "subject_name": wb_card.get("subjectName"),
        "category_name": wb_card.get("object"),  # WB uses "object" for category
        "photos": [p.get("big") for p in photos if p.get("big")],
        "videos": videos,
        "photos_count": len(photos),
        "videos_count": len(videos),
        "characteristics": chars,
        "dimensions": dimensions,
        "raw_data": wb_card,
    }


async def analyze_card(db: AsyncSession, card: Card, use_ai: bool = True) -> tuple:
    """
    Analyze a card and create issues with iterative AI fix loop.
    Returns (issues_list, token_usage_dict).
    
    Flow:
    1. Code validation (title, photos, description limits)
    2. WB catalog validation (allowed values + limits) with AUTO-FIX
    3. AI audit (Gemini — photo analysis, text mismatches)
    4. AI generates fixes for issues NOT auto-fixed by catalog
    5. Re-validate each AI fix against allowed_values/limits
    6. If fix doesn't pass → AI retries (up to MAX_FIX_RETRIES)
    7. Ensure every issue has a suggested_value
    8. Save everything to DB
    """
    # Token usage accumulator
    total_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0, "api_calls": 0}

    def _add_tokens(t: dict):
        total_tokens["prompt_tokens"] += t.get("prompt_tokens", 0)
        total_tokens["completion_tokens"] += t.get("completion_tokens", 0)
        total_tokens["thinking_tokens"] += t.get("thinking_tokens", 0)
        total_tokens["total_tokens"] += t.get("total_tokens", 0)
        total_tokens["api_calls"] += 1
    # ── Save SKIPPED/POSTPONED issues before wiping ─────────
    existing_skipped = await db.execute(
        select(CardIssue).where(
            CardIssue.card_id == card.id,
            CardIssue.status.in_([IssueStatus.SKIPPED, IssueStatus.POSTPONED]),
        )
    )
    skipped_map: dict[str, tuple] = {
        i.code: (i.status, i.postpone_reason, i.postponed_until)
        for i in existing_skipped.scalars().all()
    }

    # Delete old issues
    await db.execute(
        delete(CardIssue).where(CardIssue.card_id == card.id)
    )
    await db.flush()  # Ensure delete is applied before adding new issues
    
    issues: List[CardIssue] = []
    raw_data = card.raw_data or {}
    ai_context = copy.deepcopy(raw_data) if isinstance(raw_data, dict) else {}
    score_breakdown = {}  # No basic code analysis — AI handles everything

    # ── STEP 0: Basic media validation ────────────────────────────────────
    # We keep media quantity/video checks deterministic, so UI can surface
    # them in a dedicated media flow while still treating 0-photo cards as critical.
    basic_media_codes = {"no_photos", "few_photos", "add_more_photos", "no_video"}
    for basic_issue in card_analyzer.analyze_card(card):
        code = str(basic_issue.get("code") or "").strip().lower()
        if code not in basic_media_codes:
            continue

        severity = basic_issue.get("severity", IssueSeverity.WARNING)
        if not isinstance(severity, IssueSeverity):
            severity = IssueSeverity(str(severity))

        category = basic_issue.get("category", IssueCategory.OTHER)
        if not isinstance(category, IssueCategory):
            category = IssueCategory(str(category))

        issues.append(
            CardIssue(
                card_id=card.id,
                code=_clip(code, 100),
                severity=severity,
                category=category,
                title=_clip(basic_issue.get("title", "Проблема с медиа"), 500),
                description=basic_issue.get("description"),
                current_value=basic_issue.get("current_value"),
                suggested_value=basic_issue.get("suggested_value"),
                alternatives=basic_issue.get("alternatives", []),
                field_path=_clip(basic_issue.get("field_path"), 255) if basic_issue.get("field_path") else None,
                score_impact=int(basic_issue.get("score_impact") or 0),
                status=IssueStatus.PENDING,
                source=_clip("code", 50),
            )
        )

    # ── STEP 1: WB catalog validation (allowed values + limits only) ──
    # Now includes auto-fix suggestions from catalog data
    wb_issues_data: List[dict] = []
    if raw_data:
        wb_issues_data = validate_card_characteristics(raw_data)
        
        for wb_issue in wb_issues_data:
            sv = wb_issue.get("suggested_value")
            is_fixed = wb_issue.get("is_fixed_field", False)
            
            # WB severity mapping:
            # - critical stays critical (missing required)
            # - error → warning (allowed_values, limits)
            # - fixed fields → warning
            wb_severity = wb_issue.get("severity", "warning")
            if wb_severity == "critical" and not is_fixed:
                severity = IssueSeverity.CRITICAL
            else:
                severity = IssueSeverity.WARNING
            
            issue = CardIssue(
                card_id=card.id,
                code=_clip(
                    f"wb_fixed_{wb_issue.get('category', 'char')}" if is_fixed else f"wb_{wb_issue.get('category', 'char')}",
                    100,
                ),
                severity=severity,
                category=IssueCategory.CHARACTERISTICS,
                title=_clip(wb_issue.get("message", "Ошибка характеристики"), 500),
                description=_format_error_description(wb_issue),
                current_value=_resolve_current_value(
                    raw_data,
                    f"characteristics.{wb_issue.get('name')}",
                    fallback=str(wb_issue.get("value")) if wb_issue.get("value") else None,
                ),
                # Fixed field don't get suggestions
                suggested_value=None if is_fixed else (_format_suggested(sv) if sv else None),
                alternatives=_extract_issue_example_values(wb_issue.get("errors", [])),
                field_path=_clip(f"characteristics.{wb_issue.get('name')}", 255),
                charc_id=wb_issue.get("charc_id"),
                allowed_values=wb_issue.get("allowed_values", []),
                error_details=wb_issue.get("errors", []),
                score_impact=0 if is_fixed else _calculate_wb_score_impact(wb_issue),  # Fixed fields don't affect score
                status=IssueStatus.PENDING,
                source=_clip("code", 50),
            )
            # Mark auto-fixed issues (but not if fixed field)
            if wb_issue.get("auto_fixed") and sv and not is_fixed:
                issue.source = "auto_fix"
            issues.append(issue)

    # ── STEP 1.5: Fixed file check ────────────────────────
    # Compare card characteristics against store's uploaded fixed values.
    # Fixed file values always take priority — mismatch is a WARNING.
    # Also collect fixed char names to exclude from AI audit.
    fixed_char_names: set[str] = set()
    nm_id = raw_data.get("nmID") or raw_data.get("nm_id") or getattr(card, "nm_id", None)
    if nm_id and raw_data:
        fixed_entries = await ffs.get_entries_for_card(db, card.store_id, nm_id)
        if fixed_entries:
            # Record all characteristic names that have fixed values
            for fe in fixed_entries:
                char_name = getattr(fe, 'char_name', None) or (fe.get('char_name') if isinstance(fe, dict) else None)
                if char_name:
                    fixed_char_names.add(char_name.lower())
            mismatches = ffs.compare_card_with_fixed(raw_data, fixed_entries)
            for mm in mismatches:
                ff_issue = CardIssue(
                    card_id=card.id,
                    code=_clip("fixed_file_mismatch", 100),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.CHARACTERISTICS,
                    title=_clip(f"Расхождение с эталонным файлом: {mm['char_name']}", 500),
                    description=(
                        f"В эталонном файле: «{mm['fixed_value']}». "
                        f"В карточке: «{mm['card_value'] or 'не заполнено'}»."
                    ),
                    current_value=mm["card_value"],
                    suggested_value=mm["fixed_value"],
                    field_path=_clip(mm["field_path"], 255) if mm.get("field_path") else None,
                    score_impact=8,
                    status=IssueStatus.PENDING,
                    source=_clip("fixed_file", 50),
                )
                issues.append(ff_issue)

    # ── STEP 2.5: Generate / load Product DNA ────────────────
    # Photo analyzed ONCE and cached in card.product_dna.
    # All subsequent AI calls use this text → no re-sending photo.
    # Provider selection: GPT uses VisionService (GPT-4o-mini), Gemini uses GeminiService.
    if use_ai and raw_data and not card.product_dna:
        dna_limit = max(1, min(int(getattr(settings, "AI_CONTEXT_PHOTOS_COUNT", 2) or 2), 5))
        photo_urls_dna = _extract_photo_urls(raw_data, limit=dna_limit)

        if photo_urls_dna:
            subject_name_dna = raw_data.get("subjectName") or raw_data.get("subject_name") or ""
            ai_svc = get_ai_service()
            primary_photo = photo_urls_dna[0]
            # Use provider's own vision if available; pass additional photos as fallback context.
            if ai_svc.is_enabled() and hasattr(ai_svc, "generate_product_dna_text"):
                dna_text = await asyncio.to_thread(
                    ai_svc.generate_product_dna_text,
                    primary_photo,
                    subject_name_dna,
                    photo_urls_dna,
                )
            elif vision_service.is_enabled:
                dna_text = await vision_service.generate_product_dna_text(
                    primary_photo,
                    subject_name_dna,
                    photo_urls=photo_urls_dna,
                )
            else:
                dna_text = ""
            if dna_text:
                card.product_dna = dna_text
                db.add(card)
    product_dna: str = card.product_dna or ""

    # ── STEP 2: AI audit (if enabled) ────────────────────
    gemini = get_ai_service()
    if use_ai and gemini.is_enabled() and raw_data:
        # Enrich raw_data with valid characteristic names for this category
        # so AI knows which characteristics belong to this category
        audit_data = dict(raw_data)
        valid_char_names_norm: set[str] = set()
        valid_char_ids: set[int] = set()
        subject_id = raw_data.get("subjectID") or raw_data.get("subject_id")
        if subject_id:
            catalog = get_catalog()
            subject_chars = catalog.get_subject_chars(int(subject_id))
            if subject_chars:
                audit_data["_valid_char_names"] = [cm.name for cm in subject_chars]
                valid_char_names_norm = {
                    _norm_text(cm.name)
                    for cm in subject_chars
                    if getattr(cm, "name", None)
                }
                valid_char_ids = {
                    int(cm.charc_id)
                    for cm in subject_chars
                    if getattr(cm, "charc_id", None) is not None
                }
            # Also pass SEO keywords for this category into audit
            subject_name = raw_data.get("subjectName") or raw_data.get("subject_name") or ""
            seo_kws = catalog.get_keywords_for_subject(subject_name)
            if seo_kws:
                audit_data["_seo_keywords"] = seo_kws
        # Tell AI which characteristics are controlled by fixed file (don't audit them)
        if fixed_char_names:
            audit_data["_fixed_file_chars"] = list(fixed_char_names)
        ai_issues, audit_tokens = await asyncio.to_thread(
            gemini.audit_card, audit_data, product_dna
        )
        _add_tokens(audit_tokens)
        
        for ai_issue in ai_issues:
            # Date/certificate/declaration fields are out of AI scope.
            # They are controlled only via fixed file mismatches.
            if _is_date_sensitive_ai_issue(ai_issue):
                continue
            # Text-based issues are out of AI audit scope (title/description are generated later)
            if _is_text_based_ai_issue(ai_issue):
                continue
            # vendorCode/article checks are out of scope (characteristics only)
            if _is_vendorcode_ai_issue(ai_issue):
                continue
            # allowed_values checks are handled by deterministic WB validator (source=code)
            if _is_allowed_values_ai_issue(ai_issue):
                continue
            # Color characteristics are validated separately via color_names.json — skip AI issues for color
            ai_name = (ai_issue.get("name") or "").strip().lower()
            if ai_name in {"цвет", "color", "основной цвет", "цвет товара"}:
                continue

            # Guard against false "wrong category" from AI:
            # if characteristic is objectively valid for this subject (by name/id),
            # ignore AI's category_mismatch + clear recommendation.
            ai_errors = ai_issue.get("errors") or []
            ai_error_types = {
                str(e.get("type", "")).strip().lower()
                for e in ai_errors
                if isinstance(e, dict)
            }
            fix_action_raw = str(ai_issue.get("fix_action") or "").strip().lower()
            is_ai_category_mismatch = bool(
                ai_error_types.intersection({"category_mismatch", "wrong_category"})
                or "не входит в допустимый" in str(ai_issue.get("message") or "").lower()
            )
            ai_name_norm = _norm_text(str(ai_issue.get("name") or ""))
            ai_charc_id = ai_issue.get("charcId")
            ai_charc_id_int = None
            if ai_charc_id is not None and str(ai_charc_id).isdigit():
                ai_charc_id_int = int(ai_charc_id)

            if is_ai_category_mismatch and fix_action_raw == "clear":
                is_valid_by_name = ai_name_norm in valid_char_names_norm if ai_name_norm else False
                is_valid_by_id = ai_charc_id_int in valid_char_ids if ai_charc_id_int is not None else False
                if is_valid_by_name or is_valid_by_id:
                    continue
            # Build error_details with swap/compound info if present
            ai_error_details = ai_issue.get("errors", [])
            fix_action = ai_issue.get("fix_action", "replace")
            if fix_action == "compound":
                compound_fixes = ai_issue.get("compound_fixes", [])
                if compound_fixes:
                    ai_error_details = list(ai_error_details or [])
                    # Build name → current value map so each sub-field can show its "before" state
                    chars_raw = raw_data.get("characteristics") or []
                    _char_val_map: dict = {}
                    for _ch in (chars_raw if isinstance(chars_raw, list) else []):
                        _n = (_ch.get("name") or "").lower()
                        _v = _ch.get("value") or _ch.get("values")
                        if _n:
                            _char_val_map[_n] = (
                                ", ".join(str(x) for x in _v)
                                if isinstance(_v, list)
                                else (str(_v) if _v is not None else None)
                            )
                    normalized_fixes = []
                    for f in compound_fixes:
                        if not isinstance(f, dict):
                            continue
                        fix_name = f.get("name", "")
                        field_path = f.get("field_path") or _normalize_issue_field_path(fix_name)
                        # For top-level fields (title, description) get value directly from raw_data
                        fix_name_lower = (fix_name or "").lower()
                        if fix_name_lower == "title":
                            current_val = str(raw_data.get("title") or "")
                        elif fix_name_lower == "description":
                            current_val = str(raw_data.get("description") or "")
                        else:
                            current_val = _char_val_map.get(fix_name_lower)
                        fix_action_item = f.get("action", "set")
                        fix_value = f.get("value")
                        if fix_action_item != "clear":
                            fix_value = _normalize_compound_fix_value(
                                field_path=field_path,
                                value=fix_value,
                                current_value=current_val,
                            )
                        normalized_fixes.append({
                            "name": fix_name,
                            "field_path": field_path,
                            "charc_id": f.get("charcId"),
                            "action": fix_action_item,
                            "value": fix_value,
                            "current_value": current_val,
                        })
                    ai_error_details.append({
                        "type": "compound",
                        "fix_action": "compound",
                        "fixes": normalized_fixes,
                    })
            elif fix_action == "swap":
                ai_error_details = ai_error_details or []
                ai_error_details.append({
                    "type": "swap",
                    "fix_action": "swap",
                    "swap_to_name": ai_issue.get("swap_to_name", ""),
                    "swap_to_value": ai_issue.get("swap_to_value", ""),
                })
            elif fix_action == "clear":
                ai_error_details = ai_error_details or []
                ai_error_details.append({
                    "type": "clear",
                    "fix_action": "clear",
                })

            normalized_issue_path = _normalize_issue_field_path(ai_issue.get("name"))

            # ── Populate allowed_values from catalog for AI-generated issues ──
            ai_allowed_values: List[str] = []
            if normalized_issue_path and normalized_issue_path.startswith("characteristics."):
                char_name = normalized_issue_path.split("characteristics.", 1)[1].strip()
                if char_name:
                    try:
                        ai_allowed_values = get_catalog().get_allowed_values(char_name) or []
                    except Exception:
                        ai_allowed_values = []

            issue = CardIssue(
                card_id=card.id,
                code=_clip(f"ai_{ai_issue.get('category', 'mixed')}", 100),
                severity=_map_severity(ai_issue.get("severity", "warning")),
                category=_map_ai_category(ai_issue.get("category"), normalized_issue_path),
                title=_clip(ai_issue.get("message", "AI обнаружил проблему"), 500),
                description=_format_ai_description(ai_issue),
                current_value=_resolve_current_value(
                    raw_data,
                    normalized_issue_path,
                    code=f"ai_{ai_issue.get('category', 'mixed')}",
                    fallback=str(ai_issue.get("value")) if ai_issue.get("value") else None,
                ),
                field_path=_clip(normalized_issue_path, 255) if normalized_issue_path else None,
                charc_id=ai_issue.get("charcId"),
                allowed_values=ai_allowed_values,
                error_details=ai_error_details,
                score_impact=_calculate_ai_score_impact(ai_issue),
                status=IssueStatus.PENDING,
                source=_clip("ai", 50),
            )
            # Title/description issues severity based on AI severity,
            # but override only if completely missing (no_title, no_description)
            _np = (normalized_issue_path or "").strip().lower()
            _code = ai_issue.get("code", "")
            if _code in ("no_title", "no_description"):
                issue.severity = IssueSeverity.CRITICAL
            elif issue.category == IssueCategory.CHARACTERISTICS:
                issue.severity = IssueSeverity.WARNING
            # Otherwise keep AI severity (warning for short/long/policy issues)
            issues.append(issue)

        # ── STEP 4: AI generates fixes ──────────────────
        # Send ALL issues to AI for concrete fixes, except:
        #   - Photo/video issues (need manual upload)
        #   - Auto-fixed issues (already have correct values)
        # Date-related fields are out of AI scope and handled only by fixed_file mismatch.
        issues = _drop_non_fixed_date_issues(issues)

        # User requirement:
        # 1) characteristics first (batch AI),
        # 2) title/description later via dedicated prompts.
        _SKIP_AI_CODES = set()
        _AI_TEXT_CODES = {
            "title_too_short", "no_title", "title_too_long",
            "title_policy_violation",
            "no_description", "description_too_short", "description_too_long", "description_policy_violation",
        }
        fixable_issues = []
        fixable_indices = []
        for idx, iss in enumerate(issues):
            already_auto_fixed = (iss.source == "auto_fix")
            is_skip = iss.code in _SKIP_AI_CODES
            # fixed_file issues already have the correct value from uploaded file — no AI needed
            is_fixed_file = (iss.source == "fixed_file")
            # wrong_category issues already have __CLEAR__ as suggested_value — no AI needed
            is_wrong_category = iss.code == "wb_wrong_category"
            is_text_issue = _is_title_issue_obj(iss) or _is_description_issue_obj(iss)
            normalized_path = (iss.field_path or "").strip().lower()
            issue_error_type = iss.code
            if normalized_path == "title":
                issue_error_type = "title"
            elif normalized_path == "description":
                issue_error_type = "description"
            
            # Batch AI is for non-text issues only (allowed values / limits / logic).
            if not is_skip and not already_auto_fixed and not is_fixed_file and not is_wrong_category and not is_text_issue:
                fixable_issues.append({
                    "id": str(idx),
                    "name": iss.field_path or iss.title,
                    "current_value": iss.current_value,
                    "error_type": issue_error_type,
                    "message": iss.title,
                    "description": iss.description,
                    "allowed_values": _allowed_values_for_ai(iss),
                    "errors": iss.error_details,
                })
                fixable_indices.append(idx)
                # Clear analyzer's generic suggested_value — AI will provide concrete one
                iss.suggested_value = None
        
        if fixable_issues:
            suggestions, fixes_tokens = await asyncio.to_thread(
                gemini.generate_fixes, ai_context, fixable_issues, product_dna
            )
            _add_tokens(fixes_tokens)
            
            # ── STEP 5–6: Validate each fix, retry if needed ──
            missed_issues = []  # Issues AI didn't return fixes for
            for fi_pos, idx in enumerate(fixable_indices):
                iss = issues[idx]
                suggestion = suggestions.get(str(idx), {})
                if not suggestion:
                    missed_issues.append((idx, fixable_issues[fi_pos]))
                    continue

                rec_value = suggestion.get("recommended_value")
                reason = suggestion.get("reason", "")
                fix_action = str(suggestion.get("fix_action", "replace") or "replace").strip().lower()
                if fix_action not in {"replace", "clear", "swap"}:
                    fix_action = "replace"
                if fix_action == "swap":
                    swap_to_name = suggestion.get("swap_to_name")
                    if (not swap_to_name) or _is_same_issue_field(iss.field_path, str(swap_to_name)):
                        fix_action = "replace"
                        if rec_value in (None, "", []):
                            rec_value = suggestion.get("swap_to_value")

                is_title_issue = _is_title_issue_obj(iss)
                is_description_issue = _is_description_issue_obj(iss)
                is_text_issue = (iss.code in _AI_TEXT_CODES) or is_title_issue or is_description_issue
                title_fix_valid = True
                description_fix_valid = True

                # ── A) Title issues — validate against quality rules ──
                if is_title_issue:
                    title_fix_valid = False
                    fail_reason = "AI не вернул предложенный title"
                    if rec_value:
                        title_fix_valid, fail_reason = _validate_title_fix(
                            str(rec_value), ai_context
                        )
                        if not title_fix_valid:
                            for _ in range(MAX_FIX_RETRIES):
                                refix, refix_t = await asyncio.to_thread(
                                    gemini.refix_title,
                                    card=ai_context,
                                    current_title=str(rec_value),
                                    failed_reason=fail_reason,
                                )
                                _add_tokens(refix_t)
                                if not refix:
                                    break
                                rec_value = refix.get("recommended_value", rec_value)
                                reason = refix.get("reason", reason)
                                title_fix_valid, fail_reason = _validate_title_fix(
                                    str(rec_value), ai_context
                                )
                                if title_fix_valid:
                                    break

                    if not title_fix_valid:
                        rec_value = None

                # ── A2) Description issues — validate against SEO rules ──
                elif is_description_issue:
                    description_fix_valid = False
                    fail_reason = "AI не вернул предложенное описание"
                    if rec_value:
                        description_fix_valid, fail_reason = validate_description(
                            str(rec_value), ai_context
                        )
                        if description_fix_valid:
                            kw_valid, kw_reason = _check_seo_keywords_in_text(
                                str(rec_value), _get_subject_keywords(ai_context), min_count=2
                            )
                            if not kw_valid:
                                description_fix_valid, fail_reason = False, kw_reason
                        if not description_fix_valid:
                            for _ in range(MAX_FIX_RETRIES):
                                refix, refix_t = await asyncio.to_thread(
                                    gemini.refix_description,
                                    card=ai_context,
                                    current_description=str(rec_value),
                                    failed_reason=fail_reason,
                                )
                                _add_tokens(refix_t)
                                if not refix:
                                    break
                                rec_value = refix.get("recommended_value", rec_value)
                                reason = refix.get("reason", reason)
                                description_fix_valid, fail_reason = validate_description(
                                    str(rec_value), ai_context
                                )
                                if description_fix_valid:
                                    kw_valid, kw_reason = _check_seo_keywords_in_text(
                                        str(rec_value), _get_subject_keywords(ai_context), min_count=2
                                    )
                                    if not kw_valid:
                                        description_fix_valid, fail_reason = False, kw_reason
                                if description_fix_valid:
                                    break

                    if not description_fix_valid:
                        rec_value = None

                # ── B) Characteristic issues — validate against allowed values ──
                elif not is_text_issue and (iss.allowed_values or iss.error_details):
                    destructive_allowed = _allow_destructive_fix(iss)
                    fix_valid = True
                    fail_reason = ""
                    corrected_value = None

                    if fix_action in {"clear", "swap"} and not destructive_allowed:
                        fix_valid = False
                        fail_reason = (
                            "Для этой ошибки нельзя очищать/переносить поле. "
                            "Нужно выбрать корректное допустимое значение."
                        )
                    else:
                        fix_valid, fail_reason, corrected_value = _validate_fix_against_constraints(
                            rec_value,
                            iss.allowed_values,
                            iss.error_details,
                            char_name=iss.field_path or iss.title,
                            current_value=iss.current_value,
                            product_dna=product_dna,
                        )

                    # If fuzzy match found a better value, use it immediately
                    if corrected_value is not None:
                        rec_value = corrected_value
                        reason = f"{reason} (автоматически скорректировано до ближайшего допустимого значения)"
                        fix_action = "replace"

                    if not fix_valid:
                        seed_value = rec_value if rec_value not in (None, "", []) else (iss.current_value or "")
                        # Retry loop
                        for retry in range(MAX_FIX_RETRIES):
                            refix, refix_t = await asyncio.to_thread(
                                gemini.refix_value,
                                card=ai_context,
                                char_name=iss.field_path or iss.title,
                                current_value=seed_value,
                                failed_reason=fail_reason,
                                allowed_values=_allowed_values_for_ai(iss),
                                limits=_extract_limits(iss.error_details),
                            )
                            _add_tokens(refix_t)
                            if not refix:
                                continue
                            seed_value = refix.get("recommended_value", seed_value)
                            rec_value = seed_value
                            reason = refix.get("reason", reason)
                            fix_action = "replace"

                            fix_valid, fail_reason, corrected_value = _validate_fix_against_constraints(
                                rec_value,
                                iss.allowed_values,
                                iss.error_details,
                                char_name=iss.field_path or iss.title,
                                current_value=iss.current_value,
                                product_dna=product_dna,
                            )

                            # Apply fuzzy match correction if found
                            if corrected_value is not None:
                                rec_value = corrected_value
                                reason = f"{reason} (автоматически скорректировано)"

                            if fix_valid:
                                break

                    if not fix_valid:
                        fallback_value = _fallback_value_from_constraints(iss)
                        if fallback_value not in (None, "", []):
                            rec_value = fallback_value
                            fix_action = "replace"
                            reason = reason or "Автоматически подобрано по allowed_values и лимитам"

                    if rec_value in (None, "", []):
                        salvaged_value = _salvage_issue_fix_candidate(iss, product_dna=product_dna)
                        if salvaged_value not in (None, "", []):
                            rec_value = salvaged_value
                            fix_action = "replace"
                            reason = reason or "Автоматически выделено подтвержденное значение по фото"

                # Save the fix — skip empty AI results
                # For swap actions: empty recommended_value is valid (means "clear this field")
                destructive_allowed = _allow_destructive_fix(iss)
                is_swap = fix_action == "swap" and destructive_allowed
                is_clear = fix_action == "clear" and destructive_allowed

                has_value = rec_value is not None and rec_value != "" and rec_value != []
                if is_title_issue and has_value and not title_fix_valid:
                    has_value = False
                if is_description_issue and has_value and not description_fix_valid:
                    has_value = False
                
                if is_swap or is_clear:
                    # For swap/clear: the recommended_value should be "" (clear)
                    iss.ai_suggested_value = ""
                    iss.suggested_value = ""
                    # Store swap info in error_details
                    swap_details = _remove_fix_action_markers(iss.error_details)
                    swap_entry = {"type": "swap" if is_swap else "clear", "fix_action": fix_action}
                    if is_swap:
                        swap_entry["swap_to_name"] = suggestion.get("swap_to_name", "")
                        swap_entry["swap_to_value"] = suggestion.get("swap_to_value", "")
                    swap_details.append(swap_entry)
                    iss.error_details = swap_details
                elif has_value:
                    iss.error_details = _remove_fix_action_markers(iss.error_details)
                    iss.ai_suggested_value = _format_suggested(rec_value)
                else:
                    iss.error_details = _remove_fix_action_markers(iss.error_details)
                    iss.ai_suggested_value = None
                    
                iss.ai_reason = reason
                iss.ai_alternatives = []

                # Always use AI concrete value as suggested_value
                if has_value and not is_swap and not is_clear:
                    iss.suggested_value = _format_suggested(rec_value)
                    if not is_title_issue and not is_description_issue:
                        _set_characteristic_value_in_context(
                            ai_context,
                            iss.field_path,
                            rec_value,
                        )

            # ── STEP 5b: Retry missed issues (AI didn't return fix) ──
            if missed_issues:
                retry_issues = []
                retry_map = []  # (original_idx, position_in_retry)
                for orig_idx, issue_data in missed_issues:
                    retry_issues.append({
                        **issue_data,
                        "id": "0",  # Single issue per retry
                    })
                    retry_map.append(orig_idx)

                for ri, retry_issue in enumerate(retry_issues):
                    orig_idx = retry_map[ri]
                    iss = issues[orig_idx]
                    retry_result, retry_t = await asyncio.to_thread(
                        gemini.generate_fixes, ai_context, [retry_issue], product_dna
                    )
                    _add_tokens(retry_t)
                    suggestion = retry_result.get("0", {})
                    if suggestion:
                        rec_value = suggestion.get("recommended_value")
                        reason = suggestion.get("reason", "")
                        fix_action = str(suggestion.get("fix_action", "replace") or "replace").strip().lower()
                        if fix_action not in {"replace", "clear", "swap"}:
                            fix_action = "replace"
                        if fix_action == "swap":
                            swap_to_name = suggestion.get("swap_to_name")
                            if (not swap_to_name) or _is_same_issue_field(iss.field_path, str(swap_to_name)):
                                fix_action = "replace"
                                if rec_value in (None, "", []):
                                    rec_value = suggestion.get("swap_to_value")

                        if _is_title_issue_obj(iss) and rec_value:
                            valid, _ = _validate_title_fix(str(rec_value), ai_context)
                            if not valid:
                                rec_value = None
                        elif _is_description_issue_obj(iss) and rec_value:
                            valid, _ = validate_description(str(rec_value), ai_context)
                            if not valid:
                                rec_value = None
                        else:
                            destructive_allowed = _allow_destructive_fix(iss)
                            if fix_action in {"clear", "swap"} and not destructive_allowed:
                                fix_action = "replace"
                                rec_value = _fallback_value_from_constraints(iss)
                            if rec_value not in (None, "", []):
                                valid, _, corrected = _validate_fix_against_constraints(
                                    rec_value,
                                    iss.allowed_values,
                                    iss.error_details,
                                    char_name=iss.field_path or iss.title,
                                    current_value=iss.current_value,
                                    product_dna=product_dna,
                                )
                                if corrected is not None:
                                    rec_value = corrected
                                if not valid:
                                    rec_value = _fallback_value_from_constraints(iss)

                        if rec_value in (None, "", []):
                            salvaged_value = _salvage_issue_fix_candidate(iss, product_dna=product_dna)
                            if salvaged_value not in (None, "", []):
                                rec_value = salvaged_value
                                fix_action = "replace"
                                reason = reason or "Автоматически выделено подтвержденное значение по фото"

                        has_value = rec_value is not None and rec_value != "" and rec_value != []
                        if has_value:
                            iss.error_details = _remove_fix_action_markers(iss.error_details)
                            iss.ai_suggested_value = _format_suggested(rec_value)
                            iss.ai_reason = reason
                            iss.ai_alternatives = []
                            iss.suggested_value = _format_suggested(rec_value)
                            if not _is_title_issue_obj(iss) and not _is_description_issue_obj(iss):
                                _set_characteristic_value_in_context(
                                    ai_context,
                                    iss.field_path,
                                    rec_value,
                                )
                        else:
                            iss.error_details = _remove_fix_action_markers(iss.error_details)

        # If characteristics need changes, force a description-refresh issue
        # so AI-generated new description is visible in the issues list.
        has_non_text_characteristic_issue = any(
            (iss.category == IssueCategory.CHARACTERISTICS)
            and not _is_title_issue_obj(iss)
            and not _is_description_issue_obj(iss)
            and (iss.source != "fixed_file")
            for iss in issues
        )
        has_description_issue = any(_is_description_issue_obj(iss) for iss in issues)
        if has_non_text_characteristic_issue and not has_description_issue:
            current_description = str(
                ai_context.get("description")
                or raw_data.get("description")
                or ""
            )
            issues.append(
                CardIssue(
                    card_id=card.id,
                    code=_clip("description_refresh_needed", 100),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.DESCRIPTION,
                    title=_clip("Нужно обновить описание после исправления характеристик", 500),
                    description=(
                        "После изменения характеристик описание может стать неактуальным. "
                        "Сгенерировано новое описание с учетом исправлений."
                    ),
                    current_value=current_description,
                    suggested_value=None,
                    field_path="description",
                    score_impact=4,
                    status=IssueStatus.PENDING,
                    source=_clip("ai", 50),
                )
            )

        # ── STEP 5c: Title/Description — AI generates from scratch, then validates ──
        for iss in issues:
            already_auto_fixed = (iss.source == "auto_fix")
            if already_auto_fixed:
                continue
            if not (_is_title_issue_obj(iss) or _is_description_issue_obj(iss)):
                continue

            fail_reason = f"{iss.title}. {iss.description or ''}".strip()
            rec_value = None
            reason = ""

            if _is_title_issue_obj(iss):
                current_title = str(
                    ai_context.get("title")
                    or raw_data.get("title")
                    or iss.current_value
                    or ""
                )

                # Step 1: Generate fresh title via AI (not refix)
                gen_result, gen_t = await asyncio.to_thread(
                    gemini.generate_title,
                    card=ai_context,
                    product_dna=product_dna,
                    seo_keywords=_get_subject_keywords(ai_context),
                )
                _add_tokens(gen_t)
                candidate = _as_text(gen_result.get("recommended_value")) or current_title
                reason = gen_result.get("reason", "")
                last_ai_candidate: Optional[str] = candidate if candidate else None

                valid, fail_reason = _validate_title_fix(str(candidate), ai_context)
                if valid:
                    rec_value = candidate
                else:
                    # Step 2: Up to MAX_FIX_RETRIES correction cycles via refix_title
                    for _ in range(MAX_FIX_RETRIES):
                        refix, refix_t = await asyncio.to_thread(
                            gemini.refix_title,
                            card=ai_context,
                            current_title=str(candidate),
                            failed_reason=fail_reason,
                        )
                        _add_tokens(refix_t)
                        if not refix:
                            continue
                        candidate = _as_text(refix.get("recommended_value")) or candidate
                        reason = refix.get("reason", reason)
                        if candidate:
                            last_ai_candidate = candidate
                        valid, fail_reason = _validate_title_fix(str(candidate), ai_context)
                        if valid:
                            rec_value = candidate
                            break

                # Use best draft even if validation failed
                if rec_value is None and last_ai_candidate:
                    if last_ai_candidate.strip().lower() != current_title.strip().lower():
                        rec_value = last_ai_candidate
                        reason = reason or "Черновой вариант от AI"

                if rec_value:
                    iss.ai_suggested_value = rec_value
                    iss.ai_reason = _clean_title_ai_reason(reason, current_title, rec_value)
                    iss.ai_alternatives = []
                    iss.suggested_value = rec_value
                    ai_context["title"] = rec_value
                else:
                    iss.ai_suggested_value = None
                    iss.ai_reason = fail_reason
                    iss.ai_alternatives = []
                continue

            # description issue
            current_description = str(
                ai_context.get("description")
                or raw_data.get("description")
                or iss.current_value
                or ""
            )

            # Step 1: Generate fresh description via AI (not refix)
            gen_result, gen_t = await asyncio.to_thread(
                gemini.generate_description,
                card=ai_context,
                product_dna=product_dna,
                seo_keywords=_get_subject_keywords(ai_context),
            )
            _add_tokens(gen_t)
            candidate = _as_text(gen_result.get("recommended_value")) or current_description
            reason = gen_result.get("reason", "")
            last_ai_candidate: Optional[str] = candidate if candidate else None

            valid, fail_reason = validate_description(str(candidate), ai_context)
            if valid:
                # Also check SEO keywords (description should have at least 2)
                kw_valid, kw_reason = _check_seo_keywords_in_text(
                    str(candidate), _get_subject_keywords(ai_context), min_count=2
                )
                if not kw_valid:
                    valid, fail_reason = False, kw_reason
            if valid:
                rec_value = candidate
            else:
                # Step 2: Up to MAX_FIX_RETRIES correction cycles via refix_description
                for _ in range(MAX_FIX_RETRIES):
                    refix, refix_t = await asyncio.to_thread(
                        gemini.refix_description,
                        card=ai_context,
                        current_description=str(candidate),
                        failed_reason=fail_reason,
                    )
                    _add_tokens(refix_t)
                    if not refix:
                        continue
                    candidate = _as_text(refix.get("recommended_value")) or candidate
                    reason = refix.get("reason", reason)
                    if candidate:
                        last_ai_candidate = candidate
                    valid, fail_reason = validate_description(str(candidate), ai_context)
                    if valid:
                        kw_valid, kw_reason = _check_seo_keywords_in_text(
                            str(candidate), _get_subject_keywords(ai_context), min_count=2
                        )
                        if not kw_valid:
                            valid, fail_reason = False, kw_reason
                    if valid:
                        rec_value = candidate
                        break

            # Use best draft even if validation failed (min 500 chars to be useful)
            if rec_value is None and last_ai_candidate:
                if last_ai_candidate.strip().lower() != current_description.strip().lower():
                    if len(last_ai_candidate) >= 500:
                        rec_value = last_ai_candidate
                        reason = reason or "Черновой вариант от AI"

            if rec_value:
                iss.ai_suggested_value = rec_value
                iss.ai_reason = reason
                iss.ai_alternatives = []
                iss.suggested_value = rec_value
                ai_context["description"] = rec_value
            else:
                iss.ai_suggested_value = None
                iss.ai_reason = fail_reason
                iss.ai_alternatives = []
    
    # Date-related fields must not be auto-validated by AI/code logic.
    # Keep only fixed-file mismatches for such fields.
    issues = _drop_non_fixed_date_issues(issues)

    # ── Drop AI issues for characteristics that are in the fixed file ──
    if fixed_char_names:
        kept: List[CardIssue] = []
        for iss in issues:
            if iss.source == "ai" and iss.field_path:
                char_name = iss.field_path.split("characteristics.", 1)[-1].strip().lower() if "characteristics." in iss.field_path else ""
                if char_name and char_name in fixed_char_names:
                    continue  # Skip — controlled by fixed file
            kept.append(iss)
        issues = kept

    # ── Collapse overlapping issues covered by compound swaps ─
    issues = _collapse_compound_overlaps(issues)

    # ── Ensure every issue has a suggested_value ─
    _ensure_all_suggested_values(issues)
    _strip_unverified_catalog_suggestions(issues, product_dna)
    issues = _drop_unverified_ai_issues(issues)
    issues = _drop_noop_issues(issues)
    issues = _dedupe_identical_issues(issues)

    # Keep issues that are still actionable manually even without auto-filled value.
    issues = [iss for iss in issues if _is_manually_actionable_issue(iss)]

    # Persist final issue set (after collapse)
    for issue in issues:
        # Restore SKIPPED/POSTPONED status if this issue was previously skipped
        if issue.code in skipped_map:
            prev_status, prev_reason, prev_until = skipped_map[issue.code]
            issue.status = prev_status
            issue.postpone_reason = prev_reason
            issue.postponed_until = prev_until
        db.add(issue)
    
    # ── STEP 8: Super-Validator (without media analyzer) ─
    fcs_data = calculate_card_fcs(raw_data)
    sv_breakdown = super_validator_service.evaluate(
        card=card,
        raw_data=raw_data,
        issues=issues,
        base_breakdown=score_breakdown,
        fcs=fcs_data,
    )
    card.score = int(sv_breakdown.get("final_score", sv_breakdown.get("total_score", 0)))
    card.score_breakdown = sv_breakdown
    card.critical_issues_count = sum(1 for i in issues if i.severity == IssueSeverity.CRITICAL)
    card.warnings_count = sum(1 for i in issues if i.severity == IssueSeverity.WARNING)
    card.improvements_count = sum(1 for i in issues if i.severity == IssueSeverity.IMPROVEMENT)
    card.last_analysis_at = datetime.utcnow()

    # ── Normalize score_impact so all pending issues sum to (100 - card.score) ──
    # This ensures: fixing all issues brings the card exactly to 100.
    pending_issues = [i for i in issues if i.status == IssueStatus.PENDING]
    raw_sum = sum(max(1, i.score_impact or 1) for i in pending_issues)
    potential = max(0, 100 - card.score)
    if pending_issues and raw_sum > 0 and potential > 0:
        distributed = 0
        for idx, iss in enumerate(pending_issues):
            raw = max(1, iss.score_impact or 1)
            if idx < len(pending_issues) - 1:
                normalized = max(1, round(raw / raw_sum * potential))
                iss.score_impact = normalized
                distributed += normalized
            else:
                # Last issue gets the remainder to ensure exact sum
                iss.score_impact = max(1, potential - distributed)
    
    await db.commit()
    return issues, total_tokens


def _format_suggested(value) -> str:
    """Format a suggested value (list or scalar) to string"""
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _ensure_all_suggested_values(issues: List[CardIssue]) -> None:
    """
    Make sure every issue has a suggested_value.
    AI should have filled most issues. This handles fallback when AI is unavailable.
    IMPORTANT: Never use advice text as suggested_value — always provide concrete ready values.
    """
    for iss in issues:
        if iss.suggested_value is not None:
            continue  # Already has concrete suggestion (including "" for swap/clear)

        # Try AI value
        if iss.ai_suggested_value:
            iss.suggested_value = iss.ai_suggested_value
            continue

        code = iss.code or ""

        # Photo/video issues — manual action needed, provide instructions
        if code in ("no_photos",):
            media_threshold = max(1, int(getattr(settings, "MEDIA_WARNING_PHOTOS_COUNT", 30) or 30))
            iss.suggested_value = f"Загрузите фото товара. Без фото WB может заблокировать карточку. Цель — минимум {media_threshold} фото"
            continue
        if code in ("few_photos",):
            media_threshold = max(1, int(getattr(settings, "MEDIA_WARNING_PHOTOS_COUNT", 30) or 30))
            iss.suggested_value = f"Добавьте фотографии: если их меньше {media_threshold}, карточка остаётся в блоке медиа-ошибок"
            continue
        if code in ("add_more_photos",):
            recommended_threshold = max(
                int(getattr(settings, "MEDIA_WARNING_PHOTOS_COUNT", 30) or 30),
                int(getattr(settings, "RECOMMENDED_PHOTOS_COUNT", 30) or 30),
            )
            iss.suggested_value = f"Добавьте фото до {recommended_threshold}: общий вид, детали, фактура, посадка"
            continue
        if code in ("no_video",):
            iss.suggested_value = "Добавьте видео 15-30 секунд для повышения конверсии"
            continue

        # Fixed field issues — cannot be changed, just inform
        if code.startswith("wb_fixed_"):
            iss.suggested_value = "⚠️ Это системное поле WB, изменить нельзя"
            continue

        # For text issues where AI failed — leave empty, don't put advice as value
        # The frontend should show "AI недоступен" instead
        # Do NOT use iss.description as suggested_value — it's advice, not a value!
        iss.suggested_value = None


def _norm_issue_value(val: Optional[str]) -> str:
    if val is None:
        return ""
    return " ".join(str(val).strip().lower().split())


def _drop_noop_issues(issues: List[CardIssue]) -> List[CardIssue]:
    """
    Remove issues that provide no actionable fix to the user:
    1. Any issue where suggested == current (no-op)
    2. Any issue where allowed_values is non-empty in principle but AI couldn't produce
       a suggested_value — meaning the field has constraints and there's nothing valid to set.
       (If allowed_values is empty, free-text is accepted and we keep the issue so user can type.)
    """
    out: List[CardIssue] = []
    for iss in issues:
        # Rule 1: no-op suggestion (current value already equals suggested value)
        # Skip only for AI/code-generated issues; keep fixed_file/auto_fix visible by design.
        if iss.source in {"ai", "code"}:
            if _issue_values_equivalent(iss.current_value, iss.suggested_value or iss.ai_suggested_value):
                continue

        # Rule 2: allowed_values is empty (no catalog constraints) AND no suggestion generated
        # → AI couldn't determine what to change to → unfixable, skip silently
        has_allowed = bool(iss.allowed_values)
        has_suggestion = bool(
            (iss.ai_suggested_value or "").strip()
            or (iss.suggested_value or "").strip()
        )
        is_free_text_field = (iss.field_path or "").lower() in ("title", "description")
        if not has_allowed and not has_suggestion and not is_free_text_field:
            continue

        out.append(iss)
    return out


def _dedupe_identical_issues(issues: List[CardIssue]) -> List[CardIssue]:
    """Drop exact duplicate issues generated from the same evidence/fix."""
    deduped: List[CardIssue] = []
    seen: set[tuple] = set()

    for iss in issues:
        severity = iss.severity.value if hasattr(iss.severity, "value") else str(iss.severity or "")
        category = iss.category.value if hasattr(iss.category, "value") else str(iss.category or "")
        status = iss.status.value if hasattr(iss.status, "value") else str(iss.status or "")
        signature = (
            str(iss.code or "").strip().lower(),
            severity,
            category,
            status,
            str(iss.field_path or "").strip().lower(),
            _norm_issue_value(iss.current_value),
            _norm_issue_value(iss.suggested_value),
            _norm_issue_value(iss.ai_suggested_value),
            json.dumps(iss.error_details or [], ensure_ascii=False, sort_keys=True),
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(iss)

    return deduped


def _validate_fix_against_constraints(
    value,
    allowed_values: list,
    error_details: list,
    char_name: Optional[str] = None,
    current_value: Optional[str] = None,
    product_dna: str = "",
) -> tuple:
    """
    Check if AI-suggested value passes allowed_values and limit constraints.
    Returns (is_valid: bool, fail_reason: str, corrected_value: any)
    
    If value doesn't match allowed_values exactly, tries to find best match.
    For color fields: AI picks ONE parent, then a separate AI call selects
    the closest shades from that parent's children.
    """
    corrected = None
    is_color = _is_color_field(char_name)
    catalog = None
    if is_color:
        try:
            catalog = get_catalog()
        except Exception:
            catalog = None

    # Color-special flow:
    # 1) AI picks ONE parent color (e.g. "черный")
    # 2) Get children list from color_names.json
    # 3) Separate AI call picks the closest 4 shades for this product
    # 4) Final palette = [parent] + [AI-selected children] = 5 colors
    if is_color and catalog is not None:
        # Parse AI selection
        picked_raw = value
        if isinstance(picked_raw, list):
            picked_raw = picked_raw[0] if picked_raw else ""
        picked_str = str(picked_raw or "").strip()
        if not picked_str:
            return False, "Не удалось определить основной цвет", None

        # Resolve to parent
        parent = catalog.get_color_parent(picked_str) or picked_str

        limits = _extract_limits(error_details)
        min_l = limits.get("min")
        max_l = limits.get("max")
        desired = 5
        if isinstance(max_l, int) and max_l > 0:
            desired = min(desired, max_l)
        if isinstance(min_l, int) and min_l > desired:
            desired = min(min_l, max_l or min_l)
        desired = max(3, min(desired, 5))

        # Get all children of this parent
        children = list(catalog.color_parent_to_children.get(parent, []))

        full_allowed = catalog.get_allowed_values("цвет") or []
        full_allowed_norm = {_norm_text(x) for x in full_allowed}

        # Start palette with the parent itself (if it's in allowed list)
        normalized_palette: List[str] = []
        if _norm_text(parent) in full_allowed_norm:
            exact_parent = next((av for av in full_allowed if _norm_text(av) == _norm_text(parent)), parent)
            normalized_palette.append(exact_parent)

        # How many children do we need from AI?
        children_needed = desired - len(normalized_palette)

        if children and children_needed > 0:
            # Ask AI to pick closest shades from children list
            ai_svc = get_ai_service()
            if ai_svc.is_enabled():
                ai_shades, _shade_tokens = ai_svc.pick_color_shades(
                    parent_color=parent,
                    children=children,
                    product_dna=product_dna,
                    count=children_needed,
                )
                for shade in ai_shades:
                    if _norm_text(shade) in full_allowed_norm:
                        exact = next((av for av in full_allowed if _norm_text(av) == _norm_text(shade)), shade)
                        if exact not in normalized_palette:
                            normalized_palette.append(exact)
                    else:
                        bm = find_best_match(shade, full_allowed, threshold=0.72)
                        if bm and bm not in normalized_palette:
                            normalized_palette.append(bm)

        # Fallback: if AI didn't return enough, fill from similarity-based method
        if len(normalized_palette) < desired and children:
            seeds = _extract_seed_colors(current_value)
            fallback_palette = catalog.suggest_related_colors(
                selected_parent_or_color=picked_str,
                seed_colors=seeds,
                total_count=desired,
            )
            for c in fallback_palette:
                if len(normalized_palette) >= desired:
                    break
                if _norm_text(c) in full_allowed_norm:
                    exact = next((av for av in full_allowed if _norm_text(av) == _norm_text(c)), c)
                    if exact not in normalized_palette:
                        normalized_palette.append(exact)

        if not normalized_palette:
            return False, f"Не удалось подобрать палитру для цвета '{picked_str}'", None

        return True, "", normalized_palette

    if not allowed_values and not error_details:
        return True, "", None

    # Generic allowed_values flow (non-color)
    if allowed_values:
        if isinstance(value, list):
            corrected_list = []
            invalid = []
            for v in value:
                v_str = str(v).strip()
                # Try exact match
                if v_str in allowed_values:
                    corrected_list.append(v_str)
                else:
                    # Try fuzzy match
                    best_match = find_best_match(v_str, allowed_values, threshold=0.75)
                    if best_match:
                        corrected_list.append(best_match)
                    else:
                        invalid.append(v_str)
            
            if invalid:
                return False, f"Значения {invalid} отсутствуют в допустимых: {allowed_values[:10]}", None
            if corrected_list != value:
                corrected = corrected_list
        
        elif isinstance(value, str):
            v_str = value.strip()
            # Try exact match
            if v_str not in allowed_values:
                # Try fuzzy match
                best_match = find_best_match(v_str, allowed_values, threshold=0.75)
                if best_match:
                    corrected = best_match
                else:
                    return False, f"Значение '{v_str}' отсутствует в допустимых: {allowed_values[:10]}", None
    
    # Check limits (non-color generic)
    limits = _extract_limits(error_details)
    if limits:
        min_l = limits.get("min")
        max_l = limits.get("max")
        if isinstance(value, list):
            count = len(value)
        elif isinstance(value, str) and "," in value:
            count = len([v.strip() for v in value.split(",") if v.strip()])
        else:
            count = 1
        
        if min_l is not None and count < min_l:
            return False, f"Нужно минимум {min_l} значений, сейчас {count}", corrected
        if max_l is not None and count > max_l:
            return False, f"Нужно максимум {max_l} значений, сейчас {count}", corrected
    
    return True, "", corrected


def _extract_limits(error_details: list) -> dict:
    """Extract min/max limits from error_details"""
    if not error_details:
        return {}
    for err in error_details:
        if isinstance(err, dict) and err.get("type") == "limit":
            return {"min": err.get("min"), "max": err.get("max")}
    return {}


def _map_severity(severity: str) -> IssueSeverity:
    """Map string severity to enum"""
    mapping = {
        "critical": IssueSeverity.CRITICAL,
        # AI "error" is too aggressive in current flow; keep it as warning
        "error": IssueSeverity.WARNING,
        "warning": IssueSeverity.WARNING,
        "info": IssueSeverity.INFO,
    }
    return mapping.get(severity.lower(), IssueSeverity.WARNING)


def _map_ai_category(category: str, field_path: Optional[str] = None) -> IssueCategory:
    """Map AI category to enum with field-path override for photo-based characteristic issues."""
    normalized_path = str(field_path or "").strip().lower()
    normalized_category = str(category or "").strip().lower()

    if normalized_path == "title":
        return IssueCategory.TITLE
    if normalized_path == "description":
        return IssueCategory.DESCRIPTION
    if normalized_path.startswith("characteristics."):
        return IssueCategory.CHARACTERISTICS
    if normalized_path.startswith("photos"):
        return IssueCategory.PHOTOS
    if normalized_path.startswith("videos"):
        return IssueCategory.VIDEO

    mapping = {
        "photo": IssueCategory.PHOTOS,
        "text": IssueCategory.DESCRIPTION,
        "identification": IssueCategory.CATEGORY,
        "qualification": IssueCategory.CHARACTERISTICS,
        "mixed": IssueCategory.OTHER,
    }
    return mapping.get(normalized_category, IssueCategory.OTHER)


def _format_error_description(wb_issue: dict) -> str:
    """Format WB validation error description"""
    parts = []
    for err in wb_issue.get("errors", []):
        if err.get("type") == "limit":
            parts.append(f"Лимит: {err.get('min', 0)}-{err.get('max', 999)}, текущее: {err.get('actual')}")
        elif err.get("type") == "allowed_values":
            invalid = err.get("invalidValues", [])[:3]
            if invalid:
                parts.append(f"Недопустимые значения: {', '.join(str(x) for x in invalid)}")
        elif err.get("type") == "wrong_category":
            parts.append(err.get("message", "Характеристика не входит в список допустимых для данной категории"))
    return "; ".join(parts) if parts else wb_issue.get("message", "")


def _format_ai_description(ai_issue: dict) -> str:
    """Format AI issue description"""
    parts = []
    for err in ai_issue.get("errors", []):
        if not isinstance(err, dict):
            continue
        marker = str(err.get("fix_action") or err.get("type") or "").strip().lower()
        if marker in {"swap", "clear", "compound"}:
            continue
        message = str(err.get("message") or "").strip()
        if message:
            parts.append(message)

    if parts:
        unique_parts = list(dict.fromkeys(parts))
        return "; ".join(unique_parts)
    return str(ai_issue.get("message") or "").strip()


def _calculate_wb_score_impact(wb_issue: dict) -> int:
    """Calculate score impact for WB validation issue"""
    errors = wb_issue.get("errors", [])
    # Wrong category characteristics are a significant quality issue
    if any(e.get("type") == "wrong_category" for e in errors):
        return 10
    base = 8
    if any(e.get("type") == "limit" for e in errors):
        base += 4
    if any(e.get("type") == "allowed_values" for e in errors):
        base += 2
    return min(base, 15)


def _calculate_ai_score_impact(ai_issue: dict) -> int:
    """Calculate score impact for AI issue"""
    severity_scores = {
        "critical": 15,
        "error": 8,
        "warning": 5,
        "improvement": 3,
    }
    # Reduce impact for non-critical issues
    base = severity_scores.get(ai_issue.get("severity", "warning"), 5)
    # Further reduce if category is not core (title/description/photo)
    category = ai_issue.get("category", "").lower()
    if category not in ("text", "photo", "identification"):
        base = max(3, base - 2)
    return base


async def analyze_store_cards(
    db: AsyncSession,
    store_id: int,
    use_ai: bool = True,
    limit: Optional[int] = 10,  # Default 10 cards for testing
) -> dict:
    """Analyze cards in a store. If limit is set, only analyze that many."""
    query = select(Card).where(Card.store_id == store_id)
    if limit:
        query = query.limit(limit)
    result = await db.execute(query)
    cards = result.scalars().all()
    
    total = len(cards)
    analyzed = 0
    total_issues = 0
    analyzed_ids = []
    
    for card in cards:
        issues, _tokens = await analyze_card(db, card, use_ai=use_ai)
        analyzed += 1
        total_issues += len(issues)
        analyzed_ids.append(card.id)
    
    # Reset stale counts for non-analyzed cards in this store
    # (cards not in the batch may have outdated counts with no matching issues)
    if limit and analyzed_ids:
        await db.execute(
            update(Card)
            .where(
                Card.store_id == store_id,
                Card.id.notin_(analyzed_ids),
            )
            .values(
                critical_issues_count=0,
                warnings_count=0,
                improvements_count=0,
                growth_points_count=0,
            )
        )
        # Also delete orphaned issues for non-analyzed cards
        await db.execute(
            delete(CardIssue)
            .where(
                CardIssue.card_id.in_(
                    select(Card.id).where(
                        Card.store_id == store_id,
                        Card.id.notin_(analyzed_ids),
                    )
                )
            )
        )
        await db.commit()
    
    return {
        "total": total,
        "analyzed": analyzed,
        "issues_found": total_issues,
    }


async def get_card_by_id(db: AsyncSession, card_id: int) -> Optional[Card]:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Card)
        .options(selectinload(Card.issues))
        .where(Card.id == card_id)
    )
    return result.scalar_one_or_none()


def _pending_issue_counts_from_card(card: Card) -> dict[str, int]:
    counts = {
        "critical": 0,
        "warning": 0,
        "improvement": 0,
    }

    for issue in getattr(card, "issues", None) or []:
        status = issue.status.value if hasattr(issue.status, "value") else str(issue.status or "")
        if status != IssueStatus.PENDING.value:
            continue

        severity = issue.severity.value if hasattr(issue.severity, "value") else str(issue.severity or "")
        if severity in counts:
            counts[severity] += 1

    return counts


async def ensure_card_issue_consistency(
    db: AsyncSession,
    card: Card,
    *,
    reanalyze_if_missing: bool = False,
) -> Card:
    """
    Heal stale card issue state.

    Some sync flows used to remove card_issues rows without resetting the cached
    issue counters on cards. When that happens the frontend sees warning counts
    but no actual issues. This helper optionally re-analyzes such cards once and
    otherwise falls back to the real pending counts from DB/loaded relations.
    """
    if card is None:
        return card

    stored_counts = {
        "critical": int(card.critical_issues_count or 0),
        "warning": int(card.warnings_count or 0),
        "improvement": int(card.improvements_count or 0),
    }
    loaded_issues = list(getattr(card, "issues", None) or [])
    actual_counts = _pending_issue_counts_from_card(card)

    stored_total = sum(stored_counts.values())
    loaded_total = len(loaded_issues)

    if reanalyze_if_missing and stored_total > 0 and loaded_total == 0 and card.raw_data:
        try:
            try:
                await asyncio.wait_for(
                    analyze_card(db, card, use_ai=True),
                    timeout=STALE_CARD_REANALYZE_TIMEOUT_SEC,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "Timed out while re-analyzing stale card with AI, falling back to validator-only run | card_id=%s nm_id=%s",
                    getattr(card, "id", None),
                    getattr(card, "nm_id", None),
                )
                await db.rollback()
                fallback_card = await get_card_by_id(db, card.id)
                if fallback_card is not None:
                    card = fallback_card
                await analyze_card(db, card, use_ai=False)

            refreshed = await get_card_by_id(db, card.id)
            if refreshed is not None:
                card = refreshed
                stored_counts = {
                    "critical": int(card.critical_issues_count or 0),
                    "warning": int(card.warnings_count or 0),
                    "improvement": int(card.improvements_count or 0),
                }
                actual_counts = _pending_issue_counts_from_card(card)
        except Exception:
            logger.exception(
                "Failed to re-analyze stale card issue state | card_id=%s nm_id=%s",
                getattr(card, "id", None),
                getattr(card, "nm_id", None),
            )
            await db.rollback()
            refreshed = await get_card_by_id(db, card.id)
            if refreshed is not None:
                card = refreshed
                stored_counts = {
                    "critical": int(card.critical_issues_count or 0),
                    "warning": int(card.warnings_count or 0),
                    "improvement": int(card.improvements_count or 0),
                }
                actual_counts = _pending_issue_counts_from_card(card)

    if stored_counts == actual_counts:
        return card

    card.critical_issues_count = actual_counts["critical"]
    card.warnings_count = actual_counts["warning"]
    card.improvements_count = actual_counts["improvement"]
    await db.commit()

    refreshed = await get_card_by_id(db, card.id)
    return refreshed or card


async def get_store_cards(
    db: AsyncSession,
    store_id: int,
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = None,
    min_score: Optional[int] = None,
    max_score: Optional[int] = None,
    has_critical: Optional[bool] = None,
    has_issues: Optional[bool] = None,
    no_issues: Optional[bool] = None,
    is_fully_confirmed: Optional[bool] = None,
) -> tuple[List[Card], int]:
    """Get cards with filters"""
    query = select(Card).where(Card.store_id == store_id)
    count_query = select(func.count(Card.id)).where(Card.store_id == store_id)
    
    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (Card.title.ilike(search_filter)) |
            (Card.vendor_code.ilike(search_filter)) |
            (func.cast(Card.nm_id, String).ilike(search_filter))
        )
        count_query = count_query.where(
            (Card.title.ilike(search_filter)) |
            (Card.vendor_code.ilike(search_filter)) |
            (func.cast(Card.nm_id, String).ilike(search_filter))
        )
    
    if min_score is not None:
        query = query.where(Card.score >= min_score)
        count_query = count_query.where(Card.score >= min_score)
    
    if max_score is not None:
        query = query.where(Card.score <= max_score)
        count_query = count_query.where(Card.score <= max_score)
    
    if has_critical is not None:
        if has_critical:
            query = query.where(Card.critical_issues_count > 0)
            count_query = count_query.where(Card.critical_issues_count > 0)
        else:
            query = query.where(Card.critical_issues_count == 0)
            count_query = count_query.where(Card.critical_issues_count == 0)

    total_issues_expr = (
        func.coalesce(Card.critical_issues_count, 0)
        + func.coalesce(Card.warnings_count, 0)
        + func.coalesce(Card.improvements_count, 0)
    )
    confirmed_sections_expr = (
        select(func.count(CardConfirmedSection.id))
        .where(
            CardConfirmedSection.card_id == Card.id,
            CardConfirmedSection.section.in_(CARD_WORKFLOW_SECTIONS),
        )
        .correlate(Card)
        .scalar_subquery()
    )
    if has_issues:
        query = query.where(total_issues_expr > 0)
        count_query = count_query.where(total_issues_expr > 0)
    if no_issues:
        query = query.where(total_issues_expr == 0)
        count_query = count_query.where(total_issues_expr == 0)
    if is_fully_confirmed is not None:
        required_sections = len(CARD_WORKFLOW_SECTIONS)
        if is_fully_confirmed:
            query = query.where(confirmed_sections_expr >= required_sections)
            count_query = count_query.where(confirmed_sections_expr >= required_sections)
        else:
            query = query.where(confirmed_sections_expr < required_sections)
            count_query = count_query.where(confirmed_sections_expr < required_sections)
    
    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Get paginated results
    query = query.order_by(Card.critical_issues_count.desc(), Card.score.asc())
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    cards = list(result.scalars().all())
    
    return cards, total


async def get_card_by_nm_id(db: AsyncSession, nm_id: int, store_id: int) -> Optional[Card]:
    """Get a card by WB nmID within a store."""
    result = await db.execute(
        select(Card).where(Card.nm_id == nm_id, Card.store_id == store_id)
    )
    return result.scalar_one_or_none()
