import secrets
import string
from datetime import timedelta, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.database import get_db
from ..core.config import settings
from ..core.time import utc_now
from ..core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
    get_password_hash,
    get_current_user,
)
from ..models import User, UserRole, RegistrationAccessRequest
from ..schemas import (
    UserCreate, UserOut, LoginRequest, TokenResponse,
    RefreshTokenRequest, PasswordChangeRequest, UserUpdate,
    RegisterAccessRequest, RegisterAccessResponse,
    RegisterStartRequest, RegisterStartResponse, VerifyEmailCodeRequest,
)
from ..services import (
    get_user_by_email, create_user, authenticate_user,
    update_last_login, change_password, update_user
)
from ..services.email_service import send_registration_password_email, send_email_verification_code

router = APIRouter(prefix="/auth", tags=["Authentication"])

REGISTER_EMAIL_COOLDOWN_SECONDS = 120
REGISTER_CODE_EXPIRES_SECONDS = 15 * 60


def _generate_temp_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _generate_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


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


@router.post("/register/request-access", response_model=RegisterAccessResponse)
async def register_request_access(
    req: RegisterAccessRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Email-based registration flow:
    - User enters email
    - System sends temporary password to email
    - User logs in with that password and then changes it in Profile
    """
    email = req.email.lower().strip()
    now = utc_now()

    existing_user = await get_user_by_email(db, email)
    if existing_user and existing_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    row = (
        await db.execute(
            select(RegistrationAccessRequest).where(RegistrationAccessRequest.email == email)
        )
    ).scalar_one_or_none()
    if row and row.cooldown_until and row.cooldown_until > now:
        retry_after = max(1, int((row.cooldown_until - now).total_seconds()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Повторная отправка через {retry_after} сек",
        )

    temp_password = _generate_temp_password(10)
    temp_password_hash = get_password_hash(temp_password)

    # Email must be delivered before activation/update.
    try:
        send_registration_password_email(to_email=email, password=temp_password)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось отправить письмо. Попробуйте позже.",
        )

    if existing_user and not existing_user.is_active:
        existing_user.hashed_password = temp_password_hash
        existing_user.is_active = True
        existing_user.is_verified = True
        # Public registration must never inherit invite/store role bindings.
        existing_user.role = UserRole.OWNER
        existing_user.store_id = None
        existing_user.custom_permissions = None
        if req.first_name is not None:
            existing_user.first_name = req.first_name.strip() or None
        if req.last_name is not None:
            existing_user.last_name = req.last_name.strip() or None
    elif not existing_user:
        new_user = User(
            email=email,
            hashed_password=temp_password_hash,
            first_name=(req.first_name or "").strip() or None,
            last_name=(req.last_name or "").strip() or None,
            role=UserRole.OWNER,
            is_active=True,
            is_verified=True,
        )
        db.add(new_user)

    cooldown_until = now + timedelta(seconds=REGISTER_EMAIL_COOLDOWN_SECONDS)
    expires_at = now + timedelta(days=1)
    if row:
        row.temp_password_hash = temp_password_hash
        row.first_name = (req.first_name or "").strip() or None
        row.last_name = (req.last_name or "").strip() or None
        row.expires_at = expires_at
        row.cooldown_until = cooldown_until
        row.sent_count = int(row.sent_count or 0) + 1
    else:
        db.add(
            RegistrationAccessRequest(
                email=email,
                temp_password_hash=temp_password_hash,
                first_name=(req.first_name or "").strip() or None,
                last_name=(req.last_name or "").strip() or None,
                expires_at=expires_at,
                cooldown_until=cooldown_until,
                sent_count=1,
            )
        )

    await db.commit()

    return RegisterAccessResponse(
        message="Временный пароль отправлен на email",
        cooldown_seconds=REGISTER_EMAIL_COOLDOWN_SECONDS,
    )


@router.post("/register/start", response_model=RegisterStartResponse)
async def register_start(
    req: RegisterStartRequest,
    db: AsyncSession = Depends(get_db),
):
    """Start registration: save user as inactive and send 6-digit email code."""
    email = req.email.lower().strip()
    now = utc_now()
    existing_user = await get_user_by_email(db, email)
    if existing_user and existing_user.is_active and existing_user.is_verified:
        raise HTTPException(status_code=400, detail="Email already registered")

    row = (
        await db.execute(
            select(RegistrationAccessRequest).where(RegistrationAccessRequest.email == email)
        )
    ).scalar_one_or_none()
    if row and row.cooldown_until and row.cooldown_until > now:
        retry_after = max(1, int((row.cooldown_until - now).total_seconds()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Повторная отправка через {retry_after} сек",
        )

    verification_code = _generate_verification_code()
    try:
        send_email_verification_code(to_email=email, code=verification_code)
    except Exception:
        raise HTTPException(status_code=500, detail="Не удалось отправить код. Попробуйте позже.")

    if existing_user:
        existing_user.hashed_password = get_password_hash(req.password)
        existing_user.first_name = (req.first_name or "").strip() or existing_user.first_name
        existing_user.last_name = (req.last_name or "").strip() or existing_user.last_name
        existing_user.is_active = False
        existing_user.is_verified = False
        # Public registration must reset role/store inherited from invites.
        existing_user.role = UserRole.OWNER
        existing_user.store_id = None
        existing_user.custom_permissions = None
    else:
        db.add(
            User(
                email=email,
                hashed_password=get_password_hash(req.password),
                first_name=(req.first_name or "").strip() or None,
                last_name=(req.last_name or "").strip() or None,
                role=UserRole.OWNER,
                is_active=False,
                is_verified=False,
            )
        )

    cooldown_until = now + timedelta(seconds=REGISTER_EMAIL_COOLDOWN_SECONDS)
    expires_at = now + timedelta(seconds=REGISTER_CODE_EXPIRES_SECONDS)
    code_hash = get_password_hash(verification_code)
    if row:
        row.temp_password_hash = code_hash
        row.first_name = (req.first_name or "").strip() or None
        row.last_name = (req.last_name or "").strip() or None
        row.expires_at = expires_at
        row.cooldown_until = cooldown_until
        row.sent_count = int(row.sent_count or 0) + 1
    else:
        db.add(
            RegistrationAccessRequest(
                email=email,
                temp_password_hash=code_hash,
                first_name=(req.first_name or "").strip() or None,
                last_name=(req.last_name or "").strip() or None,
                expires_at=expires_at,
                cooldown_until=cooldown_until,
                sent_count=1,
            )
        )

    await db.commit()
    return RegisterStartResponse(
        message="Код подтверждения отправлен на email",
        cooldown_seconds=REGISTER_EMAIL_COOLDOWN_SECONDS,
        expires_in_seconds=REGISTER_CODE_EXPIRES_SECONDS,
    )


@router.post("/register/resend-code", response_model=RegisterStartResponse)
async def register_resend_code(
    req: RegisterAccessRequest,
    db: AsyncSession = Depends(get_db),
):
    """Resend 6-digit code for inactive account."""
    email = req.email.lower().strip()
    now = utc_now()

    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    if user.is_active and user.is_verified:
        raise HTTPException(status_code=400, detail="Аккаунт уже активирован")

    row = (
        await db.execute(
            select(RegistrationAccessRequest).where(RegistrationAccessRequest.email == email)
        )
    ).scalar_one_or_none()
    if row and row.cooldown_until and row.cooldown_until > now:
        retry_after = max(1, int((row.cooldown_until - now).total_seconds()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Повторная отправка через {retry_after} сек",
        )

    verification_code = _generate_verification_code()
    try:
        send_email_verification_code(to_email=email, code=verification_code)
    except Exception:
        raise HTTPException(status_code=500, detail="Не удалось отправить код. Попробуйте позже.")

    cooldown_until = now + timedelta(seconds=REGISTER_EMAIL_COOLDOWN_SECONDS)
    expires_at = now + timedelta(seconds=REGISTER_CODE_EXPIRES_SECONDS)
    code_hash = get_password_hash(verification_code)
    if row:
        row.temp_password_hash = code_hash
        row.expires_at = expires_at
        row.cooldown_until = cooldown_until
        row.sent_count = int(row.sent_count or 0) + 1
    else:
        db.add(
            RegistrationAccessRequest(
                email=email,
                temp_password_hash=code_hash,
                first_name=user.first_name,
                last_name=user.last_name,
                expires_at=expires_at,
                cooldown_until=cooldown_until,
                sent_count=1,
            )
        )

    await db.commit()
    return RegisterStartResponse(
        message="Код подтверждения отправлен повторно",
        cooldown_seconds=REGISTER_EMAIL_COOLDOWN_SECONDS,
        expires_in_seconds=REGISTER_CODE_EXPIRES_SECONDS,
    )


@router.post("/register/verify-code", response_model=TokenResponse)
async def register_verify_code(
    req: VerifyEmailCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify email code, activate account, and login."""
    email = req.email.lower().strip()
    code = req.code.strip()
    now = utc_now()

    row = (
        await db.execute(
            select(RegistrationAccessRequest).where(RegistrationAccessRequest.email == email)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Код не найден. Запросите повторно.")
    if row.expires_at < now:
        raise HTTPException(status_code=400, detail="Код истёк. Запросите новый код.")
    if not verify_password(code, row.temp_password_hash):
        raise HTTPException(status_code=400, detail="Неверный код подтверждения")

    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    user.is_verified = True
    user.is_active = True
    if not user.first_name and row.first_name:
        user.first_name = row.first_name
    if not user.last_name and row.last_name:
        user.last_name = row.last_name
    await update_last_login(db, user)
    await db.delete(row)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(login_data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Login and get access token"""
    user = await authenticate_user(db, login_data.email, login_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    
    if not user.is_active or not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_NOT_VERIFIED",
                "message": "Аккаунт не активирован. Подтвердите код из email.",
                "email": user.email,
            },
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


@router.patch("/me", response_model=UserOut)
async def update_current_user_info(
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update current user profile (first_name, last_name, phone)."""
    updated = await update_user(db, current_user, user_data)
    return updated


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload profile avatar image and store public URL in user profile."""
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Разрешены только изображения")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        ext = ".jpg"

    avatars_dir = Path(settings.MEDIA_ROOT) / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    filename = f"user_{current_user.id}_{int(utc_now().timestamp())}_{secrets.token_hex(4)}{ext}"
    file_path = avatars_dir / filename

    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Максимальный размер изображения: 5MB")
    file_path.write_bytes(data)

    current_user.avatar_url = f"/media/avatars/{filename}"
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/heartbeat")
async def heartbeat(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update last_active_at — called every 60s from frontend when user is active."""
    current_user.last_active_at = utc_now()
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
    if not invite or invite.is_used or invite.expires_at < utc_now():
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

    result = await db.execute(
        select(UserInvite).where(UserInvite.token == token)
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.is_used or invite.expires_at < utc_now():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite link is invalid or has expired",
        )

    existing = await get_user_by_email(db, invite.email)
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="User already registered")
        # Reactivate deactivated user with new password and role
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
