import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, 
    Enum, Text, ForeignKey, Index, JSON
)
from sqlalchemy.orm import relationship

from ..core.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    OWNER = "owner"             # Владелец — видит всё, управляет командой
    HEAD_MANAGER = "head_manager"  # Старший менеджер — проверяет и утверждает
    MANAGER = "manager"         # Менеджер — исправляет ошибки
    USER = "user"               # Обычный пользователь (legacy)
    VIEWER = "viewer"           # Только просмотр


# ── Permission constants ──
class Permission(str, enum.Enum):
    DASHBOARD_VIEW = "dashboard.view"
    CARDS_VIEW = "cards.view"
    CARDS_EDIT = "cards.edit"
    CARDS_APPROVE = "cards.approve"
    CARDS_SYNC = "cards.sync"
    ISSUES_FIX = "issues.fix"
    ISSUES_APPLY = "issues.apply"
    PHOTOS_MANAGE = "photos.manage"
    AB_TESTS = "ab_tests.manage"
    FEEDBACK_VIEW = "feedback.view"
    FEEDBACK_MANAGE = "feedback.manage"
    PROMOTION_MANAGE = "promotion.manage"
    TEAM_VIEW = "team.view"
    TEAM_MANAGE = "team.manage"


# Human-readable labels for permissions (Russian)
PERMISSION_LABELS: dict[str, str] = {
    "dashboard.view": "Просмотр дашборда",
    "cards.view": "Просмотр карточек",
    "cards.edit": "Редактирование карточек",
    "cards.approve": "Одобрение карточек",
    "cards.sync": "Синхронизация с WB",
    "issues.fix": "Исправление ошибок",
    "issues.apply": "Применение исправлений",
    "photos.manage": "Фотостудия",
    "ab_tests.manage": "A/B тесты",
    "feedback.view": "Просмотр отзывов",
    "feedback.manage": "Ответы на отзывы",
    "promotion.manage": "Управление акциями",
    "team.view": "Просмотр команды",
    "team.manage": "Управление командой",
}

# Permission groups for UI
PERMISSION_GROUPS: dict[str, list[str]] = {
    "Карточки": ["cards.view", "cards.edit", "cards.approve", "cards.sync"],
    "Проблемы": ["issues.fix", "issues.apply"],
    "Инструменты": ["photos.manage", "ab_tests.manage", "feedback.view", "feedback.manage", "promotion.manage"],
    "Команда": ["team.view", "team.manage"],
    "Общее": ["dashboard.view"],
}


# ── Role → Permissions mapping ──
ROLE_PERMISSIONS: dict[str, set[str]] = {
    UserRole.ADMIN: {"*"},  # All permissions
    UserRole.OWNER: {
        Permission.DASHBOARD_VIEW, Permission.CARDS_VIEW, Permission.CARDS_EDIT,
        Permission.CARDS_APPROVE, Permission.CARDS_SYNC,
        Permission.ISSUES_FIX, Permission.ISSUES_APPLY,
        Permission.PHOTOS_MANAGE, Permission.AB_TESTS, 
        Permission.FEEDBACK_VIEW, Permission.FEEDBACK_MANAGE,
        Permission.PROMOTION_MANAGE,
        Permission.TEAM_VIEW, Permission.TEAM_MANAGE,
    },
    UserRole.HEAD_MANAGER: {
        Permission.DASHBOARD_VIEW, Permission.CARDS_VIEW, Permission.CARDS_EDIT,
        Permission.CARDS_APPROVE, Permission.CARDS_SYNC,
        Permission.ISSUES_FIX, Permission.ISSUES_APPLY,
        Permission.PHOTOS_MANAGE, Permission.AB_TESTS,
        Permission.FEEDBACK_VIEW, Permission.FEEDBACK_MANAGE,
        Permission.TEAM_VIEW,
    },
    UserRole.MANAGER: {
        Permission.DASHBOARD_VIEW, Permission.CARDS_VIEW, Permission.CARDS_EDIT,
        Permission.ISSUES_FIX, Permission.PHOTOS_MANAGE,
        Permission.FEEDBACK_VIEW,
    },
    UserRole.USER: {
        Permission.DASHBOARD_VIEW, Permission.CARDS_VIEW,
    },
    UserRole.VIEWER: {
        Permission.DASHBOARD_VIEW, Permission.CARDS_VIEW,
    },
}


def user_has_permission(user_role: str, permission: str, custom_permissions: list | None = None) -> bool:
    """Check if a user has a specific permission (custom overrides role)."""
    if custom_permissions is not None and len(custom_permissions) > 0:
        return permission in custom_permissions
    perms = ROLE_PERMISSIONS.get(user_role, set())
    return "*" in perms or permission in perms


def get_user_permissions(user_role: str, custom_permissions: list | None = None) -> list[str]:
    """Return flat list of permission strings for a role or custom set."""
    if custom_permissions is not None and len(custom_permissions) > 0:
        return list(custom_permissions)
    perms = ROLE_PERMISSIONS.get(user_role, set())
    if "*" in perms:
        return [p.value for p in Permission]
    return [p if isinstance(p, str) else p.value for p in perms]


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    role = Column(
        Enum(UserRole, values_callable=lambda x: [e.value for e in x]),
        default=UserRole.USER,
        nullable=False
    )
    custom_permissions = Column(JSON, nullable=True, default=None)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="SET NULL"), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    last_active_at = Column(DateTime, nullable=True)
    
    # Relationships
    stores = relationship("Store", back_populates="owner", cascade="all, delete-orphan",
                          foreign_keys="Store.owner_id")
    created_prompts = relationship("PromptTemplate", back_populates="creator")
    
    __table_args__ = (
        Index("idx_users_email", "email"),
        Index("idx_users_role", "role"),
    )
    
    @property
    def full_name(self) -> str:
        parts = [self.first_name, self.last_name]
        return " ".join(p for p in parts if p) or self.email

    def has_permission(self, permission: str) -> bool:
        role_val = self.role.value if isinstance(self.role, UserRole) else self.role
        return user_has_permission(role_val, permission, self.custom_permissions)

    @property
    def permissions(self) -> list[str]:
        role_val = self.role.value if isinstance(self.role, UserRole) else self.role
        return get_user_permissions(role_val, self.custom_permissions)
