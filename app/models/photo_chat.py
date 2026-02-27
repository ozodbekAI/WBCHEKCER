from __future__ import annotations

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class PhotoChatSession(Base):
    __tablename__ = "photo_chat_sessions"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, index=True, nullable=False)
    client_session_id = Column(String(128), index=True, nullable=False)

    # relative path under MEDIA_ROOT, like: photos/sessions/<session_id>/<file>.png
    last_generated_relpath = Column(String(512), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    messages = relationship("PhotoChatMessage", back_populates="session", cascade="all, delete-orphan")
    media_items = relationship("PhotoChatMedia", back_populates="session", cascade="all, delete-orphan")


class PhotoChatMessage(Base):
    __tablename__ = "photo_chat_messages"

    id = Column(Integer, primary_key=True, index=True)

    session_id = Column(Integer, ForeignKey("photo_chat_sessions.id", ondelete="CASCADE"), index=True, nullable=False)

    role = Column(String(16), nullable=False)  # user | model | system
    msg_type = Column(String(32), nullable=False, default="text")  # text | info | action-progress | action-complete

    content = Column(Text, nullable=True)
    meta = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("PhotoChatSession", back_populates="messages")


class PhotoChatMedia(Base):
    __tablename__ = "photo_chat_media"

    id = Column(Integer, primary_key=True, index=True)

    session_id = Column(Integer, ForeignKey("photo_chat_sessions.id", ondelete="CASCADE"), index=True, nullable=False)

    kind = Column(String(16), nullable=False, default="image")  # image | video
    source = Column(String(32), nullable=False, default="user")  # user | generated

    # relative path under MEDIA_ROOT
    relpath = Column(String(512), nullable=False)

    # optional original URL (WB/CDN/etc.)
    source_url = Column(String(1024), nullable=True)

    # optional prompt that produced this media
    prompt = Column(Text, nullable=True)

    # 1-based order inside session
    seq = Column(Integer, nullable=False, default=1)

    meta = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("PhotoChatSession", back_populates="media_items")
