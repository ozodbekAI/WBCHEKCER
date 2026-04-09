"""
Fixed File Router
Endpoints for uploading, viewing, editing and deleting fixed characteristic values.
Only owner and head_manager can manage (upload/edit/delete) fixed files.
Any store member can view (GET).
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.security import get_current_user
from ..models import User, Store, UserRole
from ..services import get_store_by_id
from ..services import fixed_file_service as ffs

router = APIRouter(prefix="/stores/{store_id}/fixed-file", tags=["Fixed File"])

# ─── Permission helper ────────────────────────────────────────────────────────

_MANAGE_ROLES = {UserRole.ADMIN, UserRole.OWNER, UserRole.HEAD_MANAGER}


async def _get_store(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Store:
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    role = current_user.role if isinstance(current_user.role, UserRole) else UserRole(current_user.role)
    if role == UserRole.ADMIN:
        return store
    if store.owner_id != current_user.id and getattr(current_user, "store_id", None) != store.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return store


def _require_manage(current_user: User) -> None:
    role = current_user.role if isinstance(current_user.role, UserRole) else UserRole(current_user.role)
    if role not in _MANAGE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только владелец или старший менеджер могут управлять эталонными значениями",
        )


# ─── Schemas ──────────────────────────────────────────────────────────────────

class FixedEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    nm_id: int
    brand: Optional[str] = None
    subject_name: Optional[str] = None
    char_name: str
    fixed_value: str
    created_at: datetime
    updated_at: datetime

class FixedEntryListOut(BaseModel):
    items: List[FixedEntryOut]
    total: int
    page: int
    limit: int


class FixedEntryUpdate(BaseModel):
    fixed_value: str


class UploadResult(BaseModel):
    upserted: int
    message: str


class HasFixedFile(BaseModel):
    has_fixed_file: bool


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/status", response_model=HasFixedFile)
async def check_has_fixed_file(
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
):
    """Quick check: does this store have any fixed file entries?"""
    has = await ffs.has_any_entries(db, store.id)
    return HasFixedFile(has_fixed_file=has)


@router.get("/template")
async def download_template(
    store: Store = Depends(_get_store),
):
    """Download Excel template for fixed values."""
    xlsx_bytes = ffs.generate_template_excel()
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="fixed_values_template.xlsx"'},
    )


@router.post("/upload", response_model=UploadResult)
async def upload_fixed_file(
    file: UploadFile = File(...),
    replace_all: bool = Query(False, description="Удалить все существующие записи перед загрузкой"),
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upload an Excel fixed file for the store.
    Only owner / head_manager can upload.
    """
    _require_manage(current_user)

    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Только Excel файлы (.xlsx, .xls)")

    content = await file.read()
    try:
        entries = ffs.parse_excel(content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Ошибка чтения Excel: {e}")

    if not entries:
        raise HTTPException(status_code=422, detail="Файл пуст или не содержит данных")

    if replace_all:
        await ffs.delete_all_entries(db, store.id)

    count = await ffs.upsert_entries(db, store.id, entries, current_user.id)
    return UploadResult(
        upserted=count,
        message=f"Загружено {count} эталонных значений",
    )


@router.get("", response_model=FixedEntryListOut)
async def list_fixed_entries(
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
    nm_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=100000),
):
    """List fixed file entries for a store."""
    skip = (page - 1) * limit
    items, total = await ffs.get_entries(db, store.id, nm_id=nm_id, skip=skip, limit=limit)
    return FixedEntryListOut(
        items=[FixedEntryOut.model_validate(i) for i in items],
        total=total,
        page=page,
        limit=limit,
    )


@router.put("/{entry_id}", response_model=FixedEntryOut)
async def update_fixed_entry(
    entry_id: int,
    body: FixedEntryUpdate,
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit a fixed value. Only owner / head_manager."""
    _require_manage(current_user)

    entry = await ffs.update_entry(db, entry_id, store.id, body.fixed_value.strip())
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return FixedEntryOut.model_validate(entry)


@router.delete("/{entry_id}", status_code=204)
async def delete_fixed_entry(
    entry_id: int,
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single fixed entry. Only owner / head_manager."""
    _require_manage(current_user)

    deleted = await ffs.delete_entry(db, entry_id, store.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")


@router.delete("", status_code=204)
async def delete_all_fixed_entries(
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete ALL fixed entries for the store. Only owner / head_manager."""
    _require_manage(current_user)
    await ffs.delete_all_entries(db, store.id)



class GenerateFromPhotoResult(BaseModel):
    nm_id: int
    generated: int
    characteristics: dict
    message: str
    has_openai: bool


@router.post("/generate-from-photo/{nm_id}", response_model=GenerateFromPhotoResult)
async def generate_fixed_from_photo(
    nm_id: int,
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Mahsulot fotosini GPT-4o-mini ga yuborib Product DNA generatsiya qiladi,
    xarakteristikalarni FixedFileEntry ga saqlaydi.

    Faqat OPENAI_API_KEY sozlangan bo'lsa ishlaydi.
    Only owner / head_manager can run.
    """
    _require_manage(current_user)

    from ..services.card_service import get_card_by_nm_id
    from ..services.vision_service import vision_service

    card = await get_card_by_nm_id(db, nm_id, store.id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    if not vision_service.is_enabled:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY sozlanmagan. .env faylida OPENAI_API_KEY ni kiriting.",
        )

    result = await ffs.generate_characteristics_from_photo(
        db=db,
        store_id=store.id,
        nm_id=nm_id,
        card_raw_data=card.raw_data or {},
        user_id=current_user.id,
    )

    if result.get("error"):
        raise HTTPException(status_code=422, detail=result["error"])

    return GenerateFromPhotoResult(
        nm_id=nm_id,
        generated=result["generated"],
        characteristics=result["characteristics"],
        message=f"Foto tahlil qilindi. {result['generated']} ta xarakteristika saqlandi.",
        has_openai=vision_service.is_enabled,
    )


@router.post("/recheck/{nm_id}")
async def recheck_card_fixed(
    nm_id: int,
    store: Store = Depends(_get_store),
    db: AsyncSession = Depends(get_db),
):
    """
    Re-compare a specific card's characteristics against fixed file entries.
    Returns list of mismatches (no AI needed, pure comparison).
    """
    from ..services.card_service import get_card_by_nm_id
    from ..services.fixed_file_service import get_entries_for_card, compare_card_with_fixed

    entries = await get_entries_for_card(db, store.id, nm_id)
    if not entries:
        return {"mismatches": [], "message": "Нет эталонных значений для этой карточки"}

    card = await get_card_by_nm_id(db, nm_id, store.id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    raw = card.raw_data or {}
    mismatches = compare_card_with_fixed(raw, entries)
    return {
        "nm_id": nm_id,
        "mismatches": mismatches,
        "total": len(mismatches),
    }
