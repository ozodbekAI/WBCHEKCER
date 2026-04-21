import json
from typing import Any, Dict, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.security import get_current_user, require_issues_apply, require_issues_fix
from ..core.time import utc_now
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
from ..services.approval_service import apply_card_raw_snapshot, build_card_update_payload
from ..services.card_service import (
    _check_seo_keywords_in_text,
    _get_subject_keywords,
    _validate_fix_against_constraints,
    _validate_title_fix,
    analyze_card,
    ensure_card_issue_consistency,
)
from ..services.issue_service import (
    calculate_visible_issue_counts_from_rows,
    get_next_issue, get_card_pending_count, get_fixed_issues_for_store,
    get_queue_progress, mark_applied_to_wb,
)
from ..services.text_policy import validate_description
from ..services.wb_token_access import ensure_store_feature_access, get_store_feature_api_key
from ..services.workflow_service import create_team_tickets

router = APIRouter(prefix="/stores/{store_id}/issues", tags=["Issues"])


class IssueAssignRequest(BaseModel):
    assignee_id: Optional[int] = None
    assignee_ids: List[int] = Field(default_factory=list)
    note: Optional[str] = None


def _normalize_assignee_ids(primary_id: Optional[int], extra_ids: List[int]) -> List[int]:
    normalized: List[int] = []
    seen: set[int] = set()
    for raw in ([primary_id] if primary_id is not None else []) + list(extra_ids or []):
        try:
            user_id = int(raw)
        except (TypeError, ValueError):
            continue
        if user_id <= 0 or user_id in seen:
            continue
        seen.add(user_id)
        normalized.append(user_id)
    return normalized


def _is_admin_user(user: User) -> bool:
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role_value == "admin"


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
    
    if store.owner_id != current_user.id and not _is_admin_user(current_user):
        if getattr(current_user, 'store_id', None) != store.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )

    return store


# In-memory cache for WB directory values: char_name -> list of values
_wb_directory_cache: dict[str, list[str]] = {}


async def _fresh_allowed_values(issue: CardIssue, store: Store) -> list:
    """Fetch allowed values from WB directory API (cached), with local catalog fallback."""
    import re
    char_name: str | None = None
    if issue.field_path and issue.field_path.startswith("characteristics."):
        _EN_TO_RU = {"composition": "Состав", "country": "Страна производства"}
        raw = issue.field_path[len("characteristics."):]
        char_name = _EN_TO_RU.get(raw.lower(), raw)

    # Fallback: extract char name from title like "Характеристика 'Покрой': ..."
    if not char_name and issue.title:
        m = re.search(r"[Хх]арактеристика\s+['\u2018\u2019\u201C\u201D\"'](.+?)['\u2018\u2019\u201C\u201D\"']", issue.title)
        if m:
            char_name = m.group(1).strip()

    if not char_name:
        return issue.allowed_values or []

    # 1) Check in-memory cache
    if char_name in _wb_directory_cache:
        return _wb_directory_cache[char_name]

    # 2) Try WB directory API
    try:
        feature_api_key = get_store_feature_api_key(store, "cards")
        if feature_api_key:
            wb = WildberriesAPI(feature_api_key)
            result = await wb.get_directory_values(char_name)
            if result.get("success") and result.get("values"):
                _wb_directory_cache[char_name] = result["values"]
                return result["values"]
    except Exception:
        pass

    # 3) Fallback to local catalog
    try:
        from ..services.wb_validator import get_catalog
        catalog = get_catalog()
        vals = catalog.get_allowed_values(char_name)
        if vals:
            _wb_directory_cache[char_name] = vals
            return vals
    except Exception:
        pass

    return issue.allowed_values or []


def _norm_val(s: str) -> str:
    return " ".join((s or "").strip().lower().split())


def _live_current_value(issue: CardIssue) -> str | None:
    """
    Return the *live* value from the card's raw_data so the UI always shows
    what the card currently has on WB.
    """
    card = issue.card
    if card is None or not card.raw_data:
        return issue.current_value

    raw = card.raw_data
    fp = (issue.field_path or "").strip()
    c = (issue.code or "").strip().lower()

    # Title issues
    if fp == "title" or c.startswith("title_") or c in {"no_title", "title_policy_violation"}:
        live = raw.get("title") or card.title
        return str(live) if live is not None else issue.current_value

    # Description issues
    if fp == "description" or c.startswith("description_") or c in {"no_description", "description_policy_violation"}:
        live = raw.get("description") or card.description
        return str(live) if live is not None else issue.current_value

    # Characteristic issues  (field_path = "characteristics.Цвет")
    if fp.startswith("characteristics."):
        char_name = fp.split("characteristics.", 1)[1].strip()
        chars = raw.get("characteristics", [])
        if isinstance(chars, list):
            for ch in chars:
                if isinstance(ch, dict) and (ch.get("name") or "").strip().lower() == char_name.lower():
                    v = ch.get("value", ch.get("values"))
                    if isinstance(v, list):
                        return ", ".join(str(x) for x in v)
                    return str(v) if v is not None else issue.current_value
        elif isinstance(chars, dict):
            for k, v in chars.items():
                if k.strip().lower() == char_name.lower():
                    if isinstance(v, list):
                        return ", ".join(str(x) for x in v)
                    return str(v) if v is not None else issue.current_value

    return issue.current_value


async def _auto_resolve_if_now_valid(
    issue: CardIssue, fresh_allowed: list, db: AsyncSession
) -> bool:
    """If all 'invalid' values are now in fresh allowed_values, auto-resolve the issue.
    Returns True if resolved (caller should skip to next issue)."""
    if not fresh_allowed:
        return False
    # Only applies to allowed_values-type errors
    error_details = issue.error_details or []
    has_av_error = any(
        (e.get("type") == "allowed_values" if isinstance(e, dict) else False)
        for e in error_details
    )
    if not has_av_error:
        return False

    # Gather all invalid values from error_details
    invalid_vals: list[str] = []
    for e in error_details:
        if isinstance(e, dict) and e.get("type") == "allowed_values":
            invalid_vals.extend(e.get("invalidValues") or [])

    if not invalid_vals:
        return False

    allowed_norm = {_norm_val(v) for v in fresh_allowed}
    all_now_valid = all(_norm_val(str(v)) in allowed_norm for v in invalid_vals)

    if all_now_valid:
        # Auto-resolve: mark as fixed with original value (no longer an issue)
        issue.status = IssueStatus.FIXED
        issue.fixed_value = issue.current_value
        issue.fixed_at = utc_now()
        await db.commit()
        return True

    return False


def _split_manual_multi_value(value: str) -> list[str]:
    raw = str(value or "").strip()
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


def _issue_allows_clear(issue: CardIssue) -> bool:
    if str(issue.code or "").strip().lower() == "wb_wrong_category":
        return True
    for detail in (issue.error_details or []):
        if not isinstance(detail, dict):
            continue
        marker = str(detail.get("fix_action") or detail.get("type") or "").strip().lower()
        if marker in {"clear", "swap", "compound"}:
            return True
    return False


def _supports_direct_wb_apply(issue: CardIssue) -> bool:
    fp = str(issue.field_path or "").strip().lower()
    return (
        fp == "title"
        or fp == "description"
        or fp == "brand"
        or fp == "subject_name"
        or fp == "package_type"
        or fp == "complectation"
        or fp.startswith("characteristics.")
        or fp.startswith("dimensions.")
    )


def _extract_compound_changes(issue: CardIssue) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for detail in (issue.error_details or []):
        if not isinstance(detail, dict):
            continue
        marker = str(detail.get("fix_action") or detail.get("type") or "").strip().lower()
        if marker != "compound":
            continue
        for fix in (detail.get("fixes") or []):
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

            raw_value = fix.get("value") if fix.get("action") != "clear" else "__CLEAR__"
            if isinstance(raw_value, list):
                new_value = json.dumps(raw_value, ensure_ascii=False)
            elif raw_value is None:
                new_value = ""
            else:
                new_value = str(raw_value)

            changes.append(
                {
                    "field_path": field_path,
                    "new_value": new_value,
                    "charc_id": fix.get("charc_id", fix.get("charcId")),
                }
            )
    return changes


def _change_dedupe_key(change: dict[str, Any]) -> tuple[str, int]:
    field_path = str(change.get("field_path") or "").strip().lower()
    try:
        charc_id = int(change.get("charc_id")) if change.get("charc_id") is not None else 0
    except (TypeError, ValueError):
        charc_id = 0
    return field_path, charc_id


def _dedupe_changes(changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for change in changes:
        key = _change_dedupe_key(change)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(change)
    return deduped


def _build_wb_client(store: Store) -> WildberriesAPI:
    ensure_store_feature_access(store, "cards_write")
    feature_api_key = get_store_feature_api_key(store, "cards_write")
    if not feature_api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="WB Content key is not configured")
    return WildberriesAPI(feature_api_key)


async def _send_card_changes_to_wb(
    *,
    store: Store,
    card,
    changes: list[dict[str, Any]],
) -> dict[str, Any]:
    deduped_changes = _dedupe_changes(changes)
    if not deduped_changes:
        raise HTTPException(status_code=400, detail="No supported WB card changes to apply")

    wb_api = _build_wb_client(store)
    update_payload, next_raw_data = build_card_update_payload(card, deduped_changes)
    wb_result = await wb_api.update_card(update_payload)
    if not wb_result.get("success"):
        error_msg = wb_result.get("error", "Unknown WB error")
        raise HTTPException(status_code=502, detail=f"WB API error: {error_msg}")
    return next_raw_data


async def _safe_reanalyze_card_after_apply(db: AsyncSession, card) -> None:
    try:
        await analyze_card(db, card)
    except Exception:
        pending_by_severity = await db.execute(
            select(
                CardIssue.severity,
                CardIssue.code,
                CardIssue.category,
                CardIssue.field_path,
                func.count(),
            )
            .where(
                CardIssue.card_id == card.id,
                CardIssue.status == IssueStatus.PENDING,
            )
            .group_by(CardIssue.severity, CardIssue.code, CardIssue.category, CardIssue.field_path)
        )
        counts = calculate_visible_issue_counts_from_rows(pending_by_severity.all())
        card.critical_issues_count = int(counts.get("critical", 0) or 0)
        card.warnings_count = int(counts.get("warning", 0) or 0)
        card.improvements_count = int(counts.get("improvement", 0) or 0)
        await db.commit()


async def _refresh_card_after_wb_apply(
    db: AsyncSession,
    card,
    next_raw_data: Optional[dict[str, Any]],
) -> None:
    if next_raw_data is None:
        return
    apply_card_raw_snapshot(card, next_raw_data)
    card.skip_next_reanalyze = True
    await db.commit()
    await _safe_reanalyze_card_after_apply(db, card)


def _issue_to_fixed_change(issue: CardIssue) -> Optional[dict[str, Any]]:
    if not issue.fixed_value or not _supports_direct_wb_apply(issue):
        return None
    return {
        "field_path": issue.field_path,
        "new_value": issue.fixed_value,
        "charc_id": issue.charc_id,
    }


async def _validate_manual_fixed_value(issue: CardIssue, raw_value: str) -> str:
    fixed_value = str(raw_value or "").strip()
    if not fixed_value:
        raise HTTPException(status_code=400, detail="fixed_value is required")

    if str(issue.code or "").strip().lower().startswith("wb_fixed_"):
        raise HTTPException(status_code=400, detail="This WB system field cannot be fixed manually")

    if str(issue.source or "").strip().lower() == "fixed_file":
        expected = str(issue.suggested_value or "").strip()
        if fixed_value != expected:
            raise HTTPException(
                status_code=400,
                detail="For fixed-file issues use the exact suggested_value",
            )
        return fixed_value

    field_path = str(issue.field_path or "").strip().lower()
    card_payload = issue.card.raw_data if isinstance(issue.card.raw_data, dict) else {}

    if field_path == "title":
        valid, reason = _validate_title_fix(fixed_value, card_payload)
        if not valid:
            raise HTTPException(status_code=400, detail=reason or "Invalid title")
        return fixed_value

    if field_path == "description":
        valid, reason = validate_description(fixed_value, card_payload)
        if not valid:
            raise HTTPException(status_code=400, detail=reason or "Invalid description")

        keywords = _get_subject_keywords(card_payload)
        seo_valid, seo_reason = _check_seo_keywords_in_text(fixed_value, keywords, min_count=2)
        if not seo_valid:
            raise HTTPException(status_code=400, detail=seo_reason or "Description SEO validation failed")
        return fixed_value

    if field_path.startswith("characteristics."):
        if fixed_value == "__CLEAR__" and not _issue_allows_clear(issue):
            raise HTTPException(status_code=400, detail="Clearing this field is not allowed")

        parsed_values = _split_manual_multi_value(fixed_value)
        candidate: Any = [] if fixed_value == "__CLEAR__" else parsed_values
        if isinstance(candidate, list) and len(candidate) == 1:
            candidate = candidate[0]

        valid, reason, corrected = _validate_fix_against_constraints(
            value=candidate,
            allowed_values=list(issue.allowed_values or []),
            error_details=list(issue.error_details or []),
            char_name=issue.field_path or issue.title,
            current_value=issue.current_value,
            product_dna=str(issue.card.product_dna or ""),
        )
        if not valid:
            raise HTTPException(status_code=400, detail=reason or "Invalid fixed_value")

        final_value = corrected if corrected is not None else candidate
        if final_value == []:
            return "__CLEAR__"
        if isinstance(final_value, list):
            return json.dumps(final_value, ensure_ascii=False)
        return str(final_value)

    return fixed_value


@router.get("", response_model=IssueListOut)
async def list_issues(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    card_id: Optional[int] = Query(None, ge=1),
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = None,
    category: Optional[str] = None,
):
    """Get all issues for a store"""
    skip = (page - 1) * limit
    
    # Convert string to enum if provided
    status_enum = IssueStatus(status_filter) if status_filter else None
    severity_mode = (severity or "").strip().lower()
    severity_enum = IssueSeverity(severity_mode) if severity_mode and severity_mode != "media" else None
    dedicated_media = True if severity_mode == "media" else False if severity_mode in {"warning", "improvement"} else None
    
    issues, total = await get_store_issues(
        db, store.id,
        card_id=card_id,
        status=status_enum,
        severity=severity_enum,
        category=category,
        dedicated_media=dedicated_media,
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
    limit: int = 30,  # Limit per severity group
    skip_validation: bool = True,  # Skip expensive WB API calls for speed
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get issues grouped by severity
    
    Args:
        limit: Max issues to return per group (default 30, max 100)
        skip_validation: Skip fresh allowed_values lookup for better performance (default True)
    """
    # Clamp limit to reasonable range
    limit = max(10, min(500, limit))
    grouped = await get_issues_grouped(db, store.id, limit_per_group=limit)
    
    async def issue_to_dict(issue: CardIssue) -> Optional[IssueWithCard]:
        # For grouped endpoint, skip expensive WB API calls by default
        # Use cached allowed_values from issue object
        if skip_validation:
            fresh_av = issue.allowed_values or []
        else:
            fresh_av = await _fresh_allowed_values(issue, store)
            # Auto-resolve if "invalid" values are now valid
            if await _auto_resolve_if_now_valid(issue, fresh_av, db):
                return None
        
        return IssueWithCard(
            id=issue.id,
            card_id=issue.card_id,
            code=issue.code,
            severity=issue.severity.value,
            category=issue.category.value,
            title=issue.title,
            description=issue.description,
            current_value=_live_current_value(issue),
            field_path=issue.field_path,
            suggested_value=issue.suggested_value,
            alternatives=issue.alternatives or [],
            charc_id=issue.charc_id,
            allowed_values=fresh_av,
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
    
    # Build lists, filtering out auto-resolved (None) issues
    critical = [x for x in [await issue_to_dict(i) for i in grouped["critical"]] if x is not None]
    warnings = [x for x in [await issue_to_dict(i) for i in grouped["warnings"]] if x is not None]
    improvements = [x for x in [await issue_to_dict(i) for i in grouped["improvements"]] if x is not None]
    media = [x for x in [await issue_to_dict(i) for i in grouped["media"]] if x is not None]
    postponed = [x for x in [await issue_to_dict(i) for i in grouped["postponed"]] if x is not None]

    return IssuesGrouped(
        critical=critical,
        warnings=warnings,
        improvements=improvements,
        media=media,
        postponed=postponed,
        critical_count=len(critical),
        warnings_count=len(warnings),
        improvements_count=len(improvements),
        media_count=len(media),
        postponed_count=len(postponed),
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
    current_user: User = Depends(require_issues_fix),
):
    """Fix an issue"""
    issue = await get_issue_by_id(db, issue_id)
    
    if not issue or issue.card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    if issue.status not in (IssueStatus.PENDING, IssueStatus.SKIPPED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Issue is not pending or skipped"
        )

    fixed_value = await _validate_manual_fixed_value(issue, fix_data.fixed_value)
    next_raw_data: Optional[dict[str, Any]] = None

    if fix_data.apply_to_wb:
        if not _supports_direct_wb_apply(issue):
            raise HTTPException(
                status_code=400,
                detail="This issue type cannot be applied to WB via /issues/{id}/fix. Use dedicated card/media flow.",
            )

        changes = [
            {
                "field_path": issue.field_path,
                "new_value": fixed_value,
                "charc_id": issue.charc_id,
            }
        ]
        changes.extend(_extract_compound_changes(issue))
        next_raw_data = await _send_card_changes_to_wb(
            store=store,
            card=issue.card,
            changes=changes,
        )

    updated = await fix_issue(db, issue, fixed_value, current_user.id)
    response_payload = IssueOut.model_validate(updated)

    if fix_data.apply_to_wb and next_raw_data is not None:
        await _refresh_card_after_wb_apply(db, issue.card, next_raw_data)

    # Update store stats
    await update_store_stats(db, store.id)

    return response_payload


@router.post("/{issue_id}/skip", response_model=IssueOut)
async def skip_issue_endpoint(
    issue_id: int,
    skip_data: IssueSkipRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_issues_fix),
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


@router.post("/{issue_id}/unskip", response_model=IssueOut)
async def unskip_issue_endpoint(
    issue_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_issues_fix),
):
    """Reset a skipped issue back to pending"""
    from ..services.issue_service import unskip_issue

    issue = await get_issue_by_id(db, issue_id)

    if not issue or issue.card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )

    if issue.status != IssueStatus.SKIPPED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Issue is not skipped"
        )

    updated = await unskip_issue(db, issue)

    # Update store stats
    await update_store_stats(db, store.id)

    return IssueOut.model_validate(updated)


@router.post("/{issue_id}/postpone", response_model=IssueOut)
async def postpone_issue_endpoint(
    issue_id: int,
    postpone_data: IssuePostponeRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_issues_fix),
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


@router.post("/{issue_id}/assign")
async def assign_issue_endpoint(
    issue_id: int,
    data: IssueAssignRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_issues_fix),
):
    issue = await get_issue_by_id(db, issue_id)
    if not issue or issue.card.store_id != store.id:
        raise HTTPException(status_code=404, detail="Issue not found")

    assignee_ids = _normalize_assignee_ids(data.assignee_id, data.assignee_ids)
    if not assignee_ids:
        raise HTTPException(status_code=400, detail="At least one assignee is required")

    assignees_r = await db.execute(
        select(User).where(User.id.in_(assignee_ids), User.is_active == True)
    )
    assignees = list(assignees_r.scalars().all())
    assignees_by_id = {user.id: user for user in assignees}

    missing_ids = [user_id for user_id in assignee_ids if user_id not in assignees_by_id]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Assignee not found: {missing_ids[0]}")

    ordered_assignees = [assignees_by_id[user_id] for user_id in assignee_ids]
    for assignee in ordered_assignees:
        role_val = assignee.role.value if hasattr(assignee.role, "value") else assignee.role
        if role_val != "admin" and assignee.id != store.owner_id and getattr(assignee, "store_id", None) != store.id:
            raise HTTPException(status_code=400, detail=f"Assignee has no access to this store: {assignee.id}")

    if issue.status in (IssueStatus.FIXED, IssueStatus.AUTO_FIXED):
        raise HTTPException(status_code=400, detail="Issue is already resolved")

    note = (data.note or "").strip() or None
    assignee_names = ", ".join((assignee.full_name or f"Пользователь #{assignee.id}") for assignee in ordered_assignees)
    reason = note or f"Передано: {assignee_names}"
    if issue.status != IssueStatus.POSTPONED:
        await postpone_issue(db, issue, reason=reason)
    else:
        issue.postpone_reason = reason
        issue.updated_at = utc_now()
        await db.commit()
        await db.refresh(issue)

    tickets = await create_team_tickets(
        db,
        store_id=store.id,
        from_user_id=current_user.id,
        to_user_ids=assignee_ids,
        ticket_type="delegation",
        issue_id=issue.id,
        card_id=issue.card_id,
        issue_title=issue.title,
        issue_severity=issue.severity.value if hasattr(issue.severity, "value") else str(issue.severity),
        issue_code=issue.code,
        card_title=issue.card.title if issue.card else None,
        card_photo=(issue.card.photos[0] if issue.card and issue.card.photos else None),
        card_nm_id=issue.card.nm_id if issue.card else None,
        card_vendor_code=issue.card.vendor_code if issue.card else None,
        note=note,
    )
    await update_store_stats(db, store.id)
    return {
        "ok": True,
        "issue": IssueOut.model_validate(issue),
        "ticket": tickets[0] if tickets else None,
        "tickets": tickets,
    }


# === Queue endpoints for sequential fixing ===

@router.get("/queue/next", response_model=Optional[IssueWithCard])
async def get_next_queue_issue(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    after: Optional[int] = Query(None, description="Get issue after this ID"),
    card_id: Optional[int] = Query(None, description="Limit to specific card"),
    severity: Optional[str] = Query(None, description="Filter by severity: critical, warning, improvement, media"),
):
    """
    Get next pending issue in the fixing queue.
    If card_id provided, returns only issues for that card (returns null when card is done).
    If severity provided, only returns issues of that severity.
    Otherwise returns the globally next issue by priority.
    Auto-resolves issues whose 'invalid' values are now valid in the current catalog.
    """
    # Loop: fetch next issue, auto-resolve if no longer invalid, repeat
    _max_auto_resolve = 50  # safety limit
    for _ in range(_max_auto_resolve):
        issue = await get_next_issue(db, store.id, after_issue_id=after, card_id=card_id, severity=severity)
        if not issue:
            return None

        # Check if this issue's "invalid" values are now valid → auto-resolve
        fresh_av = await _fresh_allowed_values(issue, store)
        if await _auto_resolve_if_now_valid(issue, fresh_av, db):
            # Issue auto-resolved, fetch the next one
            continue

        break
    else:
        return None

    pending_count = await get_card_pending_count(db, issue.card_id)

    # Check if this characteristic is is_fixed in WB catalog
    requires_fixed_file = False
    try:
        from ..services.wb_validator import get_catalog
        catalog = get_catalog()
        subject_id = issue.card.subject_id if issue.card else None
        if subject_id:
            subject_chars = catalog.get_subject_chars(subject_id)
            # Extract char name from field_path (e.g. "characteristics.Состав" → "Состав")
            # Also handle legacy English aliases (composition → Состав)
            _EN_TO_RU = {"composition": "Состав", "country": "Страна производства"}
            char_name_from_path: str | None = None
            if issue.field_path and issue.field_path.startswith("characteristics."):
                raw_name = issue.field_path[len("characteristics."):]
                char_name_from_path = _EN_TO_RU.get(raw_name.lower(), raw_name)
            for cm in subject_chars:
                matched = (issue.charc_id and cm.charc_id == issue.charc_id) or \
                          (char_name_from_path and cm.name.lower() == char_name_from_path.lower())
                if matched and cm.is_fixed:
                    requires_fixed_file = True
                    break
    except Exception:
        pass

    return IssueWithCard(
        id=issue.id,
        card_id=issue.card_id,
        code=issue.code,
        severity=issue.severity.value,
        category=issue.category.value,
        title=issue.title,
        description=issue.description,
        current_value=_live_current_value(issue),
        field_path=issue.field_path,
        suggested_value=issue.suggested_value,
        alternatives=issue.alternatives or [],
        charc_id=issue.charc_id,
        allowed_values=fresh_av,
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
        card_pending_count=pending_count,
        requires_fixed_file=requires_fixed_file,
    )


@router.get("/queue/progress", response_model=QueueProgress)
async def get_queue_progress_endpoint(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    severity: Optional[str] = Query(None, description="Filter by severity: critical, warning, improvement, media"),
):
    """Get progress of issue fixing queue, optionally filtered by severity"""
    progress = await get_queue_progress(db, store.id, severity=severity)
    return QueueProgress(**progress)


@router.post("/apply-all", response_model=ApplyResult)
async def apply_all_fixes_to_wb(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_issues_apply),
):
    """
    Apply all fixed issues to Wildberries.
    Groups fixes by card and sends batch updates to WB API.
    """
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
    
    applied_ids = []
    errors = []
    
    for card_id, data in cards_fixes.items():
        card = data["card"]
        card_issues = data["issues"]
        card_changes = []
        applicable_ids = []
        skipped_for_card = 0
        for issue in card_issues:
            change = _issue_to_fixed_change(issue)
            if change is None:
                skipped_for_card += 1
                continue
            card_changes.append(change)
            applicable_ids.append(issue.id)

        if not card_changes:
            if skipped_for_card:
                errors.append(f"Card {card.nm_id}: no supported fixed issues to apply to WB")
            continue

        try:
            next_raw_data = await _send_card_changes_to_wb(
                store=store,
                card=card,
                changes=card_changes,
            )
            await mark_applied_to_wb(db, applicable_ids)
            await _refresh_card_after_wb_apply(db, card, next_raw_data)
            applied_ids.extend(applicable_ids)
            if skipped_for_card:
                errors.append(f"Card {card.nm_id}: skipped {skipped_for_card} unsupported fixed issue(s)")
        except HTTPException as exc:
            errors.append(f"Card {card.nm_id}: {exc.detail}")
    
    # Mark applied
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

    card = await ensure_card_issue_consistency(db, card, reanalyze_if_missing=True)
    
    status_enum = IssueStatus(status_filter) if status_filter else None
    issues = await get_card_issues(db, card.id, status=status_enum)
    
    return [IssueOut.model_validate(i) for i in issues]
