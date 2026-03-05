from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.security import get_current_user
from ..models import User, Store, StoreStatus
from ..schemas import StoreCreate, StoreUpdate, StoreOut, StoreStats, StoreValidationResult
from ..schemas.store import OnboardRequest, OnboardResult
from ..services import (
    create_store, get_store_by_id, get_user_stores,
    ensure_account_can_create_store,
    ensure_store_not_exists,
    update_store, update_store_status, update_store_stats,
    delete_store, check_store_access, WildberriesAPI,
    sync_cards_from_wb, analyze_store_cards,
)

router = APIRouter(prefix="/stores", tags=["Stores"])


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
    if store.owner_id != current_user.id and current_user.role != "admin":
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
):
    """Update store info"""
    updated = await update_store(db, store, store_data)
    return updated


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
    
    if result["is_valid"]:
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
    """Sync cards from WB"""
    if store.status != StoreStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Store must be validated first"
        )
    
    # Fetch cards from WB
    wb_api = WildberriesAPI(store.api_key)
    result = await wb_api.get_cards(limit=100)
    
    if not result["success"]:
        # Return detailed error info
        error_detail = result.get('error', 'Unknown error')
        error_details = result.get('details', '')
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch cards: {error_detail}. Details: {error_details}"
        )
    
    # Sync to database
    sync_result = await sync_cards_from_wb(db, store.id, result["cards"])
    
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
    # Step 1: Validate API key
    try:
        await ensure_account_can_create_store(db, current_user)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    wb_api = WildberriesAPI(data.api_key)
    validation = await wb_api.validate_api_key()
    
    if not validation["is_valid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid API key: {validation.get('error', 'Unknown error')}"
        )
    
    supplier_name = validation.get("supplier_name") or validation.get("trade_mark") or "Мой магазин"
    supplier_id = validation.get("supplier_id")

    # Prevent duplicate onboarding for the same account/supplier
    try:
        await ensure_store_not_exists(
            db,
            owner_id=current_user.id,
            api_key=data.api_key,
            wb_supplier_id=str(supplier_id) if supplier_id is not None else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    # Step 2: Create store
    store_data = StoreCreate(
        name=data.name or supplier_name,
        api_key=data.api_key,
    )
    store = await create_store(db, current_user.id, store_data)
    
    # Mark as active
    await update_store_status(
        db, store, StoreStatus.ACTIVE,
        wb_info={
            "supplier_id": supplier_id,
            "supplier_name": validation.get("supplier_name"),
        }
    )
    
    # Step 3: Sync cards
    cards_result = await wb_api.get_cards(limit=100)
    sync_result = {"total": 0, "new": 0, "updated": 0}
    
    if cards_result["success"]:
        # Paginate through all cards
        all_cards = cards_result["cards"]
        cursor = cards_result.get("cursor", {})
        
        while cursor.get("updatedAt") and cursor.get("nmID") and len(cards_result.get("cards", [])) > 0:
            cards_result = await wb_api.get_cards(
                limit=100,
                updated_at=cursor.get("updatedAt"),
                nm_id=cursor.get("nmID"),
            )
            if cards_result["success"] and cards_result.get("cards"):
                all_cards.extend(cards_result["cards"])
                cursor = cards_result.get("cursor", {})
            else:
                break
        
        sync_result = await sync_cards_from_wb(db, store.id, all_cards)
    
    # Update store stats after sync
    await update_store_stats(db, store.id)
    
    # Step 4: Analyze all cards
    analyze_result = await analyze_store_cards(
        db, store.id, use_ai=data.use_ai
    )
    
    # Final stats update
    await update_store_stats(db, store.id)
    
    return OnboardResult(
        store_id=store.id,
        store_name=store.name,
        supplier_name=validation.get("supplier_name"),
        supplier_id=supplier_id,
        cards_synced=sync_result["total"],
        cards_new=sync_result["new"],
        cards_analyzed=analyze_result["analyzed"],
        issues_found=analyze_result["issues_found"],
        ai_enabled=data.use_ai,
    )
