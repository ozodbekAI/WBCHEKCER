from __future__ import annotations

from typing import Optional, List, Iterable

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import select, func, update, delete

from app.models.photo_chat import PhotoChatSession, PhotoChatMessage, PhotoChatMedia


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

    def set_pending_assets(self, session_id: int, asset_ids: list[int] | None) -> None:
        sess = self.db.get(PhotoChatSession, session_id)
        if not sess:
            return
        sess.pending_asset_ids = [int(x) for x in (asset_ids or [])]
        self.db.add(sess)
        # если pending_asset_ids хранится в JSON колонке — полезно:
        try:
            flag_modified(sess, "pending_asset_ids")
        except Exception:
            pass

    def pop_pending_assets(self, session_id: int) -> list[int]:
        sess = self.db.get(PhotoChatSession, session_id)
        if not sess:
            return []
        ids = list(sess.pending_asset_ids or [])
        sess.pending_asset_ids = []
        self.db.add(sess)
        try:
            flag_modified(sess, "pending_asset_ids")
        except Exception:
            pass
        return ids

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
            return sess
        sess = PhotoChatSession(user_id=user_id, client_session_id=csid)
        self.db.add(sess)
        self.db.flush()
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
    ) -> PhotoChatMessage:
        msg = PhotoChatMessage(
            session_id=session_id,
            role=role,
            msg_type=msg_type,
            content=content,
            meta=meta,
        )
        self.db.add(msg)
        self.db.flush()
        return msg

    def list_messages(self, session_id: int, limit: int = 30) -> List[PhotoChatMessage]:
        stmt = (
            select(PhotoChatMessage)
            .where(PhotoChatMessage.session_id == session_id)
            .order_by(PhotoChatMessage.id.asc())
        )
        if limit is not None:
            stmt = stmt.limit(int(limit))
        return list(self.db.execute(stmt).scalars().all())

    def count_messages(self, session_id: int) -> int:
        stmt = select(func.count()).select_from(PhotoChatMessage).where(PhotoChatMessage.session_id == session_id)
        try:
            return int(self.db.execute(stmt).scalar_one() or 0)
        except Exception:
            return 0

    def get_messages_by_ids(self, session_id: int, message_ids: Iterable[int]) -> List[PhotoChatMessage]:
        ids = [int(x) for x in message_ids if str(x).strip().isdigit()]
        if not ids:
            return []
        stmt = select(PhotoChatMessage).where(
            PhotoChatMessage.session_id == session_id,
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
        res = self.db.execute(
            delete(PhotoChatMessage).where(
                PhotoChatMessage.session_id == session_id,
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
