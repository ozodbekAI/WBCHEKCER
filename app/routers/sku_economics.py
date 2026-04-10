from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import AdAnalysisBootstrapJob, Store, User
from app.schemas.sku_economics import (
    AdAnalysisBootstrapStatusOut,
    AdAnalysisOverviewOut,
    AdAnalysisSourceStatusOut,
    AdAnalysisUploadResultOut,
)
from app.services.ad_analysis_bootstrap_scheduler import (
    BOOTSTRAP_STATUS_COMPLETED,
    BOOTSTRAP_STATUS_COMPLETED_PARTIAL,
)
from app.services.sku_economics_service import sku_economics_service
from app.services.wb_token_access import ensure_store_feature_access


router = APIRouter(prefix="/stores/{store_id}/ad-analysis", tags=["Ad Analysis"])
AD_ANALYSIS_BOOTSTRAP_DAYS = 14
AD_ANALYSIS_BOOTSTRAP_PRESET = "14d"
BOOTSTRAP_SOURCE_MODES = {
    "automatic",
    "manual",
    "partial",
    "manual_required",
    "failed",
    "pending",
    "running",
    "missing",
}
BOOTSTRAP_FAILED_SOURCES = {"advert", "finance", "funnel", "snapshot", "unknown"}


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


def _default_bootstrap_source_statuses() -> list[dict[str, Any]]:
    return [
        AdAnalysisSourceStatusOut(id="advert", label="Реклама WB", mode="pending", detail=None, records=0).model_dump(mode="json"),
        AdAnalysisSourceStatusOut(id="finance", label="Финансы WB", mode="pending", detail=None, records=0).model_dump(mode="json"),
        AdAnalysisSourceStatusOut(id="funnel", label="Воронка продаж", mode="pending", detail=None, records=0).model_dump(mode="json"),
    ]


def _parse_source_statuses(raw: object) -> list[AdAnalysisSourceStatusOut]:
    if isinstance(raw, list):
        out: list[AdAnalysisSourceStatusOut] = []
        for item in raw:
            if isinstance(item, dict):
                try:
                    out.append(AdAnalysisSourceStatusOut.model_validate(item))
                except Exception:
                    continue
        return out

    if isinstance(raw, dict):
        out: list[AdAnalysisSourceStatusOut] = []
        for source_id, mode in raw.items():
            source_key = str(source_id or "").strip()
            if not source_key:
                continue
            mode_value = str(mode or "").strip()
            out.append(
                AdAnalysisSourceStatusOut(
                    id=source_key,
                    label=source_key,
                    mode=mode_value if mode_value in BOOTSTRAP_SOURCE_MODES else "missing",
                    detail=None,
                    records=0,
                )
            )
        return out

    return []


def _serialize_bootstrap_job(job: AdAnalysisBootstrapJob | None, *, store_id: int) -> AdAnalysisBootstrapStatusOut:
    if job is None:
        return AdAnalysisBootstrapStatusOut(
            task_id=None,
            store_id=int(store_id),
            status="idle",
            progress=0,
            step="Подготовка анализа рекламы еще не запускалась",
            current_stage=None,
            stage_progress=0,
            source_statuses=[],
            is_partial=False,
            failed_source=None,
            ready=False,
            error=None,
            started_at=None,
            completed_at=None,
            period_start=None,
            period_end=None,
        )

    status_value = str(job.status or "idle").strip().lower()
    if status_value not in {"idle", "pending", "running", "completed", "completed_partial", "failed"}:
        status_value = "idle"

    current_stage = str(job.current_stage or "").strip() or None
    if current_stage not in {
        "queued",
        "fetching_advert",
        "fetching_finance",
        "fetching_funnel",
        "building_snapshot",
        "completed_partial",
        "completed",
        "failed",
    }:
        current_stage = None

    source_statuses = _parse_source_statuses(job.source_statuses)
    stage_progress = max(0, min(int(job.stage_progress or 0), 100))
    step = str(job.step or "").strip()
    if not step:
        if status_value in {"completed", "completed_partial"}:
            step = "Данные для анализа рекламы готовы."
        elif status_value == "failed":
            step = "Не удалось подготовить анализ рекламы."
        elif status_value in {"pending", "running"}:
            step = "Собираем рекламу, финансы и воронку из Wildberries..."
        else:
            step = "Подготовка анализа рекламы еще не запускалась"

    failed_source = str(job.failed_source or "").strip() or None
    if failed_source not in BOOTSTRAP_FAILED_SOURCES:
        failed_source = None

    ready = status_value in {BOOTSTRAP_STATUS_COMPLETED, BOOTSTRAP_STATUS_COMPLETED_PARTIAL}
    return AdAnalysisBootstrapStatusOut(
        task_id=int(job.id),
        store_id=int(store_id),
        status=status_value,
        progress=stage_progress,
        step=step,
        current_stage=current_stage,
        stage_progress=stage_progress,
        source_statuses=source_statuses,
        is_partial=bool(job.is_partial or status_value == BOOTSTRAP_STATUS_COMPLETED_PARTIAL),
        failed_source=failed_source,
        ready=ready,
        error=str(job.error_message or "").strip() or None,
        started_at=job.started_at,
        completed_at=job.completed_at,
        period_start=job.period_start,
        period_end=job.period_end,
    )


async def _get_latest_bootstrap_job(db: AsyncSession, store_id: int) -> AdAnalysisBootstrapJob | None:
    result = await db.execute(
        select(AdAnalysisBootstrapJob)
        .where(AdAnalysisBootstrapJob.store_id == int(store_id))
        .order_by(AdAnalysisBootstrapJob.created_at.desc(), AdAnalysisBootstrapJob.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _start_or_get_bootstrap_job(
    db: AsyncSession,
    store: Store,
    *,
    started_by_id: int | None,
    force: bool = False,
) -> AdAnalysisBootstrapJob:
    latest_job = await _get_latest_bootstrap_job(db, int(store.id))
    if latest_job is not None and not force:
        latest_status = str(latest_job.status or "")
        if latest_status in {"pending", "running", "completed", "completed_partial"}:
            return latest_job

    if latest_job is not None and force and str(latest_job.status or "") in {"pending", "running"}:
        latest_job.status = "failed"
        latest_job.current_stage = "failed"
        latest_job.stage_progress = 100
        latest_job.error_message = "Bootstrap restarted by force"
        latest_job.step = "Предыдущая задача принудительно остановлена и перезапущена."

    job = AdAnalysisBootstrapJob(
        store_id=int(store.id),
        requested_by_id=started_by_id,
        status="pending",
        current_stage="queued",
        stage_progress=0,
        step="Ставим подготовку анализа рекламы в очередь...",
        days=AD_ANALYSIS_BOOTSTRAP_DAYS,
        preset=AD_ANALYSIS_BOOTSTRAP_PRESET,
        source_statuses=_default_bootstrap_source_statuses(),
        is_partial=False,
        failed_source=None,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


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
    job = await _start_or_get_bootstrap_job(
        db,
        store,
        started_by_id=int(getattr(current_user, "id", 0) or 0) or None,
        force=force,
    )
    return _serialize_bootstrap_job(job, store_id=store.id)


@router.get("/bootstrap/status", response_model=AdAnalysisBootstrapStatusOut)
async def get_ad_analysis_bootstrap_status(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    store = await _get_accessible_store(store_id, db, current_user)
    ensure_store_feature_access(store, "ad_analysis")
    job = await _get_latest_bootstrap_job(db, int(store.id))
    return _serialize_bootstrap_job(job, store_id=store.id)


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
