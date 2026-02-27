from __future__ import annotations

from asyncio.log import logger
from dataclasses import dataclass
from random import random
import time
from typing import Any, Dict, List, Optional, Sequence

import requests

from app.core.config import settings


@dataclass(frozen=True)
class MinBidResult:
    bids: List[Dict[str, Any]]
    raw: Any
    # derived
    min_combined_rub: int = 0
    min_search_rub: int = 0
    min_recommendation_rub: int = 0


class WBAdvertRepository:
    """WB Advert (promotion) API wrapper."""

    BASE_URL = "https://advert-api.wildberries.ru"

    # Campaign create (search+catalog, seacat)
    SEACAT_CREATE_URL = f"{BASE_URL}/adv/v2/seacat/save-ad"

    # Min bids (product cards)
    MIN_BIDS_URL = f"{BASE_URL}/api/advert/v1/bids/min"

    # Bids
    SET_BIDS_URL = f"{BASE_URL}/api/advert/v1/bids"
    SET_BIDS_FALLBACK_URL = f"{BASE_URL}/adv/v0/bids"

    # Finance
    ADV_BALANCE_URL = f"{BASE_URL}/adv/v1/balance"
    ADV_BUDGET_DEPOSIT_URL = f"{BASE_URL}/adv/v1/budget/deposit"

    # Campaign management
    ADV_START_URL = f"{BASE_URL}/adv/v0/start"
    ADV_PAUSE_URL = f"{BASE_URL}/adv/v0/pause"
    ADV_STOP_URL = f"{BASE_URL}/adv/v0/stop"

    # Statistics
    ADV_FULLSTATS_URL = f"{BASE_URL}/adv/v3/fullstats"

    def __init__(self) -> None:
        self._token = settings.WB_ADVERT_API_KEY

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": self._token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @staticmethod
    def _raise_for_status(r: requests.Response, prefix: str) -> None:
        if 200 <= r.status_code < 300:
            return
        raise ValueError(f"{prefix} {r.status_code}: {r.text}")

    @staticmethod
    def _bid_to_rub(value: Any) -> int:
        """Convert WB CPM value to RUB (kopecks -> rub)."""
        try:
            v = int(value)
        except Exception:
            return 0
        return v // 100 if v >= 1000 else v

    def create_seacat_campaign(self, name: str, nms: List[int]) -> tuple[int, Any]:
        payload = {
            "name": name,
            "subjectId": None,
            "nms": [int(x) for x in nms],
        }
        r = requests.post(self.SEACAT_CREATE_URL, headers=self._headers(), json=payload, timeout=60)
        self._raise_for_status(r, "WB create campaign error")
        data = r.json() if r.text else None

        advert_id = None
        if isinstance(data, dict):
            advert_id = data.get("advertId") or data.get("id")
        if not advert_id:
            raise ValueError(f"WB create campaign: cannot extract advertId from response: {data}")

        return int(advert_id), data

    def get_min_bids(
        self,
        advert_id: int,
        nm_id: int,
        *,
        search: bool = True,
        recommendation: bool = False,
        combined: bool = False,
        payment_type: str = "cpm",
    ) -> MinBidResult:
        """
        FIX: placement_types enum: "combined" | "search" | "recommendation"
        User wants ONLY search -> always send ["search"].
        v1: KOPECKS, v0: RUB
        """

        pt = str(payment_type).lower().strip() or "cpm"

        placement_types = ["search"]

        # cache key (since we always search-only)
        cache_key = (int(advert_id), int(nm_id), pt, True, False, False)
        cached = self._minbids_cache_get(cache_key)
        if cached is not None:
            return cached

        attempts: list[tuple[str, dict, bool]] = []

        # v1 (kopecks) — try snake/camel
        attempts.append((
            self.MIN_BIDS_URL,
            {"advert_id": int(advert_id), "nm_ids": [int(nm_id)], "payment_type": pt, "placement_types": placement_types},
            True
        ))
        attempts.append((
            self.MIN_BIDS_URL,
            {"advertId": int(advert_id), "nmIds": [int(nm_id)], "paymentType": pt, "placementTypes": placement_types},
            True
        ))

        # v0 (rub) fallback — also only search
        attempts.append((
            self.MIN_BIDS_V0_URL,
            {"advert_id": int(advert_id), "nm_ids": [int(nm_id)], "payment_type": pt, "placement_types": placement_types},
            False
        ))

        last_r: requests.Response | None = None
        used_values_in_kopecks = True
        used_url = ""

        max_retries_429 = 4
        base_sleep = 2.0

        for url, payload, kopecks in attempts:
            for attempt in range(max_retries_429 + 1):
                self._acquire_minbids_slot()
                r = self._request("POST", url, headers=self._headers(), json=payload, timeout=30)
                last_r = r

                if 200 <= r.status_code < 300:
                    used_url = url
                    used_values_in_kopecks = kopecks
                    break

                if r.status_code == 429 or (500 <= r.status_code <= 599):
                    ra = r.headers.get("Retry-After")
                    if ra:
                        try:
                            sleep_s = float(ra)
                        except Exception:
                            sleep_s = base_sleep
                    else:
                        sleep_s = min(25.0, base_sleep * (2 ** attempt))

                    sleep_s = sleep_s + random.uniform(0.0, 0.8)
                    with self._MINBIDS_LOCK:
                        self._MINBIDS_NEXT_TS = max(self._MINBIDS_NEXT_TS, time.time() + sleep_s)
                    time.sleep(sleep_s)
                    continue

                # other errors -> try next endpoint/payload
                break

            if last_r is not None and 200 <= last_r.status_code < 300:
                break

        if last_r is None:
            raise ValueError("WB bids/min error: no attempts made")
        if not (200 <= last_r.status_code < 300):
            self._raise_for_status(last_r, "WB bids/min error")

        raw: Any = last_r.json() if (last_r.text or "").strip() not in ("", "null") else None

        def bid_to_rub(v: Any) -> int:
            try:
                n = int(float(v))
            except Exception:
                return 0
            if n <= 0:
                return 0
            return (n + 99) // 100 if used_values_in_kopecks else n

        # normalize
        norm_bids: list[dict] = []
        if isinstance(raw, dict) and isinstance(raw.get("bids"), list):
            rows = raw.get("bids") or []
        elif isinstance(raw, list):
            rows = raw
        else:
            rows = []

        for row in rows:
            if not isinstance(row, dict):
                continue
            nm = row.get("nm_id") or row.get("nmId") or nm_id
            inner = row.get("bids") or row.get("values") or []
            norm_inner: list[dict] = []
            if isinstance(inner, list):
                for b in inner:
                    if isinstance(b, dict):
                        norm_inner.append({"type": b.get("type"), "value": b.get("value")})
            norm_bids.append({"nm_id": int(nm), "bids": norm_inner})

        # we only care search
        def find_search() -> int:
            for row in norm_bids:
                if int(row.get("nm_id", 0)) != int(nm_id):
                    continue
                for b in row.get("bids", []):
                    if str(b.get("type")) == "search":
                        return bid_to_rub(b.get("value"))
            return 0

        min_search = find_search()

        logger.info(
            "WB min bids parsed (SEARCH ONLY): url=%s kopecks=%s nm_id=%s search=%s",
            used_url, used_values_in_kopecks, nm_id, min_search
        )

        out = MinBidResult(
            bids=norm_bids,
            raw=raw,
            min_combined_rub=0,
            min_search_rub=int(min_search),
            min_recommendation_rub=0,
        )
        self._minbids_cache_set(cache_key, out)
        return out


    def set_bid(
        self,
        advert_id: int,
        nm_id: int,
        *,
        placement: str = "combined",   # ✅ default combined
        bid_value: int = 0,
        value_unit: str = "rub",
    ) -> Any:
        bid_rub = int(bid_value)
        bid_kopecks = bid_rub * 100 if str(value_unit).lower() == "rub" else bid_rub

        placement_norm = str(placement).strip().lower()
        # ✅ only allowed enum
        if placement_norm not in ("search", "recommendation", "combined"):
            placement_norm = "combined"

        payload_v1 = {
            "bids": [
                {
                    "advert_id": int(advert_id),
                    "nm_bids": [
                        {
                            "nm_id": int(nm_id),
                            "bid_kopecks": int(bid_kopecks),
                            "placement": placement_norm,
                        }
                    ],
                }
            ]
        }

        r1 = self._request("PATCH", self.SET_BIDS_URL, headers=self._headers(), json=payload_v1, timeout=30)
        if 200 <= r1.status_code < 300:
            txt = (r1.text or "").strip()
            return r1.json() if txt not in ("", "null") else None

        # fallback v0
        payload_v0 = {
            "bids": [
                {"advert_id": int(advert_id), "nm_bids": [{"nm": int(nm_id), "bid": int(bid_rub)}]}
            ]
        }
        r0 = self._request("PATCH", self.SET_BIDS_V0_URL, headers=self._headers(), json=payload_v0, timeout=30)
        if r0.status_code == 204:
            return None
        if 200 <= r0.status_code < 300:
            txt = (r0.text or "").strip()
            return r0.json() if txt not in ("", "null") else None

        raise ValueError(f"WB bids update error: v1={r1.status_code}:{r1.text} | v0={r0.status_code}:{r0.text}")

    def get_balance(self) -> Any:
        r = requests.get(self.ADV_BALANCE_URL, headers=self._headers(), timeout=30)
        self._raise_for_status(r, "WB balance error")
        return r.json() if r.text else None

    def pause_campaign(self, advert_id: int) -> Any:
        params = {"id": int(advert_id)}
        r = requests.get(self.ADV_PAUSE_URL, headers=self._headers(), params=params, timeout=30)
        self._raise_for_status(r, "WB pause error")
        return r.json() if r.text else None

    def stop_campaign(self, advert_id: int) -> Any:
        params = {"id": int(advert_id)}
        r = requests.get(self.ADV_STOP_URL, headers=self._headers(), params=params, timeout=30)
        self._raise_for_status(r, "WB stop error")
        return r.json() if r.text else None

    def deposit_budget(
        self,
        advert_id: int,
        amount_rub: int,
        *,
        source_type: int = 1,
        cashback_sum: Optional[int] = None,
        cashback_percent: Optional[int] = None,
        return_budget: bool = True,
    ) -> Any:
        params = {"id": int(advert_id)}
        body: Dict[str, Any] = {
            "sum": int(amount_rub),
            "type": int(source_type),
            "return": bool(return_budget),
        }
        if cashback_sum is not None:
            body["cashback_sum"] = int(cashback_sum)
            if cashback_percent is None:
                raise ValueError("cashback_percent is required when cashback_sum is provided")
            body["cashback_percent"] = int(cashback_percent)

        r = requests.post(self.ADV_BUDGET_DEPOSIT_URL, headers=self._headers(), params=params, json=body, timeout=30)
        self._raise_for_status(r, "WB budget deposit error")
        return r.json() if r.text else None

    def start_campaign(self, advert_id: int) -> Any:
        params = {"id": int(advert_id)}
        r = requests.get(self.ADV_START_URL, headers=self._headers(), params=params, timeout=30)
        self._raise_for_status(r, "WB start error")
        return r.json() if r.text else None

    def get_fullstats(self, advert_ids: Sequence[int], *, begin_date: str, end_date: str) -> Any:
        ids = ",".join(str(int(x)) for x in advert_ids)
        params = {"ids": ids, "beginDate": begin_date, "endDate": end_date}
        r = requests.get(self.ADV_FULLSTATS_URL, headers=self._headers(), params=params, timeout=60)
        self._raise_for_status(r, "WB fullstats error")
        return r.json() if r.text else None

    # Backward compatible adapter
    def get_campaign_stats(self, advert_ids: List[int], dates: List[str]) -> Any:
        if not dates or len(dates) < 2:
            raise ValueError("dates must be [beginDate, endDate] for fullstats")
        return self.get_fullstats(advert_ids, begin_date=str(dates[0]), end_date=str(dates[1]))