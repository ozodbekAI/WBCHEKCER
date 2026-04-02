from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Store, User
from app.schemas.sku_economics import AdAnalysisOverviewOut, AdAnalysisUploadResultOut
from app.services.sku_economics_service import sku_economics_service


router = APIRouter(prefix="/stores/{store_id}/ad-analysis", tags=["Ad Analysis"])


async def _get_accessible_store(
    store_id: int,
    db: AsyncSession,
    current_user: User,
) -> Store:
    result = await db.execute(select(Store).where(Store.id == int(store_id)))
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")

    is_owner = int(store.owner_id) == int(current_user.id)
    is_admin = getattr(current_user, "role", None) == "admin"
    is_member = int(getattr(current_user, "store_id", 0) or 0) == int(store_id)
    if not (is_owner or is_admin or is_member):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return store


def _parse_period(value: str | None, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return date.fromisoformat(str(value))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid date: {value}") from exc


def _validate_period(period_start: date, period_end: date) -> None:
    if period_end < period_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period_end must be greater than or equal to period_start")


@router.get("/overview", response_model=AdAnalysisOverviewOut)
async def get_ad_analysis_overview(
    store_id: int,
    days: int = 14,
    preset: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    page: int = 1,
    page_size: int = 25,
    status: str | None = None,
    search: str | None = None,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store = await _get_accessible_store(store_id, db, current_user)
    default_end = date.today()
    default_start = default_end - timedelta(days=max(int(days or 14), 1) - 1)
    parsed_start = _parse_period(period_start, default_start) if period_start else None
    parsed_end = _parse_period(period_end, default_end) if period_end else None
    if parsed_start and parsed_end:
        _validate_period(parsed_start, parsed_end)
    return await sku_economics_service.build_overview(
        db,
        store,
        days=days,
        period_start=parsed_start,
        period_end=parsed_end,
        preset=preset,
        page=page,
        page_size=page_size,
        status_filter=status,
        search=search,
        force=force,
    )


@router.post("/costs/upload", response_model=AdAnalysisUploadResultOut)
async def upload_ad_costs(
    store_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_accessible_store(store_id, db, current_user)
    content = await file.read()
    result = await sku_economics_service.upload_costs(
        db,
        store_id=store_id,
        file_name=file.filename or "costs.xlsx",
        content=content,
    )
    return AdAnalysisUploadResultOut(
        imported=result.imported,
        updated=result.updated,
        file_name=file.filename or "costs.xlsx",
        notes=result.notes,
        detected_headers=result.detected_headers,
        matched_fields=result.matched_fields,
        resolved_by_vendor_code=result.resolved_by_vendor_code,
        unresolved_count=result.unresolved_count,
        unresolved_preview=result.unresolved_preview,
    )


@router.post("/manual-spend/upload", response_model=AdAnalysisUploadResultOut)
async def upload_ad_manual_spend(
    store_id: int,
    file: UploadFile = File(...),
    period_start: str | None = Form(None),
    period_end: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_accessible_store(store_id, db, current_user)
    default_end = date.today()
    default_start = default_end - timedelta(days=13)
    parsed_start = _parse_period(period_start, default_start)
    parsed_end = _parse_period(period_end, default_end)
    _validate_period(parsed_start, parsed_end)
    content = await file.read()
    result = await sku_economics_service.upload_manual_spend(
        db,
        store_id=store_id,
        file_name=file.filename or "manual-spend.xlsx",
        content=content,
        period_start=parsed_start,
        period_end=parsed_end,
    )
    return AdAnalysisUploadResultOut(
        imported=result.imported,
        updated=result.updated,
        file_name=file.filename or "manual-spend.xlsx",
        period_start=parsed_start,
        period_end=parsed_end,
        notes=result.notes,
        detected_headers=result.detected_headers,
        matched_fields=result.matched_fields,
        resolved_by_vendor_code=result.resolved_by_vendor_code,
        unresolved_count=result.unresolved_count,
        unresolved_preview=result.unresolved_preview,
    )


@router.post("/finance/upload", response_model=AdAnalysisUploadResultOut)
async def upload_ad_manual_finance(
    store_id: int,
    file: UploadFile = File(...),
    period_start: str | None = Form(None),
    period_end: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_accessible_store(store_id, db, current_user)
    default_end = date.today()
    default_start = default_end - timedelta(days=13)
    parsed_start = _parse_period(period_start, default_start)
    parsed_end = _parse_period(period_end, default_end)
    _validate_period(parsed_start, parsed_end)
    content = await file.read()
    result = await sku_economics_service.upload_manual_finance(
        db,
        store_id=store_id,
        file_name=file.filename or "finance.xlsx",
        content=content,
        period_start=parsed_start,
        period_end=parsed_end,
    )
    return AdAnalysisUploadResultOut(
        imported=result.imported,
        updated=result.updated,
        file_name=file.filename or "finance.xlsx",
        period_start=parsed_start,
        period_end=parsed_end,
        notes=result.notes,
        detected_headers=result.detected_headers,
        matched_fields=result.matched_fields,
        resolved_by_vendor_code=result.resolved_by_vendor_code,
        unresolved_count=result.unresolved_count,
        unresolved_preview=result.unresolved_preview,
    )
