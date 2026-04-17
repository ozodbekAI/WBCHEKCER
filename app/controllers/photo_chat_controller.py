from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import asyncio
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator, Awaitable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from sqlalchemy import delete

from app.core.config import settings
from app.services.photo_chat_repository import PhotoChatRepository
from app.services.gemini_api import GeminiApiError
from app.services.media_storage import (
    get_file_url,
    save_generated_metadata,
)
from app.services.photo_chat_agent import PhotoChatAgent, resolve_photo_chat_locale
from app.models.photo_chat import PhotoChatMedia, PhotoChatMessage

from app.services.scence_repositories import SceneCategoryRepository, PoseRepository
from app.services.model_repository import ModelRepository
from app.services.kie_service.kie_services import kie_service, KIEInsufficientCreditsError
from app.services.photo_error_mapper import map_photo_error
from app.services.media_storage import save_generated_file

logger = logging.getLogger("photo.chat.controller")


_PHOTO_CHAT_UI_TEXT = {
    "clarify_request": {
        "en": "Could you clarify exactly what you'd like me to change or create?",
        "ru": "Уточните, пожалуйста, что именно нужно изменить или создать.",
        "uz": "Iltimos, aynan nimani o'zgartirish yoki yaratish kerakligini aniqlashtirib bering.",
    },
    "need_asset": {
        "en": "Please send the photo you'd like me to work with.",
        "ru": "Пришлите фото, с которым нужно работать.",
        "uz": "Ishlashim kerak bo'lgan rasmni yuboring.",
    },
    "missing_source": {
        "en": "I couldn't find the selected photo. Please send it again.",
        "ru": "Не нашёл выбранное фото. Пришлите фото ещё раз.",
        "uz": "Tanlangan rasm topilmadi. Iltimos, uni yana yuboring.",
    },
    "need_two_photos": {
        "en": "I need two photos: the garment and the model. Please attach both and try again.",
        "ru": "Нужно 2 фото: изделие (одежда) и фотомодель. Прикрепите оба и попробуйте снова.",
        "uz": "Menga 2 ta rasm kerak: kiyim va model. Ikkalasini ham biriktirib, yana urinib ko'ring.",
    },
    "uploaded_photos_missing": {
        "en": "I couldn't find the uploaded photos.",
        "ru": "Не найдены загруженные фото.",
        "uz": "Yuklangan rasmlar topilmadi.",
    },
    "prompt_required": {
        "en": "Prompt is required.",
        "ru": "Промпт не указан.",
        "uz": "Prompt ko'rsatilmagan.",
    },
    "quick_action_unsupported": {
        "en": "This quick action isn't supported in stream yet.",
        "ru": "Эта быстрая команда пока не поддерживается в stream.",
        "uz": "Bu tezkor amal hali stream rejimida qo'llab-quvvatlanmaydi.",
    },
    "planner_failed": {
        "en": "I couldn't process that request. Please try again.",
        "ru": "Не получилось обработать запрос. Попробуйте ещё раз.",
        "uz": "So'rovni qayta ishlay olmadim. Iltimos, yana urinib ko'ring.",
    },
    "limit_reached": {
        "en": "The message limit has been reached. Delete some messages or clear the chat to continue.",
        "ru": "Лимит сообщений достигнут. Удалите лишние сообщения или очистите чат, чтобы продолжить.",
        "uz": "Xabarlar limiti tugadi. Davom etish uchun bir nechta xabarni o'chiring yoki chatni tozalang.",
    },
    "assets_received_question": {
        "en": "I received {count} photo(s). What would you like me to do with them?",
        "ru": "Я получил {count} фото. Что нужно сделать с ними?",
        "uz": "Men {count} ta rasm oldim. Ular bilan nima qilishimni xohlaysiz?",
    },
    "write_what_to_do": {
        "en": "Please tell me what you'd like to do.",
        "ru": "Напишите, что нужно сделать.",
        "uz": "Nima qilish kerakligini yozing.",
    },
    "understood": {
        "en": "Understood.",
        "ru": "Понял.",
        "uz": "Tushundim.",
    },
    "generation_done": {
        "en": "Done: {current}/{total}",
        "ru": "Готово: {current}/{total}",
        "uz": "Tayyor: {current}/{total}",
    },
    "change_pose": {
        "en": "Change pose",
        "ru": "Сменить позу",
        "uz": "Pozani o'zgartirish",
    },
    "change_background": {
        "en": "Change background",
        "ru": "Сменить фон",
        "uz": "Fonini o'zgartirish",
    },
    "put_on_model": {
        "en": "Put on model",
        "ru": "Надеть на модель",
        "uz": "Modelga kiydirish",
    },
    "enhance_quality": {
        "en": "Enhance quality",
        "ru": "Улучшение качества",
        "uz": "Sifatni yaxshilash",
    },
    "normalize_own_model": {
        "en": "Own model normalization",
        "ru": "Нормализация: своя фотомодель",
        "uz": "O'z modeli bilan normallashtirish",
    },
    "create_video_from_photo": {
        "en": "Create video from photo",
        "ru": "Создать видео из фото",
        "uz": "Rasmdan video yaratish",
    },
    "video_generation": {
        "en": "Video generation",
        "ru": "Генерация видео",
        "uz": "Video generatsiyasi",
    },
}


def _user_id(user: Any) -> Optional[int]:
    if user is None:
        return None
    if isinstance(user, dict):
        return user.get("user_id") or user.get("id")
    return getattr(user, "id", None)


def _sse(data: Dict[str, Any]) -> str:
    payload = json.dumps(data or {}, ensure_ascii=False)
    return f"event: message\ndata: {payload}\n\n"


def _short_payload(value: Any, *, max_len: int = 500) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = str(value)
    if len(text) <= max_len:
        return text
    return f"{text[:max_len]}...(+{len(text) - max_len} chars)"


def _normalize_base_url(base_url: str | None = None) -> str | None:
    raw = (base_url or "").strip()
    if not raw:
        return None
    return raw.rstrip("/")


def _coerce_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _ui_locale(locale: str | None) -> str:
    normalized = (locale or "en").strip().lower()
    if normalized.startswith("ru"):
        return "ru"
    if normalized.startswith("uz"):
        return "uz"
    return "en"


def _photo_chat_text(key: str, locale: str | None, **kwargs: Any) -> str:
    variants = _PHOTO_CHAT_UI_TEXT.get(key) or {}
    template = variants.get(_ui_locale(locale)) or variants.get("en") or key
    try:
        return template.format(**kwargs)
    except Exception:
        return template


@dataclass
class StreamState:
    request_id: str
    thread_id: int
    base_url: str | None = None
    context_state: Dict[str, Any] = field(default_factory=dict)


MAX_REMOTE_BYTES = 15 * 1024 * 1024

# Chat history is intentionally unlimited. Set an integer to restore a hard cap.
MAX_CHAT_MESSAGES: Optional[int] = None

ALLOWED_REMOTE_HOST_SUFFIXES = (
    "wbbasket.ru",
    "wbstatic.net",
    "wildberries.ru",
    "wb.ru",
)

def _is_allowed_remote_host(host: str, *, base_url: str | None = None) -> bool:
    host = (host or "").lower()
    if not host:
        return False

    public_hosts: set[str] = set()
    for candidate in (_normalize_base_url(base_url), settings.MEDIA_PUBLIC_BASE_URL, settings.PUBLIC_BASE_URL):
        try:
            public_host = (urlparse(candidate or "").hostname or "").lower()
        except Exception:
            public_host = ""
        if public_host:
            public_hosts.add(public_host)

    if host in public_hosts:
        return True

    return any(host == suffix or host.endswith(f".{suffix}") for suffix in ALLOWED_REMOTE_HOST_SUFFIXES)


def _resolve_local_media_path(source_url: str, *, base_url: str | None = None) -> Optional[Path]:
    if not source_url:
        return None

    raw = source_url.strip()
    parsed = urlparse(raw)

    if parsed.scheme in ("http", "https") and parsed.path.startswith("/media/"):
        host = (parsed.hostname or "").lower()
        public_hosts: set[str] = set()
        for candidate in (_normalize_base_url(base_url), settings.MEDIA_PUBLIC_BASE_URL, settings.PUBLIC_BASE_URL):
            try:
                public_host = (urlparse(candidate or "").hostname or "").lower()
            except Exception:
                public_host = ""
            if public_host:
                public_hosts.add(public_host)
        if host and public_hosts and host not in public_hosts:
            return None
        raw_path = parsed.path
    elif raw.startswith("/media/"):
        raw_path = raw
    else:
        return None

    rel = raw_path[len("/media/") :].lstrip("/").replace("\\", "/")
    if not rel or ".." in Path(rel).parts:
        return None

    media_root = Path(settings.MEDIA_ROOT).resolve()
    full_path = (media_root / rel).resolve()
    if not str(full_path).startswith(str(media_root) + os.sep) and full_path != media_root:
        return None
    return full_path


def _is_chat_locked(message_count: int) -> bool:
    return MAX_CHAT_MESSAGES is not None and message_count >= MAX_CHAT_MESSAGES


async def _download_image_bytes(source_url: str, *, base_url: str | None = None) -> Tuple[bytes, str]:
    parsed = urlparse(source_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Unsupported URL scheme")
    host = (parsed.hostname or "").lower()
    if not _is_allowed_remote_host(host, base_url=base_url):
        raise ValueError("Unsupported URL host")

    timeout = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(source_url)
        resp.raise_for_status()

        final_host = (resp.url.host or "").lower()
        if not _is_allowed_remote_host(final_host, base_url=base_url):
            raise ValueError("Redirected to an unsupported host")

        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if not content_type.startswith("image/"):
            raise ValueError("URL does not point to an image")

        chunks: list[bytes] = []
        total = 0
        async for chunk in resp.aiter_bytes():
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_REMOTE_BYTES:
                raise ValueError("Image is too large")
            chunks.append(chunk)

        ext = os.path.splitext(resp.url.path)[1].lower() or ".jpg"
        return b"".join(chunks), ext


def _save_bytes_to_media_photos(content: bytes, ext: str) -> str:
    safe_ext = (ext or "").lower()
    if safe_ext and not safe_ext.startswith("."):
        safe_ext = f".{safe_ext}"
    if safe_ext not in (".jpg", ".jpeg", ".png", ".webp"):
        safe_ext = ".jpg"

    file_name = f"chat_{uuid.uuid4().hex}{safe_ext}"
    relpath = f"photos/{file_name}"
    abs_path = os.path.join(settings.MEDIA_ROOT, relpath)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(content)
    return relpath


@dataclass
class PlannerResult:
    intent: str
    assistant_message: str = ""
    image_prompt: Optional[str] = None
    image_count: Optional[int] = None
    selected_asset_ids: List[int] | None = None
    aspect_ratio: Optional[str] = None


class PhotoChatController:
    def __init__(self) -> None:
        self._agent = PhotoChatAgent(api_key=settings.GEMINI_API_KEY)

    async def close(self) -> None:
        await self._agent.close()

    def _emit(self, state: StreamState, message_type: str, **payload: Any) -> str:
        body = {
            "type": message_type,
            "request_id": state.request_id,
            "thread_id": state.thread_id,
        }
        body.update(payload)
        return _sse(body)

    def _resolve_thread(
        self,
        repo: PhotoChatRepository,
        *,
        session_id: int,
        requested_thread_id: int | None = None,
    ):
        if requested_thread_id is None:
            return repo.get_or_create_active_thread(session_id)

        thread = repo.get_thread(requested_thread_id, session_id=session_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Photo chat thread not found")
        return thread

    def _thread_message_count(self, repo: PhotoChatRepository, thread_id: int) -> int:
        try:
            return len(repo.list_thread_messages(thread_id, limit=None))
        except Exception:
            return 0

    def _serialize_asset(self, media: PhotoChatMedia, *, base_url: str | None = None) -> Dict[str, Any]:
        meta = media.meta if isinstance(media.meta, dict) else {}
        return {
            "asset_id": media.id,
            "seq": media.seq,
            "kind": media.kind,
            "source": media.source,
            "file_url": get_file_url(media.relpath, base_url=base_url),
            "file_name": os.path.basename(media.relpath),
            "prompt": media.prompt,
            "caption": (meta.get("caption") or meta.get("summary") or "") if isinstance(meta, dict) else "",
            "meta": meta,
        }

    def _serialize_message(self, message) -> Dict[str, Any]:
        return {
            "id": message.id,
            "role": message.role,
            "msg_type": message.msg_type,
            "content": message.content,
            "meta": message.meta,
            "thread_id": getattr(message, "thread_id", None),
            "request_id": getattr(message, "request_id", None),
            "created_at": getattr(message, "created_at", None).isoformat() if getattr(message, "created_at", None) else None,
        }

    def _serialize_thread_history(
        self,
        *,
        session_key: str,
        thread_id: int,
        active_thread_id: int,
        context_state: Dict[str, Any],
        messages: List[Dict[str, Any]],
        assets: List[Dict[str, Any]],
        message_count: int,
    ) -> Dict[str, Any]:
        return {
            "session_key": session_key,
            "thread_id": thread_id,
            "active_thread_id": active_thread_id,
            "context_state": context_state,
            "message_count": message_count,
            "limit": MAX_CHAT_MESSAGES,
            "locked": _is_chat_locked(message_count),
            "messages": messages,
            "assets": assets,
        }

    def _asset_to_planner_asset(self, media: PhotoChatMedia, *, base_url: str | None = None) -> Dict[str, Any]:
        meta = media.meta if isinstance(media.meta, dict) else {}
        return {
            "asset_id": media.id,
            "seq": media.seq,
            "url": get_file_url(media.relpath, base_url=base_url),
            "source": media.source,
            "caption": (meta.get("caption") or meta.get("summary") or "") if isinstance(meta, dict) else "",
            "tags": (meta.get("tags") or []) if isinstance(meta, dict) else [],
            "colors": (meta.get("colors") or []) if isinstance(meta, dict) else [],
            "clothing": (meta.get("clothing") or "") if isinstance(meta, dict) else "",
            "background": (meta.get("background") or "") if isinstance(meta, dict) else "",
            "pose": (meta.get("pose") or "") if isinstance(meta, dict) else "",
            "kind": media.kind,
        }

    def _update_context_state(
        self,
        repo: PhotoChatRepository,
        state: StreamState,
        *,
        context: Dict[str, Any] | None = None,
        **changes: Any,
    ) -> Dict[str, Any]:
        state.context_state = repo.update_thread_context(state.thread_id, context=context, **changes)
        return state.context_state

    def _response_locale(
        self,
        *,
        user_message: str = "",
        history: Optional[List[Dict[str, Any]]] = None,
        thread_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        return resolve_photo_chat_locale(
            user_message=user_message,
            history=history,
            thread_context=thread_context,
        )

    def _text(
        self,
        key: str,
        *,
        locale: str | None = None,
        user_message: str = "",
        history: Optional[List[Dict[str, Any]]] = None,
        thread_context: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> str:
        resolved_locale = locale or self._response_locale(
            user_message=user_message,
            history=history,
            thread_context=thread_context,
        )
        return _photo_chat_text(key, resolved_locale, **kwargs)

    async def upload_asset(
        self,
        *,
        user: Any,
        db,
        client_session_id: str | None,
        base_url: str | None,
        content: bytes,
        filename: str,
        content_type: str,
    ) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            raise ValueError("Unauthorized")

        # Canonical session = user_id (stable across reloads/browsers)
        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)

        # Stable session identifier (legacy clients used client_session_id).
        client_session_id = str(uid)

        _name, ext = os.path.splitext(filename or "")
        if not ext:
            if (content_type or "").lower() == "image/png":
                ext = ".png"
            elif (content_type or "").lower() == "image/webp":
                ext = ".webp"
            else:
                ext = ".jpg"

        rel = _save_bytes_to_media_photos(content, ext)
        url = get_file_url(rel, base_url=base_url)

        desc = {}
        try:
            desc = await self._agent.describe_image_rich(content, content_type or "image/jpeg")
        except Exception:
            desc = {}

        caption = (desc.get("summary") or "").strip()
        meta = ({"caption": caption, **desc} if desc else ({"caption": caption} if caption else None))

        media = repo.add_media(
            session_id=sess.id,
            relpath=rel,
            kind="image",
            source="user",
            source_url=None,
            prompt=None,
            meta=meta,
        )
        db.commit()

        # IMPORTANT: upload/import should NOT create chat messages.
        # Messages are created only when the user sends a chat request.

        save_generated_metadata(rel, {
            "source": "user",
            "user_id": uid,
            "client_session_id": str(uid),
            "asset_id": media.id,
            "seq": media.seq,
            **(meta or {})
        })

        return {
            "asset_id": media.id,
            "seq": media.seq,
            "file_url": url,
            "file_name": os.path.basename(rel),
            "caption": caption or None,
        }

    async def import_asset_from_url(
        self,
        *,
        user: Any,
        db,
        client_session_id: str | None,
        source_url: str,
        base_url: str | None = None,
    ) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            raise ValueError("Unauthorized")

        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)
        logger.info("import_asset_from_url: user=%s, session=%s, source_url=%s", uid, sess.id, source_url)

        # (Опционально) идемпотентность: если уже импортировали этот url в ЛЮБУЮ session — возвращаем имеющийся
        # ✅ ВАЖНО: ищем в ANY session пользователя, не только в текущей
        existing = repo.find_media_by_source_url_any_session(user_id=uid, source_url=source_url)
        if existing:
            logger.info("import_asset_from_url: found existing media in session=%s, asset_id=%s", existing.session_id, existing.id)
            # Проверяем, в этой ли session? Если нет, то нужно её перенести или создать ссылку?
            # Для совместимости: просто возвращаем существующий asset_id, он будет работать при fetch_media_bytes
            return {
                "asset_id": existing.id,
                "seq": existing.seq,
                "file_url": get_file_url(existing.relpath, base_url=base_url),
                "file_name": os.path.basename(existing.relpath),
                "caption": ((existing.meta or {}).get("caption") if isinstance(existing.meta, dict) else None),
            }

        local_path = _resolve_local_media_path(source_url, base_url=base_url)
        if local_path and local_path.exists() and local_path.is_file():
            content = local_path.read_bytes()
            ext = local_path.suffix.lower() or ".jpg"
            content_type = "image/jpeg"
        else:
            content, ext = await _download_image_bytes(source_url, base_url=base_url)
            content_type = "image/webp" if ext == ".webp" else ("image/png" if ext == ".png" else "image/jpeg")

        rel = _save_bytes_to_media_photos(content, ext)
        url = get_file_url(rel, base_url=base_url)

        # сначала описание
        desc = {}
        try:
            desc = await self._agent.describe_image_rich(content, content_type)
        except Exception:
            desc = {}

        caption = (desc.get("summary") or "").strip()
        meta = ({"caption": caption, **desc} if desc else ({"caption": caption} if caption else None))

        # ✅ сначала создаём media
        media = repo.add_media(
            session_id=sess.id,
            relpath=rel,
            kind="image",
            source="import",
            source_url=source_url,
            prompt=None,
            meta=(meta if meta else {"source_url": source_url}),
        )

        db.commit()

        # ✅ metadata-файл тоже после media
        save_generated_metadata(rel, {
            "source": "import",
            "user_id": uid,
            "client_session_id": str(uid),
            "asset_id": media.id,
            "seq": media.seq,
            "source_url": source_url,
            **(meta or {}),
        })

        logger.info("import_asset_from_url: created new media in session=%s, asset_id=%s, source_url=%s", sess.id, media.id, source_url)

        return {
            "asset_id": media.id,
            "seq": media.seq,
            "file_url": url,
            "file_name": os.path.basename(rel),
            "caption": caption or None,
        }

    async def _load_recent_image_bytes(
        self,
        media_map: Dict[int, PhotoChatMedia],
        asset_ids: List[int],
        *,
        base_url: str | None = None,
        max_items: int = 4,
    ) -> List[Tuple[int, bytes, str]]:
        recent_image_bytes: List[Tuple[int, bytes, str]] = []

        for aid in asset_ids[:max_items]:
            media = media_map.get(int(aid))
            if not media or not media.relpath or media.kind != "image":
                continue

            abs_path = os.path.join(settings.MEDIA_ROOT, media.relpath)
            if os.path.exists(abs_path):
                try:
                    with open(abs_path, "rb") as file_obj:
                        recent_image_bytes.append((int(aid), file_obj.read(), "image/jpeg"))
                    continue
                except Exception as exc:
                    logger.warning("Failed to read local image bytes asset_id=%s: %s", aid, exc)

            try:
                url = get_file_url(media.relpath, base_url=base_url)
                raw = await self._agent.fetch_url_bytes(url)
                recent_image_bytes.append((int(aid), raw, "image/jpeg"))
            except Exception as exc:
                logger.warning("Failed to fetch image bytes asset_id=%s: %s", aid, exc)
                if media.source_url:
                    try:
                        raw = await self._agent.fetch_url_bytes(media.source_url)
                        recent_image_bytes.append((int(aid), raw, "image/jpeg"))
                        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                        with open(abs_path, "wb") as file_obj:
                            file_obj.write(raw)
                    except Exception as recovery_exc:
                        logger.error("Failed to recover image bytes asset_id=%s: %s", aid, recovery_exc)

        return recent_image_bytes

    async def _build_planner_context(
        self,
        repo: PhotoChatRepository,
        *,
        session_id: int,
        thread_id: int,
        current_asset_ids: List[int] | None = None,
        base_url: str | None = None,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
        messages = repo.list_thread_messages(thread_id, limit=None)[-12:]
        context_state = repo.get_thread_context(thread_id)
        media_map = {int(media.id): media for media in repo.list_media(session_id, limit=None)}

        hist: List[Dict[str, Any]] = []
        ordered_asset_ids: List[int] = []
        seen_asset_ids: set[int] = set()

        def _push_asset_id(value: Any) -> None:
            asset_id = _coerce_int(value)
            if asset_id is None or asset_id in seen_asset_ids:
                return
            if asset_id not in media_map:
                return
            seen_asset_ids.add(asset_id)
            ordered_asset_ids.append(asset_id)

        for asset_id in current_asset_ids or []:
            _push_asset_id(asset_id)
        for asset_id in context_state.get("working_asset_ids") or []:
            _push_asset_id(asset_id)
        _push_asset_id(context_state.get("last_generated_asset_id"))

        for message in messages:
            role = "user" if message.role == "user" else "model"
            meta = message.meta if isinstance(message.meta, dict) else {}
            asset_ids = meta.get("asset_ids") if isinstance(meta, dict) else None
            text = str(message.content or "")
            if (text and text.strip()) or asset_ids:
                hist.append({"role": role, "text": text, "asset_ids": asset_ids})
            for asset_id in asset_ids or []:
                _push_asset_id(asset_id)

        assets = [self._asset_to_planner_asset(media_map[asset_id], base_url=base_url) for asset_id in ordered_asset_ids]
        return hist, assets, context_state

    async def _await_kie_with_progress(
        self,
        *,
        state: StreamState,
        action: str,
        request_coro: Awaitable[dict],
        result_holder: Dict[str, Any],
    ) -> AsyncGenerator[str, None]:
        poll_interval = max(1, int(settings.KIE_POLL_INTERVAL_SECONDS or 10))
        attempt = 0
        task = asyncio.create_task(request_coro)
        logger.info(
            "quick_action awaiting KIE result | request=%s action=%s",
            state.request_id,
            action,
        )
        try:
            while True:
                done, _ = await asyncio.wait(
                    {task},
                    timeout=poll_interval,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if task in done:
                    result_holder["result"] = await task
                    return

                attempt += 1
                logger.info(
                    "quick_action still waiting for KIE result | request=%s action=%s attempt=%s",
                    state.request_id,
                    action,
                    attempt,
                )
                yield self._emit(
                    state,
                    "image_started",
                    index=attempt,
                    total=0,
                    prompt="Обработка на стороне KIE продолжается",
                )
        finally:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    async def _handle_quick_action(
        self,
        *,
        user_id: int,
        client_session_id: str,
        db,
        repo: PhotoChatRepository,
        sess,
        state: StreamState,
        message: str,
        asset_ids: list[int],
        quick_action: Dict[str, Any],
    ) -> AsyncGenerator[str, None]:
        action_type = (quick_action.get("type") or quick_action.get("action") or "").strip().lower().replace("_", "-")
        action_aliases = {
            "create_video": "generate-video",
            "create-video": "generate-video",
            "change-background": "change-background",
            "change-pose": "change-pose",
            "put-on-model": "put-on-model",
            "enhance": "enhance",
            "normalize-own-model": "normalize-own-model",
            "custom-generation": "custom-generation",
            "generate-video": "generate-video",
        }
        action_type = action_aliases.get(action_type, action_type)
        if action_type == "create-video":
            action_type = "generate-video"
        response_locale = self._response_locale(
            user_message=message,
            thread_context=state.context_state,
        )

        def _emit_error(raw_error: Any) -> str:
            mapped = map_photo_error(raw_error, context=f"quick_action:{action_type or 'unknown'}")
            logger.warning(
                "photo quick_action mapped error | action=%s code=%s raw=%s",
                action_type or "unknown",
                mapped.get("code"),
                str(raw_error or ""),
            )
            return self._emit(
                state,
                "error",
                message=mapped.get("message"),
                code=mapped.get("code"),
                retryable=bool(mapped.get("retryable", True)),
                error=mapped,
            )

        if not action_type:
            yield _emit_error("quick_action.type is required")
            return

        selected_ids: list[int] = list(asset_ids or [])
        if not selected_ids:
            selected_ids.extend([int(x) for x in (state.context_state.get("working_asset_ids") or []) if str(x).isdigit()])
        if not selected_ids:
            try:
                msgs = repo.list_thread_messages(state.thread_id, limit=None)
                for m in reversed(msgs):
                    meta = m.meta if isinstance(m.meta, dict) else {}
                    ids = meta.get("asset_ids")
                    if isinstance(ids, list) and ids:
                        selected_ids = [int(x) for x in ids if str(x).isdigit()]
                        break
            except Exception:
                selected_ids = []
        if not selected_ids:
            last_generated_id = _coerce_int(state.context_state.get("last_generated_asset_id"))
            if last_generated_id is not None:
                selected_ids = [last_generated_id]

        if not selected_ids:
            q = self._text("need_asset", locale=response_locale)
            model_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="model",
                content=q,
                msg_type="text",
            )
            self._update_context_state(
                repo,
                state,
                pending_question=q,
                last_action={"type": action_type, "status": "needs_asset"},
            )
            db.commit()
            yield self._emit(state, "question", content=q, message_id=model_msg.id)
            return

        media_list = repo.list_media(sess.id, limit=None)
        media_map = {int(m.id): m for m in media_list}
        src_media = media_map.get(int(selected_ids[0]))
        if not src_media:
            q = self._text("missing_source", locale=response_locale)
            model_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="model",
                content=q,
                msg_type="text",
            )
            self._update_context_state(
                repo,
                state,
                pending_question=q,
                last_action={"type": action_type, "status": "missing_source"},
            )
            db.commit()
            yield self._emit(state, "question", content=q, message_id=model_msg.id)
            return

        src_url = get_file_url(src_media.relpath, base_url=state.base_url)
        logger.info(
            "quick_action resolved source | action=%s request=%s user=%s thread=%s asset=%s relpath=%s src_url=%s",
            action_type,
            state.request_id,
            user_id,
            state.thread_id,
            src_media.id,
            src_media.relpath,
            src_url,
        )

        def _short(v: Any, max_len: int = 240) -> str:
            text = str(v) if v is not None else ""
            if len(text) <= max_len:
                return text
            return f"{text[:max_len]}...(+{len(text) - max_len} chars)"

        async def _persist_and_emit(
            out_bytes: bytes,
            prompt_text: str,
            *,
            media_type: str = "image",
        ) -> AsyncGenerator[str, None]:
            rel_path = save_generated_file(out_bytes, kind=media_type)
            url = get_file_url(rel_path, base_url=state.base_url)

            gen_media = repo.add_media(
                session_id=sess.id,
                relpath=rel_path,
                kind=media_type,
                source="generated",
                source_url=None,
                prompt=prompt_text,
                meta={
                    "source_asset_ids": selected_ids,
                    "quick_action": {"type": action_type, **{k: v for k, v in quick_action.items() if k != "type"}},
                },
            )

            img_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="model",
                content=None,
                msg_type="image",
                meta={"asset_ids": [gen_media.id]},
            )
            repo.set_last_generated(sess.id, rel_path)
            context_state = self._update_context_state(
                repo,
                state,
                last_generated_asset_id=gen_media.id,
                working_asset_ids=[gen_media.id],
                pending_question=None,
                last_action={
                    "type": action_type,
                    "status": "completed",
                    "source_asset_ids": selected_ids,
                    "generated_asset_id": gen_media.id,
                    "media_type": media_type,
                },
            )
            db.commit()

            try:
                save_generated_metadata(
                    rel_path,
                    {
                        "source": "kie",
                        "user_id": user_id,
                        "client_session_id": client_session_id,
                        "thread_id": state.thread_id,
                        "request_id": state.request_id,
                        "asset_id": gen_media.id,
                        "seq": gen_media.seq,
                        "prompt": prompt_text,
                        "quick_action": action_type,
                        "media_type": media_type,
                    },
                )
            except Exception:
                pass

            yield self._emit(
                state,
                "generation_complete",
                image_url=url,
                file_name=os.path.basename(rel_path),
                prompt=prompt_text,
                asset_id=gen_media.id,
                message_id=img_msg.id,
                media_type=media_type,
            )
            yield self._emit(state, "context_state", context_state=context_state)

        try:
            if action_type == "change-pose":
                prompt_id = quick_action.get("pose_prompt_id") or quick_action.get("prompt_id")
                try:
                    prompt_id = int(prompt_id)
                except Exception:
                    prompt_id = 0
                if not prompt_id:
                    yield _emit_error("pose_prompt_id is required")
                    return

                pose_repo = PoseRepository(db)
                pose_prompt = pose_repo.get_prompt(prompt_id)
                if not pose_prompt:
                    yield _emit_error("Pose prompt not found")
                    return

                prompt_text = getattr(pose_prompt, "name", None) or getattr(pose_prompt, "prompt", "") or self._text(
                    "change_pose",
                    locale=response_locale,
                )

                yield self._emit(state, "generation_start", prompt=prompt_text)
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s payload=%s prompt=%s",
                    state.request_id,
                    user_id,
                    "change_pose",
                    quick_action,
                    _short(prompt_id),
                )
                result_container: dict[str, Any] = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="change_pose",
                    request_coro=kie_service.change_pose(src_url, pose_prompt.prompt, max_attempts=0),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_container.get("result", {})
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "change_pose",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "change-background":
                item_id = quick_action.get("scene_item_id") or quick_action.get("item_id")
                try:
                    item_id = int(item_id)
                except Exception:
                    item_id = 0
                if not item_id:
                    yield _emit_error("scene_item_id is required")
                    return

                scene_repo = SceneCategoryRepository(db)
                item = scene_repo.get_item(item_id)
                if not item:
                    yield _emit_error("Scene item not found")
                    return
                sub = scene_repo.get_subcategory(item.subcategory_id)
                cat = scene_repo.get_category(sub.category_id) if sub else None

                full_prompt = (
                    f"Create a professional product card. "
                    f"Scene: {getattr(cat, 'name', '')} → {getattr(sub, 'name', '')} → {getattr(item, 'name', '')}. "
                    f"{getattr(item, 'prompt', '')}"
                ).strip()

                prompt_text = " — ".join(
                    [x for x in [getattr(cat, "name", ""), getattr(sub, "name", ""), getattr(item, "name", "")] if x]
                ) or self._text("change_background", locale=response_locale)

                yield self._emit(state, "generation_start", prompt=prompt_text)
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s prompt=%s src=%s",
                    state.request_id,
                    user_id,
                    "change-background",
                    _short(full_prompt),
                    src_url,
                )
                result_container = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="change-background",
                    request_coro=kie_service.change_scene(src_url, full_prompt, max_attempts=0),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_container.get("result", {})
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "change-background",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "put-on-model":
                # Normalize item on a new model prompt (backend can also resolve model_item_id if numeric)
                model_item_id = quick_action.get("model_item_id")
                new_model_prompt = (quick_action.get("new_model_prompt") or "").strip()

                model_prompt = None
                if model_item_id:
                    try:
                        mid = int(model_item_id)
                    except Exception:
                        mid = 0
                    if mid:
                        repo_model = ModelRepository(db)
                        item = repo_model.get_item(mid)
                        if item:
                            model_prompt = getattr(item, "prompt", None)

                final_prompt = (model_prompt or new_model_prompt or "").strip()
                if not final_prompt:
                    yield _emit_error("new_model_prompt or model_item_id is required")
                    return

                yield self._emit(state, "generation_start", prompt=self._text("put_on_model", locale=response_locale))
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s prompt_type=%s final_prompt=%s src=%s",
                    state.request_id,
                    user_id,
                    "put-on-model",
                    "model_prompt",
                    _short(final_prompt),
                    src_url,
                )
                result_container = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="put-on-model",
                    request_coro=kie_service.normalize_new_model(
                        item_image_url=src_url,
                        model_prompt=final_prompt,
                        ghost_prompt_override=None,
                        new_model_prompt_override=new_model_prompt or None,
                        max_attempts=0,
                    ),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_container.get("result", {})
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "put-on-model",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, final_prompt):
                    yield chunk
                return

            if action_type == "enhance":
                level = (quick_action.get("level") or "medium").strip()
                if level not in ("light", "medium", "strong"):
                    level = "medium"
                prompt_text = self._text("enhance_quality", locale=response_locale)

                yield self._emit(state, "generation_start", prompt=prompt_text)
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s level=%s src=%s",
                    state.request_id,
                    user_id,
                    "enhance",
                    level,
                    src_url,
                )
                result_container = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="enhance",
                    request_coro=kie_service.enhance_photo(src_url, level, max_attempts=0),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_container.get("result", {})
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "enhance",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "normalize-own-model":
                if len(selected_ids) < 2:
                    q = self._text("need_two_photos", locale=response_locale)
                    model_msg = repo.add_message(
                        session_id=sess.id,
                        thread_id=state.thread_id,
                        request_id=state.request_id,
                        role="model",
                        content=q,
                        msg_type="text",
                    )
                    self._update_context_state(
                        repo,
                        state,
                        pending_question=q,
                        last_action={"type": action_type, "status": "needs_second_asset"},
                    )
                    db.commit()
                    yield self._emit(state, "question", content=q, message_id=model_msg.id)
                    return

                garment_media = media_map.get(int(selected_ids[0]))
                model_media_item = media_map.get(int(selected_ids[1]))

                if not garment_media or not model_media_item:
                    yield _emit_error(self._text("uploaded_photos_missing", locale=response_locale))
                    return

                garment_url = get_file_url(garment_media.relpath, base_url=state.base_url)
                model_url = get_file_url(model_media_item.relpath, base_url=state.base_url)
                prompt_text = self._text("normalize_own_model", locale=response_locale)

                yield self._emit(state, "generation_start", prompt=prompt_text)
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s garment=%s model=%s",
                    state.request_id,
                    user_id,
                    "normalize-own-model",
                    garment_url,
                    model_url,
                )
                result_container = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="normalize-own-model",
                    request_coro=kie_service.normalize_own_model(
                        item_image_url=garment_url,
                        model_image_url=model_url,
                        max_attempts=0,
                    ),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_container.get("result", {})
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "normalize-own-model",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "custom-generation":
                custom_prompt = (quick_action.get("prompt") or message or "").strip()
                if not custom_prompt:
                    yield _emit_error(self._text("prompt_required", locale=response_locale))
                    return
                prompt_text = custom_prompt[:100]

                yield self._emit(state, "generation_start", prompt=prompt_text)
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s prompt=%s src=%s",
                    state.request_id,
                    user_id,
                    "custom-generation",
                    _short(custom_prompt),
                    src_url,
                )
                result_container = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="custom-generation",
                    request_coro=kie_service.custom_generation(src_url, custom_prompt, max_attempts=0),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_container.get("result", {})
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "custom-generation",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "generate-video":
                video_prompt = (quick_action.get("prompt") or message or self._text("create_video_from_photo", locale=response_locale)).strip()
                video_model = quick_action.get("model") or "hailuo/minimax-video-01-live"
                video_duration = int(quick_action.get("duration") or 5)
                video_resolution = quick_action.get("resolution") or "720p"
                prompt_text = self._text("video_generation", locale=response_locale)

                yield self._emit(state, "generation_start", prompt=prompt_text)
                logger.info(
                    "quick_action call kie | request=%s user=%s action=%s video_model=%s duration=%s resolution=%s prompt=%s src=%s",
                    state.request_id,
                    user_id,
                    "generate-video",
                    video_model,
                    video_duration,
                    video_resolution,
                    _short(video_prompt),
                    src_url,
                )
                result_container = {}
                async for chunk in self._await_kie_with_progress(
                    state=state,
                    action="generate-video",
                    request_coro=kie_service.generate_video(
                        image_url=src_url,
                        prompt=video_prompt,
                        model=video_model,
                        duration=video_duration,
                        resolution=video_resolution,
                        max_attempts=0,
                    ),
                    result_holder=result_container,
                ):
                    yield chunk
                result = result_holder.get("result", {})
                out_bytes = result.get("video") or result.get("image")
                if not out_bytes:
                    yield _emit_error("No video in result")
                    return
                logger.info(
                    "quick_action result from KIE | request=%s action=%s user=%s bytes=%s",
                    state.request_id,
                    "generate-video",
                    user_id,
                    len(out_bytes),
                )

                async for chunk in _persist_and_emit(out_bytes, video_prompt, media_type="video"):
                    yield chunk
                return

            yield self._emit(state, "chat", content=self._text("quick_action_unsupported", locale=response_locale))
            return

        except KIEInsufficientCreditsError as e:
            logger.warning("quick_action insufficient credits action=%s err=%s", action_type, str(e))
            yield _emit_error(str(e))
            return
        except Exception as e:
            logger.exception("quick_action unexpected failure action=%s", action_type)
            yield _emit_error(str(e))
            return

    async def _planner(
        self, 
        user_message: str, 
        history: List[Dict[str, Any]], 
        assets: List[Dict[str, Any]],
        thread_context: Optional[Dict[str, Any]] = None,
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
    ) -> PlannerResult:
        try:
            plan = await self._agent.plan_action(
                user_message=user_message, 
                history=history, 
                assets=assets,
                thread_context=thread_context,
                recent_image_bytes=recent_image_bytes,
            )
            
            # ✅ FIX: Properly handle selected_asset_ids
            raw_ids = plan.get("selected_asset_ids")
            selected_ids = None
            if isinstance(raw_ids, list) and len(raw_ids) > 0:
                valid_ids = []
                for x in raw_ids:
                    try:
                        valid_ids.append(int(x))
                    except (ValueError, TypeError):
                        pass
                selected_ids = valid_ids if valid_ids else None

            intent = str(plan.get("intent") or "chat").strip().lower()
            assistant_message = str(plan.get("assistant_message") or "").strip()
            image_prompt = str(plan.get("image_prompt") or "").strip() or None
            locale = self._response_locale(
                user_message=user_message,
                history=history,
                thread_context=thread_context,
            )

            if intent in ("edit_image", "generate_image") and not image_prompt:
                intent = "question"
                assistant_message = assistant_message or self._text(
                    "clarify_request",
                    locale=locale,
                )

            if intent == "question" and not assistant_message:
                assistant_message = self._text(
                    "clarify_request",
                    locale=locale,
                )
            
            return PlannerResult(
                intent=intent,
                assistant_message=assistant_message,
                image_prompt=image_prompt,
                image_count=plan.get("image_count"),
                selected_asset_ids=selected_ids,
                aspect_ratio=plan.get("aspect_ratio"),
            )
        except Exception:
            try:
                txt = await self._agent.generate_text(user_message, history=history)
            except Exception:
                txt = self._text(
                    "planner_failed",
                    user_message=user_message,
                    history=history,
                    thread_context=thread_context,
                )
            return PlannerResult(intent="chat", assistant_message=txt)

    def _normalize_ar(self,ar: Optional[str]) -> Optional[str]:
        if not ar:
            return None
        a = ar.strip().lower()
        mapping = {
            "portrait": "3:4",
            "vertical": "3:4",
            "landscape": "4:3",
            "square": "1:1",
            "wb": "3:4",
        }
        if a in mapping:
            return mapping[a]
        if re.match(r"^\d+:\d+$", a):
            return a
        return None

    def _strip_multi_words(self, s: str) -> str:
        """Remove layout words that often create collages, while preserving positional image refs."""
        if not s:
            return s
        t = s
        bad_patterns = [
            r"\bside[\s-]?by[\s-]?side\b",
            r"\bcollage\b",
            r"\bgrid\b",
            r"\bsplit[\s-]?screen\b",
            r"\bdiptych\b",
            r"\btriptych\b",
            r"\bcontact sheet\b",
            r"\bmulti[\s-]?panel\b",
            r"\bmultiple frames?\b",
        ]
        for pat in bad_patterns:
            t = re.sub(pat, "", t, flags=re.IGNORECASE)
        return " ".join(t.split()).strip()

    def _pose_variants(self, n: int) -> list[str]:
        """Safe single-person poses. Each generated image gets exactly one pose."""
        base = [
            "Standing confidently, full body, hands relaxed, elegant posture",
            "Walking naturally, mid-step, full body, confident posture",
            "Seated gracefully on a chair/bench, full body visible, elegant hands",
            "Leaning slightly on a railing, looking to the side, full body",
        ]
        n = max(1, min(int(n or 1), 4))
        return base[:n]

    def _make_single_image_prompt(self, base_prompt: str, pose_text: str) -> str:
        """Keep each variant as a single image without overriding the user's requested content."""
        base_prompt = self._strip_multi_words(base_prompt or "")
        parts = [base_prompt] if base_prompt else []
        if pose_text:
            parts.append(
                f"Variant guidance: {pose_text}. Use this only if it fits the user's request and does not override explicit instructions."
            )
        parts.append(
            "Output rules:\n"
            "- Produce one final image for this variant.\n"
            "- No collage, grid, split-screen, diptych, triptych, or multi-panel layout.\n"
            "- Preserve exact positional references such as 'Image 1' and 'Image 2' if they appear.\n"
            "- For edits, change only what the task asks and keep other details unchanged unless the user requested otherwise.\n"
        )
        return "\n".join([part for part in parts if part]).strip()

    async def chat_stream(self, *, user: Any, db, payload: Dict[str, Any]) -> AsyncGenerator[str, None]:
        base_url = _normalize_base_url(payload.get("base_url"))
        request_id = str((payload.get("request_id") or "").strip() or uuid.uuid4().hex)
        requested_thread_id = _coerce_int(payload.get("thread_id"))
        uid = _user_id(user)
        incoming_asset_ids_raw = payload.get("asset_ids") or []
        quick_action = payload.get("quick_action")
        logger.info(
            "chat_stream request received | request=%s user=%s thread=%s message_len=%s quick_action=%s asset_ids=%s photo_urls=%s",
            request_id,
            uid,
            requested_thread_id,
            len(str(payload.get("message") or "")),
            _short_payload(quick_action),
            incoming_asset_ids_raw if isinstance(incoming_asset_ids_raw, list) else [incoming_asset_ids_raw],
            payload.get("photo_urls") or payload.get("photo_url"),
        )

        if uid is None:
            mapped = map_photo_error("Unauthorized", context="chat_stream")
            state = StreamState(request_id=request_id, thread_id=requested_thread_id or 0, base_url=base_url, context_state={})
            yield self._emit(
                state,
                "error",
                message=mapped.get("message"),
                code=mapped.get("code"),
                retryable=bool(mapped.get("retryable", False)),
                error=mapped,
            )
            return

        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)

        try:
            thread = self._resolve_thread(repo, session_id=sess.id, requested_thread_id=requested_thread_id)
        except HTTPException as exc:
            mapped = map_photo_error(str(exc.detail), context="chat_stream")
            state = StreamState(request_id=request_id, thread_id=requested_thread_id or 0, base_url=base_url, context_state={})
            yield self._emit(
                state,
                "error",
                message=mapped.get("message"),
                code=mapped.get("code"),
                retryable=False,
                error=mapped,
            )
            return

        state = StreamState(
            request_id=request_id,
            thread_id=thread.id,
            base_url=base_url,
            context_state=repo.get_thread_context(thread.id),
        )
        # Persist locale preference at the thread level when provided by the client.
        incoming_locale = str(payload.get("locale") or "").strip()
        if incoming_locale:
            try:
                self._update_context_state(repo, state, locale=incoming_locale)
            except Exception:
                # Locale is best-effort and must not break streaming.
                pass

        msg_count = self._thread_message_count(repo, thread.id)
        if _is_chat_locked(msg_count):
            yield self._emit(
                state,
                "limit_reached",
                limit=MAX_CHAT_MESSAGES,
                message_count=msg_count,
                message=self._text(
                    "limit_reached",
                    user_message=str(payload.get("message") or "").strip(),
                    thread_context=state.context_state,
                ),
            )
            return

        message = str(payload.get("message") or "").strip()
        client_session_id = str(int(uid))

        if not isinstance(incoming_asset_ids_raw, list):
            incoming_asset_ids_raw = [incoming_asset_ids_raw]
        incoming_asset_ids: list[int] = []
        seen_asset_ids: set[int] = set()
        for item in incoming_asset_ids_raw:
            asset_id = _coerce_int(item)
            if asset_id is None or asset_id in seen_asset_ids:
                continue
            seen_asset_ids.add(asset_id)
            incoming_asset_ids.append(asset_id)

        incoming_photo_urls_raw = payload.get("photo_urls")
        if incoming_photo_urls_raw is None:
            incoming_photo_urls_raw = payload.get("photo_url")
        if isinstance(incoming_photo_urls_raw, str):
            incoming_photo_urls = [incoming_photo_urls_raw]
        elif isinstance(incoming_photo_urls_raw, list):
            incoming_photo_urls = [str(item).strip() for item in incoming_photo_urls_raw if str(item).strip()]
        else:
            incoming_photo_urls = []

        if incoming_photo_urls:
            imported_ids: list[int] = []
            for source_url in incoming_photo_urls[:6]:
                if not source_url or source_url.startswith("blob:"):
                    continue
                try:
                    imported = await self.import_asset_from_url(
                        user=user,
                        db=db,
                        client_session_id=client_session_id,
                        source_url=source_url,
                        base_url=base_url,
                    )
                    imported_id = _coerce_int(imported.get("asset_id"))
                    if imported_id is not None and imported_id not in seen_asset_ids:
                        seen_asset_ids.add(imported_id)
                        imported_ids.append(imported_id)
                except Exception as exc:
                    logger.warning("chat_stream: failed to import photo_url=%s: %s", source_url, exc)
            incoming_asset_ids.extend(imported_ids)

        media_map = {int(media.id): media for media in repo.list_media(sess.id, limit=None)}
        asset_ids = [asset_id for asset_id in incoming_asset_ids if asset_id in media_map]
        if asset_ids:
            self._update_context_state(repo, state, working_asset_ids=asset_ids, pending_question=None)

        already_acked_user_message_id: Optional[int] = None
        prefetched_plan: Optional[PlannerResult] = None

        if not message:
            if asset_ids:
                img_msg = repo.add_message(
                    session_id=sess.id,
                    thread_id=state.thread_id,
                    request_id=state.request_id,
                    role="user",
                    content=None,
                    msg_type="image",
                    meta={"asset_ids": asset_ids},
                )
                self._update_context_state(
                    repo,
                    state,
                    pending_question=None,
                    last_action={"type": "user_assets", "asset_ids": asset_ids},
                )
                db.commit()
                already_acked_user_message_id = img_msg.id
                yield self._emit(state, "ack", user_message_id=img_msg.id)

                history, assets, context_state = await self._build_planner_context(
                    repo,
                    session_id=sess.id,
                    thread_id=state.thread_id,
                    current_asset_ids=asset_ids,
                    base_url=base_url,
                )
                state.context_state = context_state
                recent_image_bytes = await self._load_recent_image_bytes(media_map, asset_ids, base_url=base_url)
                implicit_message = f"[User sent {len(asset_ids)} image(s) without text - understand intent from context]"
                prefetched_plan = await self._planner(
                    implicit_message,
                    history,
                    assets,
                    thread_context=context_state,
                    recent_image_bytes=recent_image_bytes,
                )

                if prefetched_plan.intent in ("edit_image", "generate_image"):
                    if prefetched_plan.selected_asset_ids:
                        dedup_selected: list[int] = []
                        seen_selected: set[int] = set()
                        for item in prefetched_plan.selected_asset_ids:
                            selected_id = _coerce_int(item)
                            if selected_id is None or selected_id in seen_selected:
                                continue
                            seen_selected.add(selected_id)
                            dedup_selected.append(selected_id)
                        if dedup_selected:
                            asset_ids = dedup_selected
                            self._update_context_state(repo, state, working_asset_ids=asset_ids)
                    message = str(prefetched_plan.image_prompt or "").strip()
                else:
                    txt = prefetched_plan.assistant_message or self._text(
                        "assets_received_question",
                        history=history,
                        thread_context=context_state,
                        count=len(asset_ids),
                    )
                    model_msg = repo.add_message(
                        session_id=sess.id,
                        thread_id=state.thread_id,
                        request_id=state.request_id,
                        role="model",
                        content=txt,
                        msg_type="text",
                    )
                    self._update_context_state(
                        repo,
                        state,
                        pending_question=txt if prefetched_plan.intent == "question" else None,
                        last_action={"type": prefetched_plan.intent or "chat"},
                    )
                    db.commit()
                    yield self._emit(
                        state,
                        "question" if prefetched_plan.intent == "question" else "response",
                        content=txt,
                        message_id=model_msg.id,
                    )
                    return
            else:
                q = self._text(
                    "write_what_to_do",
                    thread_context=state.context_state,
                )
                model_msg = repo.add_message(
                    session_id=sess.id,
                    thread_id=state.thread_id,
                    request_id=state.request_id,
                    role="model",
                    content=q,
                    msg_type="text",
                )
                self._update_context_state(
                    repo,
                    state,
                    pending_question=q,
                    last_action={"type": "question", "status": "awaiting_message"},
                )
                db.commit()
                yield self._emit(state, "question", content=q, message_id=model_msg.id)
                return

        if already_acked_user_message_id is None:
            user_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="user",
                content=message,
                msg_type="image" if (not message and asset_ids) else "text",
                meta={"asset_ids": asset_ids} if asset_ids else None,
            )
            self._update_context_state(
                repo,
                state,
                pending_question=None,
                last_action={"type": "user_message"},
            )
            db.commit()
            yield self._emit(state, "ack", user_message_id=user_msg.id)

        quick_action = payload.get("quick_action")
        if quick_action is not None and not isinstance(quick_action, dict):
            logger.warning(
                "chat_stream: quick_action has unexpected type | request=%s user=%s type=%s value=%s",
                request_id,
                uid,
                type(quick_action).__name__,
                _short_payload(quick_action),
            )

        if isinstance(quick_action, dict) and (quick_action.get("type") or quick_action.get("action")):
            logger.info(
                "chat_stream dispatching to quick_action | request=%s user=%s action=%s keys=%s",
                request_id,
                uid,
                (quick_action.get("type") or quick_action.get("action")),
                sorted([str(key) for key in quick_action.keys()]),
            )
            async for chunk in self._handle_quick_action(
                user_id=uid,
                client_session_id=client_session_id,
                db=db,
                repo=repo,
                sess=sess,
                state=state,
                message=message,
                asset_ids=asset_ids,
                quick_action=quick_action,
            ):
                yield chunk
            return

        logger.info(
            "chat_stream planner path used | request=%s user=%s quick_action=%s",
            request_id,
            uid,
            _short_payload(quick_action),
        )

        history, assets, context_state = await self._build_planner_context(
            repo,
            session_id=sess.id,
            thread_id=state.thread_id,
            current_asset_ids=asset_ids,
            base_url=base_url,
        )
        state.context_state = context_state

        planner_asset_ids = [int(asset.get("asset_id")) for asset in assets if _coerce_int(asset.get("asset_id")) is not None]
        fetch_ids = asset_ids[:4] if asset_ids else planner_asset_ids[-4:]
        recent_image_bytes = await self._load_recent_image_bytes(media_map, fetch_ids, base_url=base_url)

        plan = prefetched_plan or await self._planner(
            message,
            history,
            assets,
            thread_context=context_state,
            recent_image_bytes=recent_image_bytes,
        )

        if plan.intent in ("question", "chat"):
            txt = plan.assistant_message or ""
            model_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="model",
                content=txt,
                msg_type="text",
            )
            self._update_context_state(
                repo,
                state,
                pending_question=txt if plan.intent == "question" else None,
                last_action={"type": plan.intent},
            )
            db.commit()
            yield self._emit(
                state,
                "question" if plan.intent == "question" else "chat",
                content=txt,
                message_id=model_msg.id,
            )
            return

        if plan.intent not in ("edit_image", "generate_image"):
            txt = plan.assistant_message or self._text(
                "understood",
                user_message=message,
                history=history,
                thread_context=state.context_state,
            )
            model_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="model",
                content=txt,
                msg_type="text",
            )
            self._update_context_state(repo, state, pending_question=None, last_action={"type": "chat"})
            db.commit()
            yield self._emit(state, "chat", content=txt, message_id=model_msg.id)
            return

        try:
            image_count = int(plan.image_count or 1)
        except Exception:
            image_count = 1
        image_count = max(1, min(image_count, 4))

        selected_ids = [int(item) for item in (plan.selected_asset_ids or []) if str(item).strip().isdigit()]
        if plan.intent == "edit_image":
            if not selected_ids:
                if asset_ids:
                    selected_ids = list(asset_ids)
                elif state.context_state.get("working_asset_ids"):
                    selected_ids = [int(item) for item in state.context_state.get("working_asset_ids") or [] if str(item).isdigit()]
                else:
                    for history_item in reversed(history):
                        history_asset_ids = history_item.get("asset_ids") if isinstance(history_item, dict) else None
                        if isinstance(history_asset_ids, list) and history_asset_ids:
                            selected_ids = [int(item) for item in history_asset_ids if str(item).strip().isdigit()]
                            break
                if not selected_ids:
                    last_generated_id = _coerce_int(state.context_state.get("last_generated_asset_id"))
                    if last_generated_id is not None:
                        selected_ids = [last_generated_id]

            if not selected_ids:
                q = plan.assistant_message or self._text(
                    "need_asset",
                    user_message=message,
                    history=history,
                    thread_context=state.context_state,
                )
                model_msg = repo.add_message(
                    session_id=sess.id,
                    thread_id=state.thread_id,
                    request_id=state.request_id,
                    role="model",
                    content=q,
                    msg_type="text",
                )
                self._update_context_state(
                    repo,
                    state,
                    pending_question=q,
                    last_action={"type": "question", "status": "needs_asset"},
                )
                db.commit()
                yield self._emit(state, "question", content=q, message_id=model_msg.id)
                return

        images: List[Tuple[bytes, str]] = []
        if plan.intent == "edit_image":
            images = [(raw, mime_type) for _asset_id, raw, mime_type in await self._load_recent_image_bytes(
                media_map,
                selected_ids[: getattr(settings, "GEMINI_MAX_CONTEXT_IMAGES", 6)],
                base_url=base_url,
                max_items=getattr(settings, "GEMINI_MAX_CONTEXT_IMAGES", 6),
            )]

        selected_assets = [asset for asset in assets if int(asset.get("asset_id", 0)) in selected_ids]
        enhanced_prompt = self._agent.build_rich_prompt(
            basic_prompt=plan.image_prompt or message,
            selected_assets=selected_assets,
            selected_asset_ids=selected_ids,
        )
        aspect_ratio = self._normalize_ar(plan.aspect_ratio)

        yield self._emit(state, "images_start", total=image_count)

        enhanced_prompt = self._strip_multi_words(enhanced_prompt)
        generated_asset_ids: List[int] = []

        for index in range(image_count):
            yield self._emit(state, "image_started", index=index + 1, total=image_count)

            per_image_prompt = self._make_single_image_prompt(
                base_prompt=enhanced_prompt,
                # Never force pose/framing. Follow-up edits must keep the original composition unless
                # the user explicitly asked for pose/framing changes.
                pose_text="",
            )

            def _emit_stream_error(raw_error: Any) -> str:
                mapped = map_photo_error(raw_error, context="chat_stream:generation")
                return self._emit(
                    state,
                    "error",
                    message=mapped.get("message"),
                    code=mapped.get("code"),
                    retryable=bool(mapped.get("retryable", True)),
                    error=mapped,
                    index=index + 1,
                    total=image_count,
                )

            try:
                _assistant_text, out_bytes, out_mime = await self._agent.edit_or_generate_image(
                    prompt=per_image_prompt,
                    images=images,
                    aspect_ratio=aspect_ratio,
                )
            except GeminiApiError as exc:
                logger.error("edit_or_generate_image failed: %s", str(exc).strip() or "GeminiApiError")
                yield _emit_stream_error(exc)
                return
            except Exception as exc:
                logger.exception("edit_or_generate_image failed with unexpected error")
                yield _emit_stream_error(exc)
                return

            if not out_bytes:
                logger.warning("edit_or_generate_image returned empty output bytes")
                yield _emit_stream_error("generation returned empty result")
                return

            ext = ".png"
            if (out_mime or "").lower() == "image/jpeg":
                ext = ".jpg"
            elif (out_mime or "").lower() == "image/webp":
                ext = ".webp"

            rel = _save_bytes_to_media_photos(out_bytes, ext)
            url = get_file_url(rel, base_url=base_url)

            gen_meta = {"source_asset_ids": selected_ids} if selected_ids else {}
            gen_meta["prompt_used"] = per_image_prompt

            try:
                desc = await self._agent.describe_image_rich(out_bytes, out_mime or "image/png")
                caption = (desc.get("summary") or "").strip()
                if caption:
                    gen_meta["caption"] = caption
                    gen_meta.update(desc)
            except Exception:
                gen_meta["caption"] = f"Generated: {(plan.image_prompt or message)[:100]}"

            gen_media = repo.add_media(
                session_id=sess.id,
                relpath=rel,
                kind="image",
                source="generated",
                source_url=None,
                prompt=plan.image_prompt or message,
                meta=gen_meta if gen_meta else None,
            )
            generated_asset_ids.append(gen_media.id)

            image_msg = repo.add_message(
                session_id=sess.id,
                thread_id=state.thread_id,
                request_id=state.request_id,
                role="model",
                content=None,
                msg_type="image",
                meta={"asset_ids": [gen_media.id]},
            )
            repo.set_last_generated(sess.id, rel)

            try:
                save_generated_metadata(
                    rel,
                    {
                        "source": "gemini",
                        "user_id": uid,
                        "client_session_id": client_session_id,
                        "thread_id": state.thread_id,
                        "request_id": state.request_id,
                        "asset_id": gen_media.id,
                        "seq": gen_media.seq,
                        "prompt": plan.image_prompt or message,
                        "prompt_used": per_image_prompt,
                        **(gen_meta or {}),
                    },
                )
            except Exception:
                pass

            db.commit()
            yield self._emit(
                state,
                "generation_complete",
                image_url=url,
                file_name=os.path.basename(rel),
                prompt=plan.image_prompt or message,
                asset_id=gen_media.id,
                message_id=image_msg.id,
                index=index + 1,
                total=image_count,
            )

        done_txt = self._text(
            "generation_done",
            user_message=message,
            history=history,
            thread_context=state.context_state,
            current=image_count,
            total=image_count,
        )
        model_msg = repo.add_message(
            session_id=sess.id,
            thread_id=state.thread_id,
            request_id=state.request_id,
            role="model",
            content=done_txt,
            msg_type="text",
        )
        context_state = self._update_context_state(
            repo,
            state,
            last_generated_asset_id=(generated_asset_ids[-1] if generated_asset_ids else state.context_state.get("last_generated_asset_id")),
            working_asset_ids=(generated_asset_ids or selected_ids or asset_ids),
            pending_question=None,
            last_action={
                "type": plan.intent,
                "status": "completed",
                "source_asset_ids": selected_ids or asset_ids,
                "generated_asset_ids": generated_asset_ids,
                "image_count": image_count,
            },
        )
        db.commit()
        yield self._emit(state, "chat", content=done_txt, message_id=model_msg.id)
        yield self._emit(state, "context_state", context_state=context_state)

    async def create_new_thread(self, *, user: Any, db, base_url: str | None = None) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            raise ValueError("Unauthorized")

        base_url = _normalize_base_url(base_url)
        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)
        previous_active_thread = repo.get_or_create_active_thread(sess.id)
        previous_context = repo.get_thread_context(previous_active_thread.id)

        new_thread_context = {"locale": previous_context.get("locale")} if previous_context.get("locale") else None
        thread = repo.create_new_thread(sess.id, context=new_thread_context)
        context_state = repo.get_thread_context(thread.id)
        db.commit()

        assets = [self._serialize_asset(media, base_url=base_url) for media in repo.list_media(sess.id, limit=None)]
        return self._serialize_thread_history(
            session_key=str(int(uid)),
            thread_id=thread.id,
            active_thread_id=thread.id,
            context_state=context_state,
            messages=[],
            assets=assets,
            message_count=0,
        )

    async def get_chat_history(
        self,
        *,
        user: Any,
        db,
        thread_id: int | None = None,
        base_url: str | None = None,
    ) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            return {"messages": [], "assets": [], "context_state": {}}

        base_url = _normalize_base_url(base_url)
        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)
        active_thread = repo.get_or_create_active_thread(sess.id)
        thread = self._resolve_thread(repo, session_id=sess.id, requested_thread_id=thread_id)

        msgs = repo.list_thread_messages(thread.id, limit=None)
        media = repo.list_media(sess.id, limit=None)
        assets = [self._serialize_asset(it, base_url=base_url) for it in media]
        messages = [self._serialize_message(msg) for msg in msgs]
        msg_count = len(msgs)

        return self._serialize_thread_history(
            session_key=str(int(uid)),
            thread_id=thread.id,
            active_thread_id=active_thread.id,
            context_state=repo.get_thread_context(thread.id),
            messages=messages,
            assets=assets,
            message_count=msg_count,
        )

    async def delete_messages(self, *, user: Any, db, payload: Dict[str, Any]) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            return {"deleted": 0, "deleted_media": 0, "message_count": 0, "limit": MAX_CHAT_MESSAGES, "locked": False}

        ids_raw = payload.get("message_ids") or payload.get("ids") or []
        if not isinstance(ids_raw, list):
            ids_raw = [ids_raw]
        msg_ids: list[int] = []
        for x in ids_raw:
            try:
                msg_ids.append(int(x))
            except Exception:
                pass
        msg_ids = list(dict.fromkeys(msg_ids))
        if not msg_ids:
            return {"deleted": 0, "deleted_media": 0, "message_count": 0, "limit": MAX_CHAT_MESSAGES, "locked": False}

        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)
        active_thread = repo.get_or_create_active_thread(sess.id)
        thread = self._resolve_thread(repo, session_id=sess.id, requested_thread_id=_coerce_int(payload.get("thread_id")))

        res = db.execute(
            delete(PhotoChatMessage).where(
                PhotoChatMessage.session_id == sess.id,
                PhotoChatMessage.thread_id == thread.id,
                PhotoChatMessage.id.in_(msg_ids),
            )
        )
        deleted = int(getattr(res, "rowcount", 0) or 0)
        db.commit()
        msg_count = self._thread_message_count(repo, thread.id)

        return {
            "thread_id": thread.id,
            "active_thread_id": active_thread.id,
            "deleted": deleted,
            "deleted_media": 0,
            "message_count": msg_count,
            "limit": MAX_CHAT_MESSAGES,
            "locked": _is_chat_locked(msg_count),
        }

    async def clear_history(self, *, user: Any, db, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            return {"deleted": 0, "deleted_media": 0, "message_count": 0, "limit": MAX_CHAT_MESSAGES, "locked": False}

        payload = payload or {}
        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)
        active_thread = repo.get_or_create_active_thread(sess.id)
        thread = self._resolve_thread(repo, session_id=sess.id, requested_thread_id=_coerce_int(payload.get("thread_id")))

        clear_mode = str(payload.get("clear_mode") or "messages").strip().lower()
        if clear_mode not in {"messages", "context", "all"}:
            raise HTTPException(status_code=400, detail="Invalid clear_mode")

        deleted = 0
        if clear_mode in {"messages", "all"}:
            deleted = repo.clear_thread_messages(thread.id)

        if clear_mode in {"context", "all"}:
            context_state = repo.reset_thread_context(thread.id)
        else:
            context_state = repo.get_thread_context(thread.id)

        db.commit()
        msg_count = self._thread_message_count(repo, thread.id)

        return {
            "thread_id": thread.id,
            "active_thread_id": active_thread.id,
            "clear_mode": clear_mode,
            "deleted": deleted,
            "deleted_media": 0,
            "context_state": context_state,
            "message_count": msg_count,
            "limit": MAX_CHAT_MESSAGES,
            "locked": _is_chat_locked(msg_count),
        }
