# routers/photo_assets.py

import logging
import os
import uuid
from pathlib import Path
from typing import Any, List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db_dependency
from app.core.dependencies import get_current_user, require_admin
from app.models.photo_asset import PhotoAsset, AssetType, AssetOwnerType
from app.services.photo_asset_repository import PhotoAssetRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/photo-assets", tags=["Photo Assets"])


# ==================== Schemas ====================

class PhotoAssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_type: str
    owner_type: str
    user_id: Optional[int] = None
    name: str
    description: Optional[str] = None
    prompt: Optional[str] = None
    image_url: str
    file_url: Optional[str] = None  # compatibility alias for older frontend clients
    url: Optional[str] = None       # compatibility alias for older frontend clients
    thumbnail_url: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    order_index: int
    is_active: bool
    
class PhotoAssetCreate(BaseModel):
    asset_type: str  # model, scene, pose, custom
    name: str
    description: Optional[str] = None
    prompt: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    order_index: int = 0


class PhotoAssetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    prompt: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None


class PhotoAssetListResponse(BaseModel):
    assets: List[PhotoAssetResponse]
    total: int


class CategoriesResponse(BaseModel):
    categories: List[str]

class PhotoAssetAddFromUrlRequest(BaseModel):
    asset_type: str
    source_url: str
    name: Optional[str] = None
    description: Optional[str] = None
    prompt: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None


# ==================== Helper functions ====================

UPLOAD_DIR = "media/assets"
MAX_REMOTE_BYTES = 15 * 1024 * 1024  # 15MB safety limit

# Allowlist for remotely fetching images to avoid SSRF.
# We support WB CDN + our own PUBLIC_BASE_URL host (for absolute /media links).
ALLOWED_REMOTE_HOST_SUFFIXES = (
    "wbbasket.ru",
    "wbstatic.net",
    "wildberries.ru",
    "wb.ru",
)

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
CONTENT_TYPE_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _extract_user_id(user: Any) -> int:
    """Return current user id for both dict and ORM User dependency shapes."""
    raw_uid = None
    if isinstance(user, dict):
        raw_uid = user.get("user_id") or user.get("id")
    else:
        raw_uid = getattr(user, "id", None)
    if raw_uid is None:
        raise HTTPException(401, "Unauthorized")
    try:
        return int(raw_uid)
    except (TypeError, ValueError):
        raise HTTPException(401, "Invalid user context")


def ensure_upload_dir():
    """Upload katalogini yaratish"""
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def save_uploaded_file(file: UploadFile) -> str:
    """Faylni saqlash va URL qaytarish"""
    ensure_upload_dir()
    
    # Unique filename
    ext = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    # Save file
    with open(filepath, "wb") as f:
        content = file.file.read()
        f.write(content)
    
    # Return relative URL
    return f"/media/assets/{filename}"

def save_bytes_to_file(content: bytes, ext: str) -> str:
    """Save raw bytes into UPLOAD_DIR with a unique name and return public URL."""
    ensure_upload_dir()

    safe_ext = (ext or "").lower()
    if safe_ext and not safe_ext.startswith("."):
        safe_ext = f".{safe_ext}"
    if safe_ext not in ALLOWED_IMAGE_EXTS:
        safe_ext = ".jpg"

    filename = f"{uuid.uuid4()}{safe_ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    return f"/media/assets/{filename}"

def _is_allowed_remote_host(host: str) -> bool:
    host = (host or "").lower()
    if not host:
        return False

    # Allow our own public host for absolute /media links.
    try:
        public_host = (urlparse(settings.PUBLIC_BASE_URL).hostname or "").lower()
    except Exception:
        public_host = ""
    if public_host and host == public_host:
        return True

    return any(host == suffix or host.endswith(f".{suffix}") for suffix in ALLOWED_REMOTE_HOST_SUFFIXES)

def _resolve_local_media_path(source_url: str) -> Optional[Path]:
    """
    Convert /media/* URL into a safe local filesystem path (under settings.MEDIA_ROOT).
    Returns None when the URL doesn't point to our media.
    """
    if not source_url:
        return None

    raw = source_url.strip()

    parsed = urlparse(raw)
    if parsed.scheme in ("http", "https") and parsed.path.startswith("/media/"):
        # Only trust absolute /media links if host matches our own public host.
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
        raise HTTPException(400, "Invalid media path")

    media_root = Path(settings.MEDIA_ROOT).resolve()
    full_path = (media_root / rel).resolve()
    if not str(full_path).startswith(str(media_root) + os.sep) and full_path != media_root:
        raise HTTPException(400, "Invalid media path")

    return full_path

async def _download_image_bytes(source_url: str) -> tuple[bytes, str]:
    """
    Download image bytes from a remote URL with basic SSRF protections.
    Returns (bytes, ext).
    """
    parsed = urlparse(source_url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Unsupported URL scheme")

    host = (parsed.hostname or "").lower()
    if not _is_allowed_remote_host(host):
        raise HTTPException(400, "Unsupported URL host")

    timeout = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            resp = await client.get(source_url)
        except httpx.HTTPError as e:
            raise HTTPException(400, f"Failed to fetch image: {e}") from e

        final_host = (resp.url.host or "").lower()
        if not _is_allowed_remote_host(final_host):
            raise HTTPException(400, "Redirected to an unsupported host")

        if resp.status_code >= 400:
            raise HTTPException(400, f"Failed to fetch image (HTTP {resp.status_code})")

        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if not content_type.startswith("image/"):
            raise HTTPException(400, "URL does not point to an image")

        # Stream with a hard cap.
        chunks: list[bytes] = []
        total = 0
        async for chunk in resp.aiter_bytes():
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_REMOTE_BYTES:
                raise HTTPException(413, "Image is too large")
            chunks.append(chunk)
        content = b"".join(chunks)

        # Determine ext from content-type first, then URL.
        ext = CONTENT_TYPE_TO_EXT.get(content_type)
        if not ext:
            ext = os.path.splitext(resp.url.path)[1].lower()
        return content, ext or ".jpg"


def get_asset_type(type_str: str) -> AssetType:
    """String dan AssetType ga convert"""
    type_map = {
        "model": AssetType.MODEL,
        "scene": AssetType.SCENE,
        "pose": AssetType.POSE,
        "custom": AssetType.CUSTOM,
    }
    if type_str.lower() not in type_map:
        raise HTTPException(400, f"Invalid asset type: {type_str}")
    return type_map[type_str.lower()]


def asset_to_response(asset: PhotoAsset) -> PhotoAssetResponse:
    """Model dan response ga convert"""
    return PhotoAssetResponse(
        id=asset.id,
        asset_type=asset.asset_type.value,
        owner_type=asset.owner_type.value,
        user_id=asset.user_id,
        name=asset.name,
        description=asset.description,
        prompt=asset.prompt,
        image_url=asset.image_url,
        file_url=asset.image_url,
        url=asset.image_url,
        thumbnail_url=asset.thumbnail_url,
        category=asset.category,
        subcategory=asset.subcategory,
        order_index=asset.order_index,
        is_active=asset.is_active,
    )


# ==================== Admin Endpoints ====================

@router.post("/admin/upload", response_model=PhotoAssetResponse)
async def admin_upload_asset(
    file: UploadFile = File(...),
    asset_type: str = Form(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    subcategory: Optional[str] = Form(None),
    order_index: int = Form(0),
    db: Session = Depends(get_db_dependency),
    admin: dict = Depends(require_admin),
):
    """
    Admin: System asset yuklash (barcha userlar ko'radi)
    """
    try:
        admin_id = _extract_user_id(admin)
        # Save file
        image_url = save_uploaded_file(file)
        
        # Create asset
        repo = PhotoAssetRepository(db)
        asset = repo.create(
            asset_type=get_asset_type(asset_type),
            owner_type=AssetOwnerType.SYSTEM,
            name=name,
            image_url=image_url,
            description=description,
            prompt=prompt,
            category=category,
            subcategory=subcategory,
            order_index=order_index,
        )
        
        logger.info("Admin %s uploaded system asset: %s", admin_id, asset.id)
        return asset_to_response(asset)
        
    except Exception as e:
        logger.error(f"Admin upload error: {e}")
        raise HTTPException(500, str(e))


@router.get("/admin/list", response_model=PhotoAssetListResponse)
async def admin_list_assets(
    asset_type: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db_dependency),
    admin: dict = Depends(require_admin),
):
    """
    Admin: System assetlar ro'yxati
    """
    repo = PhotoAssetRepository(db)
    
    type_filter = get_asset_type(asset_type) if asset_type else None
    assets = repo.get_system_assets(asset_type=type_filter, category=category, is_active=None)
    
    return PhotoAssetListResponse(
        assets=[asset_to_response(a) for a in assets],
        total=len(assets),
    )


@router.put("/admin/{asset_id}", response_model=PhotoAssetResponse)
async def admin_update_asset(
    asset_id: int,
    data: PhotoAssetUpdate,
    db: Session = Depends(get_db_dependency),
    admin: dict = Depends(require_admin),
):
    """
    Admin: System assetni yangilash
    """
    repo = PhotoAssetRepository(db)
    asset = repo.get_by_id(asset_id)
    
    if not asset:
        raise HTTPException(404, "Asset not found")
    
    if asset.owner_type != AssetOwnerType.SYSTEM:
        raise HTTPException(403, "Can only edit system assets")
    
    updated = repo.update(asset_id, **data.model_dump(exclude_none=True))
    return asset_to_response(updated)


@router.delete("/admin/{asset_id}")
async def admin_delete_asset(
    asset_id: int,
    db: Session = Depends(get_db_dependency),
    admin: dict = Depends(require_admin),
):
    """
    Admin: System assetni o'chirish
    """
    repo = PhotoAssetRepository(db)
    asset = repo.get_by_id(asset_id)
    
    if not asset:
        raise HTTPException(404, "Asset not found")
    
    if asset.owner_type != AssetOwnerType.SYSTEM:
        raise HTTPException(403, "Can only delete system assets")
    
    # Delete file
    if asset.image_url and asset.image_url.startswith("/media/"):
        file_path = asset.image_url.lstrip("/")
        if os.path.exists(file_path):
            os.remove(file_path)
    
    repo.delete(asset_id)
    return {"success": True, "message": "Asset deleted"}


# ==================== User Endpoints ====================

@router.post("/user/upload", response_model=PhotoAssetResponse)
async def user_upload_asset(
    file: UploadFile = File(...),
    asset_type: Optional[str] = Form(None),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    subcategory: Optional[str] = Form(None),
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    User: O'z assetini yuklash
    """
    try:
        user_id = _extract_user_id(user)
        resolved_asset_type = (asset_type or "custom").strip() or "custom"
        resolved_name = (name or file.filename or f"Upload {uuid.uuid4().hex[:8]}").strip()
        if not resolved_name:
            resolved_name = f"Upload {uuid.uuid4().hex[:8]}"

        # Save file
        image_url = save_uploaded_file(file)
        
        # Create asset
        repo = PhotoAssetRepository(db)
        asset = repo.create(
            asset_type=get_asset_type(resolved_asset_type),
            owner_type=AssetOwnerType.USER,
            user_id=user_id,
            name=resolved_name,
            image_url=image_url,
            description=description,
            prompt=prompt,
            category=category,
            subcategory=subcategory,
        )
        
        logger.info("User %s uploaded personal asset: %s", user_id, asset.id)
        return asset_to_response(asset)
        
    except Exception as e:
        logger.error(f"User upload error: {e}")
        raise HTTPException(500, str(e))

@router.post("/user/add-from-url", response_model=PhotoAssetResponse)
@router.post("/user/import", response_model=PhotoAssetResponse)
async def user_add_asset_from_url(
    data: PhotoAssetAddFromUrlRequest,
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    User: Save an asset by importing an image from an existing URL.
    Useful for adding WB card photos / generated history items into "My samples".
    """
    source_url = (data.source_url or "").strip()
    if not source_url:
        raise HTTPException(400, "source_url is required")
    user_id = _extract_user_id(user)

    # Local /media/* path support
    local_path = _resolve_local_media_path(source_url)
    content: bytes
    ext: str
    if local_path is not None:
        if not local_path.exists() or not local_path.is_file():
            raise HTTPException(404, "Source file not found")
        if local_path.stat().st_size > MAX_REMOTE_BYTES:
            raise HTTPException(413, "Image is too large")
        content = local_path.read_bytes()
        ext = local_path.suffix.lower() or ".jpg"
    else:
        content, ext = await _download_image_bytes(source_url)

    try:
        image_url = save_bytes_to_file(content, ext)

        repo = PhotoAssetRepository(db)
        name = (data.name or "").strip() or f"Imported {uuid.uuid4().hex[:8]}"
        asset = repo.create(
            asset_type=get_asset_type(data.asset_type),
            owner_type=AssetOwnerType.USER,
            user_id=user_id,
            name=name,
            image_url=image_url,
            description=data.description,
            prompt=data.prompt,
            category=data.category,
            subcategory=data.subcategory,
        )

        logger.info(
            "User %s imported asset from url (%s): %s",
            user_id,
            data.asset_type,
            asset.id,
        )
        return asset_to_response(asset)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"User add-from-url error: {e}")
        raise HTTPException(500, str(e))


@router.get("/user/my-assets", response_model=PhotoAssetListResponse)
async def user_get_my_assets(
    asset_type: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    User: O'z assetlari ro'yxati
    """
    repo = PhotoAssetRepository(db)
    user_id = _extract_user_id(user)
    
    type_filter = get_asset_type(asset_type) if asset_type else None
    assets = repo.get_user_assets(
        user_id=user_id,
        asset_type=type_filter,
        category=category,
    )
    
    return PhotoAssetListResponse(
        assets=[asset_to_response(a) for a in assets],
        total=len(assets),
    )


@router.put("/user/{asset_id}", response_model=PhotoAssetResponse)
async def user_update_asset(
    asset_id: int,
    data: PhotoAssetUpdate,
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    User: O'z assetini yangilash
    """
    repo = PhotoAssetRepository(db)
    user_id = _extract_user_id(user)
    asset = repo.get_by_id(asset_id)
    
    if not asset:
        raise HTTPException(404, "Asset not found")
    
    if asset.owner_type != AssetOwnerType.USER or asset.user_id != user_id:
        raise HTTPException(403, "Can only edit your own assets")
    
    updated = repo.update(asset_id, **data.model_dump(exclude_none=True))
    return asset_to_response(updated)


@router.delete("/user/{asset_id}")
async def user_delete_asset(
    asset_id: int,
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    User: O'z assetini o'chirish
    """
    repo = PhotoAssetRepository(db)
    user_id = _extract_user_id(user)

    asset = repo.get_by_id(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found or not owned by you")

    if asset.owner_type != AssetOwnerType.USER or asset.user_id != user_id:
        raise HTTPException(404, "Asset not found or not owned by you")

    # Delete DB row first, then try to delete the file (best-effort).
    repo.delete(asset_id)

    try:
        local_path = _resolve_local_media_path(asset.image_url)
        if local_path and local_path.exists() and local_path.is_file():
            local_path.unlink()
    except Exception:
        # Avoid failing deletion because of filesystem issues.
        pass

    return {"success": True, "message": "Asset deleted"}


# ==================== Public Endpoints (for catalog) ====================

@router.get("/catalog", response_model=PhotoAssetListResponse)
async def get_catalog(
    asset_type: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    Katalog: System + User assets (user ko'radigan hammasi)
    """
    repo = PhotoAssetRepository(db)
    user_id = _extract_user_id(user)
    
    type_filter = get_asset_type(asset_type) if asset_type else None
    assets = repo.get_all_for_user(
        user_id=user_id,
        asset_type=type_filter,
        category=category,
    )
    
    return PhotoAssetListResponse(
        assets=[asset_to_response(a) for a in assets],
        total=len(assets),
    )


@router.get("/catalog/categories", response_model=CategoriesResponse)
async def get_categories(
    asset_type: str,
    db: Session = Depends(get_db_dependency),
    user: dict = Depends(get_current_user),
):
    """
    Kategoriyalar ro'yxati
    """
    repo = PhotoAssetRepository(db)
    user_id = _extract_user_id(user)
    
    # System kategoriyalari
    system_cats = repo.get_categories(
        asset_type=get_asset_type(asset_type),
        owner_type=AssetOwnerType.SYSTEM,
    )
    
    # User kategoriyalari
    user_cats = repo.get_categories(
        asset_type=get_asset_type(asset_type),
        owner_type=AssetOwnerType.USER,
        user_id=user_id,
    )
    
    # Unique categories
    all_cats = list(set(system_cats + user_cats))
    all_cats.sort()
    
    return CategoriesResponse(categories=all_cats)
