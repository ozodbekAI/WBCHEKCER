from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.security import get_current_user
from ..models import User, Store, CardIssue, IssueStatus, IssueSeverity
from ..schemas import (
    IssueOut, IssueWithCard, IssueListOut, IssuesGrouped,
    IssueFixRequest, IssueSkipRequest, IssuePostponeRequest,
    IssueStats
)
from ..schemas.issue import QueueProgress, ApplyResult
from ..services import (
    get_store_by_id, get_issue_by_id, get_card_issues,
    get_store_issues, get_issues_grouped, fix_issue,
    skip_issue, postpone_issue, get_issue_stats,
    WildberriesAPI, update_store_stats,
)
from ..services.issue_service import (
    get_next_issue, get_fixed_issues_for_store,
    get_queue_progress, mark_applied_to_wb,
)

router = APIRouter(prefix="/stores/{store_id}/issues", tags=["Issues"])


async def get_user_store(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Store:
    """Get store and verify access"""
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found"
        )
    
    if store.owner_id != current_user.id and current_user.role != "admin":
        if getattr(current_user, 'store_id', None) != store.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )

    return store


@router.get("", response_model=IssueListOut)
async def list_issues(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = None,
    category: Optional[str] = None,
):
    """Get all issues for a store"""
    skip = (page - 1) * limit
    
    # Convert string to enum if provided
    status_enum = IssueStatus(status_filter) if status_filter else None
    severity_enum = IssueSeverity(severity) if severity else None
    
    issues, total = await get_store_issues(
        db, store.id,
        status=status_enum,
        severity=severity_enum,
        category=category,
        skip=skip,
        limit=limit,
    )
    
    return IssueListOut(
        items=[IssueOut.model_validate(i) for i in issues],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/grouped", response_model=IssuesGrouped)
async def get_grouped_issues(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get issues grouped by severity"""
    grouped = await get_issues_grouped(db, store.id)
    
    def issue_to_dict(issue: CardIssue) -> IssueWithCard:
        return IssueWithCard(
            id=issue.id,
            card_id=issue.card_id,
            code=issue.code,
            severity=issue.severity.value,
            category=issue.category.value,
            title=issue.title,
            description=issue.description,
            current_value=issue.current_value,
            suggested_value=issue.suggested_value,
            alternatives=issue.alternatives or [],
            charc_id=issue.charc_id,
            allowed_values=issue.allowed_values or [],
            error_details=issue.error_details or [],
            ai_suggested_value=issue.ai_suggested_value,
            ai_reason=issue.ai_reason,
            ai_alternatives=issue.ai_alternatives or [],
            source=issue.source,
            score_impact=issue.score_impact,
            status=issue.status.value,
            fixed_value=issue.fixed_value,
            fixed_at=issue.fixed_at,
            created_at=issue.created_at,
            card_nm_id=issue.card.nm_id,
            card_title=issue.card.title,
            card_vendor_code=issue.card.vendor_code,
            card_photos=issue.card.photos[:3] if issue.card.photos else [],
        )
    
    return IssuesGrouped(
        critical=[issue_to_dict(i) for i in grouped["critical"]],
        warnings=[issue_to_dict(i) for i in grouped["warnings"]],
        improvements=[issue_to_dict(i) for i in grouped["improvements"]],
        postponed=[issue_to_dict(i) for i in grouped["postponed"]],
        critical_count=grouped["critical_count"],
        warnings_count=grouped["warnings_count"],
        improvements_count=grouped["improvements_count"],
        postponed_count=grouped["postponed_count"],
    )


@router.get("/stats", response_model=IssueStats)
async def get_issues_stats(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get issue statistics"""
    stats = await get_issue_stats(db, store.id)
    return IssueStats(**stats)


@router.get("/{issue_id}", response_model=IssueOut)
async def get_issue(
    issue_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get issue details"""
    issue = await get_issue_by_id(db, issue_id)
    
    if not issue or issue.card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    return IssueOut.model_validate(issue)


@router.post("/{issue_id}/fix", response_model=IssueOut)
async def fix_issue_endpoint(
    issue_id: int,
    fix_data: IssueFixRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fix an issue"""
    issue = await get_issue_by_id(db, issue_id)
    
    if not issue or issue.card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    if issue.status != IssueStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Issue is not pending"
        )
    
    # Apply fix to WB if requested
    if fix_data.apply_to_wb:
        # Build update payload based on field_path
        wb_api = WildberriesAPI(store.api_key)
        # In a real implementation, you would build the proper update payload
        # For now, just mark as fixed
    
    # Mark as fixed
    updated = await fix_issue(db, issue, fix_data.fixed_value, current_user.id)
    
    # Update store stats
    await update_store_stats(db, store.id)
    
    return IssueOut.model_validate(updated)


@router.post("/{issue_id}/skip", response_model=IssueOut)
async def skip_issue_endpoint(
    issue_id: int,
    skip_data: IssueSkipRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Skip an issue"""
    issue = await get_issue_by_id(db, issue_id)
    
    if not issue or issue.card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    updated = await skip_issue(db, issue, skip_data.reason)
    
    # Update store stats
    await update_store_stats(db, store.id)
    
    return IssueOut.model_validate(updated)


@router.post("/{issue_id}/postpone", response_model=IssueOut)
async def postpone_issue_endpoint(
    issue_id: int,
    postpone_data: IssuePostponeRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Postpone an issue for later"""
    issue = await get_issue_by_id(db, issue_id)
    
    if not issue or issue.card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    updated = await postpone_issue(
        db, issue,
        until=postpone_data.postpone_until,
        reason=postpone_data.reason
    )
    
    # Update store stats
    await update_store_stats(db, store.id)
    
    return IssueOut.model_validate(updated)


# === Queue endpoints for sequential fixing ===

@router.get("/queue/next", response_model=Optional[IssueWithCard])
async def get_next_queue_issue(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    after: Optional[int] = Query(None, description="Get issue after this ID"),
):
    """
    Get next pending issue in the fixing queue.
    Order: critical → warning → improvement, by score impact.
    Use `after` param to skip past a specific issue ID.
    """
    issue = await get_next_issue(db, store.id, after_issue_id=after)
    
    if not issue:
        return None
    
    return IssueWithCard(
        id=issue.id,
        card_id=issue.card_id,
        code=issue.code,
        severity=issue.severity.value,
        category=issue.category.value,
        title=issue.title,
        description=issue.description,
        current_value=issue.current_value,
        suggested_value=issue.suggested_value,
        alternatives=issue.alternatives or [],
        charc_id=issue.charc_id,
        allowed_values=issue.allowed_values or [],
        error_details=issue.error_details or [],
        ai_suggested_value=issue.ai_suggested_value,
        ai_reason=issue.ai_reason,
        ai_alternatives=issue.ai_alternatives or [],
        source=issue.source,
        score_impact=issue.score_impact,
        status=issue.status.value,
        fixed_value=issue.fixed_value,
        fixed_at=issue.fixed_at,
        created_at=issue.created_at,
        card_nm_id=issue.card.nm_id,
        card_title=issue.card.title,
        card_vendor_code=issue.card.vendor_code,
        card_photos=issue.card.photos[:3] if issue.card.photos else [],
    )


@router.get("/queue/progress", response_model=QueueProgress)
async def get_queue_progress_endpoint(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get progress of issue fixing queue"""
    progress = await get_queue_progress(db, store.id)
    return QueueProgress(**progress)


@router.post("/apply-all", response_model=ApplyResult)
async def apply_all_fixes_to_wb(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Apply all fixed issues to Wildberries.
    Groups fixes by card and sends batch updates to WB API.
    """
    from ..services.wb_api import WildberriesAPI
    
    fixed_issues = await get_fixed_issues_for_store(db, store.id)
    
    if not fixed_issues:
        return ApplyResult(
            total_issues=0,
            applied=0,
            failed=0,
            errors=[],
        )
    
    # Group by card
    cards_fixes: dict = {}
    for issue in fixed_issues:
        card_id = issue.card_id
        if card_id not in cards_fixes:
            cards_fixes[card_id] = {
                "card": issue.card,
                "issues": [],
            }
        cards_fixes[card_id]["issues"].append(issue)
    
    wb_api = WildberriesAPI(store.api_key)
    applied_ids = []
    errors = []
    
    for card_id, data in cards_fixes.items():
        card = data["card"]
        card_issues = data["issues"]
        
        # Build update payload from raw_data + fixes
        raw = card.raw_data or {}
        
        # Apply characteristic fixes
        characteristics = raw.get("characteristics", [])
        for issue in card_issues:
            if issue.field_path and issue.field_path.startswith("characteristics.") and issue.fixed_value:
                char_name = issue.field_path.replace("characteristics.", "")

                def _parse_fixed_value(fv: str) -> list:
                    """Convert fixed_value string to WB value array."""
                    try:
                        import json as _json
                        val = _json.loads(fv)
                        if isinstance(val, list):
                            return val
                        return [str(val)]
                    except (Exception,):
                        pass
                    if fv == "__CLEAR__":
                        return []
                    if ";" in fv:
                        return [v.strip() for v in fv.split(";") if v.strip()]
                    if ", " in fv:
                        return [v.strip() for v in fv.split(", ") if v.strip()]
                    return [fv]

                matched = False
                for ch in characteristics:
                    if ch.get("name") == char_name or (issue.charc_id and str(ch.get("id")) == str(issue.charc_id)):
                        ch["value"] = _parse_fixed_value(issue.fixed_value)
                        matched = True
                        break
                if not matched and issue.charc_id and issue.fixed_value != "__CLEAR__":
                    # Add new characteristic that doesn't exist yet
                    characteristics.append({
                        "id": issue.charc_id,
                        "name": char_name,
                        "value": _parse_fixed_value(issue.fixed_value),
                    })
        
        # Build WB update payload
        update_payload = {
            "nmID": card.nm_id,
            "vendorCode": card.vendor_code or "",
            "characteristics": characteristics,
        }
        
        # Apply title/description fixes
        for issue in card_issues:
            if issue.field_path == "title" and issue.fixed_value:
                update_payload["title"] = issue.fixed_value
            elif issue.field_path == "description" and issue.fixed_value:
                update_payload["description"] = issue.fixed_value
        
        # Send to WB
        result = await wb_api.update_card(update_payload)
        
        if result.get("success"):
            applied_ids.extend([i.id for i in card_issues])
        else:
            error_msg = result.get("error", "Unknown error")
            errors.append(f"Card {card.nm_id}: {error_msg}")
    
    # Mark applied
    if applied_ids:
        await mark_applied_to_wb(db, applied_ids)
    
    # Update store stats
    await update_store_stats(db, store.id)
    
    return ApplyResult(
        total_issues=len(fixed_issues),
        applied=len(applied_ids),
        failed=len(fixed_issues) - len(applied_ids),
        errors=errors,
    )


# === Card-specific issues endpoint ===

cards_router = APIRouter(prefix="/stores/{store_id}/cards/{card_id}/issues", tags=["Card Issues"])


@cards_router.get("", response_model=List[IssueOut])
async def list_card_issues(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    status_filter: Optional[str] = Query(None, alias="status"),
):
    """Get issues for a specific card"""
    from ..services import get_card_by_id
    
    card = await get_card_by_id(db, card_id)
    if not card or card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found"
        )
    
    status_enum = IssueStatus(status_filter) if status_filter else None
    issues = await get_card_issues(db, card_id, status=status_enum)
    
    return [IssueOut.model_validate(i) for i in issues]
