from __future__ import annotations

import logging
import threading
import time
from datetime import date, timedelta
from typing import Any, List

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.services.promotion_repository import PromotionRepository
from app.services.promotion_service import PromotionService
from app.models.promotion import PromotionPhoto


logger = logging.getLogger(__name__)


def _chunk(lst: List[Any], n: int) -> List[List[Any]]:
    return [lst[i : i + n] for i in range(0, len(lst), n)]


class PromotionScheduler:
    def __init__(self, interval_sec: int = 60) -> None:
        self.interval_sec = int(interval_sec)
        self.service = PromotionService()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start_background(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self.run_forever, name="promotion-scheduler", daemon=True)
        self._thread.start()
        logger.info("[scheduler] started interval_sec=%s", self.interval_sec)

    def stop(self) -> None:
        self._stop_event.set()
        logger.info("[scheduler] stop requested")

    def run_forever(self) -> None:
        while not self._stop_event.is_set():
            t0 = time.perf_counter()
            try:
                self.tick()
            except Exception:
                logger.exception("[scheduler] tick failed")
            elapsed = time.perf_counter() - t0
            # wait remaining time
            wait_s = max(float(self.interval_sec) - elapsed, 0.0)
            self._stop_event.wait(wait_s)

    def tick(self) -> None:
        db: Session = SessionLocal()
        try:
            repo = PromotionRepository(db)
            companies = repo.list_running()
            if not companies:
                logger.debug("[scheduler] no running companies")
                return

            begin_date = date.today().isoformat()
            end_date = (date.today() + timedelta(days=1)).isoformat()

            logger.info("[scheduler] running=%s beginDate=%s endDate=%s", len(companies), begin_date, end_date)

            for batch in _chunk(companies, 50):
                ids = [int(c.wb_company_id) for c in batch if getattr(c, "wb_company_id", None)]
                if not ids:
                    continue

                logger.info("[scheduler] fullstats ids=%s", ids)
                stats = self.service.wb_advert.get_fullstats(ids, begin_date=begin_date, end_date=end_date)

                for c in batch:
                    try:
                        wb_id = int(c.wb_company_id)
                        total_shows, total_clicks = self.service.parse_stats_totals(stats, advert_id=wb_id)

                        last_shows = int(getattr(c, "last_total_shows", 0) or 0)
                        last_clicks = int(getattr(c, "last_total_clicks", 0) or 0)

                        delta_shows = max(int(total_shows) - last_shows, 0)
                        delta_clicks = max(int(total_clicks) - last_clicks, 0)

                        logger.info(
                            "[scheduler] company=%s wb=%s totals(shows=%s clicks=%s) delta(shows=%s clicks=%s) current_order=%s",
                            c.id,
                            wb_id,
                            total_shows,
                            total_clicks,
                            delta_shows,
                            delta_clicks,
                            int(getattr(c, "current_photo_order", 1) or 1),
                        )

                        # accumulate delta into current photo
                        if delta_shows or delta_clicks:
                            repo.add_delta_to_current_photo(c, delta_shows=delta_shows, delta_clicks=delta_clicks)

                        # update baseline totals for next tick
                        repo.update_last_totals(c, shows=total_shows, clicks=total_clicks)

                        # threshold check (reload photo from DB for fresh shows)
                        current_photo = (
                            db.query(PromotionPhoto)
                            .filter(PromotionPhoto.company_id == c.id, PromotionPhoto.order == int(c.current_photo_order or 1))
                            .first()
                        )
                        if not current_photo:
                            continue

                        threshold = int(getattr(c, "views_per_photo", 0) or 0)
                        if threshold > 0 and int(getattr(current_photo, "shows", 0) or 0) >= threshold:
                            # switch or finalize
                            if int(c.current_photo_order or 1) < int(getattr(c, "photos_count", 0) or 0):
                                logger.info("[scheduler] SWITCH company=%s -> next photo", c.id)
                                self.service.switch_to_next_photo(db=db, company=c)
                            else:
                                logger.info("[scheduler] FINISH company=%s -> finalize winner", c.id)
                                self.service.finalize_winner(db=db, company=c, stop_campaign=True)

                    except Exception as e:
                        logger.exception("[scheduler] company tick failed company=%s", getattr(c, "id", None))
                        repo.mark_failed(c, f"tick error: {e}")

        finally:
            db.close()