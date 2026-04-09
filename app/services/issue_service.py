import json
from datetime import datetime
from typing import Any, Iterable, List, Optional
from sqlalchemy import and_, func, not_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..core.time import utc_now
from ..models import Card, CardIssue, IssueSeverity, IssueStatus, IssueCategory

MEDIA_QUEUE_CODES = {"no_photos", "few_photos", "add_more_photos", "no_video"}


def _enum_value(value: Any) -> str:
    return str(value.value if hasattr(value, "value") else value or "").strip().lower()


def is_media_issue_like(
    code: Any,
    category: Any,
    field_path: Any,
) -> bool:
    normalized_code = str(code or "").strip().lower()
    normalized_category = _enum_value(category)
    normalized_field_path = str(field_path or "").strip().lower()
    return (
        normalized_code in MEDIA_QUEUE_CODES
        or normalized_category in {IssueCategory.PHOTOS.value, IssueCategory.VIDEO.value}
        or normalized_field_path.startswith("photos")
        or normalized_field_path.startswith("videos")
    )


def is_dedicated_media_issue_like(
    code: Any,
    category: Any,
    field_path: Any,
    severity: Any,
) -> bool:
    return _enum_value(severity) != IssueSeverity.CRITICAL.value and is_media_issue_like(code, category, field_path)


def is_dedicated_media_issue(issue: Any) -> bool:
    return is_dedicated_media_issue_like(
        getattr(issue, "code", None),
        getattr(issue, "category", None),
        getattr(issue, "field_path", None),
        getattr(issue, "severity", None),
    )


def dedicated_media_issue_filter() -> Any:
    media_match = or_(
        CardIssue.code.in_(tuple(MEDIA_QUEUE_CODES)),
        CardIssue.category.in_((IssueCategory.PHOTOS, IssueCategory.VIDEO)),
        CardIssue.field_path.like("photos%"),
        CardIssue.field_path.like("videos%"),
    )
    return and_(CardIssue.severity != IssueSeverity.CRITICAL, media_match)


def non_dedicated_media_issue_filter() -> Any:
    return not_(dedicated_media_issue_filter())


def calculate_visible_issue_counts(issues: Iterable[Any]) -> dict[str, int]:
    counts = {
        IssueSeverity.CRITICAL.value: 0,
        IssueSeverity.WARNING.value: 0,
        IssueSeverity.IMPROVEMENT.value: 0,
    }
    for issue in issues:
        severity = _enum_value(getattr(issue, "severity", None))
        if severity not in counts:
            continue
        if is_dedicated_media_issue(issue):
            continue
        counts[severity] += 1
    return counts


def calculate_visible_issue_counts_from_rows(rows: Iterable[tuple[Any, Any, Any, Any, int]]) -> dict[str, int]:
    counts = {
        IssueSeverity.CRITICAL.value: 0,
        IssueSeverity.WARNING.value: 0,
        IssueSeverity.IMPROVEMENT.value: 0,
    }
    for severity, code, category, field_path, count in rows:
        normalized_severity = _enum_value(severity)
        if normalized_severity not in counts:
            continue
        if is_dedicated_media_issue_like(code, category, field_path, severity):
            continue
        counts[normalized_severity] += int(count or 0)
    return counts


def _extract_compound_fixes(error_details: list) -> list:
    """Return list of compound fix instructions from error_details."""
    for d in (error_details or []):
        if d.get("type") == "compound" or d.get("fix_action") == "compound":
            return d.get("fixes", [])
    return []


async def _apply_compound_fixes(
    db: AsyncSession,
    card_id: int,
    fixes: list,
    user_id: int,
) -> None:
    """Auto-create or auto-fix linked CardIssue records for compound fixes."""
    now = utc_now()
    for fix in fixes:
        field_path = fix.get("field_path")
        if not field_path:
            name = str(fix.get("name") or "").strip()
            lower = name.lower()
            if lower in {"title", "название", "наименование"}:
                field_path = "title"
            elif lower in {"description", "описание"}:
                field_path = "description"
            else:
                field_path = f"characteristics.{name}"
        action = fix.get("action", "set")
        raw_value = fix.get("value") if action != "clear" else "__CLEAR__"
        # Serialize lists as JSON so they can be round-tripped properly
        if isinstance(raw_value, list):
            value = json.dumps(raw_value, ensure_ascii=False)
        else:
            value = raw_value

        # Find an existing PENDING issue for this field
        result = await db.execute(
            select(CardIssue).where(
                CardIssue.card_id == card_id,
                CardIssue.field_path == field_path,
                CardIssue.status == IssueStatus.PENDING,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.status = IssueStatus.FIXED
            existing.fixed_value = value
            existing.fixed_at = now
            existing.fixed_by_id = user_id
            existing.updated_at = now
        else:
            # Create a synthetic FIXED issue so apply_all picks it up
            synthetic = CardIssue(
                card_id=card_id,
                code="compound_fix",
                severity=IssueSeverity.CRITICAL,
                category=IssueCategory.CHARACTERISTICS,
                title=f"Автоисправление: {fix.get('name', field_path)}",
                description="Автоматически исправлено как часть составного исправления",
                field_path=field_path,
                charc_id=fix.get("charc_id", fix.get("charcId")),
                fixed_value=value,
                status=IssueStatus.FIXED,
                fixed_at=now,
                fixed_by_id=user_id,
                updated_at=now,
                source="compound",
            )
            db.add(synthetic)


async def get_issue_by_id(db: AsyncSession, issue_id: int) -> Optional[CardIssue]:
    result = await db.execute(
        select(CardIssue)
        .options(selectinload(CardIssue.card))
        .where(CardIssue.id == issue_id)
    )
    return result.scalar_one_or_none()


async def get_card_issues(
    db: AsyncSession,
    card_id: int,
    status: Optional[IssueStatus] = None,
    severity: Optional[IssueSeverity] = None,
) -> List[CardIssue]:
    query = select(CardIssue).where(CardIssue.card_id == card_id)
    
    if status:
        query = query.where(CardIssue.status == status)
    if severity:
        query = query.where(CardIssue.severity == severity)
    
    query = query.order_by(
        CardIssue.severity.asc(),  # Critical first
        CardIssue.score_impact.desc()
    )
    
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_store_issues(
    db: AsyncSession,
    store_id: int,
    card_id: Optional[int] = None,
    status: Optional[IssueStatus] = None,
    severity: Optional[IssueSeverity] = None,
    category: Optional[str] = None,
    dedicated_media: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[List[CardIssue], int]:
    """Get all issues for a store with filters"""
    base_filter = (
        select(CardIssue)
        .join(Card)
        .where(Card.store_id == store_id)
    )
    count_filter = (
        select(func.count(CardIssue.id))
        .join(Card)
        .where(Card.store_id == store_id)
    )

    if card_id is not None:
        base_filter = base_filter.where(CardIssue.card_id == card_id)
        count_filter = count_filter.where(CardIssue.card_id == card_id)
    
    if status:
        base_filter = base_filter.where(CardIssue.status == status)
        count_filter = count_filter.where(CardIssue.status == status)
    
    if severity:
        base_filter = base_filter.where(CardIssue.severity == severity)
        count_filter = count_filter.where(CardIssue.severity == severity)

    if category:
        base_filter = base_filter.where(CardIssue.category == category)
        count_filter = count_filter.where(CardIssue.category == category)

    if dedicated_media is True:
        media_filter = dedicated_media_issue_filter()
        base_filter = base_filter.where(media_filter)
        count_filter = count_filter.where(media_filter)
    elif dedicated_media is False:
        non_media_filter = non_dedicated_media_issue_filter()
        base_filter = base_filter.where(non_media_filter)
        count_filter = count_filter.where(non_media_filter)
    
    # Get total count
    total_result = await db.execute(count_filter)
    total = total_result.scalar() or 0
    
    # Get paginated results
    query = (
        base_filter
        .options(selectinload(CardIssue.card))
        .order_by(CardIssue.severity.asc(), CardIssue.score_impact.desc())
        .offset(skip)
        .limit(limit)
    )
    
    result = await db.execute(query)
    issues = list(result.scalars().all())
    
    return issues, total


async def get_issues_grouped(
    db: AsyncSession, 
    store_id: int,
    limit_per_group: int = 30,  # Limit per severity group
) -> dict:
    """Get issues grouped by severity — includes PENDING and SKIPPED issues.
    
    Args:
        db: Database session
        store_id: Store ID
        limit_per_group: Max issues to return per group (default 30)
    """
    result = {
        "critical": [],
        "warnings": [],
        "improvements": [],
        "media": [],
        "postponed": [],
        "critical_count": 0,
        "warnings_count": 0,
        "improvements_count": 0,
        "media_count": 0,
        "postponed_count": 0,
    }

    # PENDING + SKIPPED issues grouped by severity
    for severity, key in [
        (IssueSeverity.CRITICAL, "critical"),
        (IssueSeverity.WARNING, "warnings"),
        (IssueSeverity.IMPROVEMENT, "improvements"),
    ]:
        # Pending first, then skipped (so skipped appear at the end of each group)
        pending, p_count = await get_store_issues(
            db, store_id,
            status=IssueStatus.PENDING,
            severity=severity,
            dedicated_media=False,
            limit=limit_per_group
        )
        skipped, s_count = await get_store_issues(
            db, store_id,
            status=IssueStatus.SKIPPED,
            severity=severity,
            dedicated_media=False,
            limit=max(0, limit_per_group - len(pending))  # Fill remaining space
        )
        result[key] = list(pending) + list(skipped)
        result[f"{key}_count"] = p_count + s_count

    media_pending, media_pending_count = await get_store_issues(
        db,
        store_id,
        status=IssueStatus.PENDING,
        dedicated_media=True,
        limit=limit_per_group,
    )
    media_skipped, media_skipped_count = await get_store_issues(
        db,
        store_id,
        status=IssueStatus.SKIPPED,
        dedicated_media=True,
        limit=max(0, limit_per_group - len(media_pending)),
    )
    result["media"] = list(media_pending) + list(media_skipped)
    result["media_count"] = media_pending_count + media_skipped_count

    # Postponed issues
    postponed, postponed_count = await get_store_issues(
        db, store_id,
        status=IssueStatus.POSTPONED,
        limit=limit_per_group
    )
    result["postponed"] = postponed
    result["postponed_count"] = postponed_count

    return result


async def fix_issue(
    db: AsyncSession,
    issue: CardIssue,
    fixed_value: str,
    user_id: int,
) -> CardIssue:
    """Mark issue as fixed, and auto-apply any compound linked fixes."""
    issue.status = IssueStatus.FIXED
    issue.fixed_value = fixed_value
    issue.fixed_at = utc_now()
    issue.fixed_by_id = user_id
    issue.updated_at = utc_now()

    # Apply all compound/linked field fixes automatically
    compound_fixes = _extract_compound_fixes(issue.error_details)
    if compound_fixes:
        await _apply_compound_fixes(db, issue.card_id, compound_fixes, user_id)

    await db.commit()
    await db.refresh(issue)
    
    # Update card counts
    await _update_card_issue_counts(db, issue.card_id)
    
    return issue


async def skip_issue(
    db: AsyncSession,
    issue: CardIssue,
    reason: Optional[str] = None,
) -> CardIssue:
    """Mark issue as skipped"""
    issue.status = IssueStatus.SKIPPED
    issue.postpone_reason = reason
    issue.updated_at = utc_now()
    
    await db.commit()
    await db.refresh(issue)
    
    await _update_card_issue_counts(db, issue.card_id)
    
    return issue


async def unskip_issue(
    db: AsyncSession,
    issue: CardIssue,
) -> CardIssue:
    """Reset a skipped issue back to pending so it can be fixed."""
    issue.status = IssueStatus.PENDING
    issue.postpone_reason = None
    issue.updated_at = utc_now()

    await db.commit()
    await db.refresh(issue)

    await _update_card_issue_counts(db, issue.card_id)

    return issue


async def postpone_issue(
    db: AsyncSession,
    issue: CardIssue,
    until: Optional[datetime] = None,
    reason: Optional[str] = None,
) -> CardIssue:
    """Mark issue as postponed"""
    issue.status = IssueStatus.POSTPONED
    issue.postponed_until = until
    issue.postpone_reason = reason
    issue.updated_at = utc_now()
    
    await db.commit()
    await db.refresh(issue)
    
    await _update_card_issue_counts(db, issue.card_id)
    
    return issue


async def _update_card_issue_counts(db: AsyncSession, card_id: int) -> None:
    """Update issue counts on card after status change"""
    pending_counts = await db.execute(
        select(
            CardIssue.severity,
            CardIssue.code,
            CardIssue.category,
            CardIssue.field_path,
            func.count(CardIssue.id),
        ).where(
            CardIssue.card_id == card_id,
            CardIssue.status == IssueStatus.PENDING
        )
        .group_by(CardIssue.severity, CardIssue.code, CardIssue.category, CardIssue.field_path)
    )
    counts = calculate_visible_issue_counts_from_rows(pending_counts.all())
    
    await db.execute(
        update(Card)
        .where(Card.id == card_id)
        .values(
            critical_issues_count=counts[IssueSeverity.CRITICAL.value],
            warnings_count=counts[IssueSeverity.WARNING.value],
            improvements_count=counts[IssueSeverity.IMPROVEMENT.value],
        )
    )
    await db.commit()


async def get_issue_stats(db: AsyncSession, store_id: int) -> dict:
    """Get issue statistics for a store"""
    # Total counts by status
    stats = {
        "total": 0,
        "pending": 0,
        "fixed": 0,
        "skipped": 0,
        "postponed": 0,
        "by_severity": {},
        "by_category": {},
        "potential_score_gain": 0,
    }
    
    # Count by status
    for status in IssueStatus:
        result = await db.execute(
            select(func.count(CardIssue.id))
            .join(Card)
            .where(Card.store_id == store_id, CardIssue.status == status)
        )
        count = result.scalar() or 0
        stats[status.value] = count
        stats["total"] += count
    
    # Count by severity (pending only)
    for severity in IssueSeverity:
        extra_conditions = []
        if severity in {IssueSeverity.WARNING, IssueSeverity.IMPROVEMENT}:
            extra_conditions.append(non_dedicated_media_issue_filter())
        result = await db.execute(
            select(func.count(CardIssue.id))
            .join(Card)
            .where(
                Card.store_id == store_id,
                CardIssue.severity == severity,
                CardIssue.status == IssueStatus.PENDING,
                *extra_conditions,
            )
        )
        stats["by_severity"][severity.value] = result.scalar() or 0
    
    # Potential score gain
    result = await db.execute(
        select(func.sum(CardIssue.score_impact))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.status == IssueStatus.PENDING
        )
    )
    stats["potential_score_gain"] = result.scalar() or 0
    
    return stats


async def get_next_issue(
    db: AsyncSession,
    store_id: int,
    after_issue_id: Optional[int] = None,
    card_id: Optional[int] = None,
    severity: Optional[str] = None,
) -> Optional[CardIssue]:
    """
    Get next pending issue in the queue for sequential fixing.
    If card_id is provided, returns only issues for that specific card.
    If severity provided, filters by that severity only.
    Otherwise orders by card priority (cards with critical issues first),
    then by severity/score_impact within the card.
    """
    conditions = [
        Card.store_id == store_id,
        CardIssue.status == IssueStatus.PENDING,
    ]

    if card_id is not None:
        conditions.append(CardIssue.card_id == card_id)

    if after_issue_id is not None:
        conditions.append(CardIssue.id > after_issue_id)

    if severity:
        if severity == "media":
            conditions.append(dedicated_media_issue_filter())
        else:
            try:
                conditions.append(CardIssue.severity == IssueSeverity(severity))
                if severity in {IssueSeverity.WARNING.value, IssueSeverity.IMPROVEMENT.value}:
                    conditions.append(non_dedicated_media_issue_filter())
            except ValueError:
                pass

    query = (
        select(CardIssue)
        .join(Card)
        .options(selectinload(CardIssue.card))
        .where(*conditions)
        .order_by(
            CardIssue.severity.asc(),  # CRITICAL=0 first
            CardIssue.score_impact.desc(),
            CardIssue.id.asc(),
        )
        .limit(1)
    )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_card_pending_count(
    db: AsyncSession,
    card_id: int,
) -> int:
    """Count pending issues for a specific card."""
    result = await db.execute(
        select(func.count(CardIssue.id)).where(
            CardIssue.card_id == card_id,
            CardIssue.status == IssueStatus.PENDING,
        )
    )
    return result.scalar() or 0


async def get_fixed_issues_for_store(
    db: AsyncSession,
    store_id: int,
) -> List[CardIssue]:
    """Get all fixed issues for a store (ready to apply to WB)"""
    result = await db.execute(
        select(CardIssue)
        .join(Card)
        .options(selectinload(CardIssue.card))
        .where(
            Card.store_id == store_id,
            CardIssue.status == IssueStatus.FIXED,
        )
        .order_by(CardIssue.card_id, CardIssue.id)
    )
    return list(result.scalars().all())


async def get_queue_progress(db: AsyncSession, store_id: int, severity: Optional[str] = None) -> dict:
    """Get progress of issue fixing queue, optionally filtered by severity."""
    severity_filter = []
    if severity:
        if severity == "media":
            severity_filter = [dedicated_media_issue_filter()]
        else:
            try:
                severity_filter = [CardIssue.severity == IssueSeverity(severity)]
                if severity in {IssueSeverity.WARNING.value, IssueSeverity.IMPROVEMENT.value}:
                    severity_filter.append(non_dedicated_media_issue_filter())
            except ValueError:
                pass

    # Total pending
    pending_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.status == IssueStatus.PENDING,
            *severity_filter,
        )
    )
    pending = pending_result.scalar() or 0
    
    # Total fixed
    fixed_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.status == IssueStatus.FIXED,
            *severity_filter,
        )
    )
    fixed = fixed_result.scalar() or 0
    
    # Total skipped
    skipped_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.status == IssueStatus.SKIPPED,
            *severity_filter,
        )
    )
    skipped = skipped_result.scalar() or 0
    
    # Total postponed
    postponed_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.status == IssueStatus.POSTPONED,
            *severity_filter,
        )
    )
    postponed = postponed_result.scalar() or 0
    
    total = pending + fixed + skipped + postponed
    
    return {
        "total": total,
        "pending": pending,
        "fixed": fixed,
        "skipped": skipped,
        "postponed": postponed,
        "progress_percent": round((fixed + skipped) / total * 100, 1) if total > 0 else 0,
    }


async def mark_applied_to_wb(
    db: AsyncSession,
    issue_ids: List[int],
) -> int:
    """Mark issues as applied to WB (update status to auto_fixed)"""
    if not issue_ids:
        return 0
    await db.execute(
        update(CardIssue)
        .where(CardIssue.id.in_(issue_ids))
        .values(
            status=IssueStatus.AUTO_FIXED,
            updated_at=utc_now(),
        )
    )
    await db.commit()
    return len(issue_ids)
