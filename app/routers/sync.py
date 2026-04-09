import asyncio
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db, AsyncSessionLocal
from ..core.security import get_current_user, require_permission
from ..core.time import utc_now
from ..models import AnalysisTask, Card, User
from ..models.issue import CardIssue
from ..services import (
    WildberriesAPI,
    get_store_by_id,
    sync_cards_from_wb,
    update_store_stats,
)
from ..services.card_service import analyze_card
from ..services.task_service import (
    ACTIVE_TASK_STATUSES,
    TASK_STATUS_CANCELLED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_RUNNING,
    TASK_TYPE_ANALYZE_ALL,
    TASK_TYPE_RESET_AND_ANALYZE,
    TASK_TYPE_SYNC_CARDS,
    create_task_record,
    ensure_task_not_cancelled,
    launch_runtime_task,
    parse_task_id,
    request_task_cancellation,
    serialize_task,
    update_task_record,
)
from ..services.wb_cards import (
    fetch_all_wb_cards,
    fetch_wb_cards_by_nm_ids,
    parse_wb_timestamp,
)
from ..services.wb_token_access import ensure_store_feature_access, get_store_feature_api_key

router = APIRouter(prefix="/stores", tags=["Sync"])
logger = logging.getLogger(__name__)

SYNC_MANAGED_TASK_TYPES = {
    TASK_TYPE_SYNC_CARDS,
    TASK_TYPE_ANALYZE_ALL,
    TASK_TYPE_RESET_AND_ANALYZE,
}


class SyncStartRequest(BaseModel):
    mode: str = Field(default="incremental")
    nm_ids: Optional[List[int]] = None


def _is_admin_user(user: User) -> bool:
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role_value == "admin"


def _check_sync_access(store, current_user: User, store_id: int) -> None:
    if store.owner_id != current_user.id and not _is_admin_user(current_user):
        if getattr(current_user, "store_id", None) != store_id:
            raise HTTPException(status_code=403, detail="No access to this store")


async def _get_sync_store(db: AsyncSession, store_id: int, current_user: User):
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    _check_sync_access(store, current_user, store_id)
    return store


def _normalize_nm_ids(raw_nm_ids: Optional[List[int]]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for raw in raw_nm_ids or []:
        try:
            nm_id = int(raw)
        except (TypeError, ValueError):
            continue
        if nm_id <= 0 or nm_id in seen:
            continue
        seen.add(nm_id)
        normalized.append(nm_id)
    return normalized


def _wb_card_is_changed(local_wb_updated_at, wb_card: dict) -> bool:
    wb_updated_at = parse_wb_timestamp(wb_card.get("updatedAt"))
    if local_wb_updated_at is None or wb_updated_at is None:
        return True
    return wb_updated_at > local_wb_updated_at


async def _build_incremental_sync_set(
    db: AsyncSession,
    *,
    store_id: int,
    wb_cards: list[dict],
) -> list[dict]:
    nm_ids = [int(card.get("nmID")) for card in wb_cards if card.get("nmID")]
    if not nm_ids:
        return []

    db_rows = await db.execute(
        select(Card.nm_id, Card.wb_updated_at).where(
            Card.store_id == store_id,
            Card.nm_id.in_(nm_ids),
        )
    )
    local_wb_updated_at = {row.nm_id: row.wb_updated_at for row in db_rows.all()}

    cards_to_sync: list[dict] = []
    for wb_card in wb_cards:
        nm_id = wb_card.get("nmID")
        if not nm_id:
            continue
        if nm_id not in local_wb_updated_at:
            cards_to_sync.append(wb_card)
            continue
        if _wb_card_is_changed(local_wb_updated_at.get(int(nm_id)), wb_card):
            cards_to_sync.append(wb_card)

    return cards_to_sync


async def _set_task_cancelled(task_id: int, *, step: str) -> None:
    async with AsyncSessionLocal() as db:
        task = await db.get(AnalysisTask, int(task_id))
        if task is None:
            return
        await update_task_record(
            db,
            task,
            status=TASK_STATUS_CANCELLED,
            step=step,
            completed_at=utc_now(),
            progress=task.progress,
        )


async def _set_task_failed(task_id: int, *, error: Exception | str) -> None:
    async with AsyncSessionLocal() as db:
        task = await db.get(AnalysisTask, int(task_id))
        if task is None:
            return
        message = str(error)
        await update_task_record(
            db,
            task,
            status=TASK_STATUS_FAILED,
            step=f"Ошибка: {message}",
            error_message=message,
            completed_at=utc_now(),
            progress=task.progress,
        )


async def _cancel_active_store_tasks(db: AsyncSession, store_id: int) -> None:
    active_tasks = await db.execute(
        select(AnalysisTask)
        .where(
            AnalysisTask.store_id == store_id,
            AnalysisTask.task_type.in_(tuple(SYNC_MANAGED_TASK_TYPES)),
            AnalysisTask.status.in_(tuple(ACTIVE_TASK_STATUSES)),
        )
        .order_by(AnalysisTask.created_at.desc(), AnalysisTask.id.desc())
    )
    for task in active_tasks.scalars().all():
        await request_task_cancellation(db, task)


async def _load_store_task(
    db: AsyncSession,
    *,
    store_id: int,
    task_id: str,
) -> AnalysisTask:
    try:
        parsed_task_id = parse_task_id(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    task = await db.get(AnalysisTask, parsed_task_id)
    if task is None or task.store_id != store_id or task.task_type not in SYNC_MANAGED_TASK_TYPES:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _run_sync(task_id: int, store_id: int, api_key: str, nm_ids_filter: Optional[List[int]] = None) -> None:
    mode = "manual" if nm_ids_filter else "incremental"

    try:
        async with AsyncSessionLocal() as db:
            task = await db.get(AnalysisTask, int(task_id))
            if task is None:
                return

            await update_task_record(
                db,
                task,
                status=TASK_STATUS_RUNNING,
                step="Подключение к Wildberries...",
                progress=5,
                started_at=utc_now(),
                completed_at=None,
                error_message=None,
                result=None,
                task_meta={"mode": mode},
            )

            wb_api = WildberriesAPI(api_key)

            async def on_fetch_progress(page: int, total_cards: int) -> None:
                await ensure_task_not_cancelled(db, task)
                progress = 18 if nm_ids_filter else min(18, 7 + page * 4)
                await update_task_record(
                    db,
                    task,
                    step=f"Получено {total_cards} карточек из WB...",
                    progress=progress,
                )

            if nm_ids_filter:
                wb_cards = await fetch_wb_cards_by_nm_ids(wb_api, nm_ids_filter, on_batch=on_fetch_progress)
                await update_task_record(
                    db,
                    task,
                    step=f"Получено {len(wb_cards)} выбранных карточек из WB",
                    progress=20,
                )
            else:
                wb_cards = await fetch_all_wb_cards(wb_api, on_page=on_fetch_progress)
                await update_task_record(
                    db,
                    task,
                    step=f"Получено {len(wb_cards)} карточек из WB",
                    progress=20,
                )

            total_wb = len(wb_cards)

            await ensure_task_not_cancelled(db, task)
            if nm_ids_filter:
                cards_to_sync = wb_cards
                await update_task_record(
                    db,
                    task,
                    step=f"Выбрано {len(cards_to_sync)} карточек для синхронизации",
                    progress=35,
                )
            else:
                await update_task_record(db, task, step="Сравнение дат обновления...", progress=25)
                cards_to_sync = await _build_incremental_sync_set(db, store_id=store_id, wb_cards=wb_cards)
                await update_task_record(
                    db,
                    task,
                    step=f"Изменено {len(cards_to_sync)} из {total_wb} карточек",
                    progress=35,
                )

            changed_count = len(cards_to_sync)
            synced_new = 0
            synced_updated = 0
            if cards_to_sync:
                sync_result = await sync_cards_from_wb(db, store_id, cards_to_sync)
                synced_new = int(sync_result.get("new", 0) or 0)
                synced_updated = int(sync_result.get("updated", 0) or 0)
                await update_task_record(
                    db,
                    task,
                    step=f"Синхронизировано: +{synced_new} новых, ~{synced_updated} обновлено",
                    progress=55,
                )
            else:
                await update_task_record(
                    db,
                    task,
                    step="Все карточки уже актуальны — обновление не требуется",
                    progress=55,
                )

            issues_found = 0
            if nm_ids_filter:
                nm_ids_to_analyze = nm_ids_filter
            else:
                analyze_limit = min(changed_count, 15)
                nm_ids_to_analyze = [card.get("nmID") for card in cards_to_sync[:analyze_limit] if card.get("nmID")]

            if nm_ids_to_analyze:
                await update_task_record(
                    db,
                    task,
                    step=f"AI-анализ {len(nm_ids_to_analyze)} карточек...",
                    progress=58,
                )
                card_rows = await db.execute(
                    select(Card).where(
                        Card.store_id == store_id,
                        Card.nm_id.in_(nm_ids_to_analyze),
                    )
                )
                cards_to_analyze = list(card_rows.scalars().all())
                total_to_analyze = max(len(cards_to_analyze), 1)

                for index, card in enumerate(cards_to_analyze, start=1):
                    await ensure_task_not_cancelled(db, task)
                    progress = 55 + int(index / total_to_analyze * 35)
                    await update_task_record(
                        db,
                        task,
                        step=f"[{index}/{len(cards_to_analyze)}] Анализ: {((card.title or '')[:40] or str(card.nm_id))}...",
                        progress=progress,
                    )
                    try:
                        issues, _ = await analyze_card(db, card, use_ai=True)
                        issues_found += len(issues)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        logger.exception(
                            "[sync.sync] card analysis failed | store_id=%s task_id=%s card_id=%s nm_id=%s error=%s",
                            store_id,
                            task_id,
                            card.id,
                            card.nm_id,
                            str(exc),
                        )
            else:
                await update_task_record(db, task, step="Нет карточек для AI-анализа", progress=90)

            await ensure_task_not_cancelled(db, task)
            await update_task_record(db, task, step="Обновление статистики магазина...", progress=92)
            await update_store_stats(db, store_id)

            await update_task_record(
                db,
                task,
                status=TASK_STATUS_COMPLETED,
                step="Готово!",
                progress=100,
                result={
                    "total_wb": total_wb,
                    "changed": changed_count,
                    "new": synced_new,
                    "updated": synced_updated,
                    "analyzed": len(nm_ids_to_analyze) if nm_ids_to_analyze else 0,
                    "issues_found": issues_found,
                    "mode": mode,
                },
                completed_at=utc_now(),
            )
    except asyncio.CancelledError:
        await _set_task_cancelled(int(task_id), step="Синхронизация остановлена")
    except Exception as exc:
        logger.exception("[sync.sync] task failed | store_id=%s task_id=%s error=%s", store_id, task_id, str(exc))
        await _set_task_failed(int(task_id), error=exc)


async def _run_card_reanalysis_task(task_id: int, store_id: int, *, reset_existing: bool) -> None:
    action_label = "Очистка старых анализов..." if reset_existing else "Загрузка карточек из базы данных..."

    try:
        async with AsyncSessionLocal() as db:
            task = await db.get(AnalysisTask, int(task_id))
            if task is None:
                return

            await update_task_record(
                db,
                task,
                status=TASK_STATUS_RUNNING,
                step=action_label,
                progress=2 if reset_existing else 5,
                started_at=utc_now(),
                completed_at=None,
                error_message=None,
                result=None,
            )

            await ensure_task_not_cancelled(db, task)
            card_id_rows = await db.execute(select(Card.id).where(Card.store_id == store_id))
            card_ids = [row[0] for row in card_id_rows.all()]

            if reset_existing and card_ids:
                await db.execute(delete(CardIssue).where(CardIssue.card_id.in_(card_ids)))
                await db.execute(
                    Card.__table__.update()
                    .where(Card.id.in_(card_ids))
                    .values(
                        score=0,
                        score_breakdown={},
                        critical_issues_count=0,
                        warnings_count=0,
                        improvements_count=0,
                        growth_points_count=0,
                        last_analysis_at=None,
                    )
                )
                await db.commit()

            total = len(card_ids)
            await update_task_record(
                db,
                task,
                step=f"Найдено {total} карточек для анализа",
                progress=10 if not reset_existing else 5,
            )

            issues_found = 0
            failed_cards = 0
            total_safe = max(total, 1)
            progress_base = 5 if reset_existing else 10
            progress_span = 88 if reset_existing else 80

            for index, card_id in enumerate(card_ids, start=1):
                await ensure_task_not_cancelled(db, task)
                progress = progress_base + int(index / total_safe * progress_span)
                card_row = await db.execute(select(Card).where(Card.id == card_id))
                card = card_row.scalar_one_or_none()
                if not card:
                    continue

                await update_task_record(
                    db,
                    task,
                    step=f"[{index}/{total}] Анализ: {((card.title or '')[:40] or str(card.nm_id))}...",
                    progress=progress,
                )
                try:
                    issues, _ = await analyze_card(db, card, use_ai=True)
                    issues_found += len(issues)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    failed_cards += 1
                    logger.exception(
                        "[sync.reanalyze] card analysis failed | store_id=%s task_id=%s card_id=%s nm_id=%s error=%s",
                        store_id,
                        task_id,
                        card.id,
                        card.nm_id,
                        str(exc),
                    )
                    await update_task_record(
                        db,
                        task,
                        step=f"[{index}/{total}] Ошибка анализа card_id={card_id}: {str(exc)[:120]}",
                        progress=progress,
                    )

            await ensure_task_not_cancelled(db, task)
            await update_store_stats(db, store_id)

            await update_task_record(
                db,
                task,
                status=TASK_STATUS_COMPLETED,
                step=f"Готово! Найдено {issues_found} проблем, ошибок анализа: {failed_cards}",
                progress=100,
                result={
                    "total_analyzed": total,
                    "issues_found": issues_found,
                    "failed_cards": failed_cards,
                    "mode": "reset_and_analyze" if reset_existing else "analyze_all",
                },
                completed_at=utc_now(),
            )
    except asyncio.CancelledError:
        await _set_task_cancelled(
            int(task_id),
            step="Перезапуск анализа остановлен" if reset_existing else "Анализ остановлен",
        )
    except Exception as exc:
        logger.exception("[sync.reanalyze] task failed | store_id=%s task_id=%s error=%s", store_id, task_id, str(exc))
        await _set_task_failed(int(task_id), error=exc)


@router.get("/{store_id}/sync/preview")
async def sync_preview(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    store = await _get_sync_store(db, store_id, current_user)
    ensure_store_feature_access(store, "cards")
    feature_api_key = get_store_feature_api_key(store, "cards")
    if not feature_api_key:
        raise HTTPException(status_code=403, detail="WB Content key is not configured")

    wb_api = WildberriesAPI(feature_api_key)
    try:
        wb_cards = await fetch_all_wb_cards(wb_api)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    db_rows = await db.execute(
        select(Card.nm_id, Card.title, Card.wb_updated_at, Card.photos_count, Card.subject_name)
        .where(Card.store_id == store_id)
    )
    local_cards = {row.nm_id: row for row in db_rows.fetchall()}

    changed: list[dict] = []
    unchanged: list[dict] = []

    for wb_card in wb_cards:
        nm_id = wb_card.get("nmID")
        if not nm_id:
            continue

        wb_updated_at_raw = wb_card.get("updatedAt", "")
        local_card = local_cards.get(int(nm_id))
        is_new = local_card is None
        is_changed = is_new or _wb_card_is_changed(getattr(local_card, "wb_updated_at", None), wb_card)

        entry = {
            "nm_id": nm_id,
            "title": wb_card.get("title") or (local_card.title if local_card else ""),
            "vendor_code": wb_card.get("vendorCode", ""),
            "subject": wb_card.get("subjectName") or (local_card.subject_name if local_card else ""),
            "photos": len(wb_card.get("photos", [])),
            "wb_updated_at": wb_updated_at_raw,
            "db_updated_at": local_card.wb_updated_at.isoformat() if local_card and local_card.wb_updated_at else None,
            "db_wb_updated_at": local_card.wb_updated_at.isoformat() if local_card and local_card.wb_updated_at else None,
            "status": "new" if is_new else ("changed" if is_changed else "ok"),
        }

        if is_changed:
            changed.append(entry)
        else:
            unchanged.append(entry)

    return {
        "total_wb": len(wb_cards),
        "changed_count": len(changed),
        "unchanged_count": len(unchanged),
        "changed": changed,
        "all_cards": changed + unchanged,
    }


@router.post("/{store_id}/sync/start")
async def start_sync(
    store_id: int,
    body: SyncStartRequest = SyncStartRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    store = await _get_sync_store(db, store_id, current_user)
    ensure_store_feature_access(store, "cards")
    feature_api_key = get_store_feature_api_key(store, "cards")
    if not feature_api_key:
        raise HTTPException(status_code=403, detail="WB Content key is not configured")

    mode = (body.mode or "incremental").strip().lower()
    if mode not in {"incremental", "manual"}:
        raise HTTPException(status_code=400, detail="Unsupported sync mode")

    nm_ids_filter = _normalize_nm_ids(body.nm_ids if mode == "manual" else None)
    if mode == "manual" and not nm_ids_filter:
        raise HTTPException(status_code=400, detail="nm_ids are required for manual sync")

    await _cancel_active_store_tasks(db, store_id)

    task = await create_task_record(
        db,
        task_type=TASK_TYPE_SYNC_CARDS,
        started_by_id=current_user.id,
        store_id=store_id,
        step="Запуск...",
        progress=0,
        task_meta={"mode": mode, "requested_nm_ids": nm_ids_filter},
    )
    launch_runtime_task(
        int(task.id),
        lambda: _run_sync(int(task.id), store_id, feature_api_key, nm_ids_filter),
    )
    return {"task_id": str(task.id), "status": "started", "mode": mode}


@router.get("/{store_id}/sync/status/{task_id}")
async def get_sync_status(
    store_id: int,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    await _get_sync_store(db, store_id, current_user)
    task = await _load_store_task(db, store_id=store_id, task_id=task_id)
    return serialize_task(task)


@router.post("/{store_id}/sync/status/{task_id}/cancel")
async def cancel_sync_task(
    store_id: int,
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    await _get_sync_store(db, store_id, current_user)
    task = await _load_store_task(db, store_id=store_id, task_id=task_id)
    task = await request_task_cancellation(db, task)
    return serialize_task(task)


@router.post("/{store_id}/sync/analyze-all")
async def start_analyze_all(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    await _get_sync_store(db, store_id, current_user)
    await _cancel_active_store_tasks(db, store_id)

    task = await create_task_record(
        db,
        task_type=TASK_TYPE_ANALYZE_ALL,
        started_by_id=current_user.id,
        store_id=store_id,
        step="Запуск анализа...",
        progress=0,
        task_meta={"mode": "analyze_all"},
    )
    launch_runtime_task(
        int(task.id),
        lambda: _run_card_reanalysis_task(int(task.id), store_id, reset_existing=False),
    )
    return {"task_id": str(task.id), "status": "started", "mode": "analyze_all"}


@router.post("/{store_id}/sync/reset-and-analyze")
async def start_reset_and_analyze(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("cards.sync")),
):
    await _get_sync_store(db, store_id, current_user)
    await _cancel_active_store_tasks(db, store_id)

    task = await create_task_record(
        db,
        task_type=TASK_TYPE_RESET_AND_ANALYZE,
        started_by_id=current_user.id,
        store_id=store_id,
        step="Запуск...",
        progress=0,
        task_meta={"mode": "reset_and_analyze"},
    )
    launch_runtime_task(
        int(task.id),
        lambda: _run_card_reanalysis_task(int(task.id), store_id, reset_existing=True),
    )
    return {"task_id": str(task.id), "status": "started", "mode": "reset_and_analyze"}


@router.get("/scheduler/status", tags=["Scheduler"])
async def get_scheduler_status(
    current_user: User = Depends(get_current_user),
):
    from ..services.card_scheduler import card_scheduler

    return card_scheduler.get_status()
