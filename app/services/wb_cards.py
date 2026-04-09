from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from .wb_api import WildberriesAPI

logger = logging.getLogger(__name__)

WbPageCallback = Callable[[int, int], Awaitable[None] | None]


def parse_wb_timestamp(raw_value: Any) -> Optional[datetime]:
    value = str(raw_value or "").strip()
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


async def _call_page_callback(callback: Optional[WbPageCallback], page: int, total_cards: int) -> None:
    if callback is None:
        return

    maybe_awaitable = callback(page, total_cards)
    if maybe_awaitable is not None:
        await maybe_awaitable


async def fetch_all_wb_cards(
    wb_api: WildberriesAPI,
    *,
    with_photo: int = -1,
    text_search: Optional[str] = None,
    on_page: Optional[WbPageCallback] = None,
    page_limit: int = 1000,
) -> list[dict]:
    cards_by_nm_id: dict[int, dict] = {}
    cursor_updated_at: Optional[str] = None
    cursor_nm_id: Optional[int] = None
    seen_cursors: set[tuple[str, int]] = set()
    page = 0

    while True:
        page += 1
        result = await wb_api.get_cards(
            limit=100,
            updated_at=cursor_updated_at,
            nm_id=cursor_nm_id,
            with_photo=with_photo,
            text_search=text_search,
        )
        if not result.get("success"):
            raise ValueError(
                f"Failed to fetch cards: {result.get('error', 'Unknown error')}. "
                f"Details: {result.get('details', '')}"
            )

        cards = result.get("cards", []) or []
        for card in cards:
            nm_id = card.get("nmID")
            if isinstance(nm_id, int):
                cards_by_nm_id[nm_id] = card

        await _call_page_callback(on_page, page, len(cards_by_nm_id))

        cursor = result.get("cursor", {}) or {}
        next_updated_at = cursor.get("updatedAt")
        next_nm_id = cursor.get("nmID")

        if not cards or not next_updated_at or next_nm_id in (None, ""):
            break

        cursor_key = (str(next_updated_at), int(next_nm_id))
        if cursor_key in seen_cursors:
            logger.warning(
                "[wb_cards] repeated WB cursor detected, stopping pagination | cursor=%s",
                cursor_key,
            )
            break

        if page >= page_limit:
            logger.warning("[wb_cards] pagination page limit reached, stopping at %s pages", page)
            break

        seen_cursors.add(cursor_key)
        cursor_updated_at = str(next_updated_at)
        cursor_nm_id = int(next_nm_id)

    return list(cards_by_nm_id.values())


async def fetch_wb_cards_by_nm_ids(
    wb_api: WildberriesAPI,
    nm_ids: list[int],
    *,
    on_batch: Optional[WbPageCallback] = None,
) -> list[dict]:
    requested = [int(nm_id) for nm_id in nm_ids if int(nm_id) > 0]
    if not requested:
        return []

    requested_set = set(requested)
    cards_by_nm_id: dict[int, dict] = {}
    batch_index = 0

    for offset in range(0, len(requested), 100):
        batch_index += 1
        batch = requested[offset:offset + 100]
        result = await wb_api.get_cards(limit=100, nm_ids=batch)
        if not result.get("success"):
            raise ValueError(
                f"Failed to fetch selected cards: {result.get('error', 'Unknown error')}. "
                f"Details: {result.get('details', '')}"
            )

        for card in result.get("cards", []) or []:
            nm_id = card.get("nmID")
            if isinstance(nm_id, int) and nm_id in requested_set:
                cards_by_nm_id[nm_id] = card

        await _call_page_callback(on_batch, batch_index, len(cards_by_nm_id))

    return [cards_by_nm_id[nm_id] for nm_id in requested if nm_id in cards_by_nm_id]
