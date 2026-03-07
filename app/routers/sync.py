import asyncio
import logging
import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from ..core.database import get_db, AsyncSessionLocal
from ..core.security import get_current_user
from ..models import User, Card
from ..models.issue import CardIssue
from ..services import (
    get_store_by_id, WildberriesAPI,
    sync_cards_from_wb, update_store_stats,
)
from ..services.card_service import analyze_card

router = APIRouter(prefix="/stores", tags=["Sync"])
logger = logging.getLogger(__name__)

# In-memory task store (survives navigation, lost on server restart)
SYNC_TASKS: dict[str, dict] = {}


def _check_sync_access(store, current_user: User, store_id: int):
    """Raise 403 if user has no access to this store."""
    if store.owner_id != current_user.id and current_user.role != "admin":
        if getattr(current_user, "store_id", None) != store_id:
            raise HTTPException(status_code=403, detail="No access to this store")


async def _run_sync(task_id: str, store_id: int, api_key: str, nm_ids_filter: Optional[List[int]] = None):
    """
    Background sync task.
    - nm_ids_filter=None  → incremental: compare updated_at, only sync changed cards
    - nm_ids_filter=[…]   → manual: sync only the specified nm_ids
    """
    task = SYNC_TASKS[task_id]
    try:
        task["status"] = "running"
        task["step"] = "Подключение к Wildberries..."
        task["progress"] = 5

        wb_api = WildberriesAPI(api_key)

        # ── Step 1: Fetch from WB ──────────────────────────────────────────
        if nm_ids_filter:
            # Manual mode: fetch only the selected cards in batches of 100
            wb_cards = []
            requested_set = set(nm_ids_filter)
            for i in range(0, len(nm_ids_filter), 100):
                batch = nm_ids_filter[i:i + 100]
                res = await wb_api.get_cards(limit=100, nm_ids=batch)
                if res["success"]:
                    wb_cards.extend(res["cards"])
            # WB API may return extra cards — filter to only requested nm_ids
            wb_cards = [c for c in wb_cards if c.get("nmID") in requested_set]
            task["step"] = f"Получено {len(wb_cards)} выбранных карточек из WB"
        else:
            # Incremental mode: fetch all cards
            res = await wb_api.get_cards(limit=100)
            if not res["success"]:
                raise Exception(f"WB API: {res.get('error', 'Unknown error')}")
            wb_cards = res["cards"]
            task["step"] = f"Получено {len(wb_cards)} карточек из WB"

        task["progress"] = 20
        total_wb = len(wb_cards)

        async with AsyncSessionLocal() as db:
            # ── Step 2: Determine which cards to process ───────────────────
            if nm_ids_filter:
                # Manual mode: use all fetched cards
                cards_to_sync = wb_cards
                task["step"] = f"Выбрано {len(cards_to_sync)} карточек для синхронизации"
            else:
                # Incremental mode: compare updated_at
                task["step"] = "Сравнение дат обновления..."
                db_res = await db.execute(
                    select(Card.nm_id, Card.updated_at).where(Card.store_id == store_id)
                )
                db_map = {row.nm_id: row.updated_at for row in db_res.fetchall()}

                cards_to_sync = []
                for wb_card in wb_cards:
                    nm_id = wb_card.get("nmID")
                    if not nm_id:
                        continue
                    if nm_id not in db_map:
                        cards_to_sync.append(wb_card)
                    else:
                        wb_upd = wb_card.get("updatedAt", "")
                        try:
                            if wb_upd:
                                wb_dt = datetime.fromisoformat(wb_upd.replace("Z", "+00:00"))
                                db_dt = db_map[nm_id]
                                if db_dt is None or wb_dt.replace(tzinfo=None) > db_dt:
                                    cards_to_sync.append(wb_card)
                            else:
                                cards_to_sync.append(wb_card)
                        except Exception:
                            cards_to_sync.append(wb_card)

                task["step"] = f"Изменено {len(cards_to_sync)} из {total_wb} карточек"

            task["progress"] = 35
            changed_count = len(cards_to_sync)

            # ── Step 3: Sync to DB ─────────────────────────────────────────
            synced_new = synced_updated = 0
            if cards_to_sync:
                sync_res = await sync_cards_from_wb(db, store_id, cards_to_sync)
                synced_new = sync_res["new"]
                synced_updated = sync_res["updated"]
                task["step"] = f"Синхронизировано: +{synced_new} новых, ~{synced_updated} обновлено"
            else:
                task["step"] = "Все карточки уже актуальны — обновление не требуется"
            task["progress"] = 55

            # ── Step 4: AI analysis of changed cards ───────────────────────
            issues_found = 0

            if nm_ids_filter:
                # Manual mode — analyze ONLY the requested cards
                nm_ids_to_analyze = nm_ids_filter
            else:
                # Incremental — analyze up to 15 changed cards
                analyze_limit = min(changed_count, 15)
                nm_ids_to_analyze = [c.get("nmID") for c in cards_to_sync[:analyze_limit] if c.get("nmID")]

            if nm_ids_to_analyze:
                task["step"] = f"AI-анализ {len(nm_ids_to_analyze)} карточек..."

                card_res = await db.execute(
                    select(Card).where(
                        Card.store_id == store_id,
                        Card.nm_id.in_(nm_ids_to_analyze),
                    )
                )
                cards_to_analyze = card_res.scalars().all()

                for i, card in enumerate(cards_to_analyze):
                    task["progress"] = 55 + int((i + 1) / max(len(cards_to_analyze), 1) * 35)
                    task["step"] = (
                        f"[{i + 1}/{len(cards_to_analyze)}] Анализ: "
                        f"{(card.title or '')[:40] or str(card.nm_id)}..."
                    )
                    try:
                        issues, _ = await analyze_card(db, card, use_ai=True)
                        issues_found += len(issues)
                    except Exception:
                        pass
            else:
                task["step"] = "Нет карточек для AI-анализа"

            # ── Step 5: Update store stats ─────────────────────────────────
            task["progress"] = 92
            task["step"] = "Обновление статистики магазина..."
            await update_store_stats(db, store_id)

        task["status"] = "completed"
        task["progress"] = 100
        task["step"] = "Готово!"
        task["result"] = {
            "total_wb": total_wb,
            "changed": changed_count,
            "new": synced_new,
            "updated": synced_updated,
            "analyzed": len(nm_ids_to_analyze) if nm_ids_to_analyze else 0,
            "issues_found": issues_found,
            "mode": "manual" if nm_ids_filter else "incremental",
        }
        task["completed_at"] = datetime.utcnow().isoformat()

    except Exception as e:
        task["status"] = "failed"
        task["step"] = f"Ошибка: {str(e)}"
        task["error"] = str(e)
        task["progress"] = 0


# ─────────────────────────────────────────────────────────────────────────────
# Preview endpoint — returns what would be synced (no actual sync)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{store_id}/sync/preview")
async def sync_preview(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return list of cards that differ between WB and DB (changed or new).
    Used to preview incremental sync and for manual card selection.
    """
    if not current_user.has_permission("cards.sync"):
        raise HTTPException(status_code=403, detail="Нет прав для синхронизации")

    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    _check_sync_access(store, current_user, store_id)

    # Fetch WB cards
    wb_api = WildberriesAPI(store.api_key)
    res = await wb_api.get_cards(limit=100)
    if not res["success"]:
        raise HTTPException(status_code=502, detail=f"WB API error: {res.get('error')}")

    wb_cards = res["cards"]

    # Fetch DB cards
    db_res = await db.execute(
        select(Card.nm_id, Card.title, Card.updated_at, Card.photos_count, Card.subject_name)
        .where(Card.store_id == store_id)
    )
    db_rows = {row.nm_id: row for row in db_res.fetchall()}

    changed = []
    unchanged = []

    for wb_card in wb_cards:
        nm_id = wb_card.get("nmID")
        if not nm_id:
            continue

        wb_upd = wb_card.get("updatedAt", "")
        is_new = nm_id not in db_rows
        is_changed = False

        if not is_new:
            db_row = db_rows[nm_id]
            try:
                if wb_upd:
                    wb_dt = datetime.fromisoformat(wb_upd.replace("Z", "+00:00"))
                    db_dt = db_row.updated_at
                    if db_dt is None or wb_dt.replace(tzinfo=None) > db_dt:
                        is_changed = True
                else:
                    is_changed = True
            except Exception:
                is_changed = True

        entry = {
            "nm_id": nm_id,
            "title": wb_card.get("title") or (db_rows[nm_id].title if nm_id in db_rows else ""),
            "vendor_code": wb_card.get("vendorCode", ""),
            "subject": wb_card.get("subjectName") or (db_rows[nm_id].subject_name if nm_id in db_rows else ""),
            "photos": len(wb_card.get("photos", [])),
            "wb_updated_at": wb_upd,
            "db_updated_at": db_rows[nm_id].updated_at.isoformat() if nm_id in db_rows and db_rows[nm_id].updated_at else None,
            "status": "new" if is_new else ("changed" if is_changed else "ok"),
        }

        if is_new or is_changed:
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


# ─────────────────────────────────────────────────────────────────────────────
# Start sync
# ─────────────────────────────────────────────────────────────────────────────

class SyncStartRequest(BaseModel):
    mode: str = "incremental"   # "incremental" | "manual"
    nm_ids: Optional[List[int]] = None  # for manual mode


@router.post("/{store_id}/sync/start")
async def start_sync(
    store_id: int,
    body: SyncStartRequest = SyncStartRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start async incremental or manual sync. Only owner/head_manager allowed."""
    if not current_user.has_permission("cards.sync"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только старший менеджер или владелец может запустить синхронизацию",
        )
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    _check_sync_access(store, current_user, store_id)

    # Cancel any running task for this store
    for task in SYNC_TASKS.values():
        if task.get("store_id") == store_id and task.get("status") == "running":
            task["status"] = "cancelled"

    task_id = str(uuid.uuid4())
    nm_ids_filter = body.nm_ids if body.mode == "manual" and body.nm_ids else None

    SYNC_TASKS[task_id] = {
        "task_id": task_id,
        "store_id": store_id,
        "status": "pending",
        "step": "Запуск...",
        "progress": 0,
        "mode": body.mode,
        "result": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
    }

    asyncio.create_task(_run_sync(task_id, store_id, store.api_key, nm_ids_filter))
    return {"task_id": task_id, "status": "started", "mode": body.mode}


# ─────────────────────────────────────────────────────────────────────────────
# Poll status
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{store_id}/sync/status/{task_id}")
async def get_sync_status(
    store_id: int,
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """Poll sync task status"""
    task = SYNC_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found or expired")
    if task.get("store_id") != store_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return task


# ─────────────────────────────────────────────────────────────────────────────
# Re-analyze all cards (without re-syncing from WB)
# ─────────────────────────────────────────────────────────────────────────────

async def _run_analyze_all(task_id: str, store_id: int):
    """Background task: analyze ALL cards in DB using existing raw_data."""
    task = SYNC_TASKS[task_id]
    try:
        task["status"] = "running"
        task["step"] = "Загрузка карточек из базы данных..."
        task["progress"] = 5

        async with AsyncSessionLocal() as db:
            # Load only IDs to avoid expired-object issues after each commit
            id_res = await db.execute(
                select(Card.id).where(Card.store_id == store_id)
            )
            card_ids = [row[0] for row in id_res.all()]
            total = len(card_ids)
            task["step"] = f"Найдено {total} карточек для анализа"
            task["progress"] = 10

            issues_found = 0
            failed_cards = 0

            for i, cid in enumerate(card_ids):
                pct = 10 + int((i + 1) / max(total, 1) * 80)
                task["progress"] = pct
                try:
                    card_row = await db.execute(select(Card).where(Card.id == cid))
                    card = card_row.scalar_one_or_none()
                    if not card:
                        continue
                    task["step"] = (
                        f"[{i + 1}/{total}] Анализ: "
                        f"{(card.title or '')[:40] or str(card.nm_id)}..."
                    )
                    issues, _ = await analyze_card(db, card, use_ai=True)
                    issues_found += len(issues)
                except Exception as e:
                    failed_cards += 1
                    logger.exception(
                        "[sync.analyze_all] card analysis failed | store_id=%s task_id=%s card_id=%s nm_id=%s error=%s",
                        store_id,
                        task_id,
                        cid,
                        getattr(card, "nm_id", None) if 'card' in locals() else None,
                        str(e),
                    )
                    task["step"] = f"[{i + 1}/{total}] Ошибка анализа card_id={cid}: {str(e)[:120]}"

            from ..services import update_store_stats
            await update_store_stats(db, store_id)

        task["status"] = "completed"
        task["progress"] = 100
        task["step"] = f"Готово! Найдено {issues_found} проблем, ошибок анализа: {failed_cards}"
        task["result"] = {
            "total_analyzed": total,
            "issues_found": issues_found,
            "failed_cards": failed_cards,
        }
        task["completed_at"] = datetime.utcnow().isoformat()
    except Exception as e:
        task["status"] = "failed"
        task["error"] = str(e)
        task["step"] = f"Ошибка: {e}"
        task["completed_at"] = datetime.utcnow().isoformat()


@router.post("/{store_id}/sync/analyze-all")
async def start_analyze_all(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-analyze all cards in DB without re-syncing from WB."""
    if not current_user.has_permission("cards.sync"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только старший менеджер или владелец может запустить анализ",
        )
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    _check_sync_access(store, current_user, store_id)

    # Cancel any running task for this store
    for task in SYNC_TASKS.values():
        if task.get("store_id") == store_id and task.get("status") == "running":
            task["status"] = "cancelled"

    task_id = str(uuid.uuid4())
    SYNC_TASKS[task_id] = {
        "task_id": task_id,
        "store_id": store_id,
        "status": "pending",
        "step": "Запуск анализа...",
        "progress": 0,
        "mode": "analyze_all",
        "result": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
    }

    asyncio.create_task(_run_analyze_all(task_id, store_id))
    return {"task_id": task_id, "status": "started", "mode": "analyze_all"}



# ─────────────────────────────────────────────────────────────────────────────
# Reset ALL analyses + re-analyze
# ─────────────────────────────────────────────────────────────────────────────

async def _run_reset_and_analyze(task_id: str, store_id: int):
    """Background task: delete all issues/scores for store, then re-analyze all cards."""
    task = SYNC_TASKS[task_id]
    try:
        task["status"] = "running"
        task["step"] = "Очистка старых анализов..."
        task["progress"] = 2

        async with AsyncSessionLocal() as db:
            # Get all card ids for this store
            card_res = await db.execute(select(Card.id).where(Card.store_id == store_id))
            card_ids = [row[0] for row in card_res.all()]

            if card_ids:
                # Delete all issues
                await db.execute(delete(CardIssue).where(CardIssue.card_id.in_(card_ids)))
                # Reset scores
                from sqlalchemy import update as sa_update
                await db.execute(
                    sa_update(Card)
                    .where(Card.id.in_(card_ids))
                    .values(score=0, score_breakdown={})
                )
                await db.commit()

            task["step"] = f"Анализ {len(card_ids)} карточек..."
            task["progress"] = 5
            total = len(card_ids)
            issues_found = 0
            failed_cards = 0

            for i, cid in enumerate(card_ids):
                pct = 5 + int((i + 1) / max(total, 1) * 88)
                task["progress"] = pct
                try:
                    # Re-fetch card fresh each time to avoid expired state after commit
                    card_row = await db.execute(select(Card).where(Card.id == cid))
                    card = card_row.scalar_one_or_none()
                    if not card:
                        continue
                    task["step"] = (
                        f"[{i + 1}/{total}] "
                        f"{(card.title or '')[:40] or str(card.nm_id)}..."
                    )
                    issues, _ = await analyze_card(db, card, use_ai=True)
                    issues_found += len(issues)
                except Exception as e:
                    failed_cards += 1
                    logger.exception(
                        "[sync.reset_and_analyze] card analysis failed | store_id=%s task_id=%s card_id=%s nm_id=%s error=%s",
                        store_id,
                        task_id,
                        cid,
                        getattr(card, "nm_id", None) if 'card' in locals() else None,
                        str(e),
                    )
                    task["step"] = f"[{i + 1}/{total}] Ошибка анализа card_id={cid}: {str(e)[:120]}"

            from ..services import update_store_stats
            await update_store_stats(db, store_id)

        task["status"] = "completed"
        task["progress"] = 100
        task["step"] = f"Готово! Найдено {issues_found} проблем, ошибок анализа: {failed_cards}"
        task["result"] = {
            "total_analyzed": total,
            "issues_found": issues_found,
            "failed_cards": failed_cards,
        }
        task["completed_at"] = datetime.utcnow().isoformat()
    except Exception as e:
        task["status"] = "failed"
        task["error"] = str(e)
        task["step"] = f"Ошибка: {e}"
        task["completed_at"] = datetime.utcnow().isoformat()


@router.post("/{store_id}/sync/reset-and-analyze")
async def start_reset_and_analyze(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all existing analyses for this store, then re-analyze all cards."""
    if not current_user.has_permission("cards.sync"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только старший менеджер или владелец может запустить анализ",
        )
    store = await get_store_by_id(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    _check_sync_access(store, current_user, store_id)

    # Cancel any running task for this store
    for task in SYNC_TASKS.values():
        if task.get("store_id") == store_id and task.get("status") == "running":
            task["status"] = "cancelled"

    task_id = str(uuid.uuid4())
    SYNC_TASKS[task_id] = {
        "task_id": task_id,
        "store_id": store_id,
        "status": "pending",
        "step": "Запуск...",
        "progress": 0,
        "mode": "reset_and_analyze",
        "result": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
    }

    asyncio.create_task(_run_reset_and_analyze(task_id, store_id))
    return {"task_id": task_id, "status": "started", "mode": "reset_and_analyze"}


# ── Scheduler status ─────────────────────────────────────────────────────────

@router.get("/scheduler/status", tags=["Scheduler"])
async def get_scheduler_status(
    current_user: User = Depends(get_current_user),
):
    """Get auto-analysis scheduler status: last/next tick times."""
    from ..services.card_scheduler import card_scheduler
    return card_scheduler.get_status()
