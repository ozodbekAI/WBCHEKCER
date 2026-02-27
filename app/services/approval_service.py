"""
Approval service — submit / review / apply card approval workflow.
"""
from datetime import datetime, date
from typing import Optional

from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import CardApproval, ApprovalStatus, CardIssue, IssueStatus, Card, User


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
    Collect all *fixed* issues for the card and create an approval request.
    """
    # Fetch fixed issues for this card
    result = await db.execute(
        select(CardIssue)
        .where(
            CardIssue.card_id == card_id,
            CardIssue.status == IssueStatus.FIXED,
        )
        .options(selectinload(CardIssue.card))
    )
    fixed_issues = list(result.scalars().all())

    if not fixed_issues:
        raise ValueError("No fixed issues found for this card")

    # Cancel any existing pending approvals for this card
    await db.execute(
        update(CardApproval)
        .where(
            CardApproval.card_id == card_id,
            CardApproval.status == ApprovalStatus.PENDING,
        )
        .values(status=ApprovalStatus.REJECTED, reviewer_comment="Superseded by new submission")
    )

    # Build changes snapshot
    changes = []
    for issue in fixed_issues:
        changes.append({
            "issue_id": issue.id,
            "field_path": issue.field_path,
            "title": issue.title,
            "old_value": issue.current_value,
            "new_value": issue.fixed_value,
            "severity": issue.severity.value if issue.severity else None,
        })

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
    approval.reviewed_at = datetime.utcnow()
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
    approval.applied_at = datetime.utcnow()
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
) -> dict:
    """Fixes total, fixes today, pending approvals, approved count."""
    today = date.today()

    # Total fixes (issues fixed by this user)
    total_r = await db.execute(
        select(func.count()).select_from(CardIssue).where(CardIssue.fixed_by_id == user_id)
    )
    fixes_total = total_r.scalar() or 0

    # Fixes today
    today_r = await db.execute(
        select(func.count()).select_from(CardIssue).where(
            CardIssue.fixed_by_id == user_id,
            func.date(CardIssue.fixed_at) == today,
        )
    )
    fixes_today = today_r.scalar() or 0

    # Approvals this user prepared — pending
    pend_r = await db.execute(
        select(func.count()).select_from(CardApproval).where(
            CardApproval.prepared_by_id == user_id,
            CardApproval.status == ApprovalStatus.PENDING,
        )
    )
    approvals_pending = pend_r.scalar() or 0

    # Approved
    appr_r = await db.execute(
        select(func.count()).select_from(CardApproval).where(
            CardApproval.prepared_by_id == user_id,
            CardApproval.status.in_([ApprovalStatus.APPROVED, ApprovalStatus.APPLIED]),
        )
    )
    approvals_approved = appr_r.scalar() or 0

    return {
        "fixes_total": fixes_total,
        "fixes_today": fixes_today,
        "approvals_pending": approvals_pending,
        "approvals_approved": approvals_approved,
    }
