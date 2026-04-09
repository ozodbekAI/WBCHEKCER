from __future__ import annotations

import asyncio
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal, get_db
from app.core.time import utc_now
from app.core.security import get_current_user
from app.models import AnalysisTask, Store, User
from app.schemas.sku_economics import (
    AdAnalysisBootstrapStatusOut,
    AdAnalysisOverviewOut,
    AdAnalysisUploadResultOut,
)
from app.services.sku_economics_service import sku_economics_service
from app.services.wb_token_access import ensure_store_feature_access


router = APIRouter(prefix="/stores/{store_id}/ad-analysis", tags=["Ad Analysis"])
AD_ANALYSIS_BOOTSTRAP_TASK_TYPE = "ad_analysis_bootstrap"
AD_ANALYSIS_BOOTSTRAP_DAYS = 14
AD_ANALYSIS_BOOTSTRAP_PRESET = "14d"
AD_ANALYSIS_BOOTSTRAP_STALE_AFTER = timedelta(minutes=5)


async def _get_accessible_store(
    store_id: int,
    db: AsyncSession,
    current_user: User,
) -> Store:
    result = await db.execute(
        select(Store)
        .where(Store.id == int(store_id))
        .options(selectinload(Store.feature_api_keys))
    )
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


def _bootstrap_progress(task: AnalysisTask | None) -> int:
    if task is None:
        return 0
    if str(task.status) == "completed":
        return 100
    total_items = max(int(task.total_items or 0), 0)
    processed_items = max(int(task.processed_items or 0), 0)
    if total_items <= 0:
        return 5 if str(task.status) in {"pending", "running"} else 0
    if processed_items >= total_items:
        return 99 if str(task.status) == "running" else 100
    return max(5, min(int(processed_items / total_items * 100), 95))


def _serialize_bootstrap_task(task: AnalysisTask | None, *, store_id: int) -> AdAnalysisBootstrapStatusOut:
    payload = task.result if isinstance(getattr(task, "result", None), dict) else {}
    status_value = str(getattr(task, "status", "idle") or "idle")
    if status_value not in {"idle", "pending", "running", "completed", "failed"}:
        status_value = "idle"
    step = str(payload.get("step") or "").strip()
    if not step:
        if status_value == "completed":
            step = "Данные для анализа рекламы готовы"
        elif status_value == "failed":
            step = "Не удалось подготовить анализ рекламы"
        elif status_value in {"pending", "running"}:
            step = "Собираем рекламу, финансы и воронку из Wildberries..."
        else:
            step = "Подготовка анализа рекламы еще не запускалась"
    return AdAnalysisBootstrapStatusOut(
        task_id=getattr(task, "id", None),
        store_id=int(store_id),
        status=status_value,
        progress=_bootstrap_progress(task),
        step=step,
        ready=status_value == "completed",
        error=getattr(task, "error_message", None) or payload.get("error"),
        started_at=getattr(task, "started_at", None),
        completed_at=getattr(task, "completed_at", None),
        period_start=payload.get("period_start"),
        period_end=payload.get("period_end"),
    )


def _is_bootstrap_task_stale(task: AnalysisTask | None) -> bool:
    if task is None:
        return False
    status_value = str(getattr(task, "status", "") or "")
    if status_value not in {"pending", "running"}:
        return False
    reference_at = getattr(task, "started_at", None) or getattr(task, "created_at", None)
    if reference_at is None:
        return False
    return (utc_now() - reference_at) > AD_ANALYSIS_BOOTSTRAP_STALE_AFTER


async def _get_latest_bootstrap_task(db: AsyncSession, store_id: int) -> AnalysisTask | None:
    result = await db.execute(
        select(AnalysisTask)
        .where(
            AnalysisTask.store_id == int(store_id),
            AnalysisTask.task_type == AD_ANALYSIS_BOOTSTRAP_TASK_TYPE,
        )
        .order_by(AnalysisTask.created_at.desc(), AnalysisTask.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _run_ad_analysis_bootstrap(task_id: int, store_id: int) -> None:
    async with AsyncSessionLocal() as db:
        task = await db.get(AnalysisTask, int(task_id))
        if task is None:
            return

        try:
            task.status = "running"
            task.started_at = utc_now()
            task.completed_at = None
            task.total_items = 3
            task.processed_items = 1
            task.error_message = None
            task.result = jsonable_encoder({
                "step": "Сохраняем базовые слои рекламы, финансов и воронки из Wildberries...",
                "preset": AD_ANALYSIS_BOOTSTRAP_PRESET,
                "days": AD_ANALYSIS_BOOTSTRAP_DAYS,
            })
            await db.commit()

            store_result = await db.execute(
                select(Store)
                .where(Store.id == int(store_id))
                .options(selectinload(Store.feature_api_keys))
            )
            store = store_result.scalar_one_or_none()
            if store is None:
                raise ValueError("Store not found")

            ensure_store_feature_access(store, "ad_analysis")

            overview = await asyncio.wait_for(
                sku_economics_service.build_overview(
                    db,
                    store,
                    days=AD_ANALYSIS_BOOTSTRAP_DAYS,
                    preset=AD_ANALYSIS_BOOTSTRAP_PRESET,
                    force=True,
                ),
                timeout=180,
            )

            task.status = "completed"
            task.processed_items = task.total_items
            task.completed_at = utc_now()
            task.result = jsonable_encoder({
                "step": "Данные для анализа рекламы готовы",
                "preset": AD_ANALYSIS_BOOTSTRAP_PRESET,
                "days": AD_ANALYSIS_BOOTSTRAP_DAYS,
                "period_start": overview.period_start,
                "period_end": overview.period_end,
                "snapshot_ready": overview.snapshot_ready,
                "available_period_start": overview.available_period_start,
                "available_period_end": overview.available_period_end,
            })
            await db.commit()
        except Exception as exc:
            await db.rollback()
            task.status = "failed"
            task.completed_at = utc_now()
            task.error_message = str(exc)
            task.result = jsonable_encoder({
                "step": "Не удалось подготовить анализ рекламы",
                "error": str(exc),
                "preset": AD_ANALYSIS_BOOTSTRAP_PRESET,
                "days": AD_ANALYSIS_BOOTSTRAP_DAYS,
            })
            await db.commit()


async def _start_or_get_bootstrap_task(
    db: AsyncSession,
    store: Store,
    *,
    force: bool = False,
) -> AnalysisTask:
    latest_task = await _get_latest_bootstrap_task(db, int(store.id))
    if latest_task is not None and not force:
        latest_status = str(latest_task.status or "")
        if latest_status == "completed":
            return latest_task
        if latest_status in {"pending", "running"} and not _is_bootstrap_task_stale(latest_task):
            return latest_task

    if latest_task is not None and _is_bootstrap_task_stale(latest_task):
        latest_task.status = "failed"
        latest_task.completed_at = utc_now()
        latest_task.error_message = "Подготовка анализа рекламы зависла по тайм-ауту и будет перезапущена."
        latest_task.result = jsonable_encoder({
            "step": "Подготовка анализа рекламы зависла по тайм-ауту и будет перезапущена.",
            "error": latest_task.error_message,
            "preset": AD_ANALYSIS_BOOTSTRAP_PRESET,
            "days": AD_ANALYSIS_BOOTSTRAP_DAYS,
        })
        await db.commit()

    task = AnalysisTask(
        store_id=int(store.id),
        task_type=AD_ANALYSIS_BOOTSTRAP_TASK_TYPE,
        status="pending",
        total_items=3,
        processed_items=0,
        result=jsonable_encoder({
            "step": "Ставим подготовку анализа рекламы в очередь...",
            "preset": AD_ANALYSIS_BOOTSTRAP_PRESET,
            "days": AD_ANALYSIS_BOOTSTRAP_DAYS,
        }),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    asyncio.create_task(_run_ad_analysis_bootstrap(int(task.id), int(store.id)))
    return task


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
    ensure_store_feature_access(store, "ad_analysis")
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


@router.post("/bootstrap/start", response_model=AdAnalysisBootstrapStatusOut)
async def start_ad_analysis_bootstrap(
    store_id: int,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store = await _get_accessible_store(store_id, db, current_user)
    ensure_store_feature_access(store, "ad_analysis")
    task = await _start_or_get_bootstrap_task(db, store, force=force)
    return _serialize_bootstrap_task(task, store_id=store.id)


@router.get("/bootstrap/status", response_model=AdAnalysisBootstrapStatusOut)
async def get_ad_analysis_bootstrap_status(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store = await _get_accessible_store(store_id, db, current_user)
    ensure_store_feature_access(store, "ad_analysis")
    task = await _get_latest_bootstrap_task(db, int(store.id))
    return _serialize_bootstrap_task(task, store_id=store.id)


@router.post("/costs/upload", response_model=AdAnalysisUploadResultOut)
async def upload_ad_costs(
    store_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store = await _get_accessible_store(store_id, db, current_user)
    ensure_store_feature_access(store, "ad_analysis")
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
    store = await _get_accessible_store(store_id, db, current_user)
    ensure_store_feature_access(store, "ad_analysis")
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
    store = await _get_accessible_store(store_id, db, current_user)
    ensure_store_feature_access(store, "ad_analysis")
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
