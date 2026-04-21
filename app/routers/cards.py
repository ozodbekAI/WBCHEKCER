import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.time import utc_now
from ..core.database import get_db
from ..core.security import get_current_user, require_permission
from ..models import User, Store, Card, CardIssue, StoreStatus, IssueStatus
from ..schemas import CardDraftOut, CardDraftPayload, CardOut, CardDetail, CardListOut
from ..services import get_store_by_id, get_card_by_id, get_store_cards, analyze_card, update_store_stats
from ..services.card_service import (
    ensure_card_issue_consistency,
    build_description_editor_keywords,
    generate_card_description_suggestion,
    should_refresh_product_dna,
)
from ..services.wb_token_access import ensure_store_feature_access, get_store_feature_api_key
from ..services.approval_service import (
    apply_card_raw_snapshot,
    build_card_approval_changes,
    build_card_update_payload,
)
from ..services.issue_service import calculate_visible_issue_counts_from_rows, mark_applied_to_wb
from ..services.wb_api import WildberriesAPI
from ..services.wb_cards import parse_wb_timestamp
from ..services.photo_error_mapper import map_photo_error
from ..services.workflow_service import (
    CARD_WORKFLOW_SECTIONS,
    confirm_card_section,
    delete_card_draft,
    get_card_confirmation_summaries,
    get_preferred_card_draft,
    list_confirmed_sections,
    save_card_draft,
    unconfirm_card_section,
)

router = APIRouter(prefix="/stores/{store_id}/cards", tags=["Cards"])
logger = logging.getLogger("photo.studio.cards.router")

MAX_REMOTE_BYTES = 15 * 1024 * 1024
MEDIA_APPLY_HISTORY_LIMIT = 20
ALLOWED_REMOTE_HOST_SUFFIXES = (
    "wbbasket.ru",
    "wbstatic.net",
    "wildberries.ru",
    "wb.ru",
)


def _photo_http_exception(raw_error: Any, *, context: str, default_status: int = 400) -> HTTPException:
    mapped = map_photo_error(raw_error, context=context)
    status_code = int(mapped.get("http_status") or default_status)
    return HTTPException(status_code=status_code, detail=mapped)


def _normalize_media_urls(urls: Any) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for raw in (urls or []):
        value = str(raw or "").strip()
        if not value:
            continue
        normalized = WildberriesAPI.strip_url_query(value)
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(value)
    return out


def _build_media_apply_snapshot_record(
    *,
    card_id: int,
    nm_id: int,
    before_snapshot: List[str],
    requested_after_snapshot: List[str],
    actual_after_snapshot: List[str],
    created_at: str,
    verification: Optional[Dict[str, Any]] = None,
    matched: Optional[bool] = None,
    stabilized: Optional[bool] = None,
    source: str = "wb_sync_photos",
) -> Dict[str, Any]:
    before = _normalize_media_urls(before_snapshot)
    requested = _normalize_media_urls(requested_after_snapshot)
    actual = _normalize_media_urls(actual_after_snapshot)
    verification_payload = verification if isinstance(verification, dict) else None

    result_matched = bool(
        matched
        if matched is not None
        else (verification_payload or {}).get("matched", False)
    )

    record: Dict[str, Any] = {
        "operation_id": str(uuid.uuid4()),
        "source": source,
        "card_id": int(card_id),
        "nm_id": int(nm_id),
        "created_at": str(created_at),
        "before_snapshot": before,
        "requested_after_snapshot": requested,
        "actual_after_snapshot": actual,
        # Backward-compatible aliases for existing readers.
        "before": before,
        "requested": requested,
        "actual": actual,
        "matched": result_matched,
        "stabilized": bool(stabilized) if stabilized is not None else None,
        "verification": verification_payload,
    }
    return record


def _append_media_apply_history(raw_data: Dict[str, Any], snapshot_record: Dict[str, Any]) -> Dict[str, Any]:
    history_raw = raw_data.get("media_apply_history")
    history = list(history_raw) if isinstance(history_raw, list) else []
    history.append(snapshot_record)
    if len(history) > MEDIA_APPLY_HISTORY_LIMIT:
        history = history[-MEDIA_APPLY_HISTORY_LIMIT:]
    raw_data["media_apply_history"] = history
    raw_data["media_apply_snapshot"] = snapshot_record
    raw_data["media_apply_last_operation_id"] = snapshot_record.get("operation_id")
    return raw_data


def _is_admin_user(user: User) -> bool:
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role_value == "admin"


class ReplaceWbPhotoRequest(BaseModel):
    source_url: str
    slot: int = Field(1, ge=1, le=30)


class SyncCardPhotosRequest(BaseModel):
    photos: List[str] = Field(..., min_length=1, max_length=30)


class DescriptionEditorDraftRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    characteristics: Dict[str, Any] = Field(default_factory=dict)


class DescriptionEditorContextRequest(BaseModel):
    draft: Optional[DescriptionEditorDraftRequest] = None


class DescriptionEditorContextOut(BaseModel):
    field: str = "description"
    keywords: List[str] = Field(default_factory=list)


class DescriptionGenerateRequest(DescriptionEditorContextRequest):
    instructions: Optional[str] = Field(None, max_length=1200)


class DescriptionGenerateOut(DescriptionEditorContextOut):
    value: str
    reason: Optional[str] = None


def _is_allowed_remote_host(host: str) -> bool:
    host = (host or "").lower()
    if not host:
        return False
    try:
        public_host = (urlparse(settings.PUBLIC_BASE_URL).hostname or "").lower()
    except Exception:
        public_host = ""
    if public_host and host == public_host:
        return True
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in ALLOWED_REMOTE_HOST_SUFFIXES)


def _resolve_local_media_path(source_url: str) -> Optional[Path]:
    if not source_url:
        return None
    raw = source_url.strip()
    parsed = urlparse(raw)

    if parsed.scheme in ("http", "https") and parsed.path.startswith("/media/"):
        host = (parsed.hostname or "").lower()
        public_host = (urlparse(settings.PUBLIC_BASE_URL).hostname or "").lower()
        if host and public_host and host != public_host:
            return None
        raw_path = parsed.path
    elif raw.startswith("/media/"):
        raw_path = raw
    else:
        return None

    rel = raw_path[len("/media/") :].lstrip("/").replace("\\", "/")
    if not rel or ".." in Path(rel).parts:
        return None

    media_root = Path(settings.MEDIA_ROOT).resolve()
    full_path = (media_root / rel).resolve()
    if not str(full_path).startswith(str(media_root) + os.sep) and full_path != media_root:
        return None
    return full_path


def _guess_content_type_from_ext(ext: str) -> str:
    e = (ext or "").lower()
    if e == ".png":
        return "image/png"
    if e == ".webp":
        return "image/webp"
    return "image/jpeg"


async def _load_image_bytes_from_source(source_url: str) -> Tuple[bytes, str, str]:
    local_path = _resolve_local_media_path(source_url)
    if local_path and local_path.exists() and local_path.is_file():
        raw = local_path.read_bytes()
        ext = local_path.suffix.lower() or ".jpg"
        content_type = _guess_content_type_from_ext(ext)
        return raw, content_type, ext

    parsed = urlparse(source_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Unsupported URL scheme")
    host = (parsed.hostname or "").lower()
    if not _is_allowed_remote_host(host):
        raise ValueError("Unsupported URL host")

    timeout = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(source_url)
        resp.raise_for_status()

        final_host = (resp.url.host or "").lower()
        if not _is_allowed_remote_host(final_host):
            raise ValueError("Redirected to unsupported host")

        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if not content_type.startswith("image/"):
            raise ValueError("URL is not an image")

        chunks: List[bytes] = []
        total = 0
        async for chunk in resp.aiter_bytes():
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_REMOTE_BYTES:
                raise ValueError("Image is too large")
            chunks.append(chunk)

        ext = os.path.splitext(resp.url.path)[1].lower() or ".jpg"
        if ext not in (".jpg", ".jpeg", ".png", ".webp"):
            ext = ".jpg"
        return b"".join(chunks), (content_type or "image/jpeg"), ext


def _extract_wb_photo_urls(raw_photos: Any) -> List[str]:
    urls: List[str] = []
    seen: set[str] = set()
    if not isinstance(raw_photos, list):
        return urls

    for item in raw_photos:
        url: Optional[str] = None
        if isinstance(item, str):
            url = item
        elif isinstance(item, dict):
            url = (
                item.get("big")
                or item.get("url")
                or item.get("full")
                or item.get("c516x688")
                or item.get("c246x328")
            )
        if not url:
            continue
        s = str(url).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        urls.append(s)
    return urls


def _extract_wb_video_urls(raw_videos: Any) -> List[str]:
    urls: List[str] = []
    seen: set[str] = set()
    if not isinstance(raw_videos, list):
        return urls

    for item in raw_videos:
        url: Optional[str] = None
        if isinstance(item, str):
            url = item
        elif isinstance(item, dict):
            url = (
                item.get("url")
                or item.get("src")
                or item.get("fileUrl")
                or item.get("file_url")
                or item.get("link")
            )
        if not url:
            continue
        s = str(url).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        urls.append(s)
    return urls


def _extract_wb_characteristics(raw_characteristics: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not isinstance(raw_characteristics, list):
        return out

    for item in raw_characteristics:
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


def _extract_wb_dimensions(raw_dimensions: Any) -> Dict[str, Any]:
    dims = raw_dimensions if isinstance(raw_dimensions, dict) else {}
    return {
        "length": dims.get("length"),
        "width": dims.get("width"),
        "height": dims.get("height"),
        "weight": dims.get("weightBrutto", dims.get("weight")),
    }


def _apply_wb_card_snapshot(card: Card, raw: Dict[str, Any]) -> None:
    if card.product_dna and should_refresh_product_dna(card, next_raw_data=raw):
        card.product_dna = None
    photos = _extract_wb_photo_urls(raw.get("photos"))
    videos = _extract_wb_video_urls(raw.get("videos"))

    card.imt_id = raw.get("imtID")
    card.vendor_code = raw.get("vendorCode")
    card.title = raw.get("title")
    card.brand = raw.get("brand")
    card.description = raw.get("description")
    card.subject_id = raw.get("subjectID")
    card.subject_name = raw.get("subjectName")
    card.category_name = raw.get("object")
    card.photos = photos
    card.videos = videos
    card.photos_count = len(photos)
    card.videos_count = len(videos)
    card.characteristics = _extract_wb_characteristics(raw.get("characteristics"))
    card.dimensions = _extract_wb_dimensions(raw.get("dimensions"))
    card.raw_data = raw
    card.wb_updated_at = parse_wb_timestamp(raw.get("updatedAt"))


async def _refresh_local_card_from_wb(
    db: AsyncSession,
    *,
    store_id: int,
    nm_id: int,
    wb_api: WildberriesAPI,
) -> Optional[Card]:
    card_r = await db.execute(
        select(Card).where(Card.store_id == store_id, Card.nm_id == nm_id)
    )
    card = card_r.scalar_one_or_none()
    if not card:
        return None

    detail = await wb_api.get_card_detail(nm_id)
    raw = detail.get("card") if detail.get("success") else None
    if isinstance(raw, dict):
        _apply_wb_card_snapshot(card, raw)
        await db.commit()
        await db.refresh(card)

    return card


def _map_wb_card_to_front(raw: Dict[str, Any]) -> Dict[str, Any]:
    photos = _extract_wb_photo_urls(raw.get("photos"))
    return {
        "nm_id": raw.get("nmID"),
        "vendor_code": raw.get("vendorCode"),
        "title": raw.get("title"),
        "brand": raw.get("brand"),
        "subject_name": raw.get("subjectName"),
        "photos": photos,
        "main_photo_url": photos[0] if photos else None,
    }


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
    ensure_store_feature_access(store, "cards")

    return store


async def _get_store_card(db: AsyncSession, store_id: int, card_id: int) -> Card:
    card = await get_card_by_id(db, card_id)
    if not card or card.store_id != store_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found",
        )
    return card


@router.get("", response_model=CardListOut)
async def list_cards(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    search: Optional[str] = None,
    min_score: Optional[int] = Query(None, ge=0, le=100),
    max_score: Optional[int] = Query(None, ge=0, le=100),
    has_critical: Optional[bool] = None,
    has_issues: Optional[bool] = None,
    no_issues: Optional[bool] = None,
    is_fully_confirmed: Optional[bool] = None,
):
    """Get cards for a store with filters"""
    skip = (page - 1) * limit
    
    cards, total = await get_store_cards(
        db, store.id,
        skip=skip,
        limit=limit,
        search=search,
        min_score=min_score,
        max_score=max_score,
        has_critical=has_critical,
        has_issues=has_issues,
        no_issues=no_issues,
        is_fully_confirmed=is_fully_confirmed,
    )
    summaries = await get_card_confirmation_summaries(db, [card.id for card in cards])

    items = []
    for card in cards:
        payload = CardOut.model_validate(card).model_dump()
        summary = summaries.get(card.id)
        if summary:
            payload["confirmation_summary"] = summary.model_dump()
        items.append(CardOut.model_validate(payload))
    
    return CardListOut(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=(total + limit - 1) // limit,
    )


@router.get("/wb/live")
async def list_wb_cards_live(
    store: Store = Depends(get_user_store),
    limit: int = Query(50, ge=1, le=100),
    with_photo: int = Query(1, ge=-1, le=1),
    q: Optional[str] = Query(None),
    cursor_updated_at: Optional[str] = Query(None),
    cursor_nm_id: Optional[int] = Query(None),
):
    """
    Live WB cards list (direct from WB Content API), used by AB test/photo studio selectors.
    """
    if store.status != StoreStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store must be active",
        )
    ensure_store_feature_access(store, "cards")
    feature_api_key = get_store_feature_api_key(store, "cards")
    if not feature_api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="WB Content key is not configured")

    wb_api = WildberriesAPI(feature_api_key)
    result = await wb_api.get_cards(
        limit=limit,
        updated_at=cursor_updated_at,
        nm_id=cursor_nm_id,
        with_photo=with_photo,
        text_search=(q or "").strip() or None,
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"WB cards list failed: {result.get('error', 'Unknown error')}",
        )

    cards_raw = result.get("cards") or []
    mapped = [_map_wb_card_to_front(c) for c in cards_raw if isinstance(c, dict)]

    # Extra protection when with_photo=1: keep only cards with at least one photo URL.
    if with_photo == 1:
        mapped = [c for c in mapped if c.get("main_photo_url")]

    return {
        "cards": mapped,
        "cursor": result.get("cursor") or {},
    }


@router.post("/wb/{nm_id}/photos/replace")
async def replace_wb_card_photo(
    nm_id: int,
    payload: ReplaceWbPhotoRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    """
    Replace WB card photo slot from a source image URL.
    Used by Photo Studio drag-and-drop from generated history to card photo slot.
    """
    if store.status != StoreStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store must be active",
        )
    ensure_store_feature_access(store, "cards_write")
    feature_api_key = get_store_feature_api_key(store, "cards_write")
    if not feature_api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="WB Content key is not configured")

    source_url = (payload.source_url or "").strip()
    if not source_url:
        raise _photo_http_exception("source_url is required", context="wb_replace_photo", default_status=400)

    try:
        content, content_type, ext = await _load_image_bytes_from_source(source_url)
    except Exception as e:
        logger.warning("replace_wb_card_photo source load failed nm_id=%s source_url=%s err=%s", nm_id, source_url, str(e))
        raise _photo_http_exception(f"Cannot load source image: {e}", context="wb_replace_photo", default_status=400)

    wb_api = WildberriesAPI(feature_api_key)
    result = await wb_api.upload_card_photo(
        nm_id=int(nm_id),
        content=content,
        content_type=content_type,
        photo_number=int(payload.slot),
        filename=f"slot_{int(payload.slot)}{ext}",
    )

    if not result.get("success"):
        logger.warning(
            "replace_wb_card_photo WB upload failed nm_id=%s slot=%s err=%s",
            nm_id,
            int(payload.slot),
            result.get("error", "Unknown error"),
        )
        raise _photo_http_exception(
            f"WB photo replace failed: {result.get('error', 'Unknown error')}",
            context="wb_replace_photo",
            default_status=502,
        )

    local_card = await _refresh_local_card_from_wb(db, store_id=store.id, nm_id=int(nm_id), wb_api=wb_api)
    photos = local_card.photos if local_card else (result.get("photos") or [])
    return {
        "ok": True,
        "nm_id": int(nm_id),
        "slot": int(payload.slot),
        "photo_url": result.get("photo_url"),
        "photos": photos,
    }


# Route ordering: specific paths BEFORE parameterized paths
@router.get("/critical", response_model=List[CardOut])
async def get_critical_cards(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
):
    """Get cards with critical issues"""
    cards, _ = await get_store_cards(
        db, store.id,
        limit=limit,
        has_critical=True,
    )
    return [CardOut.model_validate(c) for c in cards]


@router.get("/queue", response_model=List[Dict[str, Any]])
async def get_cards_queue(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
):
    """Get cards queue sorted by priority for step-by-step processing"""
    from sqlalchemy import select, func, case
    from ..models import CardIssue, IssueSeverity
    
    # Prioritize cards by: critical_issues DESC, warnings DESC, total_score ASC
    query = (
        select(Card)
        .where(Card.store_id == store.id)
        .order_by(
            Card.critical_issues_count.desc(),
            Card.warnings_count.desc(),
            Card.score.asc()
        )
        .limit(limit)
    )
    
    result = await db.execute(query)
    cards = result.scalars().all()
    
    output = []
    for card in cards:
        # Count pending issues for this card
        issue_query = select(func.count(CardIssue.id)).where(
            CardIssue.card_id == card.id,
            CardIssue.status == IssueStatus.PENDING
        )
        issue_count_result = await db.execute(issue_query)
        pending_issues = issue_count_result.scalar() or 0
        
        # Get main photo URL from photos array
        main_photo = None
        if card.photos and isinstance(card.photos, list) and len(card.photos) > 0:
            main_photo = card.photos[0]
        
        output.append({
            "id": card.id,
            "nm_id": card.nm_id,
            "vendor_code": card.vendor_code,
            "title": card.title,
            "main_photo_url": main_photo,
            "score": card.score,
            "critical_issues_count": card.critical_issues_count,
            "warnings_count": card.warnings_count,
            "pending_issues_count": pending_issues,
        })
    
    return output


@router.get("/{card_id}/confirmed-sections", response_model=List[str])
async def get_confirmed_sections(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_card(db, store.id, card_id)
    return await list_confirmed_sections(db, card_id)


@router.post("/{card_id}/confirmed-sections/{section}", status_code=204)
async def confirm_section_endpoint(
    card_id: int,
    section: str,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_store_card(db, store.id, card_id)
    normalized = (section or "").strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Section is required")
    await confirm_card_section(db, card_id, normalized, current_user.id)
    return Response(status_code=204)


@router.delete("/{card_id}/confirmed-sections/{section}", status_code=204)
async def unconfirm_section_endpoint(
    card_id: int,
    section: str,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    await _get_store_card(db, store.id, card_id)
    normalized = (section or "").strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Section is required")
    await unconfirm_card_section(db, card_id, normalized)
    return Response(status_code=204)


@router.get("/{card_id}/draft", response_model=Optional[CardDraftOut])
async def get_card_draft_endpoint(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_store_card(db, store.id, card_id)
    return await get_preferred_card_draft(db, card_id, current_user.id)


@router.put("/{card_id}/draft", response_model=CardDraftOut)
async def save_card_draft_endpoint(
    card_id: int,
    payload: CardDraftPayload,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_store_card(db, store.id, card_id)
    return await save_card_draft(
        db,
        card_id=card_id,
        author_id=current_user.id,
        data=payload.model_dump(exclude_none=True),
    )


@router.delete("/{card_id}/draft", status_code=204)
async def delete_card_draft_endpoint(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_store_card(db, store.id, card_id)
    await delete_card_draft(db, card_id, current_user.id)
    return Response(status_code=204)


@router.post("/{card_id}/apply", response_model=CardDetail)
async def apply_card_changes_endpoint(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    card = await _get_store_card(db, store.id, card_id)
    ensure_store_feature_access(store, "cards_write")

    confirmed_sections = set(await list_confirmed_sections(db, card.id))
    missing_sections = [section for section in CARD_WORKFLOW_SECTIONS if section not in confirmed_sections]
    if missing_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Confirm all sections before applying: {', '.join(missing_sections)}",
        )

    try:
        changes = await build_card_approval_changes(db, card.id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not changes:
        raise HTTPException(status_code=400, detail="No card changes found to apply")

    update_payload, next_raw_data = build_card_update_payload(card, changes)

    feature_api_key = get_store_feature_api_key(store, "cards_write")
    if not feature_api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="WB Content key is not configured")
    wb_api = WildberriesAPI(feature_api_key)
    wb_result = await wb_api.update_card(update_payload)
    if not wb_result.get("success"):
        error_msg = wb_result.get("error", "Unknown WB error")
        raise HTTPException(status_code=502, detail=f"WB API error: {error_msg}")

    issue_ids = [int(change["issue_id"]) for change in changes if change.get("issue_id")]
    if issue_ids:
        await mark_applied_to_wb(db, issue_ids)

    apply_card_raw_snapshot(card, next_raw_data)
    card.skip_next_reanalyze = True
    await db.commit()

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

    await delete_card_draft(db, card.id, current_user.id)
    await update_store_stats(db, store.id)
    await db.refresh(card)
    return CardDetail.model_validate(card)


@router.post("/{card_id}/photos/sync", response_model=CardDetail)
async def sync_card_photos_endpoint(
    card_id: int,
    payload: SyncCardPhotosRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    card = await _get_store_card(db, store.id, card_id)
    ensure_store_feature_access(store, "cards_write")

    desired_sources: List[str] = []
    seen_sources: set[str] = set()
    for raw_url in payload.photos:
        source_url = str(raw_url or "").strip()
        if not source_url:
            raise _photo_http_exception("source_url is required", context="wb_sync_photos", default_status=400)
        normalized = WildberriesAPI.strip_url_query(source_url)
        if normalized in seen_sources:
            raise _photo_http_exception("Duplicate photo URLs are not allowed", context="wb_sync_photos", default_status=400)
        seen_sources.add(normalized)
        desired_sources.append(source_url)

    feature_api_key = get_store_feature_api_key(store, "cards_write")
    if not feature_api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="WB Content key is not configured")
    wb_api = WildberriesAPI(feature_api_key)
    current_urls = await wb_api.get_card_photo_urls(card.nm_id)

    uploaded_by_index: Dict[int, str] = {}
    for idx, source_url in enumerate(desired_sources):
        if wb_api.is_wb_media_url(source_url):
            continue

        try:
            content, content_type, ext = await _load_image_bytes_from_source(source_url)
        except Exception as exc:
            logger.warning("sync_card_photos source load failed card_id=%s source_url=%s err=%s", card.id, source_url, str(exc))
            raise _photo_http_exception(f"Cannot load source image: {exc}", context="wb_sync_photos", default_status=400)

        upload_result = await wb_api.upload_card_photo(
            nm_id=card.nm_id,
            content=content,
            content_type=content_type,
            filename=f"card_{card.nm_id}_{idx + 1}{ext}",
        )
        if not upload_result.get("success"):
            logger.warning(
                "sync_card_photos WB upload failed card_id=%s nm_id=%s err=%s",
                card.id,
                card.nm_id,
                upload_result.get("error", "Unknown error"),
            )
            raise _photo_http_exception(
                f"WB photo upload failed: {upload_result.get('error', 'Unknown error')}",
                context="wb_sync_photos",
                default_status=502,
            )
        uploaded_url = str(upload_result.get("photo_url") or "").strip()
        if not uploaded_url:
            raise _photo_http_exception(
                "WB photo upload did not return a photo URL",
                context="wb_sync_photos",
                default_status=502,
            )
        uploaded_by_index[idx] = uploaded_url

    latest_urls = await wb_api.get_card_photo_urls(card.nm_id)
    if not latest_urls:
        latest_urls = current_urls

    final_urls: List[str] = []
    seen_final: set[str] = set()
    for idx, source_url in enumerate(desired_sources):
        candidate = uploaded_by_index.get(idx) or source_url
        resolved = wb_api.resolve_card_photo_url(candidate, latest_urls)
        if not resolved:
            resolved = uploaded_by_index.get(idx)
        if not resolved:
            raise _photo_http_exception(
                f"Photo not found on WB card: {source_url}",
                context="wb_sync_photos",
                default_status=400,
            )

        normalized = WildberriesAPI.strip_url_query(resolved)
        if normalized in seen_final:
            raise _photo_http_exception("Resolved photo list contains duplicates", context="wb_sync_photos", default_status=400)
        seen_final.add(normalized)
        final_urls.append(resolved)

    save_result = await wb_api.save_card_media_state(nm_id=card.nm_id, urls=final_urls)
    if not save_result.get("success"):
        logger.warning(
            "sync_card_photos WB media save failed card_id=%s nm_id=%s err=%s",
            card.id,
            card.nm_id,
            save_result.get("error", "Unknown error"),
        )
        raise _photo_http_exception(
            f"WB media save failed: {save_result.get('error', 'Unknown error')}",
            context="wb_sync_photos",
            default_status=502,
        )
    verification = save_result.get("verification") if isinstance(save_result.get("verification"), dict) else {}
    before_order = list(save_result.get("before_order") or current_urls or [])
    apply_summary = {
        "requested_order": list(verification.get("requested_order") or save_result.get("requested_order") or final_urls),
        "actual_order": list(verification.get("actual_order") or save_result.get("actual_order") or []),
        "matched": bool(verification.get("matched", save_result.get("matched", False))),
        "missing_urls": list(verification.get("missing_urls") or save_result.get("missing_urls") or []),
        "unexpected_urls": list(verification.get("unexpected_urls") or save_result.get("unexpected_urls") or []),
        "stabilized": bool(save_result.get("stabilized", False)),
        "verification": verification or None,
        "applied_at": utc_now().isoformat(),
    }

    refreshed_card = await _refresh_local_card_from_wb(db, store_id=store.id, nm_id=card.nm_id, wb_api=wb_api)
    if refreshed_card:
        card = refreshed_card
    else:
        card.photos = final_urls
        card.photos_count = len(final_urls)
        card.product_dna = None
        raw_data = dict(card.raw_data or {})
        raw_data["photos"] = [{"big": url} for url in final_urls]
        card.raw_data = raw_data
        await db.commit()
        await db.refresh(card)

    raw_data = dict(card.raw_data or {})
    raw_data["media_apply_result"] = apply_summary
    snapshot_record = _build_media_apply_snapshot_record(
        card_id=int(card.id),
        nm_id=int(card.nm_id),
        before_snapshot=before_order,
        requested_after_snapshot=list(apply_summary.get("requested_order") or final_urls or []),
        actual_after_snapshot=list(card.photos or apply_summary.get("actual_order") or []),
        created_at=str(apply_summary["applied_at"]),
        verification=verification or None,
        matched=bool(apply_summary["matched"]),
        stabilized=bool(apply_summary.get("stabilized", False)),
        source="wb_sync_photos",
    )
    # Keep latest snapshot + bounded history for future rollback endpoint/button.
    raw_data = _append_media_apply_history(raw_data, snapshot_record)
    card.raw_data = raw_data
    await db.commit()
    await db.refresh(card)

    card.skip_next_reanalyze = True
    await db.commit()

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

    await update_store_stats(db, store.id)
    await db.refresh(card)
    return CardDetail.model_validate(card)


@router.post("/{card_id}/description-editor/context", response_model=DescriptionEditorContextOut)
async def get_description_editor_context(
    card_id: int,
    payload: DescriptionEditorContextRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    card = await _get_store_card(db, store.id, card_id)
    draft_payload = payload.draft.model_dump(exclude_none=True) if payload.draft else None
    keywords = build_description_editor_keywords(card, draft_payload)
    return DescriptionEditorContextOut(keywords=keywords)


@router.post("/{card_id}/description-editor/generate", response_model=DescriptionGenerateOut)
async def generate_description_editor_value(
    card_id: int,
    payload: DescriptionGenerateRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    card = await _get_store_card(db, store.id, card_id)
    draft_payload = payload.draft.model_dump(exclude_none=True) if payload.draft else None

    try:
        result = await asyncio.wait_for(
            generate_card_description_suggestion(
                card,
                draft=draft_payload,
                instructions=payload.instructions,
            ),
            timeout=90,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Description generation timed out")
    except RuntimeError as exc:
        detail = str(exc) or "Description generation failed"
        if "disabled" in detail.lower():
            raise HTTPException(status_code=503, detail=detail)
        raise HTTPException(status_code=422, detail=detail)
    except Exception:
        raise HTTPException(status_code=502, detail="Description generation failed")

    return DescriptionGenerateOut(**result)


@router.get("/{card_id}", response_model=CardDetail)
async def get_card(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed card info"""
    card = await _get_store_card(db, store.id, card_id)
    card = await ensure_card_issue_consistency(db, card, reanalyze_if_missing=True)

    return CardDetail.model_validate(card)


@router.post("/{card_id}/analyze")
async def analyze_single_card(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Re-analyze a single card"""
    card = await _get_store_card(db, store.id, card_id)

    issues, _tokens = await analyze_card(db, card)
    
    return {
        "message": "Card analyzed",
        "score": card.score,
        "issues_count": len(issues),
    }
