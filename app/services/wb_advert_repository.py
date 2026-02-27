from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
import asyncio
import logging
import random
import threading
import time

import httpx
import requests

from app.core.config import settings

logger = logging.getLogger("wbai.wb_advert")


@dataclass(frozen=True)
class MinBidResult:
    bids: List[Dict[str, Any]]
    raw: Any
    min_combined_rub: int = 0
    min_search_rub: int = 0
    min_recommendation_rub: int = 0


class WBAdvertRepository:
    """
    Unified WB Advert repo:
    - create campaign (save-ad) supports bid_type manual/unified and placement_types rules
    - min bids (v1 kopecks + v0 rub fallback) -> returns RUB (ceil) for safe clamping
    - set bid (v1 kopecks + v0 fallback)
    - balance/budget/deposit
    - start/stop
    - fullstats with rate-limit slot + cache + retry
    - async campaign ids (dashboard) with cache + retry
    """

    BASE_URL = "https://advert-api.wildberries.ru"

    # -------- core endpoints --------
    ADV_BALANCE_URL = f"{BASE_URL}/adv/v1/balance"
    ADV_DEPOSIT_URL = f"{BASE_URL}/adv/v1/budget/deposit"
    ADV_BUDGET_URL = f"{BASE_URL}/adv/v1/budget"
    ADV_START_URL = f"{BASE_URL}/adv/v0/start"
    ADV_STOP_URL = f"{BASE_URL}/adv/v0/stop"

    # -------- campaigns --------
    SEACAT_SAVE_AD_URL = f"{BASE_URL}/adv/v2/seacat/save-ad"
    PROMO_COUNT_URL = f"{BASE_URL}/adv/v1/promotion/count"

    # -------- stats --------
    ADV_FULLSTATS_URL = f"{BASE_URL}/adv/v3/fullstats"

    # -------- bids --------
    # New endpoints (/api/advert/v1/...) use KOPECKS.
    # Old endpoints (/adv/v0/...) use RUB.
    MIN_BIDS_URL = f"{BASE_URL}/api/advert/v1/bids/min"
    MIN_BIDS_V0_URL = f"{BASE_URL}/adv/v0/bids/min"

    SET_BIDS_URL = f"{BASE_URL}/api/advert/v1/bids"
    SET_BIDS_V0_URL = f"{BASE_URL}/adv/v0/bids"

    # fullstats limiter/cache
    _FULLSTATS_MIN_INTERVAL_S = 20.5
    _FULLSTATS_LOCK = threading.Lock()
    _FULLSTATS_NEXT_TS = 0.0

    _FULLSTATS_CACHE_LOCK = threading.Lock()
    _FULLSTATS_CACHE: Dict[Tuple[str, str, str], Tuple[float, Any]] = {}
    _FULLSTATS_CACHE_TTL_S = 60.0

    # campaign ids cache
    _CAMPAIGN_IDS_LOCK = threading.Lock()
    _CAMPAIGN_IDS_CACHE: Optional[Tuple[float, List[int]]] = None
    _CAMPAIGN_IDS_TTL_S = 60.0

    def __init__(self) -> None:
        token = settings.WB_API_KEY
        self._token = token or ""

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

    # ---------------------------------------------------------------------
    # Backward-compatible request logger:
    # older code sometimes calls _request(method, base_url, url, ...)
    # newer code calls _request(method, url, ...)
    # ---------------------------------------------------------------------
    def _request(
        self,
        method: str,
        base_url_or_url: str,
        url: Optional[str] = None,
        *,
        headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None,
        json: Any = None,
        timeout: int = 30,
    ) -> requests.Response:
        # Resolve full URL
        if url is None:
            full_url = base_url_or_url
        else:
            if base_url_or_url.startswith("http") and url.startswith("http"):
                full_url = url
            else:
                full_url = base_url_or_url.rstrip("/") + "/" + url.lstrip("/")

        hdrs = headers or {}
        safe_headers = {k: ("***" if k.lower() == "authorization" else v) for k, v in hdrs.items()}

        t0 = time.perf_counter()
        logger.info("WB -> %s %s params=%s json=%s headers=%s", method, full_url, params, json, safe_headers)
        r = requests.request(method, full_url, headers=hdrs, params=params, json=json, timeout=timeout)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        body_preview = (r.text or "")[:1200]
        logger.info("WB <- %s %s status=%s in %sms body=%s", method, full_url, r.status_code, dt_ms, body_preview)
        return r

    # ---------------- helpers ----------------
    @staticmethod
    def _ids_key(advert_ids: List[int]) -> str:
        uniq = sorted({int(x) for x in advert_ids if x is not None})
        return ",".join(map(str, uniq))

    def _acquire_fullstats_slot(self) -> None:
        while True:
            with self._FULLSTATS_LOCK:
                now = time.time()
                wait = self._FULLSTATS_NEXT_TS - now
                if wait <= 0:
                    self._FULLSTATS_NEXT_TS = now + self._FULLSTATS_MIN_INTERVAL_S
                    return
            time.sleep(wait)

    def _cache_get(self, key: Tuple[str, str, str]) -> Optional[Any]:
        now = time.time()
        with self._FULLSTATS_CACHE_LOCK:
            item = self._FULLSTATS_CACHE.get(key)
            if not item:
                return None
            ts, data = item
            if (now - ts) <= self._FULLSTATS_CACHE_TTL_S:
                return data
            self._FULLSTATS_CACHE.pop(key, None)
            return None

    def _cache_set(self, key: Tuple[str, str, str], data: Any) -> None:
        with self._FULLSTATS_CACHE_LOCK:
            self._FULLSTATS_CACHE[key] = (time.time(), data)

    # =========================
    # CORE: balance / budget
    # =========================
    def get_balance(self) -> Any:
        r = self._request("GET", self.ADV_BALANCE_URL, headers=self._headers(), timeout=30)
        self._raise_for_status(r, "WB balance error")
        txt = (r.text or "").strip()
        return r.json() if txt not in ("", "null") else None

    def get_campaign_budget(self, advert_id: int) -> Dict[str, Any]:
        params = {"id": int(advert_id), "_": int(time.time() * 1000)}
        r = self._request("GET", self.ADV_BUDGET_URL, headers=self._headers(), params=params, timeout=30)
        self._raise_for_status(r, "WB budget error")
        txt = (r.text or "").strip()
        return r.json() if txt not in ("", "null") else {}

    def get_campaign_budget_total(self, advert_id: int) -> int:
        data = self.get_campaign_budget(advert_id)
        try:
            return int(data.get("total") or 0)
        except Exception:
            return 0

    def deposit_budget(self, advert_id: int, amount_rub: int, *, source_type: int = 1) -> None:
        params = {"id": int(advert_id)}
        body = {"sum": int(amount_rub), "type": int(source_type)}
        r = self._request("POST", self.ADV_DEPOSIT_URL, headers=self._headers(), params=params, json=body, timeout=30)
        self._raise_for_status(r, "WB budget deposit error")
        return

    # =========================
    # Campaign create (save-ad)
    # =========================
    def create_seacat_campaign(
        self,
        name: str,
        nms: List[int],
        *,
        bid_type: str = "unified",                 # "manual" | "unified"
        payment_type: str = "cpm",                 # "cpm" | "cpc"
        placement_types: Optional[List[str]] = None,  # only for manual
    ) -> Tuple[int, Any]:
        """
        POST /adv/v2/seacat/save-ad

        Rules:
        - bid_type: manual/unified
        - payment_type: cpm/cpc
        - placement_types: send ONLY when bid_type=manual (unified => omit key)
        """
        nm_list = [int(x) for x in (nms or []) if x is not None]
        if not nm_list:
            raise ValueError("create_seacat_campaign: nms is empty")
        if len(nm_list) > 50:
            raise ValueError(f"create_seacat_campaign: too many nms ({len(nm_list)}). Max 50")

        bt = (bid_type or "manual").strip().lower()
        if bt not in ("manual", "unified"):
            raise ValueError("create_seacat_campaign: bid_type must be 'manual' or 'unified'")

        pt = (payment_type or "cpm").strip().lower()
        if pt not in ("cpm", "cpc"):
            raise ValueError("create_seacat_campaign: payment_type must be 'cpm' or 'cpc'")

        body: Dict[str, Any] = {
            "name": str(name),
            "nms": nm_list,
            "bid_type": bt,
            "payment_type": pt,
        }

        if bt == "manual":
            pts = placement_types if placement_types is not None else ["search"]
            allowed = {"search", "recommendations"}
            seen = set()
            pts_unique: List[str] = []
            for x in (pts or []):
                s = str(x).strip().lower()
                if not s:
                    continue
                if s not in allowed:
                    raise ValueError(f"create_seacat_campaign: invalid placement_type={s}. Allowed={sorted(list(allowed))}")
                if s not in seen:
                    pts_unique.append(s)
                    seen.add(s)
            if not pts_unique:
                pts_unique = ["search"]
            body["placement_types"] = pts_unique
        # unified => do NOT include placement_types key

        r = self._request("POST", self.SEACAT_SAVE_AD_URL, headers=self._headers(), json=body, timeout=30)
        self._raise_for_status(r, "WB create seacat campaign error")

        data = r.json() if (r.text or "").strip() not in ("", "null") else None

        advert_id: Optional[int] = None
        if isinstance(data, int):
            advert_id = int(data)
        elif isinstance(data, str) and data.isdigit():
            advert_id = int(data)
        elif isinstance(data, dict):
            for k in ("advertId", "advert_id", "id", "campaignId", "campaign_id"):
                if k in data and data[k] is not None:
                    advert_id = int(data[k])
                    break
            if advert_id is None and isinstance(data.get("result"), dict):
                res = data["result"]
                for k in ("advertId", "id"):
                    if k in res and res[k] is not None:
                        advert_id = int(res[k])
                        break

        if advert_id is None:
            raise ValueError(f"Unexpected WB create campaign response: {data}")

        return advert_id, data

    # =========================
    # Start/Stop
    # =========================
    def start_campaign(self, advert_id: int) -> Any:
        params = {"id": int(advert_id)}
        r = self._request("GET", self.ADV_START_URL, headers=self._headers(), params=params, timeout=30)
        self._raise_for_status(r, "WB start error")
        txt = (r.text or "").strip()
        return r.json() if txt not in ("", "null") else None

    def stop_campaign(self, advert_id: int) -> Any:
        params = {"id": int(advert_id)}
        r = self._request("GET", self.ADV_STOP_URL, headers=self._headers(), params=params, timeout=30)
        self._raise_for_status(r, "WB stop error")
        txt = (r.text or "").strip()
        return r.json() if txt not in ("", "null") else None

    # =========================
    # STATS: fullstats (rate-limit + cache + retry)
    # =========================
    def get_fullstats(self, advert_ids: List[int], *, begin_date: str, end_date: str) -> Any:
        ids_key = self._ids_key(advert_ids)
        if not ids_key:
            return []

        ids_list = ids_key.split(",")
        if len(ids_list) > 50:
            raise ValueError(f"fullstats: too many ids ({len(ids_list)}). Max 50 per request.")

        cache_key = (ids_key, str(begin_date), str(end_date))
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        params = {"ids": ids_key, "beginDate": begin_date, "endDate": end_date}

        max_retries = 4
        base_sleep = 2.0
        last_text = ""

        for attempt in range(max_retries + 1):
            self._acquire_fullstats_slot()

            r = self._request("GET", self.ADV_FULLSTATS_URL, headers=self._headers(), params=params, timeout=30)
            last_text = r.text or ""

            if 200 <= r.status_code < 300:
                txt = (r.text or "").strip()
                data = [] if txt in ("", "null") else r.json()
                self._cache_set(cache_key, data)
                return data

            if r.status_code == 429 or (500 <= r.status_code <= 599):
                ra = r.headers.get("Retry-After")
                if ra:
                    try:
                        sleep_s = float(ra)
                    except Exception:
                        sleep_s = base_sleep
                else:
                    sleep_s = min(25.0, base_sleep * (2 ** attempt))
                sleep_s = sleep_s + random.uniform(0.0, 0.7)

                with self._FULLSTATS_LOCK:
                    self._FULLSTATS_NEXT_TS = max(self._FULLSTATS_NEXT_TS, time.time() + sleep_s)

                time.sleep(sleep_s)
                continue

            self._raise_for_status(r, "WB fullstats error")

        raise ValueError(f"WB fullstats error: exceeded retries. last={last_text}")

    # =========================
    # Campaign ids (async) - dashboard uchun
    # =========================
    async def get_campaign_ids(self) -> List[int]:
        now = time.time()
        with self._CAMPAIGN_IDS_LOCK:
            if self._CAMPAIGN_IDS_CACHE is not None:
                ts, ids = self._CAMPAIGN_IDS_CACHE
                if (now - ts) <= self._CAMPAIGN_IDS_TTL_S:
                    return ids

        timeout = httpx.Timeout(10)

        async with httpx.AsyncClient(timeout=timeout) as client:
            max_retries = 4
            base_sleep = 1.5
            last_text = ""

            for attempt in range(max_retries + 1):
                resp = await client.get(self.PROMO_COUNT_URL, headers=self._headers())
                last_text = resp.text or ""

                if 200 <= resp.status_code < 300:
                    data = resp.json() if resp.text else []
                    ids: List[int] = []

                    groups = data if isinstance(data, list) else data.get("adverts", [])
                    for grp in groups:
                        advert_list = grp.get("advert_list") or grp.get("advertList") or []
                        for a in advert_list:
                            if "advertId" in a:
                                ids.append(int(a["advertId"]))

                    ids = sorted(list(set(ids)))

                    with self._CAMPAIGN_IDS_LOCK:
                        self._CAMPAIGN_IDS_CACHE = (time.time(), ids)

                    return ids

                if resp.status_code == 429 or (500 <= resp.status_code <= 599):
                    ra = resp.headers.get("Retry-After")
                    if ra:
                        try:
                            sleep_s = float(ra)
                        except Exception:
                            sleep_s = base_sleep
                    else:
                        sleep_s = min(20.0, base_sleep * (2 ** attempt))

                    sleep_s = sleep_s + random.uniform(0.0, 0.5)
                    await asyncio.sleep(sleep_s)
                    continue

                raise RuntimeError(f"WB Advert error {resp.status_code}: {last_text}")

            raise RuntimeError(f"WB Advert error: exceeded retries. last={last_text}")

    # =========================
    # BIDS: min bids
    # =========================
    def get_min_bids(
        self,
        advert_id: int,
        nm_id: int,
        *,
        search: bool = True,
        recommendation: bool = True,
        combined: bool = True,
        payment_type: str = "cpm",
    ) -> MinBidResult:
        """
        Returns min bids in RUB (ceil) for UI/validation.

        Notes:
        - v1 (/api/advert/v1/...) uses KOPECKS
        - v0 (/adv/v0/...) uses RUB
        """

        pt = str(payment_type).lower().strip() or "cpm"

        base_types: List[str] = []
        if combined:
            base_types.append("combined")
        if search:
            base_types.append("search")
        if recommendation:
            base_types.append("recommendations")  # docs use plural

        if not base_types:
            raise ValueError("placement_types is empty")

        # We will try both "recommendations" and legacy "recommendation" if needed.
        placement_variants: List[List[str]] = [base_types]
        if "recommendations" in base_types:
            legacy = ["recommendation" if x == "recommendations" else x for x in base_types]
            if legacy != base_types:
                placement_variants.append(legacy)

        attempts: List[Tuple[str, Dict[str, Any], bool]] = []

        def add_attempt(url: str, payload: Dict[str, Any], *, values_in_kopecks: bool) -> None:
            attempts.append((url, payload, values_in_kopecks))

        for placement_types in placement_variants:
            # snake_case
            add_attempt(
                self.MIN_BIDS_URL,
                {
                    "advert_id": int(advert_id),
                    "nm_ids": [int(nm_id)],
                    "payment_type": pt,
                    "placement_types": placement_types,
                },
                values_in_kopecks=True,
            )
            # camelCase
            add_attempt(
                self.MIN_BIDS_URL,
                {
                    "advertId": int(advert_id),
                    "nmIds": [int(nm_id)],
                    "paymentType": pt,
                    "placementTypes": placement_types,
                },
                values_in_kopecks=True,
            )
            # PascalCase
            add_attempt(
                self.MIN_BIDS_URL,
                {
                    "AdvertId": int(advert_id),
                    "NmIds": [int(nm_id)],
                    "PaymentType": pt,
                    "PlacementTypes": placement_types,
                },
                values_in_kopecks=True,
            )

        # v0 fallback (rub)
        add_attempt(
            self.MIN_BIDS_V0_URL,
            {
                "advert_id": int(advert_id),
                "nm_ids": [int(nm_id)],
                "payment_type": pt,
                "placement_types": base_types,
            },
            values_in_kopecks=False,
        )

        last_r: Optional[requests.Response] = None
        used_values_in_kopecks = True
        used_url = ""

        for url, payload, values_in_kopecks in attempts:
            r = self._request("POST", url, headers=self._headers(), json=payload, timeout=30)
            last_r = r
            if 200 <= r.status_code < 300:
                used_url = url
                used_values_in_kopecks = values_in_kopecks
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
            if used_values_in_kopecks:
                # ceil kopecks->rub
                return (n + 99) // 100
            return n

        # normalize response
        norm_bids: List[Dict[str, Any]] = []
        if isinstance(raw, dict) and isinstance(raw.get("bids"), list):
            rows = raw.get("bids") or []
        elif isinstance(raw, list):
            rows = raw
        else:
            rows = []

        for row in rows:
            if not isinstance(row, dict):
                continue
            nm = row.get("nm_id") or row.get("nmId") or row.get("NmId") or nm_id
            inner = row.get("bids") or row.get("values") or []
            norm_inner: List[Dict[str, Any]] = []
            if isinstance(inner, list):
                for b in inner:
                    if isinstance(b, dict):
                        norm_inner.append({"type": b.get("type"), "value": b.get("value")})
            norm_bids.append({"nm_id": int(nm), "bids": norm_inner})

        def find_value(*types: str) -> int:
            for row in norm_bids:
                if int(row.get("nm_id", 0)) != int(nm_id):
                    continue
                for b in row.get("bids", []):
                    if str(b.get("type")) in types:
                        return bid_to_rub(b.get("value"))
            return 0

        min_combined = find_value("combined")
        min_search = find_value("search")
        min_reco = find_value("recommendations", "recommendation")

        logger.info(
            "WB min bids parsed: url=%s kopecks=%s nm_id=%s combined=%s search=%s recommendations=%s",
            used_url,
            used_values_in_kopecks,
            nm_id,
            min_combined,
            min_search,
            min_reco,
        )

        return MinBidResult(
            bids=norm_bids,
            raw=raw,
            min_combined_rub=int(min_combined),
            min_search_rub=int(min_search),
            min_recommendation_rub=int(min_reco),
        )

    # =========================
    # BIDS: set bid
    # =========================
    def set_bid(
        self,
        advert_id: int,
        nm_id: int,
        *,
        placement: str = "combined",
        bid_value: int = 0,
        value_unit: str = "rub",
    ) -> Any:
        # v1 endpoint expects bid_kopecks
        bid_rub = int(bid_value)
        bid_kopecks = bid_rub * 100 if str(value_unit).lower() == "rub" else bid_rub

        placement_norm = str(placement).strip().lower()
        if placement_norm in ("recommendation", "recommendations"):
            placement_norm = "recommendations"

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

        # fallback: without placement (some campaigns accept)
        payload_v1b = {
            "bids": [
                {
                    "advert_id": int(advert_id),
                    "nm_bids": [
                        {
                            "nm_id": int(nm_id),
                            "bid_kopecks": int(bid_kopecks),
                        }
                    ],
                }
            ]
        }
        r1b = self._request("PATCH", self.SET_BIDS_URL, headers=self._headers(), json=payload_v1b, timeout=30)
        if 200 <= r1b.status_code < 300:
            txt = (r1b.text or "").strip()
            return r1b.json() if txt not in ("", "null") else None

        # last fallback (deprecated): v0 RUB
        payload_v0 = {
            "bids": [
                {
                    "advert_id": int(advert_id),
                    "nm_bids": [{"nm": int(nm_id), "bid": int(bid_rub)}],
                }
            ]
        }
        r0 = self._request("PATCH", self.SET_BIDS_V0_URL, headers=self._headers(), json=payload_v0, timeout=30)
        if r0.status_code == 204:
            return None
        if 200 <= r0.status_code < 300:
            txt = (r0.text or "").strip()
            return r0.json() if txt not in ("", "null") else None

        raise ValueError(
            "WB bids update error: "
            f"v1={r1.status_code}:{r1.text} | v1b={r1b.status_code}:{r1b.text} | v0={r0.status_code}:{r0.text}"
        )