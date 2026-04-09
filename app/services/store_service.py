from datetime import datetime
from typing import Optional, List
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..core.time import utc_now
from ..models import Store, StoreStatus, Card, CardIssue, User
from ..schemas import StoreCreate, StoreUpdate
from ..services.issue_service import non_dedicated_media_issue_filter


async def create_store(db: AsyncSession, owner_id: int, store_data: StoreCreate) -> Store:
    await ensure_store_not_exists(
        db,
        owner_id=owner_id,
        api_key=store_data.api_key,
    )

    store = Store(
        owner_id=owner_id,
        name=store_data.name,
        api_key=store_data.api_key,
        status=StoreStatus.PENDING,
    )
    db.add(store)
    await db.commit()
    await db.refresh(store)
    return store


async def ensure_account_can_create_store(db: AsyncSession, user: User) -> None:
    """
    Business rule:
    - Only owner can connect a store.
    """
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val != "owner":
        raise ValueError("Only owner can connect a new store")


async def ensure_store_not_exists(
    db: AsyncSession,
    owner_id: int,
    api_key: Optional[str] = None,
    wb_supplier_id: Optional[str] = None,
    exclude_store_id: Optional[int] = None,
) -> None:
    """Prevent connecting the same store twice for one owner."""
    if api_key:
        query = select(Store).where(
            Store.owner_id == owner_id,
            Store.api_key == api_key,
        )
        if exclude_store_id is not None:
            query = query.where(Store.id != exclude_store_id)
        by_key = await db.execute(query)
        if by_key.scalar_one_or_none():
            raise ValueError("Store with this API key is already connected")

    if wb_supplier_id:
        query = select(Store).where(
            Store.owner_id == owner_id,
            Store.wb_supplier_id == str(wb_supplier_id),
        )
        if exclude_store_id is not None:
            query = query.where(Store.id != exclude_store_id)
        by_supplier = await db.execute(query)
        if by_supplier.scalar_one_or_none():
            raise ValueError("This WB supplier is already connected")


async def _hydrate_missing_wb_ping_access(db: AsyncSession, stores: List[Store]) -> bool:
    from .wb_api import WildberriesAPI

    updated = False
    for store in stores:
        if not store:
            continue

        default_api_key = str(getattr(store, "api_key", "") or "").strip()
        if default_api_key and not isinstance(getattr(store, "wb_ping_access", None), dict):
            store.wb_ping_access = await WildberriesAPI(default_api_key).collect_ping_access()
            store.wb_ping_checked_at = utc_now()
            updated = True

        for slot_row in getattr(store, "feature_api_keys", []) or []:
            slot_api_key = str(getattr(slot_row, "api_key", "") or "").strip()
            if slot_api_key and not isinstance(getattr(slot_row, "wb_ping_access", None), dict):
                slot_row.wb_ping_access = await WildberriesAPI(slot_api_key).collect_ping_access()
                slot_row.wb_ping_checked_at = utc_now()
                updated = True

    if updated:
        await db.commit()
    return updated


async def get_store_by_id(db: AsyncSession, store_id: int) -> Optional[Store]:
    async def _load() -> Optional[Store]:
        result = await db.execute(
            select(Store)
            .where(Store.id == store_id)
            .options(selectinload(Store.feature_api_keys))
        )
        return result.scalar_one_or_none()

    store = await _load()
    if store and await _hydrate_missing_wb_ping_access(db, [store]):
        store = await _load()
    return store


async def get_user_stores(db: AsyncSession, owner_id: int) -> List[Store]:
    async def _load_owned() -> List[Store]:
        owned = await db.execute(
            select(Store)
            .where(Store.owner_id == owner_id)
            .options(selectinload(Store.feature_api_keys))
            .order_by(Store.created_at.desc())
        )
        return list(owned.scalars().all())

    stores = await _load_owned()
    if stores and await _hydrate_missing_wb_ping_access(db, stores):
        stores = await _load_owned()

    # If not an owner, find store via user.store_id (invited member)
    if not stores:
        user_r = await db.execute(select(User).where(User.id == owner_id))
        user = user_r.scalar_one_or_none()
        if user and user.store_id:
            async def _load_member_store() -> Optional[Store]:
                store_r = await db.execute(
                    select(Store)
                    .where(Store.id == user.store_id)
                    .options(selectinload(Store.feature_api_keys))
                )
                return store_r.scalar_one_or_none()

            member_store = await _load_member_store()
            if member_store and await _hydrate_missing_wb_ping_access(db, [member_store]):
                member_store = await _load_member_store()
            if member_store:
                stores = [member_store]

    return stores


async def update_store(db: AsyncSession, store: Store, store_data: StoreUpdate) -> Store:
    update_data = store_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(store, field, value)
    store.updated_at = utc_now()
    await db.commit()
    await db.refresh(store)
    return store


async def update_store_status(
    db: AsyncSession,
    store: Store,
    status: StoreStatus,
    message: Optional[str] = None,
    wb_info: Optional[dict] = None
) -> Store:
    store.status = status
    store.status_message = message
    if wb_info:
        store.wb_supplier_id = wb_info.get("supplier_id")
        store.wb_supplier_name = wb_info.get("supplier_name")
    store.updated_at = utc_now()
    await db.commit()
    await db.refresh(store)
    return store


async def update_store_stats(db: AsyncSession, store_id: int) -> None:
    """Recalculate and update store statistics"""
    # Count cards
    cards_result = await db.execute(
        select(func.count(Card.id)).where(Card.store_id == store_id)
    )
    total_cards = cards_result.scalar() or 0
    
    # Count issues by severity
    from ..models import IssueSeverity, IssueStatus
    
    critical_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.severity == IssueSeverity.CRITICAL,
            CardIssue.status == IssueStatus.PENDING
        )
    )
    critical_count = critical_result.scalar() or 0
    
    warnings_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.severity == IssueSeverity.WARNING,
            CardIssue.status == IssueStatus.PENDING,
            non_dedicated_media_issue_filter(),
        )
    )
    warnings_count = warnings_result.scalar() or 0
    
    # Calculate potential growth (simplified)
    avg_score_result = await db.execute(
        select(func.avg(Card.score)).where(Card.store_id == store_id)
    )
    avg_score = avg_score_result.scalar() or 0
    potential_growth = max(0, int((100 - float(avg_score)) * 0.26))  # ~26% max
    
    # Update store
    await db.execute(
        update(Store)
        .where(Store.id == store_id)
        .values(
            total_cards=total_cards,
            critical_issues=critical_count,
            warnings_count=warnings_count,
            growth_potential=potential_growth,
            updated_at=utc_now()
        )
    )
    await db.commit()


async def delete_store(db: AsyncSession, store: Store) -> None:
    await db.delete(store)
    await db.commit()


async def check_store_access(db: AsyncSession, store_id: int, user_id: int) -> bool:
    """Check if user has access to the store"""
    result = await db.execute(
        select(Store).where(Store.id == store_id, Store.owner_id == user_id)
    )
    return result.scalar_one_or_none() is not None
