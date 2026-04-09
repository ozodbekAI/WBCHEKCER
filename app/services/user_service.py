from datetime import datetime
from typing import Optional
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.time import utc_now
from ..models import User, UserRole
from ..core.security import get_password_hash, verify_password
from ..schemas import UserCreate, UserUpdate


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, user_data: UserCreate, role: UserRole = UserRole.USER) -> User:
    user = User(
        email=user_data.email.lower(),
        hashed_password=get_password_hash(user_data.password),
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        phone=user_data.phone,
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    user = await get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def update_user(db: AsyncSession, user: User, user_data: UserUpdate) -> User:
    update_data = user_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    user.updated_at = utc_now()
    await db.commit()
    await db.refresh(user)
    return user


async def update_last_login(db: AsyncSession, user: User) -> None:
    user.last_login = utc_now()
    await db.commit()


async def change_password(db: AsyncSession, user: User, new_password: str) -> None:
    user.hashed_password = get_password_hash(new_password)
    user.updated_at = utc_now()
    await db.commit()


async def get_all_users(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    role: Optional[UserRole] = None,
    exclude_roles: Optional[list] = None,
) -> list[User]:
    query = select(User).offset(skip).limit(limit)
    if role:
        query = query.where(User.role == role)
    if exclude_roles:
        query = query.where(User.role.notin_(exclude_roles))
    result = await db.execute(query)
    return list(result.scalars().all())
