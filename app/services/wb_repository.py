from __future__ import annotations

from typing import List, Dict, Any, Optional
from pathlib import Path
import logging
import mimetypes
import time

import requests

from app.core.config import settings

logger = logging.getLogger("wbai.wb_content")


def _digits(value: str) -> str:
    """Extract only digits from a string."""
    return "".join(c for c in value if c.isdigit())


class WBRepository:
    BASE_URL = "https://content-api.wildberries.ru"


    def _get_headers(self) -> Dict[str, str]:
        """Common headers for WB Content API requests."""
        if not settings.WB_API_KEY:
            raise ValueError("WB_API_KEY not set")
        return {
            "Authorization": settings.WB_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @staticmethod
    def _raise_for_status(resp: requests.Response, prefix: str) -> None:
        if 200 <= resp.status_code < 300:
            return
        raise ValueError(f"{prefix} {resp.status_code}: {resp.text}")


    def get_cards_list_page(
        self,
        *,
        limit: int = 20,
        with_photo: int = -1,
        cursor_updated_at: Optional[str] = None,
        cursor_nm_id: Optional[int] = None,
        text_search: Optional[str] = None,
        allowed_categories_only: Optional[bool] = None,
        tag_ids: Optional[List[int]] = None,
        object_ids: Optional[List[int]] = None,
        brands: Optional[List[str]] = None,
        imt_id: Optional[int] = None,
    ) -> Dict[str, Any]:

        url = f"{self.BASE_URL}/content/v2/get/cards/list"
        headers = self._get_headers()

        settings: Dict[str, Any] = {
            "sort": {"ascending": False}, 
            "filter": {
                "withPhoto": int(with_photo),
            },
            "cursor": {
                "limit": int(limit),
            },
        }

        if text_search:
            settings["filter"]["textSearch"] = str(text_search)

        if allowed_categories_only is not None:
            settings["filter"]["allowedCategoriesOnly"] = bool(allowed_categories_only)

        if tag_ids:
            settings["filter"]["tagIDs"] = [int(x) for x in tag_ids]

        if object_ids:
            settings["filter"]["objectIDs"] = [int(x) for x in object_ids]

        if brands:
            settings["filter"]["brands"] = [str(x) for x in brands if str(x).strip()]

        if imt_id is not None:
            settings["filter"]["imtID"] = int(imt_id)

        if cursor_updated_at:
            settings["cursor"]["updatedAt"] = cursor_updated_at
        if cursor_nm_id is not None:
            settings["cursor"]["nmID"] = int(cursor_nm_id)

        body = {"settings": settings}

        t0 = time.perf_counter()
        resp = requests.post(url, headers=headers, json=body, timeout=30)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        logger.info("WB CONTENT -> POST %s status=%s in %sms", url, resp.status_code, dt_ms)

        self._raise_for_status(resp, "WB cards/list error")
        data = resp.json() if resp.text else {}

        if isinstance(data, dict) and data.get("error"):
            raise ValueError(f"WB API error: {data.get('errorText')}")

        return data

    def get_cards_by_article(self, article: str, *, with_photo: int = -1, limit: int = 20) -> List[Dict[str, Any]]:
        data = self.get_cards_list_page(limit=limit, with_photo=with_photo, text_search=str(article))
        return data.get("cards", [])


    def get_card_by_article(self, article: str) -> Dict[str, Any]:
        cards = self.get_cards_by_article(article)
        if not cards:
            raise ValueError(f"Card with article/textSearch '{article}' not found in WB API")

        article_lower = str(article).strip().lower()

        for card in cards:
            vendor_code = str(card.get("vendorCode", "")).strip().lower()
            if vendor_code == article_lower:
                return card

        nm_id: Optional[int] = None
        try:
            nm_id = int(article)
        except Exception:
            nm_id = None

        if nm_id is not None:
            for card in cards:
                if card.get("nmID") == nm_id:
                    return card

        return cards[0]

    def get_card_by_nm_id(self, nm_id: int) -> Dict[str, Any]:
        cards = self.get_cards_by_article(str(nm_id))
        for card in cards:
            if card.get("nmID") == nm_id:
                return card
        raise ValueError(f"Card {nm_id} not found")

    def update_cards(self, cards: List[Dict[str, Any]]) -> Dict[str, Any]:
        """POST /content/v2/cards/update"""
        url = f"{self.BASE_URL}/content/v2/cards/update"
        headers = self._get_headers()
        resp = requests.post(url, headers=headers, json=cards, timeout=30)
        self._raise_for_status(resp, "WB update error")

        data = resp.json()
        if isinstance(data, dict) and data.get("error"):
            raise ValueError(f"WB update failed: {data.get('errorText')}")
        return data

    # ------------------------------------------------------------------
    # Subject charcs
    # ------------------------------------------------------------------
    def get_subject_charcs(self, subject_id: int) -> List[Dict[str, Any]]:
        """GET /content/v2/object/charcs/{subject_id}"""
        headers = self._get_headers()
        url = f"{self.BASE_URL}/content/v2/object/charcs/{subject_id}"

        resp = requests.get(url, headers=headers, timeout=30)
        self._raise_for_status(resp, "WB charcs error")
        data = resp.json()

        if isinstance(data, dict) and data.get("error"):
            raise ValueError(f"WB API error: {data.get('errorText')}")

        raw_charcs = data.get("data", [])
        return [{"charcID": i["charcID"], "name": i["name"], "required": i["required"]} for i in raw_charcs]

    # ------------------------------------------------------------------
    # Media
    # ------------------------------------------------------------------
    def upload_media_file(
        self,
        nm_id: int,
        photo_number: int,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        *,
        timeout: int = 90,
    ) -> Dict[str, Any]:
        """POST /content/v3/media/file (multipart)"""
        url = f"{self.BASE_URL}/content/v3/media/file"

        headers = {
            "Authorization": settings.WB_API_KEY,
            "Accept": "application/json",
            "X-Nm-Id": str(nm_id),
            "X-Photo-Number": str(int(photo_number)),
        }

        files = {"uploadfile": (filename, file_bytes, content_type)}

        t0 = time.perf_counter()
        resp = requests.post(url, headers=headers, files=files, timeout=timeout)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        logger.info(
            "WB CONTENT -> POST %s nm_id=%s photo_number=%s bytes=%s ct=%s status=%s in %sms",
            url,
            nm_id,
            photo_number,
            len(file_bytes),
            content_type,
            resp.status_code,
            dt_ms,
        )

        self._raise_for_status(resp, "WB media/file error")

        try:
            data = resp.json() if resp.text else {}
        except Exception:
            # WB sometimes returns empty body; treat as success.
            data = {}

        # If WB returned an error in JSON
        if isinstance(data, dict) and data.get("error"):
            raise ValueError(f"WB media/file failed: {data.get('errorText')}")

        return data

    def get_photo_urls(self, nm_id: int) -> List[str]:
        """Return current WB photo URLs for a card (best-effort)."""
        try:
            card = self.get_card_by_nm_id(nm_id=nm_id)
            photos = (card or {}).get("photos") or []
            urls: List[str] = []
            for p in photos:
                if not isinstance(p, dict):
                    continue
                url = p.get("big") or p.get("url") or p.get("full") or p.get("c246x328") or p.get("c516x688")
                if url:
                    urls.append(str(url))
            return urls
        except Exception as e:
            logger.warning("WB CONTENT get_photo_urls failed: nm_id=%s error=%s", nm_id, str(e))
            return []

    @staticmethod
    def _ext_from_ct(content_type: str) -> str:
        ct = (content_type or "").split(";")[0].strip().lower()
        if ct == "image/webp":
            return ".webp"
        if ct == "image/jpeg":
            return ".jpg"
        if ct == "image/png":
            return ".png"
        if ct:
            ext = mimetypes.guess_extension(ct)
            if ext:
                return ext
        return ".bin"

    def save_media_state(self, nm_id: int, urls: Optional[List[str]] = None, photos: Optional[List[str]] = None) -> Dict[str, Any]:
        """POST /content/v3/media/save.

        Backward compatible: some code calls save_media_state(nm_id, urls=...) and some calls photos=...

        Docs warning: new 'data' fully replaces old media, so you MUST send full list (old + new).
        """
        data_urls = urls if urls is not None else (photos if photos is not None else [])

        url = f"{self.BASE_URL}/content/v3/media/save"
        headers = self._get_headers()
        payload = {"nmId": int(nm_id), "data": data_urls}

        t0 = time.perf_counter()
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        logger.info("WB CONTENT -> POST %s nm_id=%s urls=%s status=%s in %sms", url, nm_id, len(data_urls), resp.status_code, dt_ms)

        self._raise_for_status(resp, "WB media/save error")
        data = resp.json() if resp.text else {}

        if isinstance(data, dict) and data.get("error"):
            raise ValueError(f"WB media/save failed: {data.get('errorText')}")
        return data
    
    def upload_photo_append(
        self,
        nm_id: int,
        content: bytes,
        content_type: str,
        *,
        filename: str | None = None,
        wait_retries: int = 15,
        wait_delay_sec: float = 2.0,
    ) -> str:
        """
        ✅ Yangi rasmni WB kartaning OXIRIGA qo'shadi va URL qaytaradi.
        
        Ishlash tartibi:
        1. Hozirgi rasmlar sonini aniqlash
        2. Yangi rasmni keyingi raqamga yuklash (append)
        3. WB serverda yangilanishini kutish
        4. Yangi rasm URL ni qaytarish
        """
        # 1. Hozirgi rasmlar sonini olamiz
        card = self.get_card_by_nm_id(nm_id)
        current_photos = card.get("photos", []) or []
        photo_number = len(current_photos) + 1

        if not filename:
            ext = self._ext_from_ct(content_type or "")
            filename = f"photo_{photo_number}{ext}"

        logger.info(
            "WB CONTENT upload_photo_append: nm_id=%s current_photos=%s next_photo_number=%s filename=%s",
            nm_id,
            len(current_photos),
            photo_number,
            filename,
        )

        # 2. Rasmni yuklaymiz (oxiriga append bo'ladi)
        self.upload_media_file(
            nm_id=nm_id,
            photo_number=int(photo_number),
            file_bytes=content,
            filename=filename,
            content_type=content_type or "application/octet-stream",
        )

        # 3. WB serverda yangilanishini kutamiz va yangi URL ni topamiz
        for attempt in range(wait_retries):
            time.sleep(wait_delay_sec)
            
            try:
                card2 = self.get_card_by_nm_id(nm_id)
                photos2 = card2.get("photos", []) or []
                
                logger.info(
                    "WB CONTENT upload_photo_append polling: attempt=%s/%s photos_count=%s (was %s)",
                    attempt + 1,
                    wait_retries,
                    len(photos2),
                    len(current_photos),
                )
                
                # Yangi rasm qo'shilganligini tekshiramiz
                if len(photos2) > len(current_photos):
                    # Oxirgi rasm - bu yangi yuklangan rasm
                    last_photo = photos2[-1]
                    wb_url = (
                        last_photo.get("big") 
                        or last_photo.get("url") 
                        or last_photo.get("full") 
                        or last_photo.get("c516x688")
                        or last_photo.get("c246x328")
                    )
                    
                    if wb_url:
                        logger.info(
                            "WB CONTENT upload_photo_append SUCCESS: nm_id=%s photo_number=%s url=%s",
                            nm_id,
                            photo_number,
                            wb_url[:100],
                        )
                        return str(wb_url)
                
                # Agar rasm topilmasa, URL pattern orqali qidiramiz
                for ph in photos2:
                    if not isinstance(ph, dict):
                        continue
                    
                    # WB URL pattern: .../big/PHOTO_NUMBER.jpg
                    u = ph.get("big") or ph.get("url") or ph.get("full") or ""
                    if u and f"/big/{photo_number}" in u:
                        logger.info(
                            "WB CONTENT upload_photo_append found by pattern: nm_id=%s photo_number=%s url=%s",
                            nm_id,
                            photo_number,
                            u[:100],
                        )
                        return str(u)
                
            except Exception as e:
                logger.warning(
                    "WB CONTENT upload_photo_append polling error: attempt=%s error=%s",
                    attempt + 1,
                    str(e),
                )
                # Davom etamiz, xato bo'lsa keyingi urinishda qayta tekshiramiz

        # Agar topilmasa, xato
        raise ValueError(
            f"WB upload_photo_append: photo uploaded but URL not found after {wait_retries} retries. "
            f"nm_id={nm_id} photo_number={photo_number}"
        )

    def upload_photo(
        self,
        *,
        nm_id: int,
        content: bytes,
        content_type: str,
        photo_number: Optional[int] = None,
        filename: Optional[str] = None,
        poll_attempts: int = 10,
        poll_sleep_sec: float = 1.0,
    ) -> str:
        """
        ✅ Backward-compatible helper.
        Agar photo_number berilmasa, oxiriga qo'shadi (upload_photo_append).
        """
        if photo_number is None:
            # Oxiriga qo'shish
            return self.upload_photo_append(
                nm_id=nm_id,
                content=content,
                content_type=content_type,
                filename=filename,
                wait_retries=poll_attempts,
                wait_delay_sec=poll_sleep_sec,
            )
        
        # Aniq photo_number berilgan bo'lsa
        before = self.get_photo_urls(nm_id=nm_id)
        before_set = set(before)

        pn = int(photo_number)
        fn = filename or f"photo_{pn}{self._ext_from_ct(content_type)}"

        self.upload_media_file(
            nm_id=nm_id,
            photo_number=pn,
            file_bytes=content,
            filename=fn,
            content_type=content_type,
        )

        # Yangi URL ni topamiz
        for _ in range(max(int(poll_attempts), 1)):
            time.sleep(poll_sleep_sec)
            
            after = self.get_photo_urls(nm_id=nm_id)
            new_urls = [u for u in after if u not in before_set]
            
            if new_urls:
                uploaded = new_urls[-1]
                logger.info("WB CONTENT upload_photo mapped: nm_id=%s photo_number=%s url=%s", nm_id, pn, uploaded)
                return uploaded
            
            # Fallback: agar count o'sgan bo'lsa
            if len(after) > len(before):
                uploaded = after[-1]
                logger.info("WB CONTENT upload_photo mapped by count: nm_id=%s photo_number=%s url=%s", nm_id, pn, uploaded)
                return uploaded

        raise ValueError(
            f"WB upload_photo: uploaded but cannot map URL. nm_id={nm_id} photo_number={pn}"
        )
    
    def list_by_subject(self, subject_id: int, locale: Optional[str] = None) -> List[Dict[str, Any]]:
        """TNVED directory list for a subject (no search filter)."""
        return self.list_tnved_directory(subject_id=subject_id, search=None, locale=locale)

    def list_tnved_directory(
        self,
        *,
        subject_id: int,
        search: Optional[str] = None,
        locale: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        GET /content/v2/directory/tnved

        - subjectID: required
        - search: optional (digits)
        - locale: optional

        Returns payload.data (list).
        """
        params = {"subjectID": int(subject_id)}
        if locale:
            params["locale"] = locale
        if search is not None:
            s = _digits(str(search))
            if s:
                # WB expects integer in many SDKs, but string works too.
                params["search"] = int(s)

        headers = {"Authorization": self.token}

        resp = self.session.get(
            f"{self.BASE_URL}/content/v2/directory/tnved",
            params=params,
            headers=headers,
            timeout=20,
        )
        resp.raise_for_status()

        payload = resp.json() or {}
        if payload.get("error"):
            raise ValueError(payload.get("errorText") or "WB TNVED directory error")

        return payload.get("data") or []

    def validate_exact(self, subject_id: int, tnved_digits: str, locale: Optional[str] = None) -> bool:
        """
        Tanlangan tnved shu subject uchun haqiqatan ham bormi (exact).
        """
        tnved_digits = _digits(tnved_digits)
        if not tnved_digits:
            return False

        params = {"subjectID": int(subject_id), "search": int(tnved_digits)}
        if locale:
            params["locale"] = locale

        headers = {"Authorization": self.token}

        resp = self.session.get(
            f"{self.BASE_URL}/content/v2/directory/tnved",
            params=params,
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()

        payload = resp.json() or {}
        if payload.get("error"):
            return False

        data = payload.get("data") or []
        for item in data:
            if _digits(str(item.get("tnved") or "")) == tnved_digits:
                return True
        return False

    @staticmethod
    def extract_tnved_candidates(data: List[Dict[str, Any]]) -> List[str]:
        """
        data[] ichidan tnved larni digits qilib chiqaradi (unique).
        """
        seen = set()
        out: List[str] = []
        for item in data:
            v = _digits(str(item.get("tnved") or ""))
            if v and v not in seen:
                seen.add(v)
                out.append(v)
        return out