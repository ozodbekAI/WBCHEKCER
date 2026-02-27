from datetime import timedelta, datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.config import settings
from ..core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
    get_current_user,
)
from ..models import User
from ..schemas import (
    UserCreate, UserOut, LoginRequest, TokenResponse,
    RefreshTokenRequest, PasswordChangeRequest
)
from ..services import (
    get_user_by_email, create_user, authenticate_user,
    update_last_login, change_password
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── Accept-invite schemas ──────────────────────────────────
from pydantic import BaseModel as _BaseModel, Field as _Field
from typing import Optional as _Optional

class _AcceptInviteRequest(_BaseModel):
    password: str = _Field(min_length=6)
    first_name: _Optional[str] = None


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    """Register a new user"""
    # Check if user exists
    existing = await get_user_by_email(db, user_data.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    user = await create_user(db, user_data)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(login_data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Login and get access token"""
    user = await authenticate_user(db, login_data.email, login_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )
    
    # Update last login
    await update_last_login(db, user)
    
    # Create tokens
    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    refresh_data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
):
    """Refresh access token"""
    payload = decode_token(refresh_data.refresh_token)
    
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    
    from ..services import get_user_by_id
    user = await get_user_by_id(db, int(user_id))
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    
    # Create new tokens
    access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current user info"""
    return current_user


@router.post("/heartbeat")
async def heartbeat(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update last_active_at — called every 60s from frontend when user is active."""
    current_user.last_active_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/change-password")
async def change_user_password(
    password_data: PasswordChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change current user's password"""
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    
    await change_password(db, current_user, password_data.new_password)
    
    return {"message": "Password changed successfully"}


# ── Invite accept endpoints ─────────────────────────────────

@router.get("/accept-invite/{token}")
async def get_invite_info(token: str, db: AsyncSession = Depends(get_db)):
    """Return invite metadata so frontend can pre-fill email/name."""
    from datetime import datetime
    from sqlalchemy import select
    from ..models.invite import UserInvite

    result = await db.execute(
        select(UserInvite).where(UserInvite.token == token)
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.is_used or invite.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite link is invalid or has expired",
        )
    return {
        "email": invite.email,
        "first_name": invite.first_name,
        "role": invite.role,
    }


@router.post("/accept-invite/{token}", response_model=TokenResponse)
async def accept_invite(
    token: str,
    data: _AcceptInviteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Accept invitation: create user account with chosen password and return tokens."""
    from datetime import datetime
    from sqlalchemy import select
    from ..models.invite import UserInvite
    from ..models.user import UserRole

    result = await db.execute(
        select(UserInvite).where(UserInvite.token == token)
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.is_used or invite.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite link is invalid or has expired",
        )

    existing = await get_user_by_email(db, invite.email)
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="User already registered")
        # Reactivate deactivated user with new password and role
        from ..core.security import get_password_hash
        existing.hashed_password = get_password_hash(data.password)
        existing.is_active = True
        existing.first_name = data.first_name or invite.first_name or existing.first_name
        try:
            existing.role = UserRole(invite.role)
        except ValueError:
            existing.role = UserRole.MANAGER
        if invite.store_id:
            existing.store_id = invite.store_id
        if invite.custom_permissions:
            existing.custom_permissions = invite.custom_permissions
        invite.is_used = True
        await db.commit()
        await db.refresh(existing)
        await update_last_login(db, existing)
        access_token = create_access_token(data={"sub": str(existing.id)})
        refresh_token = create_refresh_token(data={"sub": str(existing.id)})
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=UserOut.model_validate(existing),
        )

    first_name = data.first_name or invite.first_name
    user_data = UserCreate(email=invite.email, password=data.password, first_name=first_name)
    try:
        role = UserRole(invite.role)
    except ValueError:
        role = UserRole.MANAGER

    new_user = await create_user(db, user_data, role=role)

    # Link user to the store they were invited to
    if invite.store_id:
        new_user.store_id = invite.store_id

    # Apply custom permissions if any
    if invite.custom_permissions:
        new_user.custom_permissions = invite.custom_permissions

    await db.commit()
    await db.refresh(new_user)

    invite.is_used = True
    await db.commit()

    await update_last_login(db, new_user)
    access_token = create_access_token(data={"sub": str(new_user.id)})
    refresh_token = create_refresh_token(data={"sub": str(new_user.id)})

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(new_user),
    )
