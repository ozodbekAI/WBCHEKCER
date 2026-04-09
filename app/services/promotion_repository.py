# repositories/promotion_repository.py
from __future__ import annotations

from datetime import datetime, timedelta
import json
from typing import List, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.core.time import utc_now
from app.models.promotion import PromotionCompany, PromotionPhoto, PromotionStatus


class PromotionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_company(
        self,
        *,
        user_id: int,
        wb_company_id: int,
        nm_id: int,
        card_id: int,
        title: str,
        from_main: bool,
        max_slots: int,
        keep_winner_as_main: bool = True,
        photos: List[dict],
    ) -> PromotionCompany:
        company = PromotionCompany(
            user_id=user_id,
            wb_company_id=wb_company_id,
            nm_id=nm_id,
            card_id=card_id,
            title=title,
            from_main=from_main,
            max_slots=max_slots,
            keep_winner_as_main=bool(keep_winner_as_main),
            photos_count=len(photos),
            status=PromotionStatus.CREATED,
        )
        self.db.add(company)
        self.db.flush()  # get company.id

        for p in photos:
            photo = PromotionPhoto(
                company_id=company.id,
                order=int(p["order"]),
                file_url=p["file_url"],
                wb_url=p.get("wb_url"),
            )
            self.db.add(photo)

        self.db.commit()
        self.db.refresh(company)
        return company

    def count_by_statuses(
        self,
        user_id: int,
        statuses: List[PromotionStatus],
    ) -> int:
        """
        Count total companies by statuses for pagination.
        Bu method pagination uchun jami elementlar sonini qaytaradi.
        """
        return (
            self.db.query(PromotionCompany)
            .filter(
                PromotionCompany.user_id == user_id,
                PromotionCompany.status.in_(statuses),  # ✅ .value kerak emas!
            )
            .count()
        )

    def get_company(self, company_id: int, user_id: Optional[int] = None) -> PromotionCompany:
        q = self.db.query(PromotionCompany).filter(PromotionCompany.id == int(company_id))
        if user_id is not None:
            q = q.filter(PromotionCompany.user_id == int(user_id))
        company = q.first()
        if not company:
            raise ValueError("Promotion company not found")
        return company

    def list_running(self, user_id: Optional[int] = None) -> List[PromotionCompany]:
        q = self.db.query(PromotionCompany).filter(PromotionCompany.status == PromotionStatus.RUNNING)
        if user_id is not None:
            q = q.filter(PromotionCompany.user_id == int(user_id))
        return q.all()

    def get_company_optional(self, *, company_id: int, user_id: int) -> Optional[PromotionCompany]:
        return (
            self.db.query(PromotionCompany)
            .filter(PromotionCompany.id == int(company_id), PromotionCompany.user_id == int(user_id))
            .first()
        )

    # ✅ NEW: wb_company_id bo‘yicha ham raise qilmaydi
    def get_company_by_wb_id_optional(self, *, wb_company_id: int, user_id: int) -> Optional[PromotionCompany]:
        return (
            self.db.query(PromotionCompany)
            .filter(PromotionCompany.wb_company_id == int(wb_company_id), PromotionCompany.user_id == int(user_id))
            .first()
        )

    def set_company_settings(
        self,
        company: PromotionCompany,
        *,
        title: str,
        title_changed: bool,
        from_main: bool,
        max_slots: int,
        keep_winner_as_main: bool,
        photos_count: int,
        views_per_photo: int,
        cpm: int,
        spend_rub: int,
    ) -> PromotionCompany:
        # Only settings update (do NOT start here).
        company.title = title
        company.title_changed = bool(title_changed)
        company.from_main = bool(from_main)
        company.max_slots = int(max_slots)
        company.keep_winner_as_main = bool(keep_winner_as_main)
        company.photos_count = int(photos_count)
        company.views_per_photo = int(views_per_photo)
        company.cpm = int(cpm)
        company.spend_rub = int(spend_rub)

        self.db.add(company)
        self.db.commit()
        self.db.refresh(company)
        return company


    def set_media_state(self, company: PromotionCompany, *, state: dict) -> None:
        # Persist promo media session state in original_media_json (no schema changes).
        company.original_media_json = json.dumps(state or {}, ensure_ascii=False)
        self.db.add(company)
        self.db.commit()

    def get_media_state(self, company: PromotionCompany) -> dict:
        # Return dict state. Supports legacy list format.
        try:
            if company.original_media_json:
                data = json.loads(company.original_media_json)
                if isinstance(data, dict):
                    return data
                if isinstance(data, list):
                    return {"v": 1, "original_urls": [str(x) for x in data if str(x).strip()]}
        except Exception:
            return {}
        return {}

    def set_original_media(self, company: PromotionCompany, *, original_urls: list[str]) -> None:
        # Backward-compatible helper.
        st = self.get_media_state(company)
        if st and isinstance(st, dict) and isinstance(st.get("v"), int) and st.get("v") >= 2:
            st["original_urls"] = [str(u) for u in (original_urls or [])]
            self.set_media_state(company, state=st)
            return

        company.original_media_json = json.dumps([str(u) for u in (original_urls or [])], ensure_ascii=False)
        self.db.add(company)
        self.db.commit()

    def get_original_media(self, company: PromotionCompany) -> list[str]:
        st = self.get_media_state(company)
        if st and isinstance(st, dict):
            urls = st.get("original_urls")
            if isinstance(urls, list):
                return [str(x) for x in urls if str(x).strip()]

        # legacy list
        try:
            if company.original_media_json:
                data = json.loads(company.original_media_json)
                if isinstance(data, list):
                    return [str(x) for x in data if str(x).strip()]
        except Exception:
            return []
        return []


    def set_current_uploaded(self, company: PromotionCompany, wb_url: str | None) -> None:
        company.current_uploaded_wb_url = (str(wb_url) if wb_url else None)
        self.db.add(company)
        self.db.commit()

    def reset_test_state(self, company: PromotionCompany) -> None:
        company.current_photo_order = 1
        company.winner_photo_order = None
        company.last_total_shows = 0
        company.last_total_clicks = 0
        company.last_polled_at = None
        company.started_at = None
        company.finished_at = None
        company.error_message = None
        company.original_media_json = None
        company.current_uploaded_wb_url = None

        photos = self.db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
        for p in photos:
            p.shows = 0
            p.clicks = 0
            p.ctr = 0
            p.is_winner = False
            self.db.add(p)

        self.db.add(company)
        self.db.commit()

    def upsert_photos(self, company: PromotionCompany, photos: List[dict]) -> None:
        # photos: [{order, file_url, wb_url?}, ...]
        existing = {
            int(p.order): p
            for p in self.db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
        }

        for p in photos:
            order = int(p["order"])
            file_url = p["file_url"]
            wb_url = p.get("wb_url")

            if order in existing:
                obj = existing[order]
                obj.file_url = file_url
                if wb_url:
                    obj.wb_url = wb_url
                self.db.add(obj)
            else:
                obj = PromotionPhoto(
                    company_id=company.id,
                    order=order,
                    file_url=file_url,
                    wb_url=wb_url,
                )
                self.db.add(obj)

        # Also keep photos_count in sync
        company.photos_count = int(len(photos))
        self.db.add(company)
        self.db.commit()

    def mark_started(self, company: PromotionCompany) -> None:
        company.status = PromotionStatus.RUNNING
        company.error_message = None
        company.finished_at = None
        if not company.started_at:
            company.started_at = utc_now()
        self.db.add(company)
        self.db.commit()
        self.db.refresh(company)

    def mark_failed(self, company: PromotionCompany, error: str) -> None:
        company.status = PromotionStatus.FAILED
        company.error_message = (error or "")[:1000]
        self.db.add(company)
        self.db.commit()

    def update_last_totals(self, company: PromotionCompany, shows: int, clicks: int) -> None:
        company.last_total_shows = int(shows)
        company.last_total_clicks = int(clicks)
        company.last_polled_at = utc_now()
        self.db.add(company)
        self.db.commit()

    def add_delta_to_current_photo(self, company: PromotionCompany, delta_shows: int, delta_clicks: int) -> None:
        photo = (
            self.db.query(PromotionPhoto)
            .filter(PromotionPhoto.company_id == company.id, PromotionPhoto.order == company.current_photo_order)
            .first()
        )
        if not photo:
            return

        photo.shows += max(int(delta_shows), 0)
        photo.clicks += max(int(delta_clicks), 0)
        if photo.shows > 0:
            photo.ctr = round((photo.clicks / photo.shows) * 100.0, 4)

        self.db.add(photo)
        self.db.commit()

    def set_current_photo_order(self, company: PromotionCompany, order: int) -> None:
        company.current_photo_order = int(order)
        self.db.add(company)
        self.db.commit()

    def finish_with_winner(self, company: PromotionCompany, winner_order: int) -> None:
        company.status = PromotionStatus.FINISHED
        company.winner_photo_order = int(winner_order)
        company.finished_at = utc_now()
        company.error_message = None

        photos = self.db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
        for p in photos:
            p.is_winner = (p.order == int(winner_order))
            self.db.add(p)

        self.db.add(company)
        self.db.commit()

    def finish_without_winner(self, company: PromotionCompany, *, reason: str | None = None) -> None:
        company.status = PromotionStatus.FINISHED
        company.winner_photo_order = None
        company.finished_at = utc_now()
        company.error_message = (str(reason or "").strip() or None)

        photos = self.db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
        for p in photos:
            p.is_winner = False
            self.db.add(p)

        self.db.add(company)
        self.db.commit()
    
    def mark_pending_start(self, company: PromotionCompany, *, error: str, delay_sec: int = 30) -> None:
        company.status = PromotionStatus.CREATED
        company.error_message = (error or "")[:1000]
        company.finished_at = None
        company.last_polled_at = utc_now() + timedelta(seconds=max(int(delay_sec), 0))
        self.db.add(company)
        self.db.commit()

    def mark_stopped(self, company: PromotionCompany, *, reason: str | None = None) -> None:
        company.status = PromotionStatus.STOPPED
        company.error_message = (str(reason or "").strip() or None)
        company.finished_at = utc_now()
        self.db.add(company)
        self.db.commit()

    def list_active_for_scheduler(self):
        return (
            self.db.query(PromotionCompany)
            .filter(PromotionCompany.status.in_([PromotionStatus.RUNNING, PromotionStatus.CREATED]))
            .all()
        )

    def count_attention(self, user_id: int) -> int:
        return (
            self.db.query(PromotionCompany)
            .filter(
                PromotionCompany.user_id == int(user_id),
                or_(
                    PromotionCompany.status.in_([PromotionStatus.FAILED, PromotionStatus.STOPPED]),
                    and_(
                        PromotionCompany.status == PromotionStatus.CREATED,
                        PromotionCompany.error_message.is_not(None),
                        PromotionCompany.error_message != "",
                    ),
                ),
            )
            .count()
        )

    def list_attention(self, user_id: int, limit: int | None = None, offset: int | None = None):
        q = (
            self.db.query(PromotionCompany)
            .options(joinedload(PromotionCompany.photos))
            .filter(
                PromotionCompany.user_id == int(user_id),
                or_(
                    PromotionCompany.status.in_([PromotionStatus.FAILED, PromotionStatus.STOPPED]),
                    and_(
                        PromotionCompany.status == PromotionStatus.CREATED,
                        PromotionCompany.error_message.is_not(None),
                        PromotionCompany.error_message != "",
                    ),
                ),
            )
            .order_by(PromotionCompany.id.desc())
        )
        if offset:
            q = q.offset(offset)
        if limit:
            q = q.limit(limit)
        return q.all()

    def count_pending_clean(self, user_id: int) -> int:
        return (
            self.db.query(PromotionCompany)
            .filter(
                PromotionCompany.user_id == int(user_id),
                PromotionCompany.status == PromotionStatus.CREATED,
                or_(
                    PromotionCompany.error_message.is_(None),
                    PromotionCompany.error_message == "",
                ),
            )
            .count()
        )

    def list_pending_clean(self, user_id: int, limit: int | None = None, offset: int | None = None):
        q = (
            self.db.query(PromotionCompany)
            .options(joinedload(PromotionCompany.photos))
            .filter(
                PromotionCompany.user_id == int(user_id),
                PromotionCompany.status == PromotionStatus.CREATED,
                or_(
                    PromotionCompany.error_message.is_(None),
                    PromotionCompany.error_message == "",
                ),
            )
            .order_by(PromotionCompany.id.desc())
        )
        if offset:
            q = q.offset(offset)
        if limit:
            q = q.limit(limit)
        return q.all()
    
    def get_company_by_wb_id(self, wb_company_id: int, user_id: int) -> PromotionCompany | None:
        return (
            self.db.query(PromotionCompany)
            .filter(PromotionCompany.user_id == user_id, PromotionCompany.wb_company_id == int(wb_company_id))
            .first()
        )

    def list_by_statuses(self, user_id: int, statuses: list[PromotionStatus], limit: int | None = None, offset: int | None = None):
        q = (
            self.db.query(PromotionCompany)
            .options(joinedload(PromotionCompany.photos))  # ✅ photos ham birga keladi
            .filter(
                PromotionCompany.user_id == int(user_id),
                PromotionCompany.status.in_(statuses),
            )
            .order_by(PromotionCompany.id.desc())
        )
        if offset:
            q = q.offset(offset)
        if limit:
            q = q.limit(limit)
        return q.all()
