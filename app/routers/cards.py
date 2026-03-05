import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.database import get_db
from ..core.security import get_current_user
from ..models import User, Store, Card, StoreStatus, IssueStatus
from ..schemas import CardOut, CardDetail, CardListOut
from ..services import get_store_by_id, get_card_by_id, get_store_cards, analyze_card
from ..services.wb_api import WildberriesAPI

router = APIRouter(prefix="/stores/{store_id}/cards", tags=["Cards"])

MAX_REMOTE_BYTES = 15 * 1024 * 1024
ALLOWED_REMOTE_HOST_SUFFIXES = (
    "wbbasket.ru",
    "wbstatic.net",
    "wildberries.ru",
    "wb.ru",
)


class ReplaceWbPhotoRequest(BaseModel):
    source_url: str
    slot: int = Field(1, ge=1, le=30)


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
    
    if store.owner_id != current_user.id and current_user.role != "admin":
        if getattr(current_user, 'store_id', None) != store.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )

    return store


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
    )
    
    return CardListOut(
        items=[CardOut.model_validate(c) for c in cards],
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

    wb_api = WildberriesAPI(store.api_key)
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

    source_url = (payload.source_url or "").strip()
    if not source_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="source_url is required")

    try:
        content, content_type, ext = await _load_image_bytes_from_source(source_url)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot load source image: {e}")

    wb_api = WildberriesAPI(store.api_key)
    result = await wb_api.upload_card_photo(
        nm_id=int(nm_id),
        content=content,
        content_type=content_type,
        photo_number=int(payload.slot),
        filename=f"slot_{int(payload.slot)}{ext}",
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"WB photo replace failed: {result.get('error', 'Unknown error')}",
        )

    photos = result.get("photos") or []
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


@router.get("/{card_id}", response_model=CardDetail)
async def get_card(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed card info"""
    card = await get_card_by_id(db, card_id)
    
    if not card or card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found"
        )
    
    return CardDetail.model_validate(card)


@router.post("/{card_id}/analyze")
async def analyze_single_card(
    card_id: int,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Re-analyze a single card"""
    card = await get_card_by_id(db, card_id)
    
    if not card or card.store_id != store.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found"
        )
    
    issues, _tokens = await analyze_card(db, card)
    
    return {
        "message": "Card analyzed",
        "score": card.score,
        "issues_count": len(issues),
    }
