"""
CardScheduler — har 10 daqiqada barcha active store larni WB API dan yangilaydi.
updatedAt o'zgargan cardlarni qayta analiz qiladi.

threading emas, asyncio.Task ishlatadi — DB session bilan event loop konflikti bo'lmaydi.
"""
from __future__ import annotations

import asyncio
import logging
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
        self._task: asyncio.Task | None = None
        self.last_tick_at: datetime | None = None
        self.next_tick_at: datetime | None = None

    def start_background(self) -> None:
        """Main event loop da background task sifatida ishga tushiradi."""
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop())
        logger.info("[card-scheduler] started, interval=%ss", self.interval_sec)

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("[card-scheduler] stopped")

    def get_status(self) -> dict:
        now = datetime.utcnow()
        next_in_sec: int | None = None
        if self.next_tick_at:
            delta = (self.next_tick_at - now).total_seconds()
            next_in_sec = max(0, int(delta))
        return {
            "is_running": bool(self._task and not self._task.done()),
            "interval_sec": self.interval_sec,
            "last_tick_at": self.last_tick_at.isoformat() if self.last_tick_at else None,
            "next_tick_at": self.next_tick_at.isoformat() if self.next_tick_at else None,
            "next_tick_in_sec": next_in_sec,
        }

    async def _run_loop(self) -> None:
        """Har interval_sec da _tick() chaqiradi."""
        while True:
            t0 = time.perf_counter()
            self.last_tick_at = datetime.utcnow()
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[card-scheduler] tick failed")
            elapsed = time.perf_counter() - t0
            wait_s = max(float(self.interval_sec) - elapsed, 0.0)
            self.next_tick_at = datetime.utcnow()
            import datetime as dt_mod
            self.next_tick_at = datetime.utcnow().replace(tzinfo=None) + dt_mod.timedelta(seconds=wait_s)
            await asyncio.sleep(wait_s)

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
        """WB updatedAt bilan DB raw_data.updatedAt ni solishtiradi.
        skip_next_reanalyze=True bo'lgan cardlar o'tkazib yuboriladi (biz fix qilgan cardlar)."""
        nm_ids = [c["nmID"] for c in wb_cards if c.get("nmID")]
        if not nm_ids:
            return []

        result = await db.execute(
            select(Card.nm_id, Card.raw_data, Card.skip_next_reanalyze).where(
                Card.store_id == store_id,
                Card.nm_id.in_(nm_ids),
            )
        )
        existing: dict[int, dict] = {
            row.nm_id: {
                "updated_at": (row.raw_data or {}).get("updatedAt"),
                "skip": row.skip_next_reanalyze or False,
            }
            for row in result.all()
        }

        # Reset skip flag for all cards we're processing
        skip_nm_ids = [nm_id for nm_id, v in existing.items() if v["skip"]]
        if skip_nm_ids:
            from sqlalchemy import update as sa_update
            await db.execute(
                sa_update(Card)
                .where(Card.store_id == store_id, Card.nm_id.in_(skip_nm_ids))
                .values(skip_next_reanalyze=False)
            )
            await db.commit()
            logger.debug("[card-scheduler] reset skip_next_reanalyze for %d card(s)", len(skip_nm_ids))

        changed = []
        for wb_card in wb_cards:
            nm_id = wb_card.get("nmID")
            if not nm_id:
                continue
            wb_updated_at = wb_card.get("updatedAt")
            db_entry = existing.get(nm_id)

            if nm_id not in existing:
                changed.append(nm_id)
            elif db_entry and db_entry["skip"]:
                # Skip: this card was updated by us — WB updatedAt changed because of our fix
                logger.debug("[card-scheduler] skip nm_id=%d (our fix applied)", nm_id)
            elif wb_updated_at and (db_entry or {}).get("updated_at") != wb_updated_at:
                changed.append(nm_id)

        return changed


# Singleton
card_scheduler = CardScheduler(interval_sec=600)
