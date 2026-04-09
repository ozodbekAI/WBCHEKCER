from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.time import utc_now
from app.models import AnalysisTask

logger = logging.getLogger(__name__)

TASK_STATUS_PENDING = "pending"
TASK_STATUS_RUNNING = "running"
TASK_STATUS_CANCELLING = "cancelling"
TASK_STATUS_COMPLETED = "completed"
TASK_STATUS_FAILED = "failed"
TASK_STATUS_CANCELLED = "cancelled"

FINAL_TASK_STATUSES = {
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_CANCELLED,
}
ACTIVE_TASK_STATUSES = {
    TASK_STATUS_PENDING,
    TASK_STATUS_RUNNING,
    TASK_STATUS_CANCELLING,
}

TASK_TYPE_STORE_ONBOARDING = "store_onboarding"
TASK_TYPE_SYNC_CARDS = "sync_cards"
TASK_TYPE_ANALYZE_ALL = "sync_analyze_all"
TASK_TYPE_RESET_AND_ANALYZE = "sync_reset_and_analyze"

_ACTIVE_HANDLES: dict[int, asyncio.Task[Any]] = {}

_UNSET = object()


def task_progress_percent(task: AnalysisTask | None) -> int:
    if task is None:
        return 0

    progress = int(getattr(task, "progress", 0) or 0)
    return max(0, min(progress, 100))


def serialize_task(task: AnalysisTask) -> dict[str, Any]:
    result = task.result if isinstance(task.result, dict) else None
    task_meta = task.task_meta if isinstance(task.task_meta, dict) else {}
    return {
        "task_id": str(task.id),
        "status": str(task.status or TASK_STATUS_PENDING),
        "step": task.current_step or "",
        "progress": task_progress_percent(task),
        "store_id": task.store_id,
        "mode": task_meta.get("mode"),
        "result": result,
        "error": task.error_message,
        "cancel_requested": task.cancellation_requested_at is not None and str(task.status or "") != TASK_STATUS_CANCELLED,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


async def create_task_record(
    db: AsyncSession,
    *,
    task_type: str,
    started_by_id: Optional[int],
    store_id: Optional[int],
    step: str,
    progress: int = 0,
    task_meta: Optional[dict[str, Any]] = None,
) -> AnalysisTask:
    task = AnalysisTask(
        store_id=store_id,
        started_by_id=started_by_id,
        status=TASK_STATUS_PENDING,
        task_type=task_type,
        total_items=100,
        processed_items=max(0, min(int(progress), 100)),
        progress=max(0, min(int(progress), 100)),
        current_step=step,
        task_meta=task_meta or {},
        result=None,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


async def get_task_by_id(db: AsyncSession, task_id: int) -> AnalysisTask | None:
    return await db.get(AnalysisTask, int(task_id))


async def find_latest_active_task(
    db: AsyncSession,
    *,
    task_type: str,
    store_id: Optional[int] = None,
    started_by_id: Optional[int] = None,
) -> AnalysisTask | None:
    query = (
        select(AnalysisTask)
        .where(
            AnalysisTask.task_type == task_type,
            AnalysisTask.status.in_(tuple(ACTIVE_TASK_STATUSES)),
        )
        .order_by(AnalysisTask.created_at.desc(), AnalysisTask.id.desc())
    )
    if store_id is not None:
        query = query.where(AnalysisTask.store_id == store_id)
    if started_by_id is not None:
        query = query.where(AnalysisTask.started_by_id == started_by_id)

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def update_task_record(
    db: AsyncSession,
    task: AnalysisTask,
    *,
    status: Any = _UNSET,
    step: Any = _UNSET,
    progress: Any = _UNSET,
    store_id: Any = _UNSET,
    result: Any = _UNSET,
    error_message: Any = _UNSET,
    task_meta: Any = _UNSET,
    cancellation_requested_at: Any = _UNSET,
    started_at: Any = _UNSET,
    completed_at: Any = _UNSET,
) -> AnalysisTask:
    if status is not _UNSET:
        task.status = status
    if step is not _UNSET:
        task.current_step = str(step or "")
    if progress is not _UNSET:
        progress_value = max(0, min(int(progress), 100))
        task.progress = progress_value
        task.total_items = 100
        task.processed_items = progress_value
    if store_id is not _UNSET:
        task.store_id = store_id
    if result is not _UNSET:
        task.result = result
    if error_message is not _UNSET:
        task.error_message = error_message
    if task_meta is not _UNSET:
        existing = task.task_meta if isinstance(task.task_meta, dict) else {}
        merged = dict(existing)
        if task_meta is None:
            merged = {}
        elif isinstance(task_meta, dict):
            merged.update(task_meta)
        task.task_meta = merged
    if cancellation_requested_at is not _UNSET:
        task.cancellation_requested_at = cancellation_requested_at
    if started_at is not _UNSET:
        task.started_at = started_at
    if completed_at is not _UNSET:
        task.completed_at = completed_at

    await db.commit()
    await db.refresh(task)
    return task


async def request_task_cancellation(db: AsyncSession, task: AnalysisTask) -> AnalysisTask:
    if str(task.status or "") in FINAL_TASK_STATUSES:
        return task

    now = utc_now()
    await update_task_record(
        db,
        task,
        status=TASK_STATUS_CANCELLING,
        step=task.current_step or "Останавливаем задачу...",
        cancellation_requested_at=now,
    )
    cancel_runtime_task(task.id)
    return task


def register_runtime_task(task_id: int, handle: asyncio.Task[Any]) -> None:
    _ACTIVE_HANDLES[int(task_id)] = handle


def unregister_runtime_task(task_id: int) -> None:
    _ACTIVE_HANDLES.pop(int(task_id), None)


def cancel_runtime_task(task_id: int) -> None:
    handle = _ACTIVE_HANDLES.get(int(task_id))
    if handle and not handle.done():
        handle.cancel()


def launch_runtime_task(task_id: int, coro_factory: Callable[[], Awaitable[None]]) -> None:
    async def runner() -> None:
        try:
            await coro_factory()
        finally:
            unregister_runtime_task(task_id)

    handle = asyncio.create_task(runner(), name=f"analysis-task-{task_id}")
    register_runtime_task(task_id, handle)


async def refresh_task(db: AsyncSession, task: AnalysisTask) -> AnalysisTask:
    await db.refresh(task)
    return task


async def ensure_task_not_cancelled(db: AsyncSession, task: AnalysisTask) -> None:
    await db.refresh(task, attribute_names=["status", "cancellation_requested_at"])
    if task.cancellation_requested_at is not None or str(task.status or "") == TASK_STATUS_CANCELLING:
        raise asyncio.CancelledError()


async def recover_incomplete_tasks() -> None:
    async with AsyncSessionLocal() as db:
        in_flight = await db.execute(
            select(AnalysisTask).where(AnalysisTask.status.in_(tuple(ACTIVE_TASK_STATUSES)))
        )
        rows = list(in_flight.scalars().all())
        if not rows:
            return

        now = utc_now()
        for task in rows:
            was_cancelling = str(task.status or "") == TASK_STATUS_CANCELLING or task.cancellation_requested_at is not None
            task.status = TASK_STATUS_CANCELLED if was_cancelling else TASK_STATUS_FAILED
            task.current_step = "Задача была прервана перезапуском сервера"
            if not task.error_message and not was_cancelling:
                task.error_message = "Task interrupted by server restart"
            task.completed_at = now

        await db.commit()


async def cancel_existing_active_task(
    db: AsyncSession,
    *,
    task_type: str,
    store_id: Optional[int] = None,
    started_by_id: Optional[int] = None,
) -> AnalysisTask | None:
    task = await find_latest_active_task(
        db,
        task_type=task_type,
        store_id=store_id,
        started_by_id=started_by_id,
    )
    if task is None:
        return None

    await request_task_cancellation(db, task)
    return task


async def mark_task_store_id(task_id: int, store_id: int) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(AnalysisTask)
            .where(AnalysisTask.id == int(task_id))
            .values(store_id=store_id)
        )
        await db.commit()


async def load_task_for_runtime(task_id: int) -> AnalysisTask | None:
    async with AsyncSessionLocal() as db:
        task = await db.get(AnalysisTask, int(task_id))
        return task


def is_final_status(status: Optional[str]) -> bool:
    return str(status or "") in FINAL_TASK_STATUSES


def parse_task_id(task_id: str | int) -> int:
    try:
        parsed = int(task_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid task id") from exc
    if parsed <= 0:
        raise ValueError("Invalid task id")
    return parsed
