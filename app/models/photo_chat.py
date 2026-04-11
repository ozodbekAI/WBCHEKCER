from __future__ import annotations

from typing import Any, Mapping

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


PHOTO_CHAT_THREAD_CONTEXT_KEYS = (
    "last_generated_asset_id",
    "working_asset_ids",
    "pending_question",
    "last_action",
    "locale",
)


def default_photo_chat_thread_context() -> dict[str, Any]:
    return {
        "last_generated_asset_id": None,
        "working_asset_ids": [],
        "pending_question": None,
        "last_action": None,
        "locale": None,
    }


def normalize_photo_chat_thread_context(
    value: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    base = default_photo_chat_thread_context()
    raw = value if isinstance(value, Mapping) else {}

    try:
        base["last_generated_asset_id"] = (
            int(raw.get("last_generated_asset_id"))
            if raw.get("last_generated_asset_id") is not None
            else None
        )
    except (TypeError, ValueError):
        base["last_generated_asset_id"] = None

    working_asset_ids: list[int] = []
    for item in raw.get("working_asset_ids") or []:
        try:
            working_asset_ids.append(int(item))
        except (TypeError, ValueError):
            continue
    base["working_asset_ids"] = working_asset_ids

    pending_question = raw.get("pending_question")
    if pending_question is not None:
        pending_question = str(pending_question).strip() or None
    base["pending_question"] = pending_question

    last_action = raw.get("last_action")
    if isinstance(last_action, Mapping):
        base["last_action"] = dict(last_action)
    elif last_action is None:
        base["last_action"] = None
    else:
        base["last_action"] = str(last_action).strip() or None

    locale = raw.get("locale")
    if locale is not None:
        locale = str(locale).strip() or None
    base["locale"] = locale

    return base


class PhotoChatSession(Base):
    __tablename__ = "photo_chat_sessions"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, index=True, nullable=False)
    client_session_id = Column(String(128), index=True, nullable=False)

    # relative path under MEDIA_ROOT, like: photos/sessions/<session_id>/<file>.png
    last_generated_relpath = Column(String(512), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    threads = relationship("PhotoChatThread", back_populates="session", cascade="all, delete-orphan")
    messages = relationship("PhotoChatMessage", back_populates="session", cascade="all, delete-orphan")
    media_items = relationship("PhotoChatMedia", back_populates="session", cascade="all, delete-orphan")


class PhotoChatThread(Base):
    __tablename__ = "photo_chat_threads"

    id = Column(Integer, primary_key=True, index=True)

    session_id = Column(Integer, ForeignKey("photo_chat_sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    is_active = Column(Boolean, nullable=False, default=False)
    context = Column(JSON, nullable=False, default=default_photo_chat_thread_context)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    session = relationship("PhotoChatSession", back_populates="threads")
    messages = relationship("PhotoChatMessage", back_populates="thread", cascade="all, delete-orphan")


class PhotoChatMessage(Base):
    __tablename__ = "photo_chat_messages"

    id = Column(Integer, primary_key=True, index=True)

    session_id = Column(Integer, ForeignKey("photo_chat_sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    thread_id = Column(Integer, ForeignKey("photo_chat_threads.id", ondelete="CASCADE"), index=True, nullable=False)
    request_id = Column(String(128), index=True, nullable=True)

    role = Column(String(16), nullable=False)  # user | model | system
    msg_type = Column(String(32), nullable=False, default="text")  # text | info | action-progress | action-complete

    content = Column(Text, nullable=True)
    meta = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("PhotoChatSession", back_populates="messages")
    thread = relationship("PhotoChatThread", back_populates="messages")


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
