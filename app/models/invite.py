import secrets
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship

from ..core.database import Base


class UserInvite(Base):
    __tablename__ = "user_invites"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(128), unique=True, index=True, nullable=False, default=lambda: secrets.token_urlsafe(48))
    email = Column(String(255), nullable=False, index=True)
    role = Column(String(50), nullable=False, default="manager")
    custom_permissions = Column(JSON, nullable=True)
    first_name = Column(String(100), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="SET NULL"), nullable=True)
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_used = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    store = relationship("Store")
    invited_by = relationship("User", foreign_keys=[invited_by_id])
