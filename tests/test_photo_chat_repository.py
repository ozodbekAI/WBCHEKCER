from __future__ import annotations

from pathlib import Path
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.database import Base
from app.models.photo_chat import (
    PhotoChatMedia,
    PhotoChatMessage,
    PhotoChatSession,
    PhotoChatThread,
    default_photo_chat_thread_context,
)
from app.services.photo_chat_repository import PhotoChatRepository


def _make_repo() -> tuple[PhotoChatRepository, sessionmaker]:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(
        engine,
        tables=[
            PhotoChatSession.__table__,
            PhotoChatThread.__table__,
            PhotoChatMessage.__table__,
            PhotoChatMedia.__table__,
        ],
    )
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
    return PhotoChatRepository(session_factory()), session_factory


def test_get_or_create_active_thread_bootstraps_default_context():
    repo, _session_factory = _make_repo()

    session = repo.get_or_create_user_session(user_id=101)
    thread = repo.get_or_create_active_thread(session.id)

    assert thread.session_id == session.id
    assert thread.is_active is True
    assert thread.context == default_photo_chat_thread_context()
    assert repo.get_or_create_active_thread(session.id).id == thread.id


def test_add_message_uses_active_thread_and_request_id():
    repo, _session_factory = _make_repo()

    session = repo.get_or_create_user_session(user_id=202)
    thread = repo.get_or_create_active_thread(session.id)
    message = repo.add_message(
        session_id=session.id,
        role="user",
        content="hello",
        request_id="req-202",
    )

    assert message.thread_id == thread.id
    assert message.request_id == "req-202"
    assert repo.list_messages(session.id, limit=None)[0].id == message.id


def test_create_new_thread_switches_active_history_and_normalizes_context():
    repo, _session_factory = _make_repo()

    session = repo.get_or_create_user_session(user_id=303)
    original_thread = repo.get_or_create_active_thread(session.id)
    original_message = repo.add_message(session_id=session.id, role="user", content="first")

    new_thread = repo.create_new_thread(
        session.id,
        context={
            "last_generated_asset_id": "9",
            "working_asset_ids": ["5", "oops", 7],
            "pending_question": "  Which version?  ",
            "last_action": {"type": "enhance"},
            "locale": "  ru  ",
            "ignored": "value",
        },
    )
    new_message = repo.add_message(session_id=session.id, role="user", content="second")

    assert original_thread.is_active is False
    assert new_thread.is_active is True
    assert repo.list_messages(session.id, limit=None) == [new_message]
    assert repo.list_thread_messages(original_thread.id, limit=None) == [original_message]
    assert repo.get_thread_context(new_thread.id) == {
        "last_generated_asset_id": 9,
        "working_asset_ids": [5, 7],
        "pending_question": "Which version?",
        "last_action": {"type": "enhance"},
        "locale": "ru",
    }


def test_reset_thread_context_and_merge_sessions_keep_single_active_thread():
    repo, _session_factory = _make_repo()

    legacy_a = PhotoChatSession(user_id=404, client_session_id="old-a")
    legacy_b = PhotoChatSession(user_id=404, client_session_id="old-b")
    repo.db.add_all([legacy_a, legacy_b])
    repo.db.flush()

    thread_a = repo.create_new_thread(legacy_a.id, context={"locale": "uz"})
    thread_b = repo.create_new_thread(legacy_b.id, context={"locale": "ru"})
    repo.add_message(session_id=legacy_a.id, thread_id=thread_a.id, role="user", content="a")
    repo.add_message(session_id=legacy_b.id, thread_id=thread_b.id, role="user", content="b")

    repo.reset_thread_context(thread_b.id)
    canonical = repo.get_or_create_user_session(404)

    threads = repo.db.execute(
        select(PhotoChatThread).where(PhotoChatThread.session_id == canonical.id).order_by(PhotoChatThread.id.asc())
    ).scalars().all()
    active_threads = [thread for thread in threads if thread.is_active]

    assert canonical.client_session_id == "404"
    assert len(threads) == 2
    assert len(active_threads) == 1
    assert repo.get_thread_context(thread_b.id) == default_photo_chat_thread_context()
    assert {message.content for message in repo.list_thread_messages(thread_a.id, limit=None)} == {"a"}
    assert {message.content for message in repo.list_thread_messages(thread_b.id, limit=None)} == {"b"}

    repo.db.close()


def test_clear_thread_messages_and_reset_context_keep_persistent_media():
    repo, _session_factory = _make_repo()

    session = repo.get_or_create_user_session(user_id=505)
    thread = repo.get_or_create_active_thread(session.id)
    media = repo.add_media(
        session_id=session.id,
        relpath="photos/persistent.jpg",
        kind="image",
        source="upload",
    )
    repo.add_message(
        session_id=session.id,
        thread_id=thread.id,
        role="user",
        content="edit this",
        meta={"asset_ids": [media.id]},
    )
    repo.update_thread_context(
        thread.id,
        working_asset_ids=[media.id],
        last_generated_asset_id=media.id,
        pending_question="Use this image?",
        locale="uz",
    )

    deleted = repo.clear_thread_messages(thread.id)
    context_state = repo.reset_thread_context(thread.id)

    assert deleted == 1
    assert repo.list_thread_messages(thread.id, limit=None) == []
    assert [item.id for item in repo.list_media(session.id, limit=None)] == [media.id]
    assert context_state == default_photo_chat_thread_context()

    repo.db.close()
