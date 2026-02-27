"""
Team management & card approval endpoints.
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from ..core.database import get_db
from ..core.security import (
    get_current_user, require_permission,
)
from ..models import (
    User, UserRole, Store, CardApproval, ApprovalStatus,
    CardIssue, IssueStatus, Card, get_user_permissions,
    ROLE_PERMISSIONS, Permission, PERMISSION_LABELS, PERMISSION_GROUPS,
)
from ..schemas.approval import (
    ApprovalOut, ApprovalSubmitRequest, ApprovalReviewRequest,
    ApprovalListOut, TeamMemberOut, TeamMemberUpdate,
    TeamInviteRequest, RoleInfo, PermissionInfo, PermissionsListOut,
)
from ..services import get_store_by_id, update_store_stats
from ..services.approval_service import (
    submit_for_review, review_approval,
    get_store_approvals, get_approval_by_id,
    get_user_approval_stats, mark_approval_applied,
)
from ..services.issue_service import get_fixed_issues_for_store, mark_applied_to_wb

router = APIRouter(prefix="/stores/{store_id}/team", tags=["Team & Approvals"])


# ──────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────
async def get_user_store(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Store:
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    # Admin / owner can always access
    if current_user.role not in ("admin",) and store.owner_id != current_user.id:
        # Check if user has any role that grants access to this store
        # For now all users in the system can access stores they're linked to
        pass
    return store


def _approval_to_out(a: CardApproval) -> ApprovalOut:
    return ApprovalOut(
        id=a.id,
        store_id=a.store_id,
        card_id=a.card_id,
        prepared_by_id=a.prepared_by_id,
        reviewed_by_id=a.reviewed_by_id,
        status=a.status.value if hasattr(a.status, "value") else a.status,
        changes=a.changes or [],
        total_fixes=a.total_fixes or 0,
        submit_note=a.submit_note,
        reviewer_comment=a.reviewer_comment,
        created_at=a.created_at,
        reviewed_at=a.reviewed_at,
        applied_at=a.applied_at,
        prepared_by_name=a.prepared_by.full_name if a.prepared_by else None,
        reviewed_by_name=a.reviewed_by.full_name if a.reviewed_by else None,
        card_title=a.card.title if a.card else None,
        card_nm_id=a.card.nm_id if a.card else None,
        card_vendor_code=a.card.vendor_code if a.card else None,
        card_photo=(a.card.photos[0] if a.card and a.card.photos else None),
    )


# ====================================================
# ROLES INFO
# ====================================================
@router.get("/roles", response_model=List[RoleInfo])
async def list_roles(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List available roles and their permissions."""
    role_meta = {
        "owner": ("Владелец", "Полный доступ, управление командой"),
        "head_manager": ("Старший менеджер", "Проверяет и утверждает карточки, полный доступ к редактированию"),
        "manager": ("Менеджер", "Исправляет ошибки, готовит карточки на проверку"),
        "viewer": ("Наблюдатель", "Только просмотр дашборда и карточек"),
    }

    # Count users per role
    counts_r = await db.execute(
        select(User.role, func.count())
        .where(User.is_active == True)
        .group_by(User.role)
    )
    counts = {r: c for r, c in counts_r.all()}

    result = []
    for role_id, (name, desc) in role_meta.items():
        perms = get_user_permissions(role_id)
        result.append(RoleInfo(
            id=role_id,
            name=name,
            description=desc,
            permissions=perms,
            user_count=counts.get(role_id, 0) + counts.get(UserRole(role_id) if role_id in [e.value for e in UserRole] else None, 0),
        ))
    return result


# ====================================================
# TEAM MEMBERS
# ====================================================
@router.get("/members", response_model=List[TeamMemberOut])
async def list_team_members(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("team.view", "team.manage")
    ),
):
    """List all team members with their activity stats."""
    users_r = await db.execute(
        select(User).where(
            User.is_active == True,
            User.role != UserRole.ADMIN
        ).order_by(User.created_at.desc())
    )
    users = list(users_r.scalars().all())

    result = []
    for u in users:
        stats = await get_user_approval_stats(db, u.id)
        result.append(TeamMemberOut(
            id=u.id,
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            role=u.role.value if hasattr(u.role, "value") else u.role,
            is_active=u.is_active,
            last_login=u.last_login,
            created_at=u.created_at,
            custom_permissions=u.custom_permissions,
            permissions=u.permissions,
            **stats,
        ))
    return result


@router.patch("/members/{user_id}", response_model=TeamMemberOut)
async def update_team_member(
    user_id: int,
    data: TeamMemberUpdate,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("team.manage")),
):
    """Update a team member's role or active status (owner/admin only)."""
    target_r = await db.execute(select(User).where(User.id == user_id))
    target = target_r.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot modify your own role")

    if data.role is not None:
        try:
            target.role = UserRole(data.role)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid role: {data.role}")

    if data.is_active is not None:
        target.is_active = data.is_active

    # Custom permissions: list of permission strings or None to reset
    if data.custom_permissions is not None:
        if len(data.custom_permissions) == 0:
            target.custom_permissions = None  # Reset to role defaults
        else:
            # Validate permissions
            valid = {p.value for p in Permission}
            invalid = [p for p in data.custom_permissions if p not in valid]
            if invalid:
                raise HTTPException(status_code=400, detail=f"Invalid permissions: {invalid}")
            target.custom_permissions = data.custom_permissions

    target.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(target)

    stats = await get_user_approval_stats(db, target.id)
    return TeamMemberOut(
        id=target.id,
        email=target.email,
        first_name=target.first_name,
        last_name=target.last_name,
        role=target.role.value if hasattr(target.role, "value") else target.role,
        is_active=target.is_active,
        last_login=target.last_login,
        created_at=target.created_at,
        custom_permissions=target.custom_permissions,
        permissions=target.permissions,
        **stats,
    )


@router.post("/invite", status_code=201)
async def invite_team_member(
    data: TeamInviteRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("team.manage")),
):
    """Invite a new team member via email link (no password required)."""
    import secrets
    from datetime import timedelta
    from ..models.invite import UserInvite
    from ..services.email_service import send_invite_email
    from ..core.config import settings

    existing = await db.execute(select(User).where(User.email == data.email, User.is_active == True))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User with this email already exists")

    try:
        UserRole(data.role) if data.role != "custom" else None
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {data.role}")

    # Validate custom permissions
    effective_role = data.role if data.role != "custom" else "manager"
    custom_perms = None
    if data.custom_permissions:
        valid = {p.value for p in Permission}
        invalid = [p for p in data.custom_permissions if p not in valid]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Invalid permissions: {invalid}")
        custom_perms = data.custom_permissions

    # Expire old unused invites for this email
    old_invites = await db.execute(
        select(UserInvite).where(
            UserInvite.email == data.email,
            UserInvite.is_used == False,
        )
    )
    for inv in old_invites.scalars().all():
        inv.is_used = True

    invite = UserInvite(
        token=secrets.token_urlsafe(48),
        email=data.email,
        role=effective_role,
        custom_permissions=custom_perms,
        first_name=data.first_name,
        store_id=store.id,
        invited_by_id=current_user.id,
        expires_at=datetime.utcnow() + timedelta(hours=72),
    )
    db.add(invite)
    await db.commit()

    invite_link = f"{settings.FRONTEND_URL}/accept-invite?token={invite.token}"
    role_labels = {
        "owner": "Владелец", "head_manager": "Старший менеджер",
        "manager": "Менеджер", "viewer": "Наблюдатель",
    }
    send_invite_email(
        to_email=data.email,
        invite_link=invite_link,
        inviter_name=current_user.full_name,
        role_label=role_labels.get(effective_role, effective_role),
        store_name=store.wb_supplier_name or store.name,
        company_name="AVEMOD",
    )

    return {"message": "Invitation sent", "email": data.email}


# ====================================================
# APPROVALS
# ====================================================
@router.get("/approvals", response_model=ApprovalListOut)
async def list_approvals(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    """List card approvals for a store."""
    skip = (page - 1) * limit
    st = ApprovalStatus(status_filter) if status_filter else None
    # Managers without approve permission only see their own submissions
    only_mine = not current_user.has_permission("cards.approve")
    user_id = current_user.id if only_mine else None
    items, total = await get_store_approvals(db, store.id, st, skip, limit, user_id=user_id)
    return ApprovalListOut(
        items=[_approval_to_out(a) for a in items],
        total=total,
    )


@router.post("/approvals/submit", response_model=ApprovalOut, status_code=201)
async def submit_card_for_review(
    data: ApprovalSubmitRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("issues.fix")),
):
    """
    Submit a card's fixed issues for Head-Manager review.
    Creates an approval request with a snapshot of all changes.
    """
    try:
        approval = await submit_for_review(
            db, store.id, data.card_id, current_user.id, data.note
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Re-fetch with relationships
    full = await get_approval_by_id(db, approval.id)
    return _approval_to_out(full)


@router.post("/approvals/{approval_id}/review", response_model=ApprovalOut)
async def review_card_approval(
    approval_id: int,
    data: ApprovalReviewRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.approve")),
):
    """
    Approve or reject a card approval (Head-Manager / Owner only).
    """
    if data.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")

    try:
        approval = await review_approval(
            db, approval_id, current_user.id, data.action, data.comment
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    full = await get_approval_by_id(db, approval.id)
    return _approval_to_out(full)


@router.post("/approvals/{approval_id}/apply", response_model=ApprovalOut)
async def apply_approved_to_wb(
    approval_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    """
    Apply an approved card's fixes to WB.
    Only approved approvals can be applied.
    """
    approval = await get_approval_by_id(db, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.status != ApprovalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Approval must be in 'approved' status")

    # Build WB update from the card's fixed issues
    from ..services.wb_api import WildberriesAPI

    issue_ids = [c["issue_id"] for c in (approval.changes or []) if "issue_id" in c]

    result_r = await db.execute(
        select(CardIssue)
        .where(CardIssue.id.in_(issue_ids))
        .options(selectinload(CardIssue.card))
    )
    issues = list(result_r.scalars().all())

    if not issues:
        raise HTTPException(status_code=400, detail="No issues to apply")

    card = issues[0].card
    raw = card.raw_data or {}
    characteristics = raw.get("characteristics", [])

    for issue in issues:
        if issue.field_path and issue.field_path.startswith("characteristics.") and issue.fixed_value:
            char_name = issue.field_path.replace("characteristics.", "")
            for ch in characteristics:
                if ch.get("name") == char_name or str(ch.get("id")) == str(issue.charc_id):
                    import json as _json
                    try:
                        val = _json.loads(issue.fixed_value)
                        ch["value"] = val if isinstance(val, list) else [str(val)]
                    except (_json.JSONDecodeError, TypeError):
                        ch["value"] = [issue.fixed_value]
                    break

    update_payload = {
        "nmID": card.nm_id,
        "vendorCode": card.vendor_code or "",
        "characteristics": characteristics,
    }
    for issue in issues:
        if issue.field_path == "title" and issue.fixed_value:
            update_payload["title"] = issue.fixed_value
        elif issue.field_path == "description" and issue.fixed_value:
            update_payload["description"] = issue.fixed_value

    wb_api = WildberriesAPI(store.api_key)
    wb_result = await wb_api.update_card(update_payload)

    if wb_result.get("success"):
        await mark_applied_to_wb(db, [i.id for i in issues])
        await mark_approval_applied(db, approval_id)
        await update_store_stats(db, store.id)
    else:
        error_msg = wb_result.get("error", "Unknown WB error")
        raise HTTPException(status_code=502, detail=f"WB API error: {error_msg}")

    full = await get_approval_by_id(db, approval.id)
    return _approval_to_out(full)


@router.delete("/approvals/{approval_id}", status_code=204)
async def cancel_card_approval(
    approval_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("issues.fix")),
):
    """
    Cancel a pending approval (only submitter can cancel, only if still pending).
    """
    approval = await get_approval_by_id(db, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.prepared_by_id != current_user.id and not current_user.has_permission("cards.approve"):
        raise HTTPException(status_code=403, detail="Not your approval")
    if approval.status != ApprovalStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending approvals can be cancelled")
    await db.delete(approval)
    await db.commit()


# ====================================================
# PERMISSIONS LIST
# ====================================================
@router.get("/permissions", response_model=PermissionsListOut)
async def list_permissions(
    store: Store = Depends(get_user_store),
    current_user: User = Depends(require_permission("team.manage")),
):
    """Return all available permissions with labels and groups."""
    perms = []
    for group_name, perm_ids in PERMISSION_GROUPS.items():
        for pid in perm_ids:
            perms.append(PermissionInfo(
                id=pid,
                label=PERMISSION_LABELS.get(pid, pid),
                group=group_name,
            ))
    return PermissionsListOut(permissions=perms, groups=PERMISSION_GROUPS)


# ====================================================
# TEAM ACTIVITY (for workspace widget)
# ====================================================
@router.get("/activity")
async def team_activity(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return team activity summary for workspace dashboard."""
    from datetime import timedelta
    from sqlalchemy import func as sqlfunc

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())

    # Get active non-admin users linked to this store
    users_r = await db.execute(
        select(User).where(
            User.is_active == True,
            User.role != UserRole.ADMIN,
            (User.store_id == store.id) | (User.id == store.owner_id),
        )
    )
    users = list(users_r.scalars().all())
    user_ids = [u.id for u in users]

    # Fixes by user (this week)
    fixes_week = await db.execute(
        select(CardIssue.fixed_by_id, func.count())
        .where(
            CardIssue.status == IssueStatus.FIXED,
            CardIssue.fixed_at >= week_start,
        )
        .group_by(CardIssue.fixed_by_id)
    )
    fixes_map = {uid: cnt for uid, cnt in fixes_week.all() if uid}

    # Fixes today
    fixes_today_r = await db.execute(
        select(CardIssue.fixed_by_id, func.count())
        .where(
            CardIssue.status == IssueStatus.FIXED,
            CardIssue.fixed_at >= today_start,
        )
        .group_by(CardIssue.fixed_by_id)
    )
    fixes_today_map = {uid: cnt for uid, cnt in fixes_today_r.all() if uid}

    # All-time fixes per user
    fixes_all_r = await db.execute(
        select(CardIssue.fixed_by_id, func.count())
        .where(CardIssue.status.in_([IssueStatus.FIXED, IssueStatus.AUTO_FIXED]))
        .group_by(CardIssue.fixed_by_id)
    )
    fixes_all_map = {uid: cnt for uid, cnt in fixes_all_r.all() if uid}

    # Work session today: first and last fix time per user
    work_today_r = await db.execute(
        select(
            CardIssue.fixed_by_id,
            sqlfunc.min(CardIssue.fixed_at).label("work_start"),
            sqlfunc.max(CardIssue.fixed_at).label("work_end"),
        )
        .where(
            CardIssue.fixed_by_id.in_(user_ids),
            CardIssue.status == IssueStatus.FIXED,
            CardIssue.fixed_at >= today_start,
        )
        .group_by(CardIssue.fixed_by_id)
    )
    work_today_map = {uid: (ws, we) for uid, ws, we in work_today_r.all() if uid}

    # Last fixed issue description per user (for "last action")
    last_action_r = await db.execute(
        select(CardIssue.fixed_by_id, CardIssue.title, CardIssue.fixed_at)
        .where(
            CardIssue.fixed_by_id.in_(user_ids),
            CardIssue.status == IssueStatus.FIXED,
        )
        .order_by(CardIssue.fixed_at.desc())
    )
    last_action_map: dict = {}
    for uid, title, fixed_at in last_action_r.all():
        if uid not in last_action_map:
            last_action_map[uid] = {"title": title, "at": fixed_at.isoformat() if fixed_at else None}

    # Approvals pending
    pending_r = await db.execute(
        select(func.count())
        .where(
            CardApproval.store_id == store.id,
            CardApproval.status == ApprovalStatus.PENDING,
        )
    )
    pending_count = pending_r.scalar() or 0

    # Total issues stats for this store
    total_issues = await db.execute(
        select(CardIssue.status, func.count())
        .join(CardIssue.card)
        .where(CardIssue.card.has(store_id=store.id))
        .group_by(CardIssue.status)
    )
    issues_by_status = {s.value if hasattr(s, 'value') else s: c for s, c in total_issues.all()}

    # Store score stats
    avg_score_r = await db.execute(
        select(func.avg(Card.score)).where(Card.store_id == store.id)
    )
    avg_score = round(avg_score_r.scalar() or 0, 1)

    total_issues_count = sum(issues_by_status.values())
    fixed_count = issues_by_status.get("fixed", 0) + issues_by_status.get("auto_fixed", 0)
    pending_issues_count = issues_by_status.get("pending", 0)
    completion_pct = round(fixed_count / total_issues_count * 100, 1) if total_issues_count else 0

    # Build per-user activity
    members_activity = []
    max_fixes = max((fixes_map.get(u.id, 0) for u in users), default=1) or 1
    for u in users:
        role_val = u.role.value if hasattr(u.role, 'value') else u.role
        work_start, work_end = work_today_map.get(u.id, (None, None))
        work_minutes = 0
        if work_start and work_end:
            work_minutes = max(0, int((work_end - work_start).total_seconds() / 60))
        fixes_w = fixes_map.get(u.id, 0)
        members_activity.append({
            "id": u.id,
            "name": u.full_name,
            "email": u.email,
            "role": role_val,
            "fixes_week": fixes_w,
            "fixes_today": fixes_today_map.get(u.id, 0),
            "fixes_all_time": fixes_all_map.get(u.id, 0),
            "work_start_today": work_start.isoformat() if work_start else None,
            "work_end_today": work_end.isoformat() if work_end else None,
            "work_minutes_today": work_minutes,
            "last_action": last_action_map.get(u.id),
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "last_active_at": u.last_active_at.isoformat() if u.last_active_at else None,
            "is_online": bool(u.last_active_at and (now - u.last_active_at).total_seconds() < 120),
            "progress_pct": round(fixes_w / max_fixes * 100) if max_fixes else 0,
        })

    # Sort by weekly fixes desc
    members_activity.sort(key=lambda x: x["fixes_week"], reverse=True)

    return {
        "members": members_activity,
        "pending_approvals": pending_count,
        "issues_summary": issues_by_status,
        "total_members": len(users),
        "store_stats": {
            "avg_score": avg_score,
            "completion_pct": completion_pct,
            "total_issues": total_issues_count,
            "fixed_issues": fixed_count,
            "pending_issues": pending_issues_count,
        },
    }
