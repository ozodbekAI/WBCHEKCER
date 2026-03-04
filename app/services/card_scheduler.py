"""
CardScheduler — har 10 daqiqada barcha active store larni WB API dan yangilaydi.
updatedAt o'zgargan cardlarni qayta analiz qiladi.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.store import Store, StoreStatus
from app.models.card import Card
from app.services.wb_api import WildberriesAPI

logger = logging.getLogger(__name__)


class CardScheduler:
    def __init__(self, interval_sec: int = 600) -> None:
        self.interval_sec = int(interval_sec)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start_background(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run_loop, name="card-scheduler", daemon=True
        )
        self._thread.start()
        logger.info("[card-scheduler] started, interval=%ss", self.interval_sec)

    def stop(self) -> None:
        self._stop_event.set()
        logger.info("[card-scheduler] stop requested")

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            t0 = time.perf_counter()
            try:
                asyncio.run(self._tick())
            except Exception:
                logger.exception("[card-scheduler] tick failed")
            elapsed = time.perf_counter() - t0
            wait_s = max(float(self.interval_sec) - elapsed, 0.0)
            self._stop_event.wait(wait_s)

    async def _tick(self) -> None:
        async with AsyncSessionLocal() as db:
            stores = await self._get_active_stores(db)
            if not stores:
                logger.debug("[card-scheduler] no active stores")
                return
            logger.info("[card-scheduler] checking %d store(s)", len(stores))
            for store in stores:
                try:
                    await self._sync_store(db, store)
                except Exception:
                    logger.exception("[card-scheduler] store_id=%d sync failed", store.id)

    async def _get_active_stores(self, db: AsyncSession) -> List[Store]:
        result = await db.execute(
            select(Store).where(Store.status == StoreStatus.ACTIVE)
        )
        return list(result.scalars().all())

    async def _sync_store(self, db: AsyncSession, store: Store) -> None:
        api = WildberriesAPI(api_key=store.api_key)

        # Fetch all cards from WB API (paginated)
        wb_cards: list[dict] = []
        updated_at_cursor: str | None = None
        nm_id_cursor: int | None = None

        while True:
            resp = await api.get_cards(
                limit=100,
                updated_at=updated_at_cursor,
                nm_id=nm_id_cursor,
            )
            if not resp.get("success"):
                logger.warning(
                    "[card-scheduler] store_id=%d WB API error: %s",
                    store.id, resp.get("error"),
                )
                break

            batch = resp.get("cards", [])
            wb_cards.extend(batch)

            cursor = resp.get("cursor", {})
            # WB pagination: if cursor has updatedAt+nmID → more pages
            if cursor.get("updatedAt") and cursor.get("nmID") and len(batch) == 100:
                updated_at_cursor = cursor["updatedAt"]
                nm_id_cursor = cursor["nmID"]
            else:
                break

        if not wb_cards:
            return

        logger.info(
            "[card-scheduler] store_id=%d fetched %d cards from WB",
            store.id, len(wb_cards),
        )

        # Find cards where updatedAt changed
        cards_to_reanalyze = await self._find_changed_cards(db, store.id, wb_cards)

        # Sync new/updated cards to DB
        from app.services.card_service import sync_cards_from_wb
        await sync_cards_from_wb(db, store.id, wb_cards)

        if not cards_to_reanalyze:
            logger.debug("[card-scheduler] store_id=%d no changes detected", store.id)
            return

        logger.info(
            "[card-scheduler] store_id=%d re-analyzing %d changed card(s)",
            store.id, len(cards_to_reanalyze),
        )

        # Re-analyze changed cards
        from app.services.card_service import analyze_card
        result = await db.execute(
            select(Card).where(
                Card.store_id == store.id,
                Card.nm_id.in_(cards_to_reanalyze),
            )
        )
        cards = list(result.scalars().all())

        for card in cards:
            try:
                await analyze_card(db, card, use_ai=True)
                logger.debug(
                    "[card-scheduler] store_id=%d nm_id=%d re-analyzed",
                    store.id, card.nm_id,
                )
            except Exception:
                logger.exception(
                    "[card-scheduler] store_id=%d nm_id=%d analyze failed",
                    store.id, card.nm_id,
                )

    async def _find_changed_cards(
        self,
        db: AsyncSession,
        store_id: int,
        wb_cards: list[dict],
    ) -> list[int]:
        """WB updatedAt bilan DB raw_data.updatedAt ni solishtiradi."""
        nm_ids = [c["nmID"] for c in wb_cards if c.get("nmID")]
        if not nm_ids:
            return []

        result = await db.execute(
            select(Card.nm_id, Card.raw_data).where(
                Card.store_id == store_id,
                Card.nm_id.in_(nm_ids),
            )
        )
        existing: dict[int, str | None] = {
            row.nm_id: (row.raw_data or {}).get("updatedAt")
            for row in result.all()
        }

        changed = []
        for wb_card in wb_cards:
            nm_id = wb_card.get("nmID")
            if not nm_id:
                continue
            wb_updated_at = wb_card.get("updatedAt")
            db_updated_at = existing.get(nm_id)

            if nm_id not in existing:
                # New card — will be analyzed after sync
                changed.append(nm_id)
            elif wb_updated_at and db_updated_at != wb_updated_at:
                changed.append(nm_id)

        return changed


# Singleton
card_scheduler = CardScheduler(interval_sec=600)
