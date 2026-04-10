from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.core.time import utc_now
from app.models import AdAnalysisBootstrapJob, Store
from app.schemas.sku_economics import AdAnalysisSourceStatusOut
from app.services.sku_economics_service import sku_economics_service
from app.services.wb_token_access import ensure_store_feature_access

logger = logging.getLogger("wbai.ad_analysis_bootstrap")


BOOTSTRAP_STATUS_PENDING = "pending"
BOOTSTRAP_STATUS_RUNNING = "running"
BOOTSTRAP_STATUS_COMPLETED = "completed"
BOOTSTRAP_STATUS_COMPLETED_PARTIAL = "completed_partial"
BOOTSTRAP_STATUS_FAILED = "failed"
BOOTSTRAP_STATUS_IDLE = "idle"

BOOTSTRAP_FINAL_STATUSES = {
    BOOTSTRAP_STATUS_COMPLETED,
    BOOTSTRAP_STATUS_COMPLETED_PARTIAL,
    BOOTSTRAP_STATUS_FAILED,
}

BOOTSTRAP_STAGES = {
    "queued",
    "fetching_advert",
    "fetching_finance",
    "fetching_funnel",
    "building_snapshot",
    "completed",
    "completed_partial",
    "failed",
}


def _source_status_dict(
    source_id: str,
    label: str,
    mode: str,
    *,
    detail: str | None = None,
    records: int = 0,
) -> Dict[str, Any]:
    status = AdAnalysisSourceStatusOut(
        id=source_id,
        label=label,
        mode=mode,
        detail=detail,
        records=int(records or 0),
        automatic=True,
    )
    return status.model_dump(mode="json")


def _default_source_statuses(mode: str = "pending") -> List[Dict[str, Any]]:
    return [
        _source_status_dict("advert", "Реклама WB", mode),
        _source_status_dict("finance", "Финансы WB", mode),
        _source_status_dict("funnel", "Воронка продаж", mode),
    ]


def _infer_failed_source(stage: str | None) -> str | None:
    normalized = str(stage or "").strip().lower()
    mapping = {
        "fetching_advert": "advert",
        "fetching_finance": "finance",
        "fetching_funnel": "funnel",
        "building_snapshot": "snapshot",
    }
    return mapping.get(normalized)


class AdAnalysisBootstrapScheduler:
    def __init__(self, *, tick_interval_sec: float = 2.0, stale_after: timedelta = timedelta(minutes=25)) -> None:
        self.tick_interval_sec = float(max(tick_interval_sec, 0.5))
        self.stale_after = stale_after
        self._task: asyncio.Task | None = None
        self.last_tick_at: datetime | None = None
        self.next_tick_at: datetime | None = None

    def start_background(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop(), name="ad-analysis-bootstrap-scheduler")
        logger.info("[ad-analysis-bootstrap] scheduler started interval=%ss", self.tick_interval_sec)

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("[ad-analysis-bootstrap] scheduler stop requested")

    def get_status(self) -> dict[str, Any]:
        return {
            "is_running": bool(self._task and not self._task.done()),
            "interval_sec": self.tick_interval_sec,
            "last_tick_at": self.last_tick_at.isoformat() if self.last_tick_at else None,
            "next_tick_at": self.next_tick_at.isoformat() if self.next_tick_at else None,
        }

    async def _run_loop(self) -> None:
        while True:
            started = utc_now()
            self.last_tick_at = started
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[ad-analysis-bootstrap] tick failed")
            self.next_tick_at = utc_now() + timedelta(seconds=self.tick_interval_sec)
            await asyncio.sleep(self.tick_interval_sec)

    async def _tick(self) -> None:
        await self._recover_stale_jobs()
        job_id = await self._claim_next_pending_job()
        if job_id is None:
            return
        await self._execute_job(job_id)

    async def _recover_stale_jobs(self) -> None:
        stale_before = utc_now() - self.stale_after
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AdAnalysisBootstrapJob).where(
                    AdAnalysisBootstrapJob.status == BOOTSTRAP_STATUS_RUNNING,
                    AdAnalysisBootstrapJob.heartbeat_at.is_not(None),
                    AdAnalysisBootstrapJob.heartbeat_at < stale_before,
                )
            )
            stale_jobs = list(result.scalars().all())
            if not stale_jobs:
                return
            now = utc_now()
            for job in stale_jobs:
                job.status = BOOTSTRAP_STATUS_FAILED
                job.current_stage = "failed"
                job.stage_progress = 100
                job.error_message = "Bootstrap job stalled and was marked as failed."
                job.step = "Подготовка анализа прервана тайм-аутом фонового воркера."
                job.completed_at = now
                job.heartbeat_at = now
            await db.commit()

    async def _claim_next_pending_job(self) -> Optional[int]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AdAnalysisBootstrapJob)
                .where(AdAnalysisBootstrapJob.status == BOOTSTRAP_STATUS_PENDING)
                .order_by(AdAnalysisBootstrapJob.created_at.asc(), AdAnalysisBootstrapJob.id.asc())
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            job = result.scalar_one_or_none()
            if job is None:
                return None

            now = utc_now()
            job.status = BOOTSTRAP_STATUS_RUNNING
            job.current_stage = "queued"
            job.stage_progress = 5
            job.step = "Ставим подготовку анализа рекламы в очередь..."
            job.started_at = now
            job.completed_at = None
            job.heartbeat_at = now
            if not isinstance(job.source_statuses, list) or not job.source_statuses:
                job.source_statuses = _default_source_statuses("pending")
            await db.commit()
            return int(job.id)

    async def _update_stage(
        self,
        db,
        job: AdAnalysisBootstrapJob,
        *,
        stage: str,
        progress: int,
        step: str,
        source_modes: Optional[Dict[str, str]] = None,
    ) -> None:
        if stage not in BOOTSTRAP_STAGES:
            stage = "failed"
        job.current_stage = stage
        job.stage_progress = max(0, min(int(progress), 100))
        job.step = step
        job.heartbeat_at = utc_now()
        if source_modes:
            by_id: dict[str, dict[str, Any]] = {}
            if isinstance(job.source_statuses, list):
                for raw in job.source_statuses:
                    if isinstance(raw, dict) and raw.get("id"):
                        by_id[str(raw["id"])] = dict(raw)
            for source_id, mode in source_modes.items():
                existing = by_id.get(source_id) or _source_status_dict(source_id, source_id, "missing")
                existing["mode"] = mode
                by_id[source_id] = AdAnalysisSourceStatusOut.model_validate(existing).model_dump(mode="json")
            job.source_statuses = list(by_id.values())
        await db.commit()
        await db.refresh(job)

    async def _execute_job(self, job_id: int) -> None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AdAnalysisBootstrapJob)
                .where(AdAnalysisBootstrapJob.id == int(job_id))
                .limit(1)
            )
            job = result.scalar_one_or_none()
            if job is None:
                return

            store_result = await db.execute(
                select(Store)
                .where(Store.id == int(job.store_id))
                .options(selectinload(Store.feature_api_keys))
            )
            store = store_result.scalar_one_or_none()
            if store is None:
                job.status = BOOTSTRAP_STATUS_FAILED
                job.current_stage = "failed"
                job.stage_progress = 100
                job.step = "Store not found"
                job.error_message = "Store not found"
                job.completed_at = utc_now()
                job.heartbeat_at = utc_now()
                await db.commit()
                return

            try:
                ensure_store_feature_access(store, "ad_analysis")

                await self._update_stage(
                    db,
                    job,
                    stage="fetching_advert",
                    progress=20,
                    step="Загружаем рекламные кампании и расход из WB Advert...",
                    source_modes={"advert": "running"},
                )
                await self._update_stage(
                    db,
                    job,
                    stage="fetching_finance",
                    progress=35,
                    step="Загружаем финансовый слой из WB Statistics...",
                    source_modes={"advert": "automatic", "finance": "running"},
                )
                await self._update_stage(
                    db,
                    job,
                    stage="fetching_funnel",
                    progress=50,
                    step="Загружаем воронку продаж из WB Analytics...",
                    source_modes={"finance": "automatic", "funnel": "running"},
                )
                await self._update_stage(
                    db,
                    job,
                    stage="building_snapshot",
                    progress=70,
                    step="Собираем snapshot анализа рекламы...",
                    source_modes={"funnel": "automatic"},
                )

                days = max(int(job.days or 14), 1)
                overview = await sku_economics_service.build_overview(
                    db,
                    store,
                    days=days,
                    preset=str(job.preset or "14d"),
                    force=True,
                )

                source_statuses = [source.model_dump(mode="json") for source in (overview.source_statuses or [])]
                source_modes = {
                    str((source or {}).get("id") or ""): str((source or {}).get("mode") or "")
                    for source in source_statuses
                    if isinstance(source, dict)
                }
                is_partial = any(
                    mode in {"partial", "manual_required", "failed", "missing"}
                    for mode in source_modes.values()
                )
                now = utc_now()
                job.status = BOOTSTRAP_STATUS_COMPLETED_PARTIAL if is_partial else BOOTSTRAP_STATUS_COMPLETED
                job.current_stage = "completed_partial" if is_partial else "completed"
                job.stage_progress = 100
                job.step = (
                    "Данные собраны частично: проверьте предупреждения в источниках."
                    if is_partial
                    else "Данные для анализа рекламы готовы."
                )
                job.period_start = overview.period_start
                job.period_end = overview.period_end
                job.source_statuses = source_statuses
                job.is_partial = bool(is_partial)
                job.failed_source = None
                job.result = {
                    "snapshot_ready": bool(overview.snapshot_ready),
                    "available_period_start": overview.available_period_start.isoformat() if overview.available_period_start else None,
                    "available_period_end": overview.available_period_end.isoformat() if overview.available_period_end else None,
                }
                job.error_message = None
                job.completed_at = now
                job.heartbeat_at = now
                await db.commit()
            except Exception as exc:
                logger.exception("[ad-analysis-bootstrap] job failed job_id=%s store_id=%s", int(job.id), int(job.store_id))
                now = utc_now()
                failed_source = _infer_failed_source(job.current_stage)
                job.status = BOOTSTRAP_STATUS_FAILED
                job.current_stage = "failed"
                job.stage_progress = 100
                job.error_message = str(exc)
                job.step = "Не удалось подготовить анализ рекламы."
                job.completed_at = now
                job.heartbeat_at = now
                job.failed_source = failed_source or "unknown"
                if not isinstance(job.source_statuses, list) or not job.source_statuses:
                    job.source_statuses = _default_source_statuses("failed")
                elif failed_source:
                    updated_statuses: list[dict[str, Any]] = []
                    for raw in job.source_statuses:
                        if not isinstance(raw, dict):
                            continue
                        normalized = dict(raw)
                        if str(normalized.get("id") or "") == failed_source:
                            normalized["mode"] = "failed"
                        updated_statuses.append(AdAnalysisSourceStatusOut.model_validate(normalized).model_dump(mode="json"))
                    if updated_statuses:
                        job.source_statuses = updated_statuses
                await db.commit()


ad_analysis_bootstrap_scheduler = AdAnalysisBootstrapScheduler()
