from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.security import get_current_user, require_admin
from ..models import User, UserRole
from ..schemas import UserOut, UserUpdateAdmin
from ..services import get_all_users, get_user_by_id, update_user

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/users", response_model=List[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    role: Optional[str] = None,
):
    """List all users (admin only). Owner accounts are excluded — owners manage their own stores."""
    # Admin should not see/manage owner accounts
    excluded_roles = [UserRole.OWNER]
    role_enum = UserRole(role) if role else None
    if role_enum in excluded_roles:
        return []
    users = await get_all_users(db, skip=skip, limit=limit, role=role_enum, exclude_roles=excluded_roles)
    return users


@router.get("/users/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Get user by ID (admin only)"""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user_admin(
    user_id: int,
    user_data: UserUpdateAdmin,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update user (admin only)"""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Handle role update
    update_dict = user_data.model_dump(exclude_unset=True)
    if "role" in update_dict:
        update_dict["role"] = UserRole(update_dict["role"])
    
    for key, value in update_dict.items():
        setattr(user, key, value)
    
    await db.commit()
    await db.refresh(user)
    
    return user
