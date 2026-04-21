from __future__ import annotations

from typing import Any, Iterable, List, Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.photo_chat import (
    PhotoChatMedia,
    PhotoChatMessage,
    PhotoChatSession,
    PhotoChatThread,
    default_photo_chat_thread_context,
    normalize_photo_chat_thread_context,
)


class PhotoChatRepository:
    def __init__(self, db: Session):
        self.db = db

    # -----------------------
    # Canonical session (user-scoped)
    # -----------------------
    def get_or_create_user_session(self, user_id: int) -> PhotoChatSession:
        """Return a single canonical chat session for the user.

        Rule: session key == str(user_id). This makes history stable across page reloads and browsers.
        If the user already has multiple sessions (old client_session_id logic), we merge them into one
        canonical session to avoid losing history.
        """

        stable_csid = str(int(user_id))

        # Fetch all sessions for the user (newest first)
        stmt = (
            select(PhotoChatSession)
            .where(PhotoChatSession.user_id == user_id)
            .order_by(PhotoChatSession.updated_at.desc(), PhotoChatSession.id.desc())
        )
        sessions = list(self.db.execute(stmt).scalars().all())

        if not sessions:
            sess = PhotoChatSession(user_id=user_id, client_session_id=stable_csid)
            self.db.add(sess)
            self.db.flush()
            self.get_or_create_active_thread(sess.id)
            return sess

        canonical = sessions[0]

        # Ensure canonical session uses the stable client_session_id.
        if canonical.client_session_id != stable_csid:
            canonical.client_session_id = stable_csid
            self.db.add(canonical)

        # Merge all other sessions into canonical.
        # This keeps cross-browser history and also recovers history from old random session ids.
        other_ids = [s.id for s in sessions[1:]]
        if other_ids:
            # Move messages
            self.db.execute(
                update(PhotoChatMessage)
                .where(PhotoChatMessage.session_id.in_(other_ids))
                .values(session_id=canonical.id)
            )
            # Move media
            self.db.execute(
                update(PhotoChatMedia)
                .where(PhotoChatMedia.session_id.in_(other_ids))
                .values(session_id=canonical.id)
            )
            # Preserve legacy session history as separate threads under the canonical session.
            self.db.execute(
                update(PhotoChatThread)
                .where(PhotoChatThread.session_id.in_(other_ids))
                .values(session_id=canonical.id, is_active=False)
            )
            # Prefer last generated relpath from the newest session that has it.
            if not canonical.last_generated_relpath:
                for s in sessions:
                    if s.last_generated_relpath:
                        canonical.last_generated_relpath = s.last_generated_relpath
                        break

            # Delete old sessions
            for s in sessions[1:]:
                try:
                    self.db.delete(s)
                except Exception:
                    pass

        # Re-sequence media so UI ordering remains consistent.
        self._resequence_media(canonical.id)
        self.get_or_create_active_thread(canonical.id)
        self.db.flush()
        return canonical

    def _resequence_media(self, session_id: int) -> None:
        media = self.list_media(session_id, limit=None)
        # Sort by (seq, created_at, id) to preserve original order as much as possible.
        media.sort(key=lambda m: (int(getattr(m, "seq", 0) or 0), getattr(m, "created_at", None), m.id))
        for i, m in enumerate(media, start=1):
            if m.seq != i:
                m.seq = i
                self.db.add(m)

    # -----------------------
    # Session
    # -----------------------
    def get_session(self, user_id: int, client_session_id: str) -> Optional[PhotoChatSession]:
        stmt = select(PhotoChatSession).where(
            PhotoChatSession.user_id == user_id,
            PhotoChatSession.client_session_id == client_session_id,
        )
        return self.db.execute(stmt).scalars().first()

    def get_or_create_active_thread(self, session_id: int) -> PhotoChatThread:
        stmt = (
            select(PhotoChatThread)
            .where(PhotoChatThread.session_id == session_id)
            .order_by(PhotoChatThread.is_active.desc(), PhotoChatThread.updated_at.desc(), PhotoChatThread.id.desc())
        )
        threads = list(self.db.execute(stmt).scalars().all())
        if not threads:
            return self.create_new_thread(session_id)

        active = next((thread for thread in threads if thread.is_active), None)
        if active is None:
            active = threads[0]
            active.is_active = True
            self.db.add(active)

        for thread in threads:
            if thread.id != active.id and thread.is_active:
                thread.is_active = False
                self.db.add(thread)

        normalized = normalize_photo_chat_thread_context(active.context)
        if active.context != normalized:
            active.context = normalized
            self.db.add(active)
            flag_modified(active, "context")

        self.db.flush()
        return active

    def list_threads(self, session_id: int) -> List[PhotoChatThread]:
        stmt = (
            select(PhotoChatThread)
            .where(PhotoChatThread.session_id == session_id)
            .order_by(PhotoChatThread.is_active.desc(), PhotoChatThread.updated_at.desc(), PhotoChatThread.id.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def set_active_thread(self, session_id: int, thread_id: int) -> PhotoChatThread:
        threads = self.list_threads(session_id)
        target: PhotoChatThread | None = None

        for thread in threads:
            should_be_active = int(thread.id) == int(thread_id)
            if should_be_active:
                target = thread
            if bool(thread.is_active) != should_be_active:
                thread.is_active = should_be_active
                self.db.add(thread)

        if target is None:
            raise ValueError(f"Photo chat thread {thread_id} not found for session {session_id}")

        normalized = normalize_photo_chat_thread_context(target.context)
        if target.context != normalized:
            target.context = normalized
            self.db.add(target)
            flag_modified(target, "context")

        self.db.flush()
        return target

    def create_new_thread(self, session_id: int, context: dict[str, Any] | None = None) -> PhotoChatThread:
        existing_threads = list(
            self.db.execute(
                select(PhotoChatThread).where(
                    PhotoChatThread.session_id == session_id,
                    PhotoChatThread.is_active.is_(True),
                )
            ).scalars().all()
        )
        for thread in existing_threads:
            thread.is_active = False
            self.db.add(thread)

        thread = PhotoChatThread(
            session_id=session_id,
            is_active=True,
            context=normalize_photo_chat_thread_context(context),
        )
        self.db.add(thread)
        self.db.flush()
        return thread

    def get_thread(self, thread_id: int, session_id: int | None = None) -> Optional[PhotoChatThread]:
        thread = self.db.get(PhotoChatThread, thread_id)
        if thread is None:
            return None
        if session_id is not None and int(thread.session_id) != int(session_id):
            return None
        return thread

    def delete_thread(self, session_id: int, thread_id: int) -> bool:
        thread = self.get_thread(thread_id, session_id=session_id)
        if thread is None:
            return False
        self.db.delete(thread)
        self.db.flush()
        return True

    def list_thread_messages(self, thread_id: int, limit: int | None = 30) -> List[PhotoChatMessage]:
        stmt = (
            select(PhotoChatMessage)
            .where(PhotoChatMessage.thread_id == thread_id)
            .order_by(PhotoChatMessage.id.asc())
        )
        if limit is not None:
            stmt = stmt.limit(int(limit))
        return list(self.db.execute(stmt).scalars().all())

    def clear_thread_messages(self, thread_id: int) -> int:
        res = self.db.execute(delete(PhotoChatMessage).where(PhotoChatMessage.thread_id == thread_id))
        return int(getattr(res, "rowcount", 0) or 0)

    def get_thread_context(self, thread_id: int) -> dict[str, Any]:
        thread = self.get_thread(thread_id)
        if thread is None:
            return default_photo_chat_thread_context()

        normalized = normalize_photo_chat_thread_context(thread.context)
        if thread.context != normalized:
            thread.context = normalized
            self.db.add(thread)
            flag_modified(thread, "context")
            self.db.flush()
        return normalized

    def update_thread_context(
        self,
        thread_id: int,
        context: dict[str, Any] | None = None,
        **changes: Any,
    ) -> dict[str, Any]:
        thread = self.get_thread(thread_id)
        if thread is None:
            raise ValueError(f"Photo chat thread {thread_id} not found")

        merged_context = self.get_thread_context(thread_id)
        if context:
            merged_context.update(context)
        if changes:
            merged_context.update(changes)

        thread.context = normalize_photo_chat_thread_context(merged_context)
        self.db.add(thread)
        flag_modified(thread, "context")
        self.db.flush()
        return dict(thread.context or {})

    def reset_thread_context(self, thread_id: int) -> dict[str, Any]:
        return self.update_thread_context(thread_id, context=default_photo_chat_thread_context())

    def set_pending_assets(self, session_id: int, asset_ids: list[int] | None) -> None:
        thread = self.get_or_create_active_thread(session_id)
        self.update_thread_context(thread.id, working_asset_ids=asset_ids or [])

    def pop_pending_assets(self, session_id: int) -> list[int]:
        thread = self.get_or_create_active_thread(session_id)
        context = self.get_thread_context(thread.id)
        working_asset_ids = list(context.get("working_asset_ids") or [])
        self.update_thread_context(thread.id, working_asset_ids=[])
        return working_asset_ids

    def find_media_by_source_url(self, session_id: int, source_url: str) -> Optional[PhotoChatMedia]:
        su = (source_url or "").strip()
        if not su:
            return None

        stmt = (
            select(PhotoChatMedia)
            .where(
                PhotoChatMedia.session_id == session_id,
                PhotoChatMedia.source_url == su,
            )
            .order_by(PhotoChatMedia.id.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    def find_media_by_source_url_any_session(self, user_id: int, source_url: str) -> Optional[PhotoChatMedia]:
        """Find media by source URL in ANY session for the user. Used for import idempotency."""
        su = (source_url or "").strip()
        if not su:
            return None

        # Get all session ids for user
        sessions_stmt = select(PhotoChatSession.id).where(PhotoChatSession.user_id == user_id)
        session_ids = [row[0] for row in self.db.execute(sessions_stmt).all()]
        if not session_ids:
            return None

        stmt = (
            select(PhotoChatMedia)
            .where(
                PhotoChatMedia.session_id.in_(session_ids),
                PhotoChatMedia.source_url == su,
            )
            .order_by(PhotoChatMedia.id.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()

    def get_or_create_session(self, user_id: int, client_session_id: str) -> PhotoChatSession:
        """Backwards compatible session getter.

        If client_session_id is empty -> use canonical per-user session.
        """
        csid = (client_session_id or "").strip()
        if not csid:
            return self.get_or_create_user_session(user_id)

        sess = self.get_session(user_id, csid)
        if sess:
            self.get_or_create_active_thread(sess.id)
            return sess
        sess = PhotoChatSession(user_id=user_id, client_session_id=csid)
        self.db.add(sess)
        self.db.flush()
        self.get_or_create_active_thread(sess.id)
        return sess

    def set_last_generated(self, session_id: int, relpath: str) -> None:
        sess = self.db.get(PhotoChatSession, session_id)
        if sess:
            sess.last_generated_relpath = relpath
            self.db.add(sess)

    # -----------------------
    # Messages
    # -----------------------
    def add_message(
        self,
        session_id: int,
        role: str,
        content: str | None,
        msg_type: str = "text",
        meta: dict | None = None,
        thread_id: int | None = None,
        request_id: str | None = None,
    ) -> PhotoChatMessage:
        thread = (
            self.get_or_create_active_thread(session_id)
            if thread_id is None
            else self.get_thread(thread_id, session_id=session_id)
        )
        if thread is None:
            raise ValueError(f"Photo chat thread {thread_id} not found for session {session_id}")

        msg = PhotoChatMessage(
            session_id=session_id,
            thread_id=thread.id,
            request_id=(request_id or None),
            role=role,
            msg_type=msg_type,
            content=content,
            meta=meta,
        )
        self.db.add(msg)
        self.db.flush()
        return msg

    def list_messages(self, session_id: int, limit: int = 30) -> List[PhotoChatMessage]:
        thread = self.get_or_create_active_thread(session_id)
        return self.list_thread_messages(thread.id, limit=limit)

    def count_messages(self, session_id: int) -> int:
        thread = self.get_or_create_active_thread(session_id)
        stmt = select(func.count()).select_from(PhotoChatMessage).where(PhotoChatMessage.thread_id == thread.id)
        try:
            return int(self.db.execute(stmt).scalar_one() or 0)
        except Exception:
            return 0

    def get_messages_by_ids(self, session_id: int, message_ids: Iterable[int]) -> List[PhotoChatMessage]:
        ids = [int(x) for x in message_ids if str(x).strip().isdigit()]
        if not ids:
            return []
        thread = self.get_or_create_active_thread(session_id)
        stmt = select(PhotoChatMessage).where(
            PhotoChatMessage.session_id == session_id,
            PhotoChatMessage.thread_id == thread.id,
            PhotoChatMessage.id.in_(ids),
        )
        return list(self.db.execute(stmt).scalars().all())

    # -----------------------
    # Media
    # -----------------------
    def _next_seq(self, session_id: int) -> int:
        stmt = select(func.coalesce(func.max(PhotoChatMedia.seq), 0)).where(PhotoChatMedia.session_id == session_id)
        max_seq = self.db.execute(stmt).scalar_one()
        return int(max_seq) + 1

    def add_media(
        self,
        session_id: int,
        relpath: str,
        kind: str = "image",
        source: str = "user",
        source_url: str | None = None,
        prompt: str | None = None,
        meta: dict | None = None,
    ) -> PhotoChatMedia:
        media = PhotoChatMedia(
            session_id=session_id,
            relpath=relpath,
            kind=kind,
            source=source,
            source_url=source_url,
            prompt=prompt,
            seq=self._next_seq(session_id),
            meta=meta,
        )
        self.db.add(media)
        self.db.flush()
        return media

    def list_media(self, session_id: int, limit: int | None = 50) -> List[PhotoChatMedia]:
        stmt = (
            select(PhotoChatMedia)
            .where(PhotoChatMedia.session_id == session_id)
            .order_by(PhotoChatMedia.seq.asc(), PhotoChatMedia.id.asc())
        )
        if limit is not None:
            stmt = stmt.limit(int(limit))
        return list(self.db.execute(stmt).scalars().all())

    # -----------------------
    # Delete helpers
    # -----------------------
    def delete_messages_by_ids(self, session_id: int, message_ids: Iterable[int]) -> int:
        ids = [int(x) for x in message_ids if str(x).strip().isdigit()]
        if not ids:
            return 0
        thread = self.get_or_create_active_thread(session_id)
        res = self.db.execute(
            delete(PhotoChatMessage).where(
                PhotoChatMessage.session_id == session_id,
                PhotoChatMessage.thread_id == thread.id,
                PhotoChatMessage.id.in_(ids),
            )
        )
        return int(getattr(res, "rowcount", 0) or 0)

    def delete_media_by_ids(self, session_id: int, media_ids: Iterable[int]) -> List[PhotoChatMedia]:
        ids = [int(x) for x in media_ids if str(x).strip().isdigit()]
        if not ids:
            return []
        stmt = select(PhotoChatMedia).where(
            PhotoChatMedia.session_id == session_id,
            PhotoChatMedia.id.in_(ids),
        )
        items = list(self.db.execute(stmt).scalars().all())
        if not items:
            return []
        self.db.execute(
            delete(PhotoChatMedia).where(
                PhotoChatMedia.session_id == session_id,
                PhotoChatMedia.id.in_(ids),
            )
        )
        return items


    def get_media_by_seq(self, session_id: int, seq: int) -> Optional[PhotoChatMedia]:
        stmt = select(PhotoChatMedia).where(
            PhotoChatMedia.session_id == session_id,
            PhotoChatMedia.seq == seq,
        )
        return self.db.execute(stmt).scalars().first()

    def get_last_media(self, session_id: int) -> Optional[PhotoChatMedia]:
        stmt = (
            select(PhotoChatMedia)
            .where(PhotoChatMedia.session_id == session_id)
            .order_by(PhotoChatMedia.seq.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()
