import asyncio
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db, AsyncSessionLocal
from ..core.security import get_current_user
from ..core.time import utc_now
from ..models import AnalysisTask, User, Store, StoreStatus, Card, StoreApiKey
from ..schemas import StoreCreate, StoreUpdate, StoreOut, StoreStats, StoreValidationResult
from ..schemas.store import (
    OnboardRequest,
    OnboardResult,
    OnboardStartResponse,
    OnboardTaskStatus,
    StoreApiKeyUpdateRequest,
)
from ..services import (
    create_store, get_store_by_id, get_user_stores,
    ensure_account_can_create_store,
    ensure_store_not_exists,
    update_store, update_store_status, update_store_stats,
    delete_store, check_store_access, WildberriesAPI,
    sync_cards_from_wb, analyze_store_cards,
)
from ..services.card_service import analyze_card
from ..services.task_service import (
    ACTIVE_TASK_STATUSES,
    TASK_STATUS_CANCELLED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_RUNNING,
    TASK_TYPE_STORE_ONBOARDING,
    create_task_record,
    ensure_task_not_cancelled,
    launch_runtime_task,
    parse_task_id,
    request_task_cancellation,
    serialize_task,
    update_task_record,
)
from ..services.wb_cards import fetch_all_wb_cards
from ..services.wb_token_access import (
    ensure_store_feature_access,
    get_store_feature_api_key,
    summarize_wb_token_access,
    validate_slot_key,
    validate_slot_token_access,
)

router = APIRouter(prefix="/stores", tags=["Stores"])
logger = logging.getLogger(__name__)


def _is_admin_user(user: User) -> bool:
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role_val == "admin"


def _assert_store_key_manager(store: Store, current_user: User) -> None:
    if store.owner_id == current_user.id or _is_admin_user(current_user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only owner can manage store WB keys",
    )


async def _run_onboard_flow(
    db: AsyncSession,
    current_user: User,
    data: OnboardRequest,
    task: AnalysisTask | None = None,
) -> OnboardResult:
    async def set_task_state(*, step: str, progress: int, store_id: Optional[int] = None) -> None:
        if task is None:
            return
        await update_task_record(db, task, step=step, progress=progress, store_id=store_id)

    async def ensure_not_cancelled() -> None:
        if task is None:
            return
        await ensure_task_not_cancelled(db, task)

    if task is not None:
        await set_task_state(step="Проверяем API-ключ Wildberries...", progress=5)

    await ensure_account_can_create_store(db, current_user)
    await ensure_not_cancelled()

    wb_api = WildberriesAPI(data.api_key)
    validation = await wb_api.validate_api_key()
    ping_access = await wb_api.collect_ping_access()
    token_access = summarize_wb_token_access(data.api_key, ping_access=ping_access)

    if not validation["is_valid"]:
        raise ValueError(f"Invalid API key: {validation.get('error', 'Unknown error')}")

    supplier_name = validation.get("supplier_name") or validation.get("trade_mark") or "Мой магазин"
    supplier_id = validation.get("supplier_id")
    cards_access = ((token_access.get("features") or {}).get("cards") or {})
    cards_allowed = bool(cards_access.get("allowed"))

    if task is not None:
        await set_task_state(step="Создаем магазин и проверяем дубли...", progress=16)

    await ensure_store_not_exists(
        db,
        owner_id=current_user.id,
        api_key=data.api_key,
        wb_supplier_id=str(supplier_id) if supplier_id is not None else None,
    )
    await ensure_not_cancelled()

    store_data = StoreCreate(
        name=data.name or supplier_name,
        api_key=data.api_key,
    )
    store = await create_store(db, current_user.id, store_data)
    store.wb_ping_access = ping_access
    store.wb_ping_checked_at = utc_now()

    if task is not None:
        await set_task_state(
            step="Магазин подключен. Синхронизируем карточки...",
            progress=24,
            store_id=store.id,
        )

    await update_store_status(
        db,
        store,
        StoreStatus.ACTIVE,
        wb_info={
            "supplier_id": supplier_id,
            "supplier_name": validation.get("supplier_name"),
        },
    )

    if not cards_allowed:
        if task is not None:
            await set_task_state(
                step=(
                    "Ключ проверен. Магазин подключен, но для анализа карточек "
                    "нужно добавить доступ Content."
                ),
                progress=100,
            )

        await update_store_stats(db, store.id)
        return OnboardResult(
            store_id=store.id,
            store_name=store.name,
            supplier_name=validation.get("supplier_name"),
            supplier_id=supplier_id,
            cards_synced=0,
            cards_new=0,
            cards_analyzed=0,
            issues_found=0,
            ai_enabled=data.use_ai,
            wb_token_access=token_access,
        )

    async def on_fetch_progress(page: int, total_cards: int) -> None:
        await ensure_not_cancelled()
        await set_task_state(
            step=f"Загружено {total_cards} карточек из Wildberries...",
            progress=min(55, 28 + page * 3),
        )

    all_cards = await fetch_all_wb_cards(wb_api, on_page=on_fetch_progress)
    sync_result = await sync_cards_from_wb(db, store.id, all_cards)
    await update_store_stats(db, store.id)

    if task is not None:
        await set_task_state(step="Карточки синхронизированы. Запускаем анализ...", progress=60)

    card_ids_res = await db.execute(
        select(Card.id).where(Card.store_id == store.id).order_by(Card.id.asc())
    )
    card_ids = [row[0] for row in card_ids_res.all()]

    issues_found = 0
    analyzed_count = 0
    failed_cards = 0
    total_cards = len(card_ids)

    if total_cards == 0:
        if task is not None:
            await set_task_state(step="Карточки не найдены. Завершаем подключение...", progress=92)
    else:
        for index, card_id in enumerate(card_ids, start=1):
            progress = 60 + int(index / max(total_cards, 1) * 35)
            if task is not None:
                await ensure_not_cancelled()
                await update_task_record(db, task, progress=min(progress, 95))

            card_res = await db.execute(select(Card).where(Card.id == card_id))
            card = card_res.scalar_one_or_none()
            if not card:
                continue

            if task is not None:
                card_label = (card.title or "").strip() or str(card.nm_id)
                await update_task_record(
                    db,
                    task,
                    step=f"Анализ карточек {index}/{total_cards}: {card_label[:48]}",
                    progress=min(progress, 95),
                )

            try:
                issues, _ = await asyncio.wait_for(
                    analyze_card(db, card, use_ai=data.use_ai),
                    timeout=180,
                )
                issues_found += len(issues)
                analyzed_count += 1
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                failed_cards += 1
                logger.exception(
                    "[stores.onboard] card analysis failed | store_id=%s card_id=%s nm_id=%s error=%s",
                    store.id,
                    card.id,
                    card.nm_id,
                    str(exc),
                )

    if task is not None:
        await set_task_state(step="Обновляем итоговую статистику магазина...", progress=97)

    await update_store_stats(db, store.id)

    if task is not None:
        await set_task_state(
            step=(
                f"Готово! Карточек: {sync_result['total']}, "
                f"найдено проблем: {issues_found}, ошибок анализа: {failed_cards}"
            ),
            progress=100,
        )

    return OnboardResult(
        store_id=store.id,
        store_name=store.name,
        supplier_name=validation.get("supplier_name"),
        supplier_id=supplier_id,
        cards_synced=sync_result["total"],
        cards_new=sync_result["new"],
        cards_analyzed=analyzed_count,
        issues_found=issues_found,
        ai_enabled=data.use_ai,
        wb_token_access=token_access,
    )


async def _run_onboard_task(task_id: int, user_id: int, data: OnboardRequest):
    try:
        async with AsyncSessionLocal() as db:
            task = await db.get(AnalysisTask, int(task_id))
            if task is None:
                return

            await update_task_record(
                db,
                task,
                status=TASK_STATUS_RUNNING,
                step="Запуск подключения...",
                progress=0,
                started_at=utc_now(),
                completed_at=None,
                error_message=None,
                result=None,
            )
            user = await db.get(User, user_id)
            if not user:
                raise ValueError("User not found")

            result = await _run_onboard_flow(db, user, data, task=task)

            await update_task_record(
                db,
                task,
                status=TASK_STATUS_COMPLETED,
                result=result.model_dump(),
                completed_at=utc_now(),
            )
    except asyncio.CancelledError:
        async with AsyncSessionLocal() as db:
            task = await db.get(AnalysisTask, int(task_id))
            if task is not None:
                await update_task_record(
                    db,
                    task,
                    status=TASK_STATUS_CANCELLED,
                    step="Подключение магазина остановлено",
                    completed_at=utc_now(),
                    progress=task.progress,
                )
    except Exception as exc:
        logger.exception("[stores.onboard] onboarding failed | task_id=%s error=%s", task_id, str(exc))
        async with AsyncSessionLocal() as db:
            task = await db.get(AnalysisTask, int(task_id))
            if task is not None:
                await update_task_record(
                    db,
                    task,
                    status=TASK_STATUS_FAILED,
                    step=f"Ошибка подключения: {exc}",
                    error_message=str(exc),
                    completed_at=utc_now(),
                    progress=task.progress,
                )

                if task.store_id:
                    store = await get_store_by_id(db, task.store_id)
                    if store:
                        await update_store_status(db, store, StoreStatus.ERROR, message=str(exc))


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
    
    # Check access: owner, admin, or invited member of this store
    if store.owner_id != current_user.id and not _is_admin_user(current_user):
        if getattr(current_user, 'store_id', None) != store.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    return store


@router.get("", response_model=List[StoreOut])
async def list_stores(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all stores for current user"""
    stores = await get_user_stores(db, current_user.id)
    return stores


@router.post("", response_model=StoreOut, status_code=status.HTTP_201_CREATED)
async def create_new_store(
    store_data: StoreCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new store (connect to WB)"""
    try:
        await ensure_account_can_create_store(db, current_user)
        store = await create_store(db, current_user.id, store_data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return store


@router.get("/{store_id}", response_model=StoreOut)
async def get_store(store: Store = Depends(get_user_store)):
    """Get store details"""
    return store


@router.patch("/{store_id}", response_model=StoreOut)
async def update_store_info(
    store_data: StoreUpdate,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update store info"""
    if store_data.api_key is not None:
        _assert_store_key_manager(store, current_user)

        new_api_key = store_data.api_key.strip()
        wb_api = WildberriesAPI(new_api_key)
        validation = await wb_api.validate_api_key()
        ping_access = await wb_api.collect_ping_access()
        if not validation["is_valid"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid API key: {validation.get('error', 'Unknown error')}",
            )

        supplier_id = validation.get("supplier_id")
        await ensure_store_not_exists(
            db,
            owner_id=store.owner_id,
            api_key=new_api_key,
            wb_supplier_id=str(supplier_id) if supplier_id is not None else None,
            exclude_store_id=store.id,
        )

        store.api_key = new_api_key
        store.wb_ping_access = ping_access
        store.wb_ping_checked_at = utc_now()
        store_data.api_key = new_api_key
        await update_store_status(
            db,
            store,
            StoreStatus.ACTIVE,
            wb_info={
                "supplier_id": supplier_id,
                "supplier_name": validation.get("supplier_name"),
            },
        )

    updated = await update_store(db, store, store_data)
    return updated


@router.put("/{store_id}/keys/{slot_key}", response_model=StoreOut)
async def upsert_store_feature_key(
    store_id: int,
    slot_key: str,
    data: StoreApiKeyUpdateRequest,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _assert_store_key_manager(store, current_user)
    normalized_slot = validate_slot_key(slot_key)
    if normalized_slot == "default":
        raise HTTPException(status_code=400, detail="Use PATCH /stores/{store_id} to update the main key")

    new_api_key = data.api_key.strip()
    wb_api = WildberriesAPI(new_api_key)
    full_ping_access = await wb_api.collect_ping_access()
    try:
        validate_slot_token_access(normalized_slot, new_api_key, ping_access=full_ping_access)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    seller_info = await wb_api.validate_api_key()
    slot_row = next(
        (row for row in getattr(store, "feature_api_keys", []) if str(getattr(row, "slot_key", "")).lower() == normalized_slot),
        None,
    )
    if slot_row is None:
        slot_row = StoreApiKey(store_id=store.id, slot_key=normalized_slot)
        db.add(slot_row)
        getattr(store, "feature_api_keys", []).append(slot_row)

    slot_row.api_key = new_api_key
    slot_row.wb_supplier_id = seller_info.get("supplier_id") if seller_info.get("is_valid") else None
    slot_row.wb_supplier_name = seller_info.get("supplier_name") if seller_info.get("is_valid") else None
    slot_row.wb_ping_access = full_ping_access
    slot_row.wb_ping_checked_at = utc_now()
    slot_row.updated_at = utc_now()
    await db.commit()
    refreshed_store = await get_store_by_id(db, store_id)
    if not refreshed_store:
        raise HTTPException(status_code=404, detail="Store not found")
    return refreshed_store


@router.delete("/{store_id}/keys/{slot_key}", response_model=StoreOut)
async def delete_store_feature_key(
    store_id: int,
    slot_key: str,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _assert_store_key_manager(store, current_user)
    normalized_slot = validate_slot_key(slot_key)
    if normalized_slot == "default":
        raise HTTPException(status_code=400, detail="Main store key cannot be deleted here")

    slot_row = next(
        (row for row in getattr(store, "feature_api_keys", []) if str(getattr(row, "slot_key", "")).lower() == normalized_slot),
        None,
    )
    if slot_row is not None:
        await db.delete(slot_row)
        await db.commit()

    refreshed_store = await get_store_by_id(db, store_id)
    if not refreshed_store:
        raise HTTPException(status_code=404, detail="Store not found")
    return refreshed_store


@router.delete("/{store_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_store_endpoint(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Delete a store"""
    await delete_store(db, store)


@router.post("/{store_id}/validate", response_model=StoreValidationResult)
async def validate_store_api_key(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Validate store's WB API key"""
    # Update status to validating
    await update_store_status(db, store, StoreStatus.VALIDATING)
    
    # Validate API key
    wb_api = WildberriesAPI(store.api_key)
    result = await wb_api.validate_api_key()
    ping_access = await wb_api.collect_ping_access()
    
    if result["is_valid"]:
        token_access = summarize_wb_token_access(store.api_key, ping_access=ping_access)
        store.wb_ping_access = ping_access
        store.wb_ping_checked_at = utc_now()
        await update_store_status(
            db, store, StoreStatus.ACTIVE,
            wb_info={
                "supplier_id": result.get("supplier_id"),
                "supplier_name": result.get("supplier_name"),
            }
        )
        return StoreValidationResult(
            is_valid=True,
            supplier_id=result.get("supplier_id"),
            supplier_name=result.get("supplier_name"),
            wb_token_access=token_access,
        )
    else:
        await update_store_status(
            db, store, StoreStatus.ERROR,
            message=result.get("error", "Unknown error")
        )
        return StoreValidationResult(
            is_valid=False,
            error_message=result.get("error"),
        )


@router.post("/{store_id}/sync")
async def sync_store_cards(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Sync cards from WB.

    Deprecated: prefer `/stores/{store_id}/sync/start` for tracked async syncs.
    """
    if store.status != StoreStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store must be validated first"
        )
    ensure_store_feature_access(store, "cards")
    feature_api_key = get_store_feature_api_key(store, "cards")
    if not feature_api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="WB Content key is not configured for this store",
        )
    
    # Fetch cards from WB
    wb_api = WildberriesAPI(feature_api_key)
    try:
        wb_cards = await fetch_all_wb_cards(wb_api)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    
    # Sync to database
    sync_result = await sync_cards_from_wb(db, store.id, wb_cards)
    
    # Update store stats
    await update_store_stats(db, store.id)
    
    return {
        "message": "Cards synced successfully",
        "total": sync_result["total"],
        "new": sync_result["new"],
        "updated": sync_result["updated"],
    }


@router.post("/{store_id}/analyze")
async def analyze_store(
    use_ai: bool = True,
    limit: Optional[int] = None,
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze all cards in store
    
    - use_ai: Enable Gemini AI validation (default: True)
    
    Analysis flow:
    1. Code validation (title, photos, description limits)
    2. WB catalog validation (allowed values, limits)
    3. AI validation (if enabled) - photo analysis, text mismatches
    4. AI suggestions for fixing issues
    """
    if store.status != StoreStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store must be active"
        )
    
    # Run analysis
    result = await analyze_store_cards(db, store.id, use_ai=use_ai, limit=limit)
    
    # Update store stats
    await update_store_stats(db, store.id)
    
    return {
        "message": "Analysis completed",
        "total_cards": result["total"],
        "analyzed": result["analyzed"],
        "issues_found": result["issues_found"],
        "ai_enabled": use_ai,
    }


@router.get("/{store_id}/stats", response_model=StoreStats)
async def get_store_stats(
    store: Store = Depends(get_user_store),
    db: AsyncSession = Depends(get_db),
):
    """Get store statistics"""
    from ..services import get_issue_stats, get_store_cards
    
    # Get issue stats
    issue_stats = await get_issue_stats(db, store.id)
    
    # Get cards for average score
    cards, total = await get_store_cards(db, store.id, limit=1000)
    avg_score = sum(c.score or 0 for c in cards) / len(cards) if cards else 0
    
    return StoreStats(
        total_cards=store.total_cards,
        critical_issues=store.critical_issues,
        warnings_count=store.warnings_count,
        improvements_count=issue_stats["by_severity"].get("improvement", 0),
        growth_potential=store.growth_potential,
        average_score=round(avg_score, 1),
        issues_by_severity=issue_stats["by_severity"],
        issues_by_category=issue_stats.get("by_category", {}),
    )


@router.post("/onboard/start", response_model=OnboardStartResponse)
async def start_onboard_store(
    data: OnboardRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    active_tasks = await db.execute(
        select(AnalysisTask)
        .where(
            AnalysisTask.task_type == TASK_TYPE_STORE_ONBOARDING,
            AnalysisTask.started_by_id == current_user.id,
            AnalysisTask.status.in_(tuple(ACTIVE_TASK_STATUSES)),
        )
        .order_by(AnalysisTask.created_at.desc(), AnalysisTask.id.desc())
    )
    for task in active_tasks.scalars().all():
        await request_task_cancellation(db, task)

    task = await create_task_record(
        db,
        task_type=TASK_TYPE_STORE_ONBOARDING,
        started_by_id=current_user.id,
        store_id=None,
        step="Запуск подключения...",
        progress=0,
        task_meta={"mode": "onboarding"},
    )
    launch_runtime_task(int(task.id), lambda: _run_onboard_task(int(task.id), current_user.id, data))
    return OnboardStartResponse(task_id=str(task.id), status="started")


@router.get("/onboard/status/{task_id}", response_model=OnboardTaskStatus)
async def get_onboard_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        parsed_task_id = parse_task_id(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    task = await db.get(AnalysisTask, parsed_task_id)
    if task is None or task.task_type != TASK_TYPE_STORE_ONBOARDING:
        raise HTTPException(status_code=404, detail="Onboarding task not found or expired")
    if task.started_by_id != current_user.id and not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    return serialize_task(task)


@router.post("/onboard/status/{task_id}/cancel", response_model=OnboardTaskStatus)
async def cancel_onboard_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        parsed_task_id = parse_task_id(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    task = await db.get(AnalysisTask, parsed_task_id)
    if task is None or task.task_type != TASK_TYPE_STORE_ONBOARDING:
        raise HTTPException(status_code=404, detail="Onboarding task not found or expired")
    if task.started_by_id != current_user.id and not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    task = await request_task_cancellation(db, task)
    return serialize_task(task)


@router.post("/onboard", response_model=OnboardResult)
async def onboard_store(
    data: OnboardRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Full onboarding flow: API key → validate → create store → sync cards → analyze
    
    Steps:
    1. Validate WB API key (seller info)
    2. Create store in DB
    3. Sync all cards from WB
    4. Run analysis on all cards (code + WB catalog + AI)
    
    Returns summary of everything done.
    """
    try:
        return await _run_onboard_flow(db, current_user, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
