from datetime import datetime
from typing import Optional, List
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Store, StoreStatus, Card, CardIssue, User
from ..schemas import StoreCreate, StoreUpdate


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
) -> None:
    """Prevent connecting the same store twice for one owner."""
    if api_key:
        by_key = await db.execute(
            select(Store).where(
                Store.owner_id == owner_id,
                Store.api_key == api_key,
            )
        )
        if by_key.scalar_one_or_none():
            raise ValueError("Store with this API key is already connected")

    if wb_supplier_id:
        by_supplier = await db.execute(
            select(Store).where(
                Store.owner_id == owner_id,
                Store.wb_supplier_id == str(wb_supplier_id),
            )
        )
        if by_supplier.scalar_one_or_none():
            raise ValueError("This WB supplier is already connected")


async def get_store_by_id(db: AsyncSession, store_id: int) -> Optional[Store]:
    result = await db.execute(select(Store).where(Store.id == store_id))
    return result.scalar_one_or_none()


async def get_user_stores(db: AsyncSession, owner_id: int) -> List[Store]:
    # Stores owned by this user
    owned = await db.execute(
        select(Store)
        .where(Store.owner_id == owner_id)
        .order_by(Store.created_at.desc())
    )
    stores = list(owned.scalars().all())

    # If not an owner, find store via user.store_id (invited member)
    if not stores:
        user_r = await db.execute(select(User).where(User.id == owner_id))
        user = user_r.scalar_one_or_none()
        if user and user.store_id:
            store_r = await db.execute(select(Store).where(Store.id == user.store_id))
            member_store = store_r.scalar_one_or_none()
            if member_store:
                stores = [member_store]

    return stores


async def update_store(db: AsyncSession, store: Store, store_data: StoreUpdate) -> Store:
    update_data = store_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(store, field, value)
    store.updated_at = datetime.utcnow()
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
    store.updated_at = datetime.utcnow()
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
            CardIssue.status == IssueStatus.PENDING
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
            updated_at=datetime.utcnow()
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
