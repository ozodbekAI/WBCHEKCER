"""
Approval service — submit / review / apply card approval workflow.
"""
import copy
import json
from datetime import datetime, date
from typing import Any, Optional

from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..core.time import utc_now
from ..models import (
    Card,
    CardApproval,
    CardDraft,
    CardIssue,
    ApprovalStatus,
    IssueStatus,
    User,
)


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _normalize_value(value: Any) -> str:
    return " ".join(_as_text(value).lower().split())


def _canonical_field_path(field_path: Optional[str], category: Optional[str] = None) -> str:
    raw = str(field_path or "").strip()
    lower = raw.lower()

    if not lower:
        cat = str(category or "").strip().lower()
        if cat == "title":
            return "title"
        if cat in {"description", "seo"}:
            return "description"
        return ""

    if lower in {"subject", "subject_name", "category"}:
        return "subject_name"
    if lower in {"package.type", "package_type"}:
        return "package_type"
    if lower in {"package.contents", "package.complectation", "complectation"}:
        return "complectation"
    if lower.startswith("characteristics."):
        name = raw.split(".", 1)[1].strip().lower()
        return f"characteristics.{name}"
    if lower.startswith("dimensions."):
        key = lower.split(".", 1)[1]
        if key == "weightbrutto":
            key = "weight"
        return f"dimensions.{key}"
    return lower


def _field_title(field_path: str) -> str:
    canonical = _canonical_field_path(field_path)
    if canonical == "title":
        return "Название"
    if canonical == "description":
        return "Описание"
    if canonical == "brand":
        return "Бренд"
    if canonical == "subject_name":
        return "Категория"
    if canonical == "package_type":
        return "Тип упаковки"
    if canonical == "complectation":
        return "Комплектация"
    if canonical == "dimensions.length":
        return "Длина упаковки"
    if canonical == "dimensions.width":
        return "Ширина упаковки"
    if canonical == "dimensions.height":
        return "Высота упаковки"
    if canonical == "dimensions.weight":
        return "Вес с упаковкой"
    if canonical.startswith("characteristics."):
        raw = str(field_path or "").strip()
        if raw.startswith("characteristics."):
            return raw.split(".", 1)[1].strip()
        return canonical.split(".", 1)[1]
    return str(field_path or "").strip() or "Изменение карточки"


def _card_characteristics_map(card: Card) -> dict[str, str]:
    raw = card.raw_data or {}
    raw_chars = raw.get("characteristics")
    if isinstance(raw_chars, list):
        out: dict[str, str] = {}
        for item in raw_chars:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            value = item.get("value", item.get("values"))
            out[name] = _as_text(value)
        if out:
            return out

    out: dict[str, str] = {}
    if isinstance(card.characteristics, dict):
        for key, value in card.characteristics.items():
            out[str(key)] = _as_text(value)
    return out


def _card_current_value(card: Card, field_path: str) -> str:
    canonical = _canonical_field_path(field_path)
    raw = card.raw_data or {}

    if canonical == "title":
        return _as_text(raw.get("title") or card.title)
    if canonical == "description":
        return _as_text(raw.get("description") or card.description)
    if canonical == "brand":
        return _as_text(raw.get("brand") or card.brand)
    if canonical == "subject_name":
        return _as_text(raw.get("subjectName") or card.subject_name)
    if canonical == "package_type":
        return _as_text(raw.get("package_type"))
    if canonical == "complectation":
        return _as_text(raw.get("complectation"))
    if canonical.startswith("characteristics."):
        target = canonical.split(".", 1)[1]
        for name, value in _card_characteristics_map(card).items():
            if name.strip().lower() == target:
                return _as_text(value)
        return ""
    if canonical.startswith("dimensions."):
        dims = raw.get("dimensions") if isinstance(raw.get("dimensions"), dict) else {}
        key = canonical.split(".", 1)[1]
        if key == "weight":
            return _as_text(dims.get("weightBrutto") or dims.get("weight") or (card.dimensions or {}).get("weight"))
        return _as_text(dims.get(key) or (card.dimensions or {}).get(key))
    return ""


def _build_draft_changes(card: Card, draft_data: dict[str, Any]) -> list[dict[str, Any]]:
    payload = draft_data or {}
    changes: list[dict[str, Any]] = []

    def push(field_path: str, new_value: Any) -> None:
        old_value = _card_current_value(card, field_path)
        if _normalize_value(old_value) == _normalize_value(new_value):
            return
        changes.append(
            {
                "field_path": field_path,
                "title": _field_title(field_path),
                "old_value": old_value or None,
                "new_value": _as_text(new_value),
                "severity": None,
            }
        )

    for field in ("title", "description", "brand", "subject_name", "package_type", "complectation"):
        if field in payload:
            push(field, payload.get(field))

    characteristics = payload.get("characteristics")
    if isinstance(characteristics, dict):
        for key in sorted(characteristics.keys()):
            push(f"characteristics.{key}", characteristics.get(key))

    dimensions = payload.get("dimensions")
    if isinstance(dimensions, dict):
        for key in ("length", "width", "height", "weight"):
            if key in dimensions:
                push(f"dimensions.{key}", dimensions.get(key))

    return changes


async def build_card_approval_changes(
    db: AsyncSession,
    card_id: int,
    prepared_by_id: int,
) -> list[dict[str, Any]]:
    card_r = await db.execute(select(Card).where(Card.id == card_id))
    card = card_r.scalar_one_or_none()
    if not card:
        raise ValueError("Card not found")

    fixed_r = await db.execute(
        select(CardIssue)
        .where(
            CardIssue.card_id == card_id,
            CardIssue.status == IssueStatus.FIXED,
            CardIssue.fixed_by_id == prepared_by_id,
        )
        .options(selectinload(CardIssue.card))
    )
    fixed_issues = list(fixed_r.scalars().all())

    issues_r = await db.execute(select(CardIssue).where(CardIssue.card_id == card_id))
    all_issues = list(issues_r.scalars().all())

    changes_by_key: dict[str, dict[str, Any]] = {}
    for issue in fixed_issues:
        key = _canonical_field_path(
            issue.field_path,
            issue.category.value if hasattr(issue.category, "value") else issue.category,
        ) or f"issue:{issue.id}"
        changes_by_key[key] = {
            "issue_id": issue.id,
            "field_path": issue.field_path or key,
            "title": issue.title,
            "old_value": issue.current_value,
            "new_value": issue.fixed_value,
            "severity": issue.severity.value if issue.severity else None,
            "charc_id": issue.charc_id,
        }

    draft_r = await db.execute(
        select(CardDraft)
        .where(CardDraft.card_id == card_id, CardDraft.author_id == prepared_by_id)
        .order_by(CardDraft.updated_at.desc())
        .limit(1)
    )
    draft = draft_r.scalar_one_or_none()
    if draft:
        for change in _build_draft_changes(card, draft.data or {}):
            key = _canonical_field_path(change.get("field_path"))
            matched_issue = next(
                (
                    issue
                    for issue in all_issues
                    if _canonical_field_path(
                        issue.field_path,
                        issue.category.value if hasattr(issue.category, "value") else issue.category,
                    ) == key
                ),
                None,
            )

            merged = {**changes_by_key.get(key, {}), **change}
            if matched_issue:
                merged["issue_id"] = merged.get("issue_id") or matched_issue.id
                merged["severity"] = merged.get("severity") or (
                    matched_issue.severity.value if matched_issue.severity else None
                )
                if matched_issue.charc_id and not merged.get("charc_id"):
                    merged["charc_id"] = matched_issue.charc_id
            changes_by_key[key] = merged

    changes = []
    for change in changes_by_key.values():
        if _normalize_value(change.get("old_value")) == _normalize_value(change.get("new_value")):
            continue
        changes.append(change)
    return changes


def _parse_multi_value(value: Any) -> list[str]:
    if value is None:
        return []

    raw = _as_text(value)
    if not raw or raw == "__CLEAR__":
        return []

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        if parsed is not None:
            text = str(parsed).strip()
            return [text] if text else []
    except Exception:
        pass

    if ";" in raw:
        return [part.strip() for part in raw.split(";") if part.strip()]
    if "," in raw:
        return [part.strip() for part in raw.split(",") if part.strip()]
    return [raw]


def _parse_numeric(value: Any) -> Any:
    text = _as_text(value)
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return text
    if number.is_integer():
        return int(number)
    return number


def _set_characteristic_value(
    characteristics: list[dict[str, Any]],
    field_path: str,
    value: Any,
    charc_id: Optional[int] = None,
) -> None:
    char_name = str(field_path or "").split(".", 1)[1].strip()
    parsed_value = _parse_multi_value(value)

    for item in characteristics:
        if not isinstance(item, dict):
            continue
        same_name = str(item.get("name") or "").strip().lower() == char_name.lower()
        same_id = bool(charc_id and str(item.get("id")) == str(charc_id))
        if same_name or same_id:
            item["value"] = parsed_value
            if charc_id and not item.get("id"):
                item["id"] = charc_id
            if not item.get("name"):
                item["name"] = char_name
            return

    new_item: dict[str, Any] = {"name": char_name, "value": parsed_value}
    if charc_id:
        new_item["id"] = charc_id
    characteristics.append(new_item)


def build_card_update_payload(
    card: Card,
    changes: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_data = copy.deepcopy(card.raw_data or {})
    raw_characteristics = raw_data.get("characteristics")
    if isinstance(raw_characteristics, list):
        characteristics = copy.deepcopy(raw_characteristics)
    else:
        characteristics = [
            {"name": key, "value": _parse_multi_value(value)}
            for key, value in _card_characteristics_map(card).items()
        ]
    raw_data["characteristics"] = characteristics

    update_payload: dict[str, Any] = {
        "nmID": card.nm_id,
        "vendorCode": raw_data.get("vendorCode") or card.vendor_code or "",
        "characteristics": characteristics,
    }

    dimensions_changed = False

    for change in changes:
        field_path = str(change.get("field_path") or "").strip()
        canonical = _canonical_field_path(field_path)
        new_value = change.get("new_value")

        if canonical == "title":
            value = _as_text(new_value)
            raw_data["title"] = value
            update_payload["title"] = value
            continue
        if canonical == "description":
            value = _as_text(new_value)
            raw_data["description"] = value
            update_payload["description"] = value
            continue
        if canonical == "brand":
            value = _as_text(new_value)
            raw_data["brand"] = value
            update_payload["brand"] = value
            continue
        if canonical == "subject_name":
            value = _as_text(new_value)
            raw_data["subjectName"] = value
            update_payload["subjectName"] = value
            continue
        if canonical.startswith("characteristics."):
            _set_characteristic_value(characteristics, field_path, new_value, change.get("charc_id"))
            continue
        if canonical.startswith("dimensions."):
            dims = raw_data.get("dimensions") if isinstance(raw_data.get("dimensions"), dict) else {}
            dim_key = canonical.split(".", 1)[1]
            wb_key = "weightBrutto" if dim_key == "weight" else dim_key
            parsed = _parse_numeric(new_value)
            if parsed is None:
                dims.pop(wb_key, None)
            else:
                dims[wb_key] = parsed
            raw_data["dimensions"] = dims
            dimensions_changed = True
            continue
        if canonical == "package_type":
            value = _as_text(new_value)
            raw_data["package_type"] = value
            update_payload["package_type"] = value
            continue
        if canonical == "complectation":
            value = _as_text(new_value)
            raw_data["complectation"] = value
            update_payload["complectation"] = value

    if dimensions_changed and isinstance(raw_data.get("dimensions"), dict):
        update_payload["dimensions"] = raw_data["dimensions"]

    return update_payload, raw_data


def apply_card_raw_snapshot(card: Card, raw_data: dict[str, Any]) -> None:
    card.raw_data = raw_data
    card.title = (_as_text(raw_data.get("title")) if "title" in raw_data else _as_text(card.title)) or None
    card.description = (_as_text(raw_data.get("description")) if "description" in raw_data else _as_text(card.description)) or None
    card.brand = (_as_text(raw_data.get("brand")) if "brand" in raw_data else _as_text(card.brand)) or None
    card.subject_name = (_as_text(raw_data.get("subjectName")) if "subjectName" in raw_data else _as_text(card.subject_name)) or None

    characteristics = {}
    for item in raw_data.get("characteristics") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        characteristics[name] = _as_text(item.get("value", item.get("values")))
    if characteristics:
        card.characteristics = characteristics

    dims = raw_data.get("dimensions") if isinstance(raw_data.get("dimensions"), dict) else {}
    card.dimensions = {
        "length": dims.get("length"),
        "width": dims.get("width"),
        "height": dims.get("height"),
        "weight": dims.get("weightBrutto", dims.get("weight")),
    }


# ──────────────────────────────────────────
# Submit for review (Manager)
# ──────────────────────────────────────────
async def submit_for_review(
    db: AsyncSession,
    store_id: int,
    card_id: int,
    prepared_by_id: int,
    note: Optional[str] = None,
) -> CardApproval:
    """
    Collect all pending card changes (fixed issues + current draft diff) and create an approval request.
    """
    card_r = await db.execute(select(Card).where(Card.id == card_id))
    card = card_r.scalar_one_or_none()
    if not card or card.store_id != store_id:
        raise ValueError("Card not found")

    changes = await build_card_approval_changes(db, card_id, prepared_by_id)
    if not changes:
        raise ValueError("No card changes found for this card")

    # Cancel any existing pending approvals for this card
    await db.execute(
        update(CardApproval)
        .where(
            CardApproval.card_id == card_id,
            CardApproval.status == ApprovalStatus.PENDING,
        )
        .values(status=ApprovalStatus.REJECTED, reviewer_comment="Superseded by new submission")
    )

    approval = CardApproval(
        store_id=store_id,
        card_id=card_id,
        prepared_by_id=prepared_by_id,
        status=ApprovalStatus.PENDING,
        changes=changes,
        total_fixes=len(changes),
        submit_note=note,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    return approval


# ──────────────────────────────────────────
# Review (Head-Manager / Owner)
# ──────────────────────────────────────────
async def review_approval(
    db: AsyncSession,
    approval_id: int,
    reviewer_id: int,
    action: str,  # "approve" | "reject"
    comment: Optional[str] = None,
) -> CardApproval:
    result = await db.execute(
        select(CardApproval).where(CardApproval.id == approval_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise ValueError("Approval not found")
    if approval.status != ApprovalStatus.PENDING:
        raise ValueError("Approval is not pending")

    approval.reviewed_by_id = reviewer_id
    approval.reviewed_at = utc_now()
    approval.reviewer_comment = comment

    if action == "approve":
        approval.status = ApprovalStatus.APPROVED
    else:
        approval.status = ApprovalStatus.REJECTED
        # Revert issues back to pending so manager can rework
        issue_ids = [c["issue_id"] for c in (approval.changes or []) if "issue_id" in c]
        if issue_ids:
            await db.execute(
                update(CardIssue)
                .where(CardIssue.id.in_(issue_ids))
                .values(status=IssueStatus.PENDING, fixed_value=None, fixed_at=None)
            )

    await db.commit()
    await db.refresh(approval)
    return approval


# ──────────────────────────────────────────
# Mark as applied to WB
# ──────────────────────────────────────────
async def mark_approval_applied(
    db: AsyncSession,
    approval_id: int,
) -> CardApproval:
    result = await db.execute(
        select(CardApproval).where(CardApproval.id == approval_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise ValueError("Approval not found")

    approval.status = ApprovalStatus.APPLIED
    approval.applied_at = utc_now()
    await db.commit()
    await db.refresh(approval)
    return approval


# ──────────────────────────────────────────
# List approvals
# ──────────────────────────────────────────
async def get_store_approvals(
    db: AsyncSession,
    store_id: int,
    status_filter: Optional[ApprovalStatus] = None,
    skip: int = 0,
    limit: int = 50,
    user_id: Optional[int] = None,
) -> tuple[list[CardApproval], int]:
    base = select(CardApproval).where(CardApproval.store_id == store_id)
    count_q = select(func.count()).select_from(CardApproval).where(CardApproval.store_id == store_id)

    if status_filter:
        base = base.where(CardApproval.status == status_filter)
        count_q = count_q.where(CardApproval.status == status_filter)

    if user_id:
        base = base.where(CardApproval.prepared_by_id == user_id)
        count_q = count_q.where(CardApproval.prepared_by_id == user_id)

    base = (
        base
        .options(
            selectinload(CardApproval.card),
            selectinload(CardApproval.prepared_by),
            selectinload(CardApproval.reviewed_by),
        )
        .order_by(CardApproval.created_at.desc())
        .offset(skip)
        .limit(limit)
    )

    items_r = await db.execute(base)
    count_r = await db.execute(count_q)
    return list(items_r.scalars().all()), count_r.scalar() or 0


async def get_approval_by_id(
    db: AsyncSession,
    approval_id: int,
) -> Optional[CardApproval]:
    result = await db.execute(
        select(CardApproval)
        .where(CardApproval.id == approval_id)
        .options(
            selectinload(CardApproval.card),
            selectinload(CardApproval.prepared_by),
            selectinload(CardApproval.reviewed_by),
        )
    )
    return result.scalar_one_or_none()


# ──────────────────────────────────────────
# Stats helpers
# ──────────────────────────────────────────
async def get_user_approval_stats(
    db: AsyncSession,
    user_id: int,
    store_id: int | None = None,
) -> dict:
    """Fixes total, fixes today, pending approvals, approved count."""
    today = date.today()

    # Total fixes (issues fixed by this user)
    total_q = select(func.count()).select_from(CardIssue).where(CardIssue.fixed_by_id == user_id)
    if store_id is not None:
        total_q = total_q.join(Card).where(Card.store_id == store_id)
    total_r = await db.execute(total_q)
    fixes_total = total_r.scalar() or 0

    # Fixes today
    today_q = select(func.count()).select_from(CardIssue).where(
        CardIssue.fixed_by_id == user_id,
        func.date(CardIssue.fixed_at) == today,
    )
    if store_id is not None:
        today_q = today_q.join(Card).where(Card.store_id == store_id)
    today_r = await db.execute(today_q)
    fixes_today = today_r.scalar() or 0

    # Approvals this user prepared — pending
    pending_q = select(func.count()).select_from(CardApproval).where(
        CardApproval.prepared_by_id == user_id,
        CardApproval.status == ApprovalStatus.PENDING,
    )
    if store_id is not None:
        pending_q = pending_q.where(CardApproval.store_id == store_id)
    pend_r = await db.execute(pending_q)
    approvals_pending = pend_r.scalar() or 0

    # Approved
    approved_q = select(func.count()).select_from(CardApproval).where(
        CardApproval.prepared_by_id == user_id,
        CardApproval.status.in_([ApprovalStatus.APPROVED, ApprovalStatus.APPLIED]),
    )
    if store_id is not None:
        approved_q = approved_q.where(CardApproval.store_id == store_id)
    appr_r = await db.execute(approved_q)
    approvals_approved = appr_r.scalar() or 0

    return {
        "fixes_total": fixes_total,
        "fixes_today": fixes_today,
        "approvals_pending": approvals_pending,
        "approvals_approved": approvals_approved,
    }
