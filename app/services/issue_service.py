import json
from datetime import datetime
from typing import List, Optional
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Card, CardIssue, IssueSeverity, IssueStatus, IssueCategory


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
    now = datetime.utcnow()
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
    status: Optional[IssueStatus] = None,
    severity: Optional[IssueSeverity] = None,
    category: Optional[str] = None,
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
    
    if status:
        base_filter = base_filter.where(CardIssue.status == status)
        count_filter = count_filter.where(CardIssue.status == status)
    
    if severity:
        base_filter = base_filter.where(CardIssue.severity == severity)
        count_filter = count_filter.where(CardIssue.severity == severity)
    
    if category:
        base_filter = base_filter.where(CardIssue.category == category)
        count_filter = count_filter.where(CardIssue.category == category)
    
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
        "postponed": [],
        "critical_count": 0,
        "warnings_count": 0,
        "improvements_count": 0,
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
            limit=limit_per_group
        )
        skipped, s_count = await get_store_issues(
            db, store_id,
            status=IssueStatus.SKIPPED,
            severity=severity,
            limit=max(0, limit_per_group - len(pending))  # Fill remaining space
        )
        result[key] = list(pending) + list(skipped)
        result[f"{key}_count"] = p_count + s_count

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
    issue.fixed_at = datetime.utcnow()
    issue.fixed_by_id = user_id
    issue.updated_at = datetime.utcnow()

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
    issue.updated_at = datetime.utcnow()
    
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
    issue.updated_at = datetime.utcnow()

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
    issue.updated_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(issue)
    
    await _update_card_issue_counts(db, issue.card_id)
    
    return issue


async def _update_card_issue_counts(db: AsyncSession, card_id: int) -> None:
    """Update issue counts on card after status change"""
    # Count pending issues by severity
    critical = await db.execute(
        select(func.count(CardIssue.id)).where(
            CardIssue.card_id == card_id,
            CardIssue.severity == IssueSeverity.CRITICAL,
            CardIssue.status == IssueStatus.PENDING
        )
    )
    warnings = await db.execute(
        select(func.count(CardIssue.id)).where(
            CardIssue.card_id == card_id,
            CardIssue.severity == IssueSeverity.WARNING,
            CardIssue.status == IssueStatus.PENDING
        )
    )
    improvements = await db.execute(
        select(func.count(CardIssue.id)).where(
            CardIssue.card_id == card_id,
            CardIssue.severity == IssueSeverity.IMPROVEMENT,
            CardIssue.status == IssueStatus.PENDING
        )
    )
    
    await db.execute(
        update(Card)
        .where(Card.id == card_id)
        .values(
            critical_issues_count=critical.scalar() or 0,
            warnings_count=warnings.scalar() or 0,
            improvements_count=improvements.scalar() or 0,
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
        result = await db.execute(
            select(func.count(CardIssue.id))
            .join(Card)
            .where(
                Card.store_id == store_id,
                CardIssue.severity == severity,
                CardIssue.status == IssueStatus.PENDING
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
        try:
            conditions.append(CardIssue.severity == IssueSeverity(severity))
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
        try:
            severity_filter = [CardIssue.severity == IssueSeverity(severity)]
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
            updated_at=datetime.utcnow(),
        )
    )
    await db.commit()
    return len(issue_ids)
