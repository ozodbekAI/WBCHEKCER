from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException, status
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm.attributes import NO_VALUE

from .wb_api import WB_PING_CATEGORY_BY_API_TYPE


WB_TOKEN_TYPE_LABELS: dict[int, str] = {
    1: "base",
    2: "test",
    3: "personal",
    4: "service",
}

WB_CATEGORY_BITS: dict[int, str] = {
    1: "content",
    2: "analytics",
    3: "prices",
    4: "marketplace",
    5: "statistics",
    6: "promotion",
    7: "feedbacks",
    9: "buyers_chat",
    10: "supplies",
    11: "buyers_returns",
    12: "documents",
    13: "finance",
    16: "users",
}

WB_CATEGORY_LABELS: dict[str, str] = {
    "content": "Content",
    "analytics": "Analytics",
    "prices": "Prices and Discounts",
    "marketplace": "Marketplace",
    "statistics": "Statistics",
    "promotion": "Promotion",
    "feedbacks": "Feedbacks and Questions",
    "buyers_chat": "Buyers Chat",
    "supplies": "Supplies",
    "buyers_returns": "Buyers Returns",
    "documents": "Documents",
    "finance": "Finance",
    "users": "Users",
}


@dataclass(frozen=True)
class WbFeatureRule:
    key: str
    label: str
    required_categories: tuple[str, ...] = ()
    required_write_categories: tuple[str, ...] = ()


@dataclass(frozen=True)
class WbKeySlotRule:
    key: str
    label: str
    feature_keys: tuple[str, ...]
    validation_categories: tuple[str, ...] = ()
    validation_match: str = "all"
    is_default: bool = False


WB_FEATURE_RULES: dict[str, WbFeatureRule] = {
    "cards": WbFeatureRule(
        key="cards",
        label="Карточки",
        required_categories=("content",),
    ),
    "cards_write": WbFeatureRule(
        key="cards_write",
        label="Изменение карточек",
        required_write_categories=("content",),
    ),
    "photo_studio": WbFeatureRule(
        key="photo_studio",
        label="Photo Studio",
        required_write_categories=("content",),
    ),
    "ab_tests": WbFeatureRule(
        key="ab_tests",
        label="A/B тесты",
        required_categories=("content",),
        required_write_categories=("promotion",),
    ),
    "ad_analysis": WbFeatureRule(
        key="ad_analysis",
        label="Экономика",
        required_categories=("analytics", "statistics", "promotion"),
    ),
    "documents": WbFeatureRule(
        key="documents",
        label="Документы",
        required_categories=("documents",),
    ),
}

WB_KEY_SLOT_RULES: dict[str, WbKeySlotRule] = {
    "default": WbKeySlotRule(
        key="default",
        label="Основной ключ магазина",
        feature_keys=tuple(WB_FEATURE_RULES.keys()),
        is_default=True,
    ),
    "content": WbKeySlotRule(
        key="content",
        label="Content / Карточки",
        feature_keys=("cards", "cards_write", "photo_studio"),
        validation_categories=("content",),
    ),
    "ab_tests": WbKeySlotRule(
        key="ab_tests",
        label="A/B тесты",
        feature_keys=("ab_tests",),
        validation_categories=("promotion",),
    ),
    "ad_analysis": WbKeySlotRule(
        key="ad_analysis",
        label="Экономика",
        feature_keys=("ad_analysis",),
        validation_categories=("analytics", "statistics", "promotion"),
        validation_match="any",
    ),
    "documents": WbKeySlotRule(
        key="documents",
        label="Документы",
        feature_keys=("documents",),
        validation_categories=("documents",),
    ),
}

WB_FEATURE_SLOT_CANDIDATES: dict[str, tuple[str, ...]] = {
    "cards": ("content",),
    "cards_write": ("content",),
    "photo_studio": ("content",),
    "ab_tests": ("ab_tests",),
    "ad_analysis": ("ad_analysis",),
    "documents": ("documents",),
}

WB_FEATURE_CATEGORY_SLOT_HINTS: dict[str, dict[str, tuple[str, ...]]] = {
    "cards": {"content": ("content",)},
    "cards_write": {"content": ("content",)},
    "photo_studio": {"content": ("content",)},
    "ab_tests": {
        "content": ("content",),
        "promotion": ("ab_tests",),
    },
    "ad_analysis": {
        "analytics": ("ad_analysis",),
        "statistics": ("ad_analysis",),
        "promotion": ("ad_analysis",),
    },
    "documents": {"documents": ("documents",)},
}

WB_CATEGORY_PING_API_TYPES: dict[str, str] = {
    "content": "content",
    "analytics": "analytics",
    "prices": "prices",
    "marketplace": "marketplace",
    "statistics": "statistics",
    "promotion": "advert",
    "feedbacks": "feedbacks",
    "buyers_chat": "buyers_chat",
    "supplies": "supplies",
    "buyers_returns": "buyers_returns",
    "documents": "documents",
    "finance": "finance",
    "users": "users",
}

WB_CATEGORY_ORDER: tuple[str, ...] = tuple(WB_CATEGORY_LABELS.keys())


def _bit_enabled(mask: int, bit_position: int) -> bool:
    return bool(int(mask) & (1 << (int(bit_position) - 1)))


def _b64decode_json(part: str) -> dict[str, Any]:
    padded = str(part or "") + ("=" * (-len(str(part or "")) % 4))
    raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("WB token payload is not an object")
    return payload


def _category_labels(categories: Iterable[str]) -> list[str]:
    out: list[str] = []
    for category in categories:
        key = str(category or "").strip().lower()
        if not key:
            continue
        out.append(WB_CATEGORY_LABELS.get(key, key))
    return out


def _ordered_categories(categories: Iterable[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for category in categories:
        key = str(category or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)

    order_map = {key: index for index, key in enumerate(WB_CATEGORY_ORDER)}
    return sorted(normalized, key=lambda key: (order_map.get(key, 999), key))


def _extract_ping_categories(ping_access: Any) -> tuple[list[str], set[str]]:
    if not isinstance(ping_access, dict):
        return [], set()

    allowed_categories: list[str] = []
    tested_categories: set[str] = set()

    for category in ping_access.get("allowed_categories") or []:
        key = str(category or "").strip().lower()
        if key:
            allowed_categories.append(key)
            tested_categories.add(key)

    for category in ping_access.get("denied_categories") or []:
        key = str(category or "").strip().lower()
        if key:
            tested_categories.add(key)

    results = ping_access.get("results") or {}
    if isinstance(results, dict):
        for api_type, payload in results.items():
            category = WB_PING_CATEGORY_BY_API_TYPE.get(str(api_type or "").strip().lower())
            if not category:
                continue
            tested_categories.add(category)
            if isinstance(payload, dict) and payload.get("success"):
                allowed_categories.append(category)

    return _ordered_categories(allowed_categories), tested_categories


def _merge_categories_with_ping(
    decoded_categories: Iterable[str],
    ping_access: Any,
) -> tuple[list[str], bool]:
    base_categories = _ordered_categories(decoded_categories)
    allowed_ping_categories, tested_ping_categories = _extract_ping_categories(ping_access)
    if not tested_ping_categories:
        return base_categories, False

    merged = [category for category in base_categories if category not in tested_ping_categories]
    for category in allowed_ping_categories:
        if category not in merged:
            merged.append(category)
    return _ordered_categories(merged), True


def _rule_required_categories(rule: WbFeatureRule) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for category in list(rule.required_categories) + list(rule.required_write_categories):
        key = str(category or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def _build_feature_message(
    *,
    rule: WbFeatureRule,
    allowed: bool,
    reason: str | None,
    missing_categories: list[str],
) -> str:
    if allowed:
        return f"Раздел «{rule.label}» доступен для текущего WB-ключа."

    missing_labels = _category_labels(missing_categories)
    if reason == "read_only":
        return (
            f"У вашего текущего WB-ключа нет доступа к разделу «{rule.label}»: "
            "ключ создан в режиме Read only. Обновите ключ до Read and Write "
            "или подключите отдельный ключ для этого раздела."
        )

    if reason == "decode_failed":
        return (
            f"Не удалось определить права текущего WB-ключа для раздела «{rule.label}». "
            "Обновите ключ или подключите отдельный ключ для этого раздела."
        )

    if missing_labels:
        return (
            f"У вашего текущего WB-ключа нет доступа к разделу «{rule.label}». "
            f"Нужны категории: {', '.join(missing_labels)}. "
            "Обновите ключ или подключите отдельный ключ для этого раздела."
        )

    return (
        f"У вашего текущего WB-ключа нет доступа к разделу «{rule.label}». "
        "Обновите ключ или подключите отдельный ключ для этого раздела."
    )


def build_wb_feature_access(
    *,
    categories: Iterable[str],
    read_only: bool,
    decoded: bool,
) -> dict[str, dict[str, Any]]:
    category_set = {
        str(category or "").strip().lower()
        for category in categories
        if str(category or "").strip()
    }

    out: dict[str, dict[str, Any]] = {}
    for key, rule in WB_FEATURE_RULES.items():
        required_categories = _rule_required_categories(rule)
        missing_categories = [
            category for category in rule.required_categories
            if category not in category_set
        ]
        write_missing = [
            category for category in rule.required_write_categories
            if category not in category_set
        ]
        reason: str | None = None
        allowed = True

        if not decoded:
            allowed = False
            reason = "decode_failed"
        elif missing_categories or write_missing:
            allowed = False
            reason = "missing_categories"
        elif rule.required_write_categories and read_only:
            allowed = False
            reason = "read_only"

        merged_missing = list(dict.fromkeys(missing_categories + write_missing))
        out[key] = {
            "label": rule.label,
            "allowed": allowed,
            "reason": reason,
            "message": _build_feature_message(
                rule=rule,
                allowed=allowed,
                reason=reason,
                missing_categories=merged_missing,
            ),
            "required_categories": required_categories,
            "required_categories_labels": _category_labels(required_categories),
            "missing_categories": merged_missing,
            "missing_categories_labels": _category_labels(merged_missing),
            "requires_write": bool(rule.required_write_categories),
        }

    return out


def summarize_wb_token_access(token: str | None, ping_access: Any = None) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "decoded": False,
        "decode_error": None,
        "token_type": None,
        "scope_mask": None,
        "categories": [],
        "category_labels": [],
        "read_only": False,
        "expires_at": None,
        "features": {},
    }

    raw = str(token or "").strip()
    if not raw:
        summary["decode_error"] = "WB token is empty"
        effective_categories, has_verified_access = _merge_categories_with_ping([], ping_access)
        summary["categories"] = effective_categories
        summary["category_labels"] = _category_labels(effective_categories)
        summary["features"] = build_wb_feature_access(
            categories=effective_categories,
            read_only=False,
            decoded=has_verified_access,
        )
        return summary

    decoded_categories: list[str] = []
    try:
        parts = raw.split(".")
        if len(parts) < 2:
            raise ValueError("WB token is not a JWT")

        payload = _b64decode_json(parts[1])
        scope_mask = int(payload.get("s") or 0)
        decoded_categories = [
            category
            for bit, category in sorted(WB_CATEGORY_BITS.items())
            if _bit_enabled(scope_mask, bit)
        ]
        exp = payload.get("exp")
        expires_at = None
        if exp is not None:
            expires_at = datetime.fromtimestamp(int(exp), tz=timezone.utc).replace(tzinfo=None)

        summary.update(
            {
                "decoded": True,
                "token_type": WB_TOKEN_TYPE_LABELS.get(int(payload.get("acc") or 0)) or "unknown",
                "scope_mask": scope_mask,
                "categories": decoded_categories,
                "category_labels": _category_labels(decoded_categories),
                "read_only": _bit_enabled(scope_mask, 30),
                "expires_at": expires_at,
            }
        )
    except Exception as exc:
        summary["decode_error"] = str(exc)

    effective_categories, has_verified_access = _merge_categories_with_ping(
        summary["categories"],
        ping_access,
    )
    summary["categories"] = effective_categories
    summary["category_labels"] = _category_labels(effective_categories)
    summary["features"] = build_wb_feature_access(
        categories=summary["categories"],
        read_only=bool(summary["read_only"]),
        decoded=bool(summary["decoded"]) or has_verified_access,
    )
    return summary


def _token_snapshot(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "decoded": bool(summary.get("decoded")),
        "decode_error": summary.get("decode_error"),
        "token_type": summary.get("token_type"),
        "scope_mask": summary.get("scope_mask"),
        "categories": list(summary.get("categories") or []),
        "category_labels": list(summary.get("category_labels") or []),
        "read_only": bool(summary.get("read_only")),
        "expires_at": summary.get("expires_at"),
    }


def _feature_labels(feature_keys: Iterable[str]) -> list[str]:
    return [
        WB_FEATURE_RULES[key].label
        for key in feature_keys
        if key in WB_FEATURE_RULES
    ]


def _iter_store_slot_rows(store: Any) -> list[Any]:
    try:
        state = sa_inspect(store)
        attr_state = state.attrs.feature_api_keys
        loaded_value = attr_state.loaded_value
        if loaded_value is NO_VALUE:
            if getattr(state, "async_session", None) is not None:
                return []
            rows = getattr(store, "feature_api_keys", None)
            if isinstance(rows, list):
                return rows
            try:
                return list(rows or [])
            except Exception:
                return []
        if isinstance(loaded_value, list):
            return loaded_value
        return list(loaded_value or [])
    except Exception:
        rows = getattr(store, "feature_api_keys", None)
        if isinstance(rows, list):
            return rows
        try:
            return list(rows or [])
        except Exception:
            return []
    return []


def _get_store_slot_row(store: Any, slot_key: str) -> Any | None:
    normalized = str(slot_key or "").strip().lower()
    for row in _iter_store_slot_rows(store):
        if str(getattr(row, "slot_key", "") or "").strip().lower() == normalized:
            return row
    return None


def get_store_slot_api_key(store: Any, slot_key: str) -> str | None:
    normalized = str(slot_key or "").strip().lower()
    if normalized == "default":
        raw = str(getattr(store, "api_key", "") or "").strip()
        return raw or None

    row = _get_store_slot_row(store, normalized)
    if not row:
        return None
    raw = str(getattr(row, "api_key", "") or "").strip()
    return raw or None


def _summary_has_category(summary: dict[str, Any], category: str) -> bool:
    category_set = {
        str(item or "").strip().lower()
        for item in (summary.get("categories") or [])
        if str(item or "").strip()
    }
    return str(category or "").strip().lower() in category_set


def _summary_has_writable_category(summary: dict[str, Any], category: str) -> bool:
    return _summary_has_category(summary, category) and not bool(summary.get("read_only"))


def _feature_contributing_slot(
    feature_key: str,
    rule: WbFeatureRule,
    slot_key: str,
    slot_summary: dict[str, Any] | None,
) -> bool:
    if not isinstance(slot_summary, dict):
        return False
    if not slot_summary.get("decoded"):
        return False

    relevant_categories = _rule_required_categories(rule)
    if not relevant_categories:
        return False

    return any(_summary_has_category(slot_summary, category) for category in relevant_categories)


def _build_store_feature_access(
    feature_key: str,
    rule: WbFeatureRule,
    all_slot_summaries: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    required_categories = _rule_required_categories(rule)
    missing_categories = [
        category
        for category in rule.required_categories
        if not any(_summary_has_category(summary, category) for summary in all_slot_summaries.values())
    ]
    missing_write_categories = [
        category
        for category in rule.required_write_categories
        if not any(_summary_has_writable_category(summary, category) for summary in all_slot_summaries.values())
    ]
    merged_missing = list(dict.fromkeys(missing_categories + missing_write_categories))

    read_only_only = [
        category
        for category in rule.required_write_categories
        if category not in missing_categories
        and not any(_summary_has_writable_category(summary, category) for summary in all_slot_summaries.values())
        and any(_summary_has_category(summary, category) for summary in all_slot_summaries.values())
    ]

    any_decoded = any(bool(summary.get("decoded")) for summary in all_slot_summaries.values())
    allowed = not merged_missing
    reason: str | None = None
    if not allowed:
        if read_only_only and not missing_categories:
            reason = "read_only"
        elif not any_decoded:
            reason = "decode_failed"
        else:
            reason = "missing_categories"

    slot_priority = list(dict.fromkeys(
        list(WB_FEATURE_SLOT_CANDIDATES.get(feature_key, ()))
        + [slot for category in required_categories for slot in WB_FEATURE_CATEGORY_SLOT_HINTS.get(feature_key, {}).get(category, ())]
        + ["default"]
    ))
    source_slot = "default"
    for slot_key in slot_priority:
        if _feature_contributing_slot(feature_key, rule, slot_key, all_slot_summaries.get(slot_key)):
            source_slot = slot_key
            break

    using_specific_key = any(
        slot_key != "default"
        and _feature_contributing_slot(feature_key, rule, slot_key, all_slot_summaries.get(slot_key))
        for slot_key in slot_priority
    )

    message = _build_feature_message(
        rule=rule,
        allowed=allowed,
        reason=reason,
        missing_categories=merged_missing,
    )
    if allowed and using_specific_key:
        source_label = WB_KEY_SLOT_RULES[source_slot].label
        message = f"Раздел «{rule.label}» доступен через настроенные отдельные WB-ключи, включая «{source_label}»."

    recommended_slots: list[str] = []
    for category in merged_missing:
        for slot in WB_FEATURE_CATEGORY_SLOT_HINTS.get(feature_key, {}).get(category, ()):
            if slot not in recommended_slots:
                recommended_slots.append(slot)
    if not recommended_slots:
        for slot in WB_FEATURE_SLOT_CANDIDATES.get(feature_key, ()):
            if slot not in recommended_slots:
                recommended_slots.append(slot)
    return {
        "label": rule.label,
        "allowed": allowed,
        "reason": reason,
        "message": message,
        "required_categories": required_categories,
        "required_categories_labels": _category_labels(required_categories),
        "missing_categories": merged_missing,
        "missing_categories_labels": _category_labels(merged_missing),
        "requires_write": bool(rule.required_write_categories),
        "source_slot": source_slot,
        "source_label": WB_KEY_SLOT_RULES[source_slot].label,
        "using_specific_key": using_specific_key,
        "recommended_slots": recommended_slots,
        "recommended_slot_labels": [
            WB_KEY_SLOT_RULES[slot].label for slot in recommended_slots if slot in WB_KEY_SLOT_RULES
        ],
    }


def summarize_store_wb_token_access(store: Any) -> dict[str, Any]:
    default_summary = summarize_wb_token_access(
        getattr(store, "api_key", None),
        ping_access=getattr(store, "wb_ping_access", None),
    )
    slot_summaries: dict[str, dict[str, Any]] = {}
    key_slots: list[dict[str, Any]] = []

    default_rule = WB_KEY_SLOT_RULES["default"]
    key_slots.append(
        {
            "slot_key": default_rule.key,
            "label": default_rule.label,
            "configured": bool(str(getattr(store, "api_key", "") or "").strip()),
            "is_default": True,
            "feature_keys": list(default_rule.feature_keys),
            "feature_labels": _feature_labels(default_rule.feature_keys),
            "token_access": _token_snapshot(default_summary),
            "updated_at": getattr(store, "updated_at", None),
        }
    )

    for slot_key, rule in WB_KEY_SLOT_RULES.items():
        if rule.is_default:
            continue
        row = _get_store_slot_row(store, slot_key)
        slot_summary = summarize_wb_token_access(
            getattr(row, "api_key", None) if row else None,
            ping_access=getattr(row, "wb_ping_access", None) if row else None,
        )
        slot_summaries[slot_key] = slot_summary
        key_slots.append(
            {
                "slot_key": slot_key,
                "label": rule.label,
                "configured": bool(row and str(getattr(row, "api_key", "") or "").strip()),
                "is_default": False,
                "feature_keys": list(rule.feature_keys),
                "feature_labels": _feature_labels(rule.feature_keys),
                "token_access": _token_snapshot(slot_summary),
                "updated_at": getattr(row, "updated_at", None),
            }
        )

    all_slot_summaries: dict[str, dict[str, Any]] = {"default": default_summary, **slot_summaries}
    merged_features: dict[str, dict[str, Any]] = {
        feature_key: _build_store_feature_access(feature_key, rule, all_slot_summaries)
        for feature_key, rule in WB_FEATURE_RULES.items()
    }

    return {
        **default_summary,
        "features": merged_features,
        "key_slots": key_slots,
    }


def validate_slot_key(slot_key: str) -> str:
    normalized = str(slot_key or "").strip().lower()
    if normalized not in WB_KEY_SLOT_RULES:
        raise ValueError(f"Unknown WB key slot: {slot_key}")
    return normalized


def get_slot_ping_requirements(slot_key: str) -> tuple[list[str], bool]:
    normalized = validate_slot_key(slot_key)
    rule = WB_KEY_SLOT_RULES[normalized]
    ping_api_types = [
        WB_CATEGORY_PING_API_TYPES[category]
        for category in rule.validation_categories
        if category in WB_CATEGORY_PING_API_TYPES
    ]
    require_all = rule.validation_match != "any"
    return ping_api_types, require_all


def validate_slot_token_access(slot_key: str, token: str | None, ping_access: Any = None) -> dict[str, Any]:
    normalized = validate_slot_key(slot_key)
    summary = summarize_wb_token_access(token, ping_access=ping_access)
    rule = WB_KEY_SLOT_RULES[normalized]
    if rule.is_default:
        return summary
    if not summary.get("decoded") and not summary.get("categories"):
        raise ValueError("Не удалось определить права WB-ключа")

    categories = {
        str(category or "").strip().lower()
        for category in (summary.get("categories") or [])
        if str(category or "").strip()
    }
    expected = [category for category in rule.validation_categories if category]
    if rule.validation_match == "any":
        if expected and not any(category in categories for category in expected):
            labels = _category_labels(expected)
            raise ValueError(
                f"WB key не подходит для слота «{rule.label}». "
                f"Нужен доступ хотя бы к одной категории: {', '.join(labels)}."
            )
    else:
        missing = [category for category in expected if category not in categories]
        if missing:
            labels = _category_labels(missing)
            raise ValueError(
                f"WB key не подходит для слота «{rule.label}». "
                f"Не хватает категорий: {', '.join(labels)}."
            )
    return summary


def get_store_feature_access(store: Any, feature_key: str) -> dict[str, Any]:
    if feature_key not in WB_FEATURE_RULES:
        raise KeyError(f"Unknown WB feature key: {feature_key}")

    access = getattr(store, "wb_token_access", None)
    if not isinstance(access, dict):
        access = summarize_store_wb_token_access(store)
    feature = (access.get("features") or {}).get(feature_key)
    if isinstance(feature, dict):
        return feature

    rule = WB_FEATURE_RULES[feature_key]
    return {
        "label": rule.label,
        "allowed": False,
        "reason": "missing_profile",
        "message": (
            f"У вашего текущего WB-ключа нет доступа к разделу «{rule.label}». "
            "Обновите ключ или подключите отдельный ключ для этого раздела."
        ),
        "required_categories": _rule_required_categories(rule),
        "required_categories_labels": _category_labels(_rule_required_categories(rule)),
        "missing_categories": _rule_required_categories(rule),
        "missing_categories_labels": _category_labels(_rule_required_categories(rule)),
        "requires_write": bool(rule.required_write_categories),
        "source_slot": "default",
        "source_label": WB_KEY_SLOT_RULES["default"].label,
        "using_specific_key": False,
        "recommended_slots": list(WB_FEATURE_SLOT_CANDIDATES.get(feature_key, ())),
        "recommended_slot_labels": [
            WB_KEY_SLOT_RULES[slot].label for slot in WB_FEATURE_SLOT_CANDIDATES.get(feature_key, ())
        ],
    }


def get_store_feature_api_key(store: Any, feature_key: str) -> str | None:
    feature = get_store_feature_access(store, feature_key)
    if not feature.get("allowed"):
        return None

    access = getattr(store, "wb_token_access", None)
    if not isinstance(access, dict):
        access = summarize_store_wb_token_access(store)

    slot_snapshot_map = {
        str(slot.get("slot_key") or "").strip().lower(): dict(slot.get("token_access") or {})
        for slot in (access.get("key_slots") or [])
        if isinstance(slot, dict)
    }

    def pick_slot(slot_keys: Iterable[str], *, category: str, require_write: bool = False) -> str | None:
        for slot_key in slot_keys:
            snapshot = slot_snapshot_map.get(str(slot_key or "").strip().lower()) or {}
            has_access = (
                _summary_has_writable_category(snapshot, category)
                if require_write
                else _summary_has_category(snapshot, category)
            )
            if has_access:
                return str(slot_key)
        return None

    preferred_slot: str | None = None
    if feature_key == "cards":
        preferred_slot = pick_slot(("content", "default"), category="content")
    elif feature_key in {"cards_write", "photo_studio"}:
        preferred_slot = pick_slot(("content", "default"), category="content", require_write=True)
    elif feature_key == "ab_tests":
        preferred_slot = pick_slot(("ab_tests", "default"), category="promotion", require_write=True)
    elif feature_key == "documents":
        preferred_slot = pick_slot(("documents", "default"), category="documents")
    elif feature_key == "ad_analysis":
        for category in ("analytics", "statistics", "promotion"):
            preferred_slot = pick_slot(("ad_analysis", "default"), category=category)
            if preferred_slot:
                break

    if preferred_slot:
        token = get_store_slot_api_key(store, preferred_slot)
        if token:
            return token

    source_slot = str(feature.get("source_slot") or "default").strip().lower()
    token = get_store_slot_api_key(store, source_slot)
    if token:
        return token
    return get_store_slot_api_key(store, "default")


def ensure_store_feature_access(store: Any, feature_key: str) -> None:
    feature = get_store_feature_access(store, feature_key)
    if feature.get("allowed"):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "WB_TOKEN_FEATURE_DENIED",
            "feature": feature_key,
            "message": feature.get("message") or "Access denied",
            "access": feature,
        },
    )
