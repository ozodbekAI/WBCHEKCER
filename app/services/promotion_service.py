# services/promotion_service.py
# ✅ COMPLETE FIXED VERSION

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Tuple
from datetime import timedelta, date
import mimetypes
import json
import logging
import time
import threading
import re
from urllib.parse import unquote, urlparse
import uuid
import requests

from app.core.config import settings
from sqlalchemy.orm import Session

from app.services.promotion_math import calc_spend_rub
from app.services.wb_repository import WBRepository
from app.services.wb_advert_repository import WBAdvertRepository
from app.services.promotion_repository import PromotionRepository
from app.models.promotion import PromotionCompany, PromotionPhoto, PromotionStatus
from app.models.store import Store, StoreStatus
from app.models.user import User

logger = logging.getLogger(__name__)


def _guess_content_type(url: str) -> str:
    ct, _ = mimetypes.guess_type(url)
    if ct:
        return ct
    if url.lower().endswith(".webp"):
        return "image/webp"
    if url.lower().endswith(".jpg") or url.lower().endswith(".jpeg"):
        return "image/jpeg"
    if url.lower().endswith(".png"):
        return "image/png"
    return "application/octet-stream"


class PromotionService:
    _media_locks: Dict[int, threading.Lock] = {}
    _media_locks_guard = threading.Lock()

    def __init__(self) -> None:
        self.wb_repo = WBRepository()
        self.wb_advert = WBAdvertRepository()

    def _resolve_advert_token(self, db: Session, user_id: int) -> str:
        user = db.query(User).filter(User.id == int(user_id)).first()
        candidate_store_ids: list[int] = []
        if user and getattr(user, "store_id", None):
            candidate_store_ids.append(int(user.store_id))

        owned_ids = [
            int(store_id)
            for (store_id,) in db.query(Store.id)
            .filter(Store.owner_id == int(user_id))
            .order_by(Store.id.asc())
            .all()
        ]
        candidate_store_ids.extend(owned_ids)

        # Admin fallback: first active store with an API key.
        active_store_ids = [
            int(store_id)
            for (store_id,) in db.query(Store.id)
            .filter(Store.status == StoreStatus.ACTIVE)
            .order_by(Store.id.asc())
            .all()
        ]
        candidate_store_ids.extend(active_store_ids)

        seen: set[int] = set()
        for store_id in candidate_store_ids:
            if store_id in seen:
                continue
            seen.add(store_id)
            store = db.query(Store).filter(Store.id == store_id).first()
            if not store:
                continue
            token = str(getattr(store, "api_key", "") or "").strip()
            if token:
                return token

        return str(settings.WB_ADVERT_API_KEY or settings.WB_API_KEY or "").strip()

    def _get_wb_advert(self, db: Session, user_id: int) -> WBAdvertRepository:
        token = self._resolve_advert_token(db, user_id)
        return WBAdvertRepository(token=token)

    @classmethod
    def _get_media_lock(cls, nm_id: int) -> threading.Lock:
        nm = int(nm_id)
        with cls._media_locks_guard:
            lock = cls._media_locks.get(nm)
            if lock is None:
                lock = threading.Lock()
                cls._media_locks[nm] = lock
            return lock

    def _load_company_any_id(self, db: Session, repo: PromotionRepository, user_id: int, company_id: int) -> PromotionCompany:
        c = repo.get_company_optional(company_id=int(company_id), user_id=user_id)
        if c:
            return c
        c = repo.get_company_by_wb_id_optional(wb_company_id=int(company_id), user_id=user_id)
        if c:
            return c
        raise ValueError(f"Company not found: {company_id}")

    # ============================================
    # MEDIA SYNC - FIXED
    # ============================================
    def _sync_media_upload_and_reorder(
        self,
        *,
        nm_id: int,
        photos: List[Dict[str, Any]],
        existing_by_file: Dict[str, str],
        existing_by_wb: Dict[str, str],
        trace_id: str,
        poll_attempts: int = 15,
        poll_sleep_sec: float = 2.0,
    ) -> List[str]:
        nm_id = int(nm_id)
        lock = self._get_media_lock(nm_id)

        with lock:
            logger.info("[media:%s] START: nm_id=%s photos=%s", trace_id, nm_id, len(photos))

            # 1. Upload qilish kerak bo'lganlarni aniqlash
            to_upload: List[Tuple[int, str, str]] = []
            
            for idx, p in enumerate(photos):
                file_url = str(p["file_url"])
                
                if self._is_wb_url(file_url):
                    logger.info("[media:%s] [%s] WB URL, skip", trace_id, idx)
                    continue
                
                if file_url in existing_by_file:
                    logger.info("[media:%s] [%s] cached, skip", trace_id, idx)
                    continue
                
                to_upload.append((idx, file_url, file_url))
                logger.info("[media:%s] [%s] need upload", trace_id, idx)

            # 2. Upload
            uploaded_mapping: Dict[int, str] = {}
            
            if to_upload:
                logger.info("[media:%s] uploading %s photos", trace_id, len(to_upload))
                
                for idx, file_url, original in to_upload:
                    try:
                        data, ct = self.download_url_bytes(file_url)
                        wb_url = self.wb_repo.upload_photo_append(
                            nm_id=nm_id,
                            content=data,
                            content_type=ct,
                            wait_retries=poll_attempts,
                            wait_delay_sec=poll_sleep_sec,
                        )
                        
                        wb_url_clean = self._strip_url_query(wb_url)
                        uploaded_mapping[idx] = wb_url_clean
                        existing_by_file[original] = wb_url_clean
                        existing_by_wb[wb_url_clean] = original
                        
                        logger.info("[media:%s] [%s] uploaded: %s", trace_id, idx, wb_url_clean[:80])
                    except Exception as e:
                        logger.error("[media:%s] [%s] upload failed: %s", trace_id, idx, str(e))
                        raise ValueError(f"Upload failed [{idx}]: {e}")

            # 3. WB kartadan barcha URL'lar
            time.sleep(1.0)
            all_wb_urls = self._get_wb_photo_urls(nm_id=nm_id)
            logger.info("[media:%s] WB card: %s photos", trace_id, len(all_wb_urls))

            # 4. Mapping
            desired_wb_urls: List[str] = []
            
            for idx, p in enumerate(photos):
                file_url = str(p["file_url"])
                
                # 4.1 Yangi upload
                if idx in uploaded_mapping:
                    wb_url = uploaded_mapping[idx]
                    desired_wb_urls.append(wb_url)
                    logger.info("[media:%s] [%s] NEW UPLOAD -> %s", trace_id, idx, wb_url[:80])
                    continue
                
                # 4.2 WB URL
                if self._is_wb_url(file_url):
                    wb_candidate = self._strip_url_query(file_url)
                    resolved = self._resolve_to_card_url(wb_candidate, all_wb_urls)
                    if resolved:
                        desired_wb_urls.append(resolved)
                        logger.info("[media:%s] [%s] WB URL -> %s", trace_id, idx, resolved[:80])
                        continue
                    else:
                        logger.warning("[media:%s] [%s] WB URL not in card: %s", trace_id, idx, wb_candidate[:80])
                
                # 4.3 Cached
                if file_url in existing_by_file:
                    wb_url = existing_by_file[file_url]
                    resolved = self._resolve_to_card_url(wb_url, all_wb_urls)
                    if resolved:
                        desired_wb_urls.append(resolved)
                        logger.info("[media:%s] [%s] CACHED -> %s", trace_id, idx, resolved[:80])
                        continue
                
                # 4.4 Error
                raise ValueError(f"Cannot map [{idx}]: {file_url[:200]}")

            # 5. Duplicate check
            if len(set(desired_wb_urls)) != len(desired_wb_urls):
                dups = [u for u in desired_wb_urls if desired_wb_urls.count(u) > 1]
                raise ValueError(f"Duplicate URLs: {dups[:3]}")

            # 6. Final order
            final_order = self._build_media_order(all_wb_urls, desired_wb_urls)
            logger.info("[media:%s] final order: %s total, %s desired", trace_id, len(final_order), len(desired_wb_urls))

            # 7. Save
            self.wb_repo.save_media_state(nm_id=nm_id, photos=final_order)
            logger.info("[media:%s] saved to WB", trace_id)

            # 8) Verify & wait for WB to stabilize.
            # WB may apply /media/save asynchronously and (sometimes) renumber /big/<N>.* URLs.
            # If we read the card too early, we can persist URLs that later start pointing to other images.
            k = len(desired_wb_urls)
            last_slice: List[str] | None = None
            stable_slice: List[str] | None = None

            # First short wait, then poll for 2 consecutive identical "first-k" slices.
            time.sleep(1.5)
            for _ in range(12):  # ~1.5s + 11*2s ≈ 23.5s worst-case
                urls_now = self._get_wb_photo_urls(nm_id=nm_id)
                if len(urls_now) >= k:
                    cur_slice = [self._strip_url_query(u) for u in urls_now[:k]]
                    if cur_slice == last_slice:
                        stable_slice = cur_slice
                        break
                    last_slice = cur_slice
                time.sleep(2.0)

            result_urls = stable_slice or last_slice or []
            if len(result_urls) < k:
                raise ValueError(f"WB lost photos: {len(result_urls)} < {k}")

            # Refresh caches with final (post-save) URLs.
            for idx, p in enumerate(photos):
                file_url = str(p.get("file_url") or "")
                wb_url = result_urls[idx]
                if file_url and wb_url:
                    existing_by_file[file_url] = wb_url
                    existing_by_wb[wb_url] = file_url

            logger.info("[media:%s] DONE: %s URLs", trace_id, len(result_urls))
            return result_urls

    @staticmethod
    def _strip_url_query(url: str) -> str:
        u = str(url or "").strip()
        if not u:
            return u
        try:
            parsed = urlparse(u)
            if not parsed.scheme:
                return u
            return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        except Exception:
            return u

    @staticmethod
    def _extract_photo_number(url: str) -> int | None:
        u = (url or "")
        m = re.search(r"/(?:big|c\d+x\d+)/(\d+)\.", u)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                return None
        return None

    def _resolve_to_card_url(self, candidate: str, card_urls: List[str]) -> str | None:
        cand = self._strip_url_query(candidate)
        card_urls_clean = [self._strip_url_query(u) for u in card_urls]
        
        if cand in card_urls_clean:
            idx = card_urls_clean.index(cand)
            return card_urls[idx]

        pn = self._extract_photo_number(cand)
        if pn is not None:
            for u in card_urls:
                if self._extract_photo_number(u) == pn:
                    return u

        return None

    @staticmethod
    def _is_wb_url(u: str) -> bool:
        u = (u or "").lower()
        return ("wbbasket.ru" in u) or ("wildberries" in u) or ("wb.ru" in u)

    def _get_wb_photo_urls(self, nm_id: int) -> List[str]:
        card = self.wb_repo.get_card_by_nm_id(nm_id=nm_id)
        photos = (card or {}).get("photos") or []
        urls: List[str] = []
        for p in photos:
            url = p.get("big") or p.get("url") or p.get("full") or p.get("c516x688") or p.get("c246x328")
            if url:
                urls.append(self._strip_url_query(url))
        return urls

    @staticmethod
    def _build_media_order(all_urls: List[str], desired_urls: List[str]) -> List[str]:
        seen = set()
        out: List[str] = []
        
        for u in desired_urls:
            u_clean = u.strip()
            if u_clean and u_clean not in seen:
                out.append(u_clean)
                seen.add(u_clean)
        
        for u in all_urls:
            u_clean = u.strip()
            if u_clean and u_clean not in seen:
                out.append(u_clean)
                seen.add(u_clean)
        
        return out

    def _normalize_input_photos(
        self,
        *,
        nm_id: int,
        photos_in: List[Dict[str, Any]],
        from_main: bool,
        main_photo_url: str | None = None,
    ) -> List[Dict[str, Any]]:
        """
        Normalize and validate incoming photo list.
        If `from_main=True`, ensure the current WB main photo is present as order=1.
        """
        raw: List[Dict[str, Any]] = []
        for idx, item in enumerate(photos_in or []):
            if not isinstance(item, dict):
                raise ValueError(f"Invalid photo payload at index {idx}")
            file_url = str(item.get("file_url") or "").strip()
            if not file_url:
                raise ValueError(f"file_url required at index {idx}")
            try:
                order = int(item.get("order")) if item.get("order") is not None else (idx + 1)
            except Exception:
                order = idx + 1
            raw.append({"order": order, "file_url": file_url})

        if not raw:
            raise ValueError("photos required")

        raw.sort(key=lambda x: int(x["order"]))
        normalized = [{"order": i + 1, "file_url": str(p["file_url"]).strip()} for i, p in enumerate(raw)]

        if from_main:
            main_url = str(main_photo_url or "").strip()
            if not main_url:
                try:
                    main_url = str(self._get_card_photo_map(int(nm_id)).get(1) or "").strip()
                except Exception:
                    main_url = ""

            if main_url:
                main_clean = self._strip_url_query(main_url)
                has_main = any(self._strip_url_query(str(p["file_url"])) == main_clean for p in normalized)
                if not has_main:
                    normalized = [{"order": 1, "file_url": main_url}] + [
                        {"order": i + 2, "file_url": str(p["file_url"])}
                        for i, p in enumerate(normalized)
                    ]

        out: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for i, p in enumerate(normalized, start=1):
            file_url = str(p.get("file_url") or "").strip()
            if not file_url:
                raise ValueError(f"file_url required at index {i - 1}")
            key = self._strip_url_query(file_url)
            if key in seen:
                raise ValueError("Duplicate file_urls")
            seen.add(key)
            out.append({"order": i, "file_url": file_url})
        return out

    def _ensure_variant_on_card_and_make_main(
        self,
        *,
        nm_id: int,
        desired_file_url: str,
        original_urls: List[str],
        current_uploaded_url: str | None,
    ) -> str:
        """Ensure desired variant photo exists on WB card, make it the main photo and remove previous uploaded test photo.

        - If desired_file_url is already a WB URL and exists in card media, we only reorder.
        - Otherwise we upload it (append) and then reorder.
        - We always keep original_urls (saved at start) and at most one uploaded test photo at a time.
        """
        desired_file_url = str(desired_file_url or "").strip()
        if not desired_file_url:
            raise ValueError("desired_file_url empty")

        # Base list to keep (original media)
        base_urls = list(original_urls or [])
        if not base_urls:
            base_urls = self._get_wb_photo_urls(nm_id=nm_id)

        # Resolve desired URL (existing or upload)
        desired_url: str
        if self._is_wb_url(desired_file_url):
            card_urls = self._get_wb_photo_urls(nm_id=nm_id)
            desired_url = self._resolve_to_card_url(desired_file_url, card_urls) or self._strip_url_query(desired_file_url)
        else:
            content, content_type = self.download_url_bytes(desired_file_url)
            desired_url = self.wb_repo.upload_photo_append(
                nm_id=int(nm_id),
                content=content,
                content_type=content_type or "application/octet-stream",
            )
            desired_url = self._strip_url_query(desired_url)

        # Build final list: desired first + all original (deduped), excluding previous uploaded test photo
        curr_up = self._strip_url_query(current_uploaded_url or "") if current_uploaded_url else ""
        desired_clean = self._strip_url_query(desired_url)

        seen = set()
        out: List[str] = []

        def add(u: str):
            u2 = self._strip_url_query(u)
            if not u2:
                return
            if u2 == curr_up and u2 not in [self._strip_url_query(x) for x in (original_urls or [])] and u2 != desired_clean:
                # drop previous uploaded variant
                return
            if u2 in seen:
                return
            out.append(u2)
            seen.add(u2)

        add(desired_url)
        for u in base_urls:
            add(u)

        with self._get_media_lock(int(nm_id)):
            self.wb_repo.save_media_state(nm_id=int(nm_id), photos=out)

        return desired_clean

    def download_url_bytes(self, url: str, *, timeout: Tuple[int, int] = (10, 120)) -> Tuple[bytes, str]:
        if not (url.startswith("http://") or url.startswith("https://")):
            p = Path(url)
            if p.exists() and p.is_file():
                data = p.read_bytes()
                ct = self._guess_content_type_from_path(p)
                return data, ct

        u = urlparse(url)
        if (u.scheme in ("http", "https") and u.hostname in ("localhost", "127.0.0.1") and (u.path or "").startswith("/media/")):
            rel = unquote(u.path[len("/media/"):]).lstrip("/")
            media_root = self._media_root()
            candidate = (media_root / rel).resolve()

            try:
                candidate.relative_to(media_root.resolve())
            except Exception:
                raise ValueError(f"Unsafe path: {url}")

            if candidate.exists() and candidate.is_file():
                data = candidate.read_bytes()
                ct = self._guess_content_type_from_path(candidate)
                return data, ct

            raise ValueError(f"File not found: {candidate}")

        r = requests.get(url, timeout=timeout)
        if r.status_code < 200 or r.status_code >= 300:
            raise ValueError(f"Download failed: {url} ({r.status_code})")

        content_type = r.headers.get("Content-Type") or _guess_content_type(url)
        return r.content, content_type

    @staticmethod
    def _guess_content_type_from_path(p: Path) -> str:
        ct, _ = mimetypes.guess_type(p.name)
        return ct or "application/octet-stream"

    @staticmethod
    def _media_root() -> Path:
        try:
            from core.config import settings
            mr = getattr(settings, "MEDIA_ROOT", None) or getattr(settings, "MEDIA_DIR", None)
            if mr:
                return Path(mr)
        except Exception:
            pass

        cwd = Path.cwd()
        for c in [cwd / "media", cwd / "backend" / "media", cwd.parent / "media", cwd.parent / "backend" / "media"]:
            if c.exists() and c.is_dir():
                return c
        return cwd / "media"



    # ============================================
    # PROMO MEDIA ENGINE (slot-based, no save_media_state during test)
    # ============================================
    
    @staticmethod
    def _ext_from_content_type(content_type: str) -> str:
        ct = (content_type or "").split(";")[0].strip().lower()
        if ct == "image/webp":
            return ".webp"
        if ct == "image/jpeg":
            return ".jpg"
        if ct == "image/png":
            return ".png"
        if ct:
            import mimetypes
            ext = mimetypes.guess_extension(ct)
            if ext:
                return ext
        return ".bin"

    @staticmethod
    def _ct_from_path(path_str: str) -> str:
        p = str(path_str or "").lower()
        if p.endswith(".webp"):
            return "image/webp"
        if p.endswith(".jpg") or p.endswith(".jpeg"):
            return "image/jpeg"
        if p.endswith(".png"):
            return "image/png"
        return "application/octet-stream"

    def _abs_media_path(self, rel: str) -> Path:
        rel = str(rel or "").lstrip("/")
        p = self._media_root() / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def _write_rel_bytes(self, rel: str, data: bytes) -> None:
        self._abs_media_path(rel).write_bytes(data)

    def _read_rel_bytes(self, rel: str) -> bytes:
        return (self._media_root() / str(rel or "").lstrip("/")).read_bytes()

    def _get_card_photo_map(self, nm_id: int) -> dict:
        # Map photo_number -> URL from WB card
        nm_id = int(nm_id)
        try:
            card = self.wb_repo.get_card_by_nm_id(nm_id)
        except Exception as e:
            logger.warning("[promo-media] get_card_by_nm_id failed nm_id=%s err=%s", nm_id, str(e))
            return {}
        photos = (card or {}).get("photos") or []
        out = {}
        for p in photos:
            if not isinstance(p, dict):
                continue
            u = p.get("big") or p.get("url") or p.get("full") or p.get("c516x688") or p.get("c246x328")
            if not u:
                continue
            n = self._extract_photo_number(str(u))
            if n:
                out[int(n)] = str(u)
        return out

    def _choose_parking_slot(self, total_slots: int, selected_slots: set[int]) -> int | None:
        total_slots = int(total_slots or 0)
        if total_slots < 2:
            return None
        # Prefer the highest slot that is not used as a "card variant" source
        for s in range(total_slots, 1, -1):
            if s != 1 and int(s) not in selected_slots:
                return int(s)
        # Fallback: last slot
        return int(total_slots)

    def _ensure_slot_backup(self, nm_id: int, state: dict, slot: int) -> None:
        nm_id = int(nm_id)
        slot = int(slot)
        base_dir = str(state.get("base_dir") or "promotion_media")
        backups = state.setdefault("backups", {})
        shadows = state.setdefault("shadows", {})
        k = str(slot)

        # already have a backup and file exists
        if k in backups:
            try:
                if (self._media_root() / backups[k]).exists():
                    if k in shadows and (self._media_root() / shadows[k]).exists():
                        return
            except Exception:
                pass

        photo_map = self._get_card_photo_map(nm_id)
        url = photo_map.get(slot)
        if not url:
            # slot might not exist (e.g., card has 1 photo)
            logger.warning("[promo-media] slot url not found nm_id=%s slot=%s", nm_id, slot)
            return

        data, ct = self.download_url_bytes(str(url))
        ext = self._ext_from_content_type(ct)
        rel_backup = f"{base_dir}/backup_slot{slot}{ext}"
        rel_shadow = f"{base_dir}/shadow_slot{slot}{ext}"

        self._write_rel_bytes(rel_backup, data)
        self._write_rel_bytes(rel_shadow, data)

        backups[k] = rel_backup
        shadows[k] = rel_shadow

    def _mark_touched(self, state: dict, slot: int) -> None:
        touched = state.setdefault("touched", [])
        s = int(slot)
        if s not in touched:
            touched.append(s)

    def _upload_slot(self, nm_id: int, slot: int, data: bytes, content_type: str) -> None:
        nm_id = int(nm_id)
        slot = int(slot)
        ext = self._ext_from_content_type(content_type)
        filename = f"promo_slot{slot}{ext}"
        self.wb_repo.upload_media_file(
            nm_id=nm_id,
            photo_number=slot,
            file_bytes=data,
            filename=filename,
            content_type=content_type or "application/octet-stream",
        )

    def _apply_variant_to_main_slot(self, nm_id: int, state: dict, variant_url: str) -> None:
        # Apply variant to slot1, using parking slot to avoid save_media_state.
        nm_id = int(nm_id)
        variant_url = str(variant_url or "").strip()
        test_slot = int(state.get("test_slot") or 1)
        parking_slot = state.get("parking_slot")
        parking_slot = int(parking_slot) if parking_slot else None

        # Ensure we can always restore main slot
        self._ensure_slot_backup(nm_id, state, test_slot)

        # Card source swap if possible
        src_slot = None
        if self._is_wb_url(variant_url):
            src_slot = self._extract_photo_number(variant_url)
        if src_slot and int(src_slot) != test_slot:
            src_slot = int(src_slot)
            try:
                self._ensure_slot_backup(nm_id, state, src_slot)
                shadows = state.setdefault("shadows", {})
                s1 = shadows.get(str(test_slot))
                sk = shadows.get(str(src_slot))
                if not s1 or not sk:
                    raise ValueError('missing shadows')
                b1 = self._read_rel_bytes(s1)
                bk = self._read_rel_bytes(sk)
                ct1 = self._ct_from_path(s1)
                ctk = self._ct_from_path(sk)

                self._upload_slot(nm_id, test_slot, bk, ctk)
                self._upload_slot(nm_id, src_slot, b1, ct1)

                # update shadows
                self._write_rel_bytes(s1, bk)
                self._write_rel_bytes(sk, b1)

                self._mark_touched(state, test_slot)
                self._mark_touched(state, src_slot)
                state["last_applied"] = {"kind": "swap", "src_slot": src_slot}
                return
            except Exception as e:
                logger.warning("[promo-media] swap failed, fallback to overwrite nm_id=%s src=%s err=%s", nm_id, src_slot, str(e))

        # Local/overwrite variant
        data_v, ct_v = self.download_url_bytes(variant_url)
        shadows = state.setdefault("shadows", {})
        s1 = shadows.get(str(test_slot))
        if not s1:
            # no shadow - create from current card
            self._ensure_slot_backup(nm_id, state, test_slot)
            s1 = state.get("shadows", {}).get(str(test_slot))
        
        if parking_slot:
            self._ensure_slot_backup(nm_id, state, parking_slot)
            sp = shadows.get(str(parking_slot))
            if sp and s1:
                b1 = self._read_rel_bytes(s1)
                ct1 = self._ct_from_path(s1)
                # move current main into parking
                try:
                    self._upload_slot(nm_id, parking_slot, b1, ct1)
                    self._write_rel_bytes(sp, b1)
                    self._mark_touched(state, parking_slot)
                except Exception as e:
                    logger.warning("[promo-media] move-to-parking failed nm_id=%s parking=%s err=%s", nm_id, parking_slot, str(e))

        # overwrite main
        self._upload_slot(nm_id, test_slot, data_v, ct_v)
        if s1:
            self._write_rel_bytes(s1, data_v)

        self._mark_touched(state, test_slot)
        state["last_applied"] = {"kind": "overwrite", "parking_slot": parking_slot}

    def _restore_original_slots(self, nm_id: int, state: dict) -> None:
        nm_id = int(nm_id)
        backups = state.get("backups") or {}
        shadows = state.get("shadows") or {}
        touched = list(state.get("touched") or [])
        if not touched:
            return

        for slot in touched:
            k = str(int(slot))
            rel_b = backups.get(k)
            rel_s = shadows.get(k)
            if not rel_b:
                continue
            try:
                data = self._read_rel_bytes(rel_b)
                ct = self._ct_from_path(rel_b)
                self._upload_slot(nm_id, int(slot), data, ct)
                if rel_s:
                    self._write_rel_bytes(rel_s, data)
            except Exception as e:
                logger.warning("[promo-media] restore failed nm_id=%s slot=%s err=%s", nm_id, slot, str(e))

        state["touched"] = []

    def _init_media_state(self, company: PromotionCompany, selected_wb_slots: set[int]) -> dict:
        nm_id = int(company.nm_id)
        photo_map = self._get_card_photo_map(nm_id)
        total_slots = max(photo_map.keys(), default=0)
        parking_slot = self._choose_parking_slot(total_slots, set(int(x) for x in (selected_wb_slots or set())))

        session_id = uuid.uuid4().hex[:12]
        base_dir = f"promotion_media/nm_{nm_id}/c_{int(company.id)}_{session_id}"

        st = {
            "v": 2,
            "nm_id": nm_id,
            "company_id": int(company.id),
            "test_slot": 1,
            "parking_slot": parking_slot,
            "selected_wb_slots": sorted([int(x) for x in (selected_wb_slots or set())]),
            "base_dir": base_dir,
            "backups": {},
            "shadows": {},
            "touched": [],
        }

        # Always backup main slot, and backup parking slot if exists
        self._ensure_slot_backup(nm_id, st, 1)
        if parking_slot:
            self._ensure_slot_backup(nm_id, st, int(parking_slot))

        # Store original URLs for reference
        if photo_map:
            st["original_urls"] = [photo_map[k] for k in sorted(photo_map.keys())]

        return st


    # ============================================
    # API METHODS
    # ============================================
    def create_company(self, db: Session, user_id: int, payload: dict) -> dict:
        repo = PromotionRepository(db)
        wb_advert = self._get_wb_advert(db, user_id)

        nm_id = int(payload["nm_id"])
        card_id = int(payload.get("card_id") or nm_id)
        title = str(payload["title"])
        from_main = bool(payload.get("from_main", False))
        max_slots = int(payload.get("max_slots", 4))

        photos_norm = self._normalize_input_photos(
            nm_id=nm_id,
            photos_in=payload.get("photos") or [],
            from_main=from_main,
            main_photo_url=payload.get("main_photo_url"),
        )
        if len(photos_norm) < 2:
            raise ValueError("At least 2 photos are required")

        wb_company_id, _ = wb_advert.create_seacat_campaign(name=title, nms=[nm_id])

        company = repo.create_company(
            user_id=user_id,
            wb_company_id=wb_company_id,
            nm_id=nm_id,
            card_id=card_id,
            title=title,
            from_main=from_main,
            max_slots=max_slots,
            photos=[{"order": int(p["order"]), "file_url": str(p["file_url"])} for p in photos_norm],
        )

        wb_min_bids = wb_advert.get_min_bids(
            advert_id=int(company.wb_company_id),
            nm_id=nm_id,
            search=False,
            recommendation=False,
            combined=True,
        )

        return {
            "id_company": company.id,
            "company_id": wb_company_id,
            "nm_id": nm_id,
            "title": title,
            "min_bids": {
                "min_combined_rub": int(getattr(wb_min_bids, "min_combined_rub", 0) or 0),
                "min_search_rub": int(getattr(wb_min_bids, "min_search_rub", 0) or 0),
                "min_recommendation_rub": int(getattr(wb_min_bids, "min_recommendation_rub", 0) or 0),
            },
            "status": str(company.status),
        }

    def update_company_and_start(self, db: Session, user_id: int, payload: dict) -> dict:
        repo = PromotionRepository(db)
        wb_advert = self._get_wb_advert(db, user_id)

        raw_company_id = payload.get("id_company") or payload.get("company_id")
        if not raw_company_id:
            raise ValueError("company_id required")

        company = repo.get_company(company_id=int(raw_company_id), user_id=user_id)
        if not company:
            raise ValueError("Company not found")

        trace_id = str(payload.get("trace_id") or uuid.uuid4().hex[:8])
        t0 = time.perf_counter()

        # 1) Validate + normalize payload
        nm_id = int(payload.get("nm_id") or company.nm_id)
        title = str(payload.get("title") or company.title)
        title_changed = bool(payload.get("title_changed", False))
        from_main = bool(payload.get("from_main", company.from_main))
        keep_winner_as_main = bool(payload.get("keep_winner_as_main", True))
        max_slots = int(payload.get("max_slots", company.max_slots or 4))
        views_per_photo = int(payload["views_per_photo"])
        cpm_requested = int(payload["cpm"])

        photos_norm = self._normalize_input_photos(
            nm_id=nm_id,
            photos_in=payload.get("photos") or [],
            from_main=from_main,
            main_photo_url=payload.get("main_photo_url"),
        )
        if len(photos_norm) < 2:
            raise ValueError("At least 2 photos are required")

        photos_count = len(photos_norm)
        max_slots = max(int(max_slots), int(photos_count))

        # 2) Min bids
        wb_min_bids = wb_advert.get_min_bids(
            advert_id=int(company.wb_company_id),
            nm_id=nm_id,
            search=False,
            recommendation=False,
            combined=True,
        )
        min_bid_rub = int(getattr(wb_min_bids, "min_combined_rub", 0) or 0)
        if min_bid_rub == 0:
            min_bid_rub = max(
                int(getattr(wb_min_bids, "min_search_rub", 0) or 0),
                int(getattr(wb_min_bids, "min_recommendation_rub", 0) or 0),
            )
        cpm = max(int(cpm_requested), int(min_bid_rub))

        # 3) Spend
        spend_total = calc_spend_rub(photos_count=photos_count, views_per_photo=views_per_photo, cpm_rub=cpm)

        # Optional cleanup: if previous run appended extra photos, try to restore that previous original list.
        try:
            prev_original = repo.get_original_media(company)
            if prev_original:
                with self._get_media_lock(nm_id):
                    self.wb_repo.save_media_state(nm_id=nm_id, photos=prev_original)
        except Exception:
            pass

        # 4) Save settings + reset test counters
        repo.set_company_settings(
            company,
            title=title,
            title_changed=title_changed,
            from_main=from_main,
            max_slots=max_slots,
            keep_winner_as_main=keep_winner_as_main,
            photos_count=photos_count,
            views_per_photo=views_per_photo,
            cpm=cpm,
            spend_rub=spend_total,
        )
        repo.reset_test_state(company)

        # Refresh instance
        company = repo.get_company(company_id=int(company.id), user_id=user_id)

        # 5) Initialize media state (slot-based). No save_media_state during test.
        selected_wb_slots: set[int] = set()
        for p in photos_norm:
            fu = str(p.get("file_url") or "")
            if self._is_wb_url(fu):
                n = self._extract_photo_number(fu)
                if n:
                    selected_wb_slots.add(int(n))

        with self._get_media_lock(nm_id):
            st = self._init_media_state(company, selected_wb_slots)
            repo.set_media_state(company, state=st)

            if not from_main:
                # Immediately apply first variant to slot1
                first = photos_norm[0]
                self._apply_variant_to_main_slot(nm_id, st, str(first["file_url"]))
                repo.set_media_state(company, state=st)

        # 6) Persist photos list
        upsert_payload = [{"order": int(p["order"]), "file_url": str(p["file_url"])} for p in photos_norm]
        try:
            main_url = self._get_card_photo_map(nm_id).get(1)
            if main_url and upsert_payload:
                upsert_payload[0]["wb_url"] = str(main_url)
        except Exception:
            pass

        repo.upsert_photos(company, upsert_payload)
        repo.set_current_uploaded(company, None)

        # 7) Bids
        wb_advert.set_bid(
            advert_id=int(company.wb_company_id),
            nm_id=nm_id,
            placement="combined",
            bid_value=cpm,
            value_unit="rub",
        )

        # 8) Budget (optional)
        deposit_amount = 0
        auto_deposit = bool(payload.get("auto_deposit", True))
        if auto_deposit:
            try:
                wb_budget_info = wb_advert.get_campaign_budget(int(company.wb_company_id))
                current_budget = int(wb_budget_info.get("total") or 0)
                if current_budget < int(spend_total):
                    deposit_needed = int(spend_total) - current_budget
                    deposit_amount = int(payload.get("deposit_rub") or deposit_needed or spend_total)
                    wb_advert.deposit_budget(
                        advert_id=int(company.wb_company_id),
                        amount_rub=int(deposit_amount),
                        source_type=1,
                    )
                    time.sleep(2)
            except Exception as e:
                logger.warning("[update:%s] deposit failed: %s", trace_id, str(e))

        # 9) Baseline stats
        begin_date = date.today().isoformat()
        end_date = (date.today() + timedelta(days=1)).isoformat()
        stats = wb_advert.get_fullstats([int(company.wb_company_id)], begin_date=begin_date, end_date=end_date)
        total_shows, total_clicks = self.parse_stats_totals(stats, advert_id=int(company.wb_company_id))
        repo.update_last_totals(company, shows=total_shows, clicks=total_clicks)

        # 10) Start
        try:
            wb_advert.start_campaign(int(company.wb_company_id))
            repo.mark_started(company)

            logger.info("[update:%s] SUCCESS: %sms", trace_id, int((time.perf_counter() - t0) * 1000))

            return {
                "id_company": company.id,
                "company_id": int(company.wb_company_id),
                "nm_id": nm_id,
                "title": title,
                "cpm": cpm,
                "min_cpm": int(min_bid_rub),
                "views_per_photo": int(views_per_photo),
                "photos_count": int(photos_count),
                "spend_rub": int(spend_total),
                "deposit_amount": int(deposit_amount),
                "started": True,
                "status": "running",
            }

        except Exception as e:
            err = str(e)
            try:
                repo.mark_failed(company, error=err)
            except Exception:
                pass

            return {
                "id_company": company.id,
                "company_id": int(company.wb_company_id),
                "started": False,
                "error": err,
                "status": "cannot_start",
            }


    def get_balance(self, db: Session, user_id: int) -> dict:
        wb_advert = self._get_wb_advert(db, user_id)
        try:
            balance = wb_advert.get_balance() or {}
        except Exception as e:
            logger.warning("promotion balance fallback for user_id=%s: %s", user_id, e)
            return {"balance": 0, "promo_bonus_rub": 0, "error": str(e)}

        return {
            "balance": int(balance.get("net") or 0),
            "promo_bonus_rub": int(balance.get("bonus") or 0),
        }

    def company_stats(self, db: Session, user_id: int, company_id: int) -> dict:
        repo = PromotionRepository(db)
        company = self._load_company_any_id(db, repo, user_id, int(company_id))

        photos = db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).order_by(PromotionPhoto.order.asc()).all()

        return {
            "id_company": int(company.id),
            "company_id": int(company.wb_company_id),
            "nm_id": int(company.nm_id),
            "title": str(company.title),
            "status": str(company.status),
            "spend_rub": int(getattr(company, "spend_rub", 0) or 0),
            "views_per_photo": int(getattr(company, "views_per_photo", 0) or 0),
            "photos_count": int(getattr(company, "photos_count", 0) or 0),
            "current_photo_order": int(getattr(company, "current_photo_order", 1) or 1),
            "totals": {
                "shows": int(getattr(company, "last_total_shows", 0) or 0),
                "clicks": int(getattr(company, "last_total_clicks", 0) or 0),
            },
            "photos": [
                {
                    "order": int(p.order),
                    "file_url": str(getattr(p, "file_url", "") or ""),
                    "wb_url": str(getattr(p, "wb_url", "") or ""),
                    "shows": int(getattr(p, "shows", 0) or 0),
                    "clicks": int(getattr(p, "clicks", 0) or 0),
                    "ctr": float(getattr(p, "ctr", 0) or 0),
                }
                for p in photos
            ],
        }

    def company_debug(self, db: Session, user_id: int, company_id: int) -> dict:
        repo = PromotionRepository(db)
        wb_advert = self._get_wb_advert(db, user_id)
        company = self._load_company_any_id(db, repo, user_id, int(company_id))

        wb_budget = wb_advert.get_campaign_budget(int(company.wb_company_id))
        wb_balance = wb_advert.get_balance()

        return {
            "id_company": company.id,
            "company_id": int(company.wb_company_id),
            "nm_id": int(company.nm_id),
            "status": str(company.status),
            "wb_budget": wb_budget,
            "wb_balance": wb_balance,
        }

    def start_company(self, db: Session, user_id: int, company_id: int) -> dict:
        repo = PromotionRepository(db)
        wb_advert = self._get_wb_advert(db, user_id)
        company = self._load_company_any_id(db, repo, user_id, int(company_id))

        try:
            wb_advert.start_campaign(int(company.wb_company_id))

            begin_date = date.today().isoformat()
            end_date = (date.today() + timedelta(days=1)).isoformat()
            stats = wb_advert.get_fullstats([int(company.wb_company_id)], begin_date=begin_date, end_date=end_date)
            shows, clicks = self.parse_stats_totals(stats, advert_id=int(company.wb_company_id))
            repo.update_last_totals(company, shows=shows, clicks=clicks)
            repo.mark_started(company)

            return {"id_company": company.id, "company_id": int(company.wb_company_id), "started": True, "status": "running"}

        except Exception as e:
            err = str(e)
            try:
                repo.mark_failed(company, error=err)
            except Exception:
                pass
            return {"id_company": company.id, "started": False, "error": err}

    def list_running(self, *, db: Session, user_id: int, page: int = 1, page_size: int = 6) -> dict:
        repo = PromotionRepository(db)

        statuses = [PromotionStatus.RUNNING]
        total = repo.count_by_statuses(user_id=user_id, statuses=statuses)
        total_pages = math.ceil(total / page_size) if total else 0
        offset = (page - 1) * page_size

        companies = repo.list_by_statuses(
            user_id=user_id,
            statuses=statuses,
            limit=page_size,
            offset=offset,
        )

        items = []
        for c in companies:
            items.append({
                "id_company": c.id,
                "company_id": int(c.wb_company_id),   # siz oldin shuni company_id qilib qaytargansiz
                "nm_id": int(c.nm_id),
                "title": c.title,
                "status": c.status.value,             # ✅ "finished" / "running" / ...
                "spend_rub": int(c.spend_rub),
                "views_per_photo": int(c.views_per_photo),
                "photos_count": int(c.photos_count),
                "winner_photo_order": c.winner_photo_order,
                "photos": [
                    {
                        "order": int(p.order),
                        "file_url": p.file_url,
                        "wb_url": p.wb_url,
                        "shows": int(p.shows),
                        "clicks": int(p.clicks),
                        "ctr": float(p.ctr),
                        "is_winner": bool(p.is_winner),
                    }
                    for p in (c.photos or [])
                ],
            })

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        }

    def list_failed(self, *, db: Session, user_id: int, page: int = 1, page_size: int = 6) -> dict:
        repo = PromotionRepository(db)

        statuses = [PromotionStatus.FAILED]
        total = repo.count_by_statuses(user_id=user_id, statuses=statuses)
        total_pages = math.ceil(total / page_size) if total else 0
        offset = (page - 1) * page_size

        companies = repo.list_by_statuses(
            user_id=user_id,
            statuses=statuses,
            limit=page_size,
            offset=offset,
        )

        items = []
        for c in companies:
            items.append({
                "id_company": c.id,
                "company_id": int(c.wb_company_id),   # siz oldin shuni company_id qilib qaytargansiz
                "nm_id": int(c.nm_id),
                "title": c.title,
                "status": c.status.value,             # ✅ "finished" / "running" / ...
                "spend_rub": int(c.spend_rub),
                "views_per_photo": int(c.views_per_photo),
                "photos_count": int(c.photos_count),
                "winner_photo_order": c.winner_photo_order,
                "photos": [
                    {
                        "order": int(p.order),
                        "file_url": p.file_url,
                        "wb_url": p.wb_url,
                        "shows": int(p.shows),
                        "clicks": int(p.clicks),
                        "ctr": float(p.ctr),
                        "is_winner": bool(p.is_winner),
                    }
                    for p in (c.photos or [])
                ],
            })

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        }

    def list_pending(self, db: Session, user_id: int, page: int = 1, page_size: int = 6) -> dict:
        repo = PromotionRepository(db)

        statuses = [PromotionStatus.CREATED]
        total = repo.count_by_statuses(user_id=user_id, statuses=statuses)
        total_pages = math.ceil(total / page_size) if total else 0
        offset = (page - 1) * page_size

        companies = repo.list_by_statuses(
            user_id=user_id,
            statuses=statuses,
            limit=page_size,
            offset=offset,
        )

        items = []
        for c in companies:
            items.append({
                "id_company": c.id,
                "company_id": int(c.wb_company_id),   # siz oldin shuni company_id qilib qaytargansiz
                "nm_id": int(c.nm_id),
                "title": c.title,
                "status": c.status.value,             # ✅ "finished" / "running" / ...
                "spend_rub": int(c.spend_rub),
                "views_per_photo": int(c.views_per_photo),
                "photos_count": int(c.photos_count),
                "winner_photo_order": c.winner_photo_order,
                "photos": [
                    {
                        "order": int(p.order),
                        "file_url": p.file_url,
                        "wb_url": p.wb_url,
                        "shows": int(p.shows),
                        "clicks": int(p.clicks),
                        "ctr": float(p.ctr),
                        "is_winner": bool(p.is_winner),
                    }
                    for p in (c.photos or [])
                ],
            })

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        }

    def list_finished(self, db: Session, user_id: int, page: int = 1, page_size: int = 6) -> dict:
        repo = PromotionRepository(db)

        statuses = [PromotionStatus.FINISHED]
        total = repo.count_by_statuses(user_id=user_id, statuses=statuses)
        total_pages = math.ceil(total / page_size) if total else 0
        offset = (page - 1) * page_size

        companies = repo.list_by_statuses(
            user_id=user_id,
            statuses=statuses,
            limit=page_size,
            offset=offset,
        )

        items = []
        for c in companies:
            items.append({
                "id_company": c.id,
                "company_id": int(c.wb_company_id),   # siz oldin shuni company_id qilib qaytargansiz
                "nm_id": int(c.nm_id),
                "title": c.title,
                "status": c.status.value,             # ✅ "finished" / "running" / ...
                "spend_rub": int(c.spend_rub),
                "views_per_photo": int(c.views_per_photo),
                "photos_count": int(c.photos_count),
                "winner_photo_order": c.winner_photo_order,
                "photos": [
                    {
                        "order": int(p.order),
                        "file_url": p.file_url,
                        "wb_url": p.wb_url,
                        "shows": int(p.shows),
                        "clicks": int(p.clicks),
                        "ctr": float(p.ctr),
                        "is_winner": bool(p.is_winner),
                    }
                    for p in (c.photos or [])
                ],
            })

        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": total_pages,
            }
        }

    # ============================================
    # ROTATION & FINISH
    # ============================================

    def switch_to_next_photo(self, db: Session, company: PromotionCompany) -> None:
        repo = PromotionRepository(db)

        total = int(getattr(company, "photos_count", 0) or 0)
        current = int(getattr(company, "current_photo_order", 1) or 1)
        next_order = current + 1

        if next_order > total:
            raise ValueError(f"Cannot switch: next={next_order} > total={total}")

        next_photo = (
            db.query(PromotionPhoto)
            .filter(PromotionPhoto.company_id == company.id, PromotionPhoto.order == next_order)
            .first()
        )
        if not next_photo:
            raise ValueError(f"Next photo not found (order={next_order})")

        nm_id = int(company.nm_id)

        with self._get_media_lock(nm_id):
            st = repo.get_media_state(company) or {}
            if not isinstance(st, dict) or int(st.get("v") or 0) != 2 or int(st.get("nm_id") or 0) != int(nm_id):
                # rebuild state from current card + selected WB slots in DB
                selected: set[int] = set()
                try:
                    all_ph = db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
                    for p in all_ph:
                        fu = str(getattr(p, "file_url", "") or "")
                        if self._is_wb_url(fu):
                            n = self._extract_photo_number(fu)
                            if n:
                                selected.add(int(n))
                except Exception:
                    pass
                st = self._init_media_state(company, selected)

            self._apply_variant_to_main_slot(nm_id, st, str(next_photo.file_url))
            repo.set_media_state(company, state=st)

        # Update wb_url for this order (slot1 URL is stable, content changes)
        try:
            main_url = self._get_card_photo_map(nm_id).get(1)
            if main_url:
                next_photo.wb_url = str(main_url)
                db.add(next_photo)
                db.commit()
        except Exception:
            pass

        repo.set_current_photo_order(company, next_order)

    def finalize_winner(self, db: Session, company: PromotionCompany, *, stop_campaign: bool = True) -> int:
        repo = PromotionRepository(db)

        photos = db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
        if not photos:
            raise ValueError("No photos for company")

        photos_sorted = sorted(
            photos,
            key=lambda p: (float(p.ctr or 0), int(p.shows or 0), -int(p.order)),
            reverse=True,
        )
        winner = photos_sorted[0]
        winner_order = int(winner.order)

        if stop_campaign:
            try:
                self._get_wb_advert(db, int(company.user_id)).stop_campaign(int(company.wb_company_id))
            except Exception:
                pass

        nm_id = int(company.nm_id)
        keep_winner_as_main = bool(getattr(company, "keep_winner_as_main", True))

        with self._get_media_lock(nm_id):
            st = repo.get_media_state(company) or {}
            if not isinstance(st, dict) or int(st.get("v") or 0) != 2 or int(st.get("nm_id") or 0) != int(nm_id):
                # rebuild state from current card + selected WB slots in DB
                selected: set[int] = set()
                try:
                    all_ph = db.query(PromotionPhoto).filter(PromotionPhoto.company_id == company.id).all()
                    for p in all_ph:
                        fu = str(getattr(p, "file_url", "") or "")
                        if self._is_wb_url(fu):
                            n = self._extract_photo_number(fu)
                            if n:
                                selected.add(int(n))
                except Exception:
                    pass
                st = self._init_media_state(company, selected)

            # Always restore original slots first (if we touched them)
            try:
                self._restore_original_slots(nm_id, st)
            except Exception:
                pass

            if keep_winner_as_main:
                # Apply winner after restore
                try:
                    self._apply_variant_to_main_slot(nm_id, st, str(winner.file_url))
                except Exception as e:
                    logger.warning("[promo-media] apply winner failed nm_id=%s err=%s", nm_id, str(e))

            repo.set_media_state(company, state=st)

        repo.finish_with_winner(company, winner_order)
        return winner_order

    @staticmethod
    def parse_stats_totals(stats_resp: Any, advert_id: int) -> Tuple[int, int]:
        if isinstance(stats_resp, list):
            for item in stats_resp:
                if isinstance(item, dict) and int(item.get("advertId") or 0) == int(advert_id):
                    shows = int(item.get("views") or item.get("shows") or 0)
                    clicks = int(item.get("clicks") or 0)
                    return shows, clicks
            return 0, 0

        if isinstance(stats_resp, dict):
            inner = stats_resp.get("result") or stats_resp.get("data") or stats_resp.get("items")
            if isinstance(inner, list):
                return PromotionService.parse_stats_totals(inner, advert_id)
        return 0, 0
