from __future__ import annotations

import json
import logging
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.services.photo_chat_repository import PhotoChatRepository
from app.services.gemini_api import GeminiApiError
from app.services.media_storage import (
    get_file_url,
    save_generated_metadata,
)
from app.services.photo_chat_agent import PhotoChatAgent
from app.models.photo_chat import PhotoChatSession, PhotoChatMedia

from app.services.scence_repositories import SceneCategoryRepository, PoseRepository
from app.services.model_repository import ModelRepository
from app.services.kie_service.kie_services import kie_service, KIEInsufficientCreditsError
from app.services.photo_error_mapper import map_photo_error
from app.services.media_storage import save_generated_file

logger = logging.getLogger("photo.chat.controller")


def _user_id(user: Any) -> Optional[int]:
    if user is None:
        return None
    if isinstance(user, dict):
        return user.get("user_id") or user.get("id")
    return getattr(user, "id", None)


def _sse(event: str, data: Dict[str, Any]) -> str:
    payload = json.dumps(data or {}, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


MAX_REMOTE_BYTES = 15 * 1024 * 1024

# Chat history is intentionally unlimited. Set an integer to restore a hard cap.
MAX_CHAT_MESSAGES: Optional[int] = None

ALLOWED_REMOTE_HOST_SUFFIXES = (
    "wbbasket.ru",
    "wbstatic.net",
    "wildberries.ru",
    "wb.ru",
)




def _is_allowed_remote_host(host: str) -> bool:
    host = (host or "").lower()
    if not host:
        return False

    try:
        public_host = (urlparse(settings.PUBLIC_BASE_URL).hostname or "").lower()
    except Exception:
        public_host = ""
    if public_host and host == public_host:
        return True

    return any(host == suffix or host.endswith(f".{suffix}") for suffix in ALLOWED_REMOTE_HOST_SUFFIXES)


def _resolve_local_media_path(source_url: str) -> Optional[Path]:
    if not source_url:
        return None

    raw = source_url.strip()
    parsed = urlparse(raw)

    if parsed.scheme in ("http", "https") and parsed.path.startswith("/media/"):
        host = (parsed.hostname or "").lower()
        public_host = (urlparse(settings.PUBLIC_BASE_URL).hostname or "").lower()
        if host and public_host and host != public_host:
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


async def _download_image_bytes(source_url: str) -> Tuple[bytes, str]:
    parsed = urlparse(source_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Unsupported URL scheme")
    host = (parsed.hostname or "").lower()
    if not _is_allowed_remote_host(host):
        raise ValueError("Unsupported URL host")

    timeout = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(source_url)
        resp.raise_for_status()

        final_host = (resp.url.host or "").lower()
        if not _is_allowed_remote_host(final_host):
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

    async def upload_asset(
        self,
        *,
        user: Any,
        db,
        client_session_id: str | None,
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
        url = get_file_url(rel)

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

    async def import_asset_from_url(self, *, user: Any, db, client_session_id: str | None, source_url: str) -> Dict[str, Any]:
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
                "file_url": get_file_url(existing.relpath),
                "file_name": os.path.basename(existing.relpath),
                "caption": ((existing.meta or {}).get("caption") if isinstance(existing.meta, dict) else None),
            }

        local_path = _resolve_local_media_path(source_url)
        if local_path and local_path.exists() and local_path.is_file():
            content = local_path.read_bytes()
            ext = local_path.suffix.lower() or ".jpg"
            content_type = "image/jpeg"
        else:
            content, ext = await _download_image_bytes(source_url)
            content_type = "image/webp" if ext == ".webp" else ("image/png" if ext == ".png" else "image/jpeg")

        rel = _save_bytes_to_media_photos(content, ext)
        url = get_file_url(rel)

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

    async def _build_planner_context(self, repo: PhotoChatRepository, session_id: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        # User explicitly wants full history (no 20-message cap). Users can delete messages themselves.
        messages = repo.list_messages(session_id, limit=None)
        media = repo.list_media(session_id, limit=None)

        hist: List[Dict[str, Any]] = []
        for m in messages:
            role = "user" if m.role == "user" else "model"
            meta = m.meta if isinstance(m.meta, dict) else {}
            asset_ids = meta.get("asset_ids") if isinstance(meta, dict) else None
            txt = str(m.content or "")
            if (txt and txt.strip()) or asset_ids:
                hist.append({"role": role, "text": txt, "asset_ids": asset_ids})

        assets: List[Dict[str, Any]] = []
        for it in media:
            meta = it.meta if isinstance(it.meta, dict) else {}
            cap = (meta.get("caption") or meta.get("summary") or "") if isinstance(meta, dict) else ""
            url = get_file_url(it.relpath)
            logger.info("_build_planner_context: asset_id=%s relpath=%s url=%s", it.id, it.relpath, url)
            assets.append(
                {
                    "asset_id": it.id,
                    "seq": it.seq,
                    "url": url,
                    "source": it.source,
                    "caption": cap or "",
                    "tags": (meta.get("tags") or []) if isinstance(meta, dict) else [],
                    "colors": (meta.get("colors") or []) if isinstance(meta, dict) else [],
                    "clothing": (meta.get("clothing") or "") if isinstance(meta, dict) else "",
                    "background": (meta.get("background") or "") if isinstance(meta, dict) else "",
                    "pose": (meta.get("pose") or "") if isinstance(meta, dict) else "",
                }
            )
        return hist, assets

    async def _handle_quick_action(
        self,
        *,
        user_id: int,
        client_session_id: str,
        db,
        repo: PhotoChatRepository,
        sess,
        message: str,
        asset_ids: list[int],
        quick_action: Dict[str, Any],
    ) -> AsyncGenerator[str, None]:
        """Handle deterministic quick actions in /chat/stream without calling the Gemini planner.

        Frontend sends only IDs / action type; backend resolves prompts from DB and calls KIE directly.
        Results are persisted into PhotoChat history (messages + media) and emitted via SSE.
        """

        action_type = (quick_action.get("type") or quick_action.get("action") or "").strip()
        def _emit_error(raw_error: Any) -> str:
            mapped = map_photo_error(raw_error, context=f"quick_action:{action_type or 'unknown'}")
            logger.warning(
                "photo quick_action mapped error | action=%s code=%s raw=%s",
                action_type or "unknown",
                mapped.get("code"),
                str(raw_error or ""),
            )
            return _sse(
                "message",
                {
                    "type": "error",
                    "message": mapped.get("message"),
                    "code": mapped.get("code"),
                    "retryable": bool(mapped.get("retryable", True)),
                    "error": mapped,
                },
            )

        if not action_type:
            yield _emit_error("quick_action.type is required")
            return

        # Choose source image(s). Prefer explicit ids, otherwise use the most recent
        # message that referenced assets, otherwise fallback to the last uploaded media.
        selected_ids: list[int] = list(asset_ids or [])
        if not selected_ids:
            try:
                msgs = repo.list_messages(sess.id, limit=None)
                for m in reversed(msgs):
                    meta = m.meta if isinstance(m.meta, dict) else {}
                    ids = meta.get("asset_ids")
                    if isinstance(ids, list) and ids:
                        selected_ids = [int(x) for x in ids if str(x).isdigit()]
                        break
            except Exception:
                selected_ids = []
        if not selected_ids:
            last = repo.get_last_media(sess.id)
            if last:
                selected_ids = [int(last.id)]

        if not selected_ids:
            q = "Пришлите фото, с которым нужно работать."
            model_msg = repo.add_message(session_id=sess.id, role="model", content=q, msg_type="text")
            db.commit()
            yield _sse("message", {"type": "question", "content": q, "message_id": model_msg.id})
            return

        media_list = repo.list_media(sess.id, limit=400)
        media_map = {int(m.id): m for m in media_list}
        src_media = media_map.get(int(selected_ids[0]))
        if not src_media:
            q = "Не нашёл выбранное фото. Пришлите фото ещё раз."
            model_msg = repo.add_message(session_id=sess.id, role="model", content=q, msg_type="text")
            db.commit()
            yield _sse("message", {"type": "question", "content": q, "message_id": model_msg.id})
            return

        src_url = get_file_url(src_media.relpath)

        # Helper: persist generated result to session + metadata and emit SSE
        async def _persist_and_emit(out_bytes: bytes, prompt_text: str) -> AsyncGenerator[str, None]:
            rel_path = save_generated_file(out_bytes, kind="image")
            url = get_file_url(rel_path)

            gen_media = repo.add_media(
                session_id=sess.id,
                relpath=rel_path,
                kind="image",
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
                role="model",
                content=None,
                msg_type="image",
                meta={"asset_ids": [gen_media.id]},
            )
            repo.set_last_generated(sess.id, rel_path)
            db.commit()

            # Also store to generated list metadata
            try:
                save_generated_metadata(
                    rel_path,
                    {
                        "source": "kie",
                        "user_id": user_id,
                        "client_session_id": client_session_id,
                        "asset_id": gen_media.id,
                        "seq": gen_media.seq,
                        "prompt": prompt_text,
                        "quick_action": action_type,
                    },
                )
            except Exception:
                pass

            yield _sse(
                "generation_complete",
                {
                    "image_url": url,
                    "file_name": os.path.basename(rel_path),
                    "prompt": prompt_text,
                    "asset_id": gen_media.id,
                    "message_id": img_msg.id,
                },
            )

        # ============================================
        # Execute quick action
        # ============================================

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

                prompt_text = getattr(pose_prompt, "name", None) or getattr(pose_prompt, "prompt", "") or "Сменить позу"

                yield _sse("generation_start", {"prompt": prompt_text})
                result = await kie_service.change_pose(src_url, pose_prompt.prompt)
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return

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
                ) or "Сменить фон"

                yield _sse("generation_start", {"prompt": prompt_text})
                result = await kie_service.change_scene(src_url, full_prompt)
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return

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

                yield _sse("generation_start", {"prompt": "Надеть на модель"})
                result = await kie_service.normalize_new_model(
                    item_image_url=src_url,
                    model_prompt=final_prompt,
                    ghost_prompt_override=None,
                    new_model_prompt_override=new_model_prompt or None,
                )
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return

                async for chunk in _persist_and_emit(out_bytes, final_prompt):
                    yield chunk
                return

            if action_type == "enhance":
                level = (quick_action.get("level") or "medium").strip()
                if level not in ("light", "medium", "strong"):
                    level = "medium"
                prompt_text = "Улучшение качества"

                yield _sse("generation_start", {"prompt": prompt_text})
                result = await kie_service.enhance_photo(src_url, level)
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "normalize-own-model":
                # Requires TWO images: garment (first asset) + model (second asset)
                if len(selected_ids) < 2:
                    q = "Нужно 2 фото: изделие (одежда) и фотомодель. Прикрепите оба и попробуйте снова."
                    model_msg = repo.add_message(session_id=sess.id, role="model", content=q, msg_type="text")
                    db.commit()
                    yield _sse("message", {"type": "question", "content": q, "message_id": model_msg.id})
                    return

                garment_media = media_map.get(int(selected_ids[0]))
                model_media_item = media_map.get(int(selected_ids[1]))

                if not garment_media or not model_media_item:
                    yield _emit_error("Не найдены загруженные фото")
                    return

                garment_url = get_file_url(garment_media.relpath)
                model_url = get_file_url(model_media_item.relpath)
                prompt_text = "Нормализация: своя фотомодель"

                yield _sse("generation_start", {"prompt": prompt_text})
                result = await kie_service.normalize_own_model(
                    item_image_url=garment_url,
                    model_image_url=model_url,
                )
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "custom-generation":
                custom_prompt = (quick_action.get("prompt") or message or "").strip()
                if not custom_prompt:
                    yield _emit_error("Промпт не указан")
                    return
                prompt_text = custom_prompt[:100]

                yield _sse("generation_start", {"prompt": prompt_text})
                result = await kie_service.custom_generation(src_url, custom_prompt)
                out_bytes = result.get("image")
                if not out_bytes:
                    yield _emit_error("No image in result")
                    return

                async for chunk in _persist_and_emit(out_bytes, prompt_text):
                    yield chunk
                return

            if action_type == "generate-video":
                video_prompt = (quick_action.get("prompt") or message or "Создать видео из фото").strip()
                video_model = quick_action.get("model") or "hailuo/minimax-video-01-live"
                video_duration = int(quick_action.get("duration") or 5)
                video_resolution = quick_action.get("resolution") or "720p"
                prompt_text = "Генерация видео"

                yield _sse("generation_start", {"prompt": prompt_text})
                result = await kie_service.generate_video(
                    image_url=src_url,
                    prompt=video_prompt,
                    model=video_model,
                    duration=video_duration,
                    resolution=video_resolution,
                )
                out_bytes = result.get("video") or result.get("image")
                if not out_bytes:
                    yield _emit_error("No video in result")
                    return

                rel_path = save_generated_file(out_bytes, kind="video")
                url = get_file_url(rel_path)

                gen_media = repo.add_media(
                    session_id=sess.id,
                    relpath=rel_path,
                    kind="video",
                    source="generated",
                    source_url=None,
                    prompt=video_prompt,
                    meta={"source_asset_ids": selected_ids, "quick_action": {"type": "generate-video"}},
                )
                img_msg = repo.add_message(
                    session_id=sess.id,
                    role="model",
                    content=None,
                    msg_type="image",
                    meta={"asset_ids": [gen_media.id]},
                )
                repo.set_last_generated(sess.id, rel_path)
                db.commit()

                try:
                    save_generated_metadata(
                        rel_path,
                        {
                            "source": "kie",
                            "user_id": user_id,
                            "client_session_id": client_session_id,
                            "asset_id": gen_media.id,
                            "seq": gen_media.seq,
                            "prompt": video_prompt,
                            "quick_action": "generate-video",
                            "media_type": "video",
                        },
                    )
                except Exception:
                    pass

                yield _sse("generation_complete", {
                    "image_url": url,
                    "file_name": os.path.basename(rel_path),
                    "prompt": video_prompt,
                    "asset_id": gen_media.id,
                    "message_id": img_msg.id,
                    "media_type": "video",
                })
                return

            # Unknown quick action: fallback to planner
            yield _sse("message", {"type": "chat", "content": "Эта быстрая команда пока не поддерживается в stream."})
            return

        except KIEInsufficientCreditsError as e:
            logger.warning("quick_action insufficient credits action=%s err=%s", action_type, str(e))
            yield _emit_error(str(e))
            return
        except Exception as e:
            logger.exception("quick_action unexpected failure action=%s", action_type)
            yield _emit_error(f"Ошибка quick_action: {e}")
            return

    async def _planner(
        self, 
        user_message: str, 
        history: List[Dict[str, Any]], 
        assets: List[Dict[str, Any]],
        recent_image_bytes: Optional[List[Tuple[int, bytes, str]]] = None,
    ) -> PlannerResult:
        try:
            plan = await self._agent.plan_action(
                user_message=user_message, 
                history=history, 
                assets=assets,
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
            
            return PlannerResult(
                intent=str(plan.get("intent") or "chat"),
                assistant_message=str(plan.get("assistant_message") or ""),
                image_prompt=plan.get("image_prompt"),
                image_count=plan.get("image_count"),
                selected_asset_ids=selected_ids,
                aspect_ratio=plan.get("aspect_ratio"),
            )
        except Exception:
            try:
                txt = await self._agent.generate_text(user_message, history=history)
            except Exception:
                txt = "Не получилось обработать запрос. Попробуйте ещё раз."
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
        """Remove risky phrases that make the model place multiple people/poses in one image."""
        if not s:
            return s
        t = s
        bad_patterns = [
            r"\btwo images\b", r"\b2 images\b", r"\bthree images\b", r"\b3 images\b",
            r"\btwo more images\b", r"\bthree more images\b",
            r"\btwo different poses\b", r"\bthree different poses\b",
            r"\bmultiple poses\b", r"\bin two poses\b", r"\bin three poses\b",
            r"\bside by side\b", r"\bcollage\b", r"\bgrid\b", r"\bdiptych\b", r"\btriptych\b",
            r"\bImage\s*\d+\b",  # "Image 1" like references sometimes cause duplication
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
        """Hard constraints to avoid multiple persons in a single frame."""
        base_prompt = self._strip_multi_words(base_prompt or "")

        rules = (
            "STRICT RULES:\n"
            "- Generate ONE image only.\n"
            "- Exactly ONE person in the scene (no second person, no duplicates, no clones).\n"
            "- No collage, no split-screen, no grid, no multiple frames.\n"
            "- Keep the SAME location/background as the reference image.\n"
            "- Keep the SAME outfit as the reference image.\n"
            "- Full-body shot (head-to-toe).\n"
            "- Realistic lighting and proportions.\n"
        )

        return f"{base_prompt}\nPOSE: {pose_text}.\n{rules}"

    async def chat_stream(self, *, user: Any, db, payload: Dict[str, Any]) -> AsyncGenerator[str, None]:
        uid = _user_id(user)
        if uid is None:
            mapped = map_photo_error("Unauthorized", context="chat_stream")
            yield _sse(
                "message",
                {
                    "type": "error",
                    "message": mapped.get("message"),
                    "code": mapped.get("code"),
                    "retryable": bool(mapped.get("retryable", False)),
                    "error": mapped,
                },
            )
            return

        message = (payload.get("message") or "").strip()

        # ✅ FORCE GEMINI ONLY (no engine toggle)
        engine = "gemini"

        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)

        # Optional hard-stop for installations that want to cap chat history.
        try:
            msg_count = repo.count_messages(sess.id)
        except Exception:
            msg_count = len(repo.list_messages(sess.id, limit=None))
        if _is_chat_locked(msg_count):
            yield _sse(
                "message",
                {
                    "type": "limit_reached",
                    "limit": MAX_CHAT_MESSAGES,
                    "message_count": msg_count,
                    "message": "Лимит сообщений достигнут. Удалите лишние сообщения или очистите чат, чтобы продолжить.",
                },
            )
            return

        client_session_id = str(int(uid))

        incoming_asset_ids = payload.get("asset_ids") or []

        # Backward-compatible fallback:
        # older/newer frontends may send `photo_urls` instead of `asset_ids`.
        # Import them into the current session and merge resulting asset_ids.
        incoming_photo_urls_raw = payload.get("photo_urls")
        if incoming_photo_urls_raw is None:
            # also support single photo_url
            incoming_photo_urls_raw = payload.get("photo_url")

        incoming_photo_urls: list[str] = []
        if isinstance(incoming_photo_urls_raw, str):
            incoming_photo_urls = [incoming_photo_urls_raw]
        elif isinstance(incoming_photo_urls_raw, list):
            incoming_photo_urls = [str(x) for x in incoming_photo_urls_raw if isinstance(x, str)]

        if incoming_photo_urls:
            imported_ids: list[int] = []
            for source_url in incoming_photo_urls[:6]:
                src = source_url.strip()
                if not src or src.startswith("blob:"):
                    continue
                try:
                    imported = await self.import_asset_from_url(
                        user=user,
                        db=db,
                        client_session_id=client_session_id,
                        source_url=src,
                    )
                    aid = int(imported.get("asset_id") or 0)
                    if aid:
                        imported_ids.append(aid)
                except Exception as e:
                    logger.warning("chat_stream: failed to import photo_url=%s: %s", src, e)

            if imported_ids:
                if isinstance(incoming_asset_ids, list):
                    incoming_asset_ids.extend(imported_ids)
                else:
                    incoming_asset_ids = imported_ids

        normalized_incoming_asset_ids: list[int] = []
        if isinstance(incoming_asset_ids, list):
            for x in incoming_asset_ids:
                try:
                    normalized_incoming_asset_ids.append(int(x))
                except Exception:
                    pass
        seen_incoming: set[int] = set()
        normalized_incoming_asset_ids = [
            x for x in normalized_incoming_asset_ids if not (x in seen_incoming or seen_incoming.add(x))
        ]
        already_acked_user_message_id: Optional[int] = None

        # --------------------------------------------
        # 0) If message empty => images-only flow
        # --------------------------------------------
        if not message:
            ids: list[int] = list(normalized_incoming_asset_ids)

            if ids:
                # ✅ FIXED: Check if assets exist in ANY session for this user
                valid_in_current_session = {m.id for m in repo.list_media(sess.id, limit=500)}
                all_user_sessions = repo.db.execute(
                    select(PhotoChatSession.id).where(PhotoChatSession.user_id == uid)
                ).scalars().all()
                valid_in_any_user_session = {
                    m.id for sess_id in all_user_sessions 
                    for m in repo.list_media(sess_id, limit=500)
                }
                ids = [x for x in ids if x in valid_in_current_session or x in valid_in_any_user_session]

            if ids:
                img_msg = repo.add_message(
                    session_id=sess.id,
                    role="user",
                    content=None,
                    msg_type="image",
                    meta={"asset_ids": ids},
                )
                db.commit()
                already_acked_user_message_id = img_msg.id

                yield _sse("message", {"type": "ack", "user_message_id": img_msg.id})

                # ✅ IMPORTANT: Don't just ask "what to do?" - instead pass to Gemini with full context
                # to understand what the user's intention was (especially if they previously said what they wanted)
                logger.info("chat_stream: image-only message with asset_ids=%s, passing to Gemini for context", ids)
                
                # Build context with conversation history so Gemini understands user's previous intent
                history, assets = await self._build_planner_context(repo, sess.id)
                
                # Fetch image bytes for Gemini to see them
                media_map = {int(m.id): m for m in repo.list_media(sess.id, limit=500)}
                recent_image_bytes: List[Tuple[int, bytes, str]] = []
                
                for aid in ids[:4]:
                    m = media_map.get(aid)
                    if not m:
                        try:
                            stmt = select(PhotoChatMedia).where(PhotoChatMedia.id == aid)
                            m = db.execute(stmt).scalars().first()
                        except Exception:
                            pass
                    
                    if m and m.relpath:
                        abs_path = os.path.join(settings.MEDIA_ROOT, m.relpath)
                        if os.path.exists(abs_path):
                            try:
                                with open(abs_path, "rb") as f:
                                    raw = f.read()
                                recent_image_bytes.append((aid, raw, "image/jpeg"))
                                continue
                            except Exception as e:
                                logger.warning("Failed to read local image bytes for image-only asset_id=%s: %s", aid, e)
                        try:
                            url = get_file_url(m.relpath)
                            raw = await self._agent.fetch_url_bytes(url)
                            recent_image_bytes.append((aid, raw, "image/jpeg"))
                        except Exception as e:
                            logger.warning("Failed to fetch image for image-only asset_id=%s: %s", aid, e)
                            if m.source_url:
                                try:
                                    raw = await self._agent.fetch_url_bytes(m.source_url)
                                    recent_image_bytes.append((aid, raw, "image/jpeg"))
                                    abs_path = os.path.join(settings.MEDIA_ROOT, m.relpath)
                                    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                                    with open(abs_path, "wb") as f:
                                        f.write(raw)
                                except Exception as recovery_e:
                                    logger.error("Recovery failed: %s", recovery_e)
                
                # Call planner with implicit user intent (images only, so likely image editing/generation)
                implicit_message = f"[User sent {len(ids)} image(s) without text - understand intent from context]"
                plan = await self._planner(implicit_message, history, assets, recent_image_bytes=recent_image_bytes)

                if plan.intent == "edit_image":
                    logger.info("chat_stream: image-only message recognized as edit_image")
                    picked = plan.selected_asset_ids or ids
                    dedup_picked: list[int] = []
                    seen_picked: set[int] = set()
                    for x in picked:
                        try:
                            val = int(x)
                        except Exception:
                            continue
                        if val in seen_picked:
                            continue
                        seen_picked.add(val)
                        dedup_picked.append(val)
                    normalized_incoming_asset_ids = dedup_picked or ids
                    message = (plan.image_prompt or "").strip()
                    if not message:
                        message = "Обработай изображение по контексту диалога."
                else:
                    txt = plan.assistant_message or f"Я получил {len(ids)} фото. Что нужно сделать с ними?"
                    model_msg = repo.add_message(session_id=sess.id, role="model", content=txt, msg_type="text")
                    db.commit()
                    yield _sse("message", {"type": "response", "content": txt, "message_id": model_msg.id})
                    return

            else:
                q = "Напишите, что нужно сделать."
                model_msg = repo.add_message(session_id=sess.id, role="model", content=q, msg_type="text")
                db.commit()
                yield _sse("message", {"type": "question", "content": q, "message_id": model_msg.id})
                return

        raw_asset_ids = list(normalized_incoming_asset_ids)
        asset_ids: list[int] = []
        for x in raw_asset_ids:
            try:
                asset_ids.append(int(x))
            except Exception:
                pass
        seen: set[int] = set()
        asset_ids = [x for x in asset_ids if not (x in seen or seen.add(x))]
        logger.info("chat_stream: raw_asset_ids=%s, parsed asset_ids=%s, session_id=%s", raw_asset_ids, asset_ids, sess.id)
        if asset_ids:

            valid_in_current_session = {m.id for m in repo.list_media(sess.id, limit=300)}
            logger.info("chat_stream: valid media ids in session=%s: %s", sess.id, valid_in_current_session)
            
            all_user_sessions = repo.db.execute(
                select(PhotoChatSession.id).where(PhotoChatSession.user_id == uid)
            ).scalars().all()
            valid_in_any_user_session = {
                m.id for sess_id in all_user_sessions 
                for m in repo.list_media(sess_id, limit=500)
            }
            logger.info("chat_stream: valid media ids in ANY user session: %s", valid_in_any_user_session)
            
            before_filter = asset_ids[:]
            asset_ids = [x for x in asset_ids if x in valid_in_current_session or x in valid_in_any_user_session]
            logger.info("chat_stream: after validation filter: before=%s, after=%s", before_filter, asset_ids)

        if already_acked_user_message_id is None:
            msg_type = "image" if (not message.strip() and asset_ids) else "text"
            user_msg = repo.add_message(
                session_id=sess.id,
                role="user",
                content=message,
                msg_type=msg_type,
                meta={"asset_ids": asset_ids} if asset_ids else None,
            )
            db.commit()
            yield _sse("message", {"type": "ack", "user_message_id": user_msg.id})


        quick_action = payload.get("quick_action")
        if isinstance(quick_action, dict) and (quick_action.get("type") or quick_action.get("action")):
            async for chunk in self._handle_quick_action(
                user_id=uid,
                client_session_id=client_session_id,
                db=db,
                repo=repo,
                sess=sess,
                message=message,
                asset_ids=asset_ids,
                quick_action=quick_action,
            ):
                yield chunk
            return

        history, assets = await self._build_planner_context(repo, sess.id)

        referenced_asset_ids = set()
        for msg in repo.list_messages(sess.id, limit=None):
            meta = getattr(msg, 'meta', None)
            if meta and isinstance(meta, dict):
                aids = meta.get('asset_ids')
                if isinstance(aids, list):
                    for aid in aids:
                        try:
                            referenced_asset_ids.add(int(aid))
                        except Exception:
                            pass

        # ✅ FIX: Also include asset_ids from CURRENT message
        for aid in asset_ids:
            referenced_asset_ids.add(aid)

        # ✅ NEW FIX: Also include ALL imported assets from session
        # (imported assets are not in chat messages but should be visible to Gemini)
        for a in assets:
            src = a.get('source', '')
            if src in ('import', 'user'):  # user uploaded or imported
                try:
                    referenced_asset_ids.add(int(a.get('asset_id', 0)))
                except Exception:
                    pass

        filtered_assets = [a for a in assets if int(a.get('asset_id', 0)) in referenced_asset_ids]

        # ✅ FIX: Fetch actual image bytes for recent assets so Gemini can SEE them
        # Also handle assets from OTHER sessions (cross-session asset references)
        recent_image_bytes: List[Tuple[int, bytes, str]] = []
        media_map = {int(m.id): m for m in repo.list_media(sess.id, limit=500)}
        
        # Prioritize current message's asset_ids, then recent from filtered_assets
        fetch_ids = list(asset_ids)[:4] if asset_ids else [int(a.get('asset_id', 0)) for a in filtered_assets[-4:]]
        logger.info("chat_stream: fetch_ids for images before Gemini=%s", fetch_ids)
        
        for aid in fetch_ids[:4]:
            m = media_map.get(aid)
            
            # ✅ If not in current session, search in ANY user session
            if not m:
                try:
                    stmt = select(PhotoChatMedia).where(PhotoChatMedia.id == aid)
                    m = db.execute(stmt).scalars().first()
                    if m:
                        logger.info("chat_stream: found media asset_id=%s in different session=%s", aid, m.session_id)
                except Exception as e:
                    logger.warning("Failed to find media asset_id=%s in any session: %s", aid, e)
            
            if m and m.relpath:
                logger.info("chat_stream: fetching image bytes for asset_id=%s relpath=%s", aid, m.relpath)
                
                # ✅ Debug: Check if file exists on disk
                abs_path = os.path.join(settings.MEDIA_ROOT, m.relpath)
                file_exists = os.path.exists(abs_path)
                logger.info("chat_stream: asset_id=%s absolute_path=%s file_exists=%s", aid, abs_path, file_exists)
                
                if file_exists:
                    try:
                        with open(abs_path, "rb") as f:
                            raw = f.read()
                        logger.info("chat_stream: loaded %d bytes from local disk for asset_id=%s", len(raw), aid)
                        recent_image_bytes.append((aid, raw, "image/jpeg"))
                        continue
                    except Exception as e:
                        logger.warning("chat_stream: failed to read local file for asset_id=%s: %s", aid, e)

                try:
                    url = get_file_url(m.relpath)
                    logger.info("chat_stream: built URL for asset_id=%s: %s", aid, url)
                    raw = await self._agent.fetch_url_bytes(url)
                    logger.info("chat_stream: successfully fetched %d bytes for asset_id=%s", len(raw), aid)
                    recent_image_bytes.append((aid, raw, "image/jpeg"))
                except Exception as e:
                    logger.warning("Failed to fetch image for planner asset_id=%s url=%s: %s", aid, url, e)
                    
                    # ✅ Recovery: if file missing on disk and fetch failed, try source_url
                    if not file_exists and m.source_url:
                        logger.info("chat_stream: attempting recovery for asset_id=%s from source_url=%s", aid, m.source_url)
                        try:
                            raw = await self._agent.fetch_url_bytes(m.source_url)
                            logger.info("chat_stream: recovered %d bytes for asset_id=%s from source_url", len(raw), aid)
                            # Re-save the file to disk
                            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                            with open(abs_path, "wb") as f:
                                f.write(raw)
                            logger.info("chat_stream: re-saved file for asset_id=%s to disk", aid)
                            recent_image_bytes.append((aid, raw, "image/jpeg"))
                        except Exception as recovery_e:
                            logger.error("chat_stream: recovery failed for asset_id=%s: %s", aid, recovery_e)
            else:
                logger.warning("chat_stream: media asset_id=%s not found or no relpath", aid)

        # 3. Use filtered_assets for Gemini planner and downstream logic
        plan = await self._planner(message, history, filtered_assets, recent_image_bytes=recent_image_bytes)

        # ✅ IMPORTANT FIX:
        # If planner says generate_image but we have reference image(s) -> treat as edit_image (img2img).
        if plan.intent == "generate_image":
            if (plan.selected_asset_ids and len(plan.selected_asset_ids) > 0) or (asset_ids and len(asset_ids) > 0):
                plan.intent = "edit_image"
                if not plan.selected_asset_ids:
                    plan.selected_asset_ids = asset_ids

        # --------------------------------------------
        # 5) Chat/question -> just text
        # --------------------------------------------
        if plan.intent in ("question", "chat"):
            txt = plan.assistant_message or ""
            model_msg = repo.add_message(session_id=sess.id, role="model", content=txt, msg_type="text")
            db.commit()
            yield _sse(
                "message",
                {
                    "type": "question" if plan.intent == "question" else "chat",
                    "content": txt,
                    "message_id": model_msg.id,
                },
            )
            return

        # --------------------------------------------
        # 6) We support TWO intents for images now:
        #    - edit_image (img2img using reference)
        #    - generate_image (text2img if no reference)
        # --------------------------------------------
        if plan.intent not in ("edit_image", "generate_image"):
            txt = plan.assistant_message or "Понял."
            model_msg = repo.add_message(session_id=sess.id, role="model", content=txt, msg_type="text")
            db.commit()
            yield _sse("message", {"type": "chat", "content": txt, "message_id": model_msg.id})
            return

        # --------------------------------------------
        # 7) Resolve image_count (1..4)
        # --------------------------------------------
        try:
            image_count = int(plan.image_count or 1)
        except Exception:
            image_count = 1
        image_count = max(1, min(image_count, 4))

        # --------------------------------------------
        # 8) Determine selected_ids (for edit_image)
        # --------------------------------------------
        selected_ids = plan.selected_asset_ids or []

        if plan.intent == "edit_image":
            if not selected_ids:
                if asset_ids:
                    selected_ids = asset_ids
                else:
                    # Prefer last history message with assets
                    try:
                        for h in reversed(history or []):
                            ids = h.get("asset_ids") if isinstance(h, dict) else None
                            if isinstance(ids, list) and ids:
                                selected_ids = [int(x) for x in ids if str(x).strip().isdigit()]
                                break
                    except Exception:
                        selected_ids = []

            if not selected_ids and assets:
                selected_ids = [int(assets[-1]["asset_id"])]

            if not selected_ids:
                q = plan.assistant_message or "Пришлите фото, с которым нужно работать."
                model_msg = repo.add_message(session_id=sess.id, role="model", content=q, msg_type="text")
                db.commit()
                yield _sse("message", {"type": "question", "content": q, "message_id": model_msg.id})
                return

        # --------------------------------------------
        # 9) Load image bytes if edit_image
        # ✅ ALWAYS handle fetch errors gracefully
        # ✅ Also use LOCAL resolution if possible
        # --------------------------------------------
        images: List[Tuple[bytes, str]] = []
        if plan.intent == "edit_image":
            for aid in selected_ids[: getattr(settings, "GEMINI_MAX_CONTEXT_IMAGES", 6)]:
                m = next((x for x in assets if int(x.get("asset_id") or 0) == int(aid)), None)
                if not m:
                    continue
                url = str(m.get("url") or "")
                logger.info("edit_image: attempting to load image for asset_id=%s from url=%s", aid, url)
                
                # Try LOCAL path first (faster, no network)
                local = _resolve_local_media_path(url)
                logger.info("edit_image: _resolve_local_media_path result: local=%s exists=%s", local, local.exists() if local else False)
                
                if local and local.exists():
                    try:
                        raw = local.read_bytes()
                        images.append((raw, "image/jpeg"))
                    except Exception as e:
                        logger.warning("Failed to read local image file asset_id=%s path=%s: %s", aid, local, e)
                else:
                    try:
                        raw = await self._agent.fetch_url_bytes(url)
                        images.append((raw, "image/jpeg"))
                    except Exception as e:
                        logger.warning("Failed to fetch image URL for asset_id=%s url=%s: %s", aid, url, e)
                        
                        # ✅ Recovery: try to fetch from source_url and re-save if local file missing
                        try:
                            stmt = select(PhotoChatMedia).where(PhotoChatMedia.id == aid)
                            media_record = db.execute(stmt).scalars().first()
                            
                            if media_record and media_record.source_url and not (local and local.exists()):
                                logger.info("edit_image: attempting recovery for asset_id=%s from source_url=%s", aid, media_record.source_url)
                                try:
                                    raw = await self._agent.fetch_url_bytes(media_record.source_url)
                                    images.append((raw, "image/jpeg"))
                                    
                                    # Re-save to disk
                                    if local:
                                        os.makedirs(os.path.dirname(local), exist_ok=True)
                                        with open(local, "wb") as f:
                                            f.write(raw)
                                        logger.info("edit_image: re-saved file for asset_id=%s to disk", aid)
                                except Exception as recovery_e:
                                    logger.error("edit_image: recovery failed for asset_id=%s: %s", aid, recovery_e)
                        except Exception as recovery_e:
                            logger.error("edit_image: recovery lookup failed for asset_id=%s: %s", aid, recovery_e)

        # --------------------------------------------
        # 10) Build prompt (rich prompt)
        # --------------------------------------------
        selected_assets = [a for a in assets if int(a.get("asset_id", 0)) in selected_ids]
        enhanced_prompt = self._agent.build_rich_prompt(
            basic_prompt=plan.image_prompt or message,
            selected_assets=selected_assets,
            selected_asset_ids=selected_ids,
        )
        aspect_ratio = self._normalize_ar(plan.aspect_ratio)

        # --------------------------------------------
        # 11) Notify UI: batch start (N placeholders/spinners)
        # ✅ ALWAYS as event: message for frontend simplicity
        # --------------------------------------------
        yield _sse("message", {"type": "images_start", "total": image_count})

        # --------------------------------------------
        # 12) Generate N images sequentially
        # --------------------------------------------
        enhanced_prompt = self._strip_multi_words(enhanced_prompt)

        poses = self._pose_variants(image_count)

        for _i in range(image_count):
            yield _sse("message", {"type": "image_started", "index": _i + 1, "total": image_count})

            # ✅ Each image gets its own strict prompt with ONE pose
            per_image_prompt = self._make_single_image_prompt(
                base_prompt=enhanced_prompt,
                pose_text=poses[_i],
            )

            def _emit_stream_error(raw_error: Any) -> str:
                mapped = map_photo_error(raw_error, context="chat_stream:generation")
                return _sse(
                    "message",
                    {
                        "type": "error",
                        "message": mapped.get("message"),
                        "code": mapped.get("code"),
                        "retryable": bool(mapped.get("retryable", True)),
                        "error": mapped,
                        "index": _i + 1,
                        "total": image_count,
                    },
                )

            try:
                assistant_text, out_bytes, out_mime = await self._agent.edit_or_generate_image(
                    prompt=per_image_prompt,
                    images=images,               # empty => text2img, non-empty => img2img
                    aspect_ratio=aspect_ratio,
                )
            except GeminiApiError as e:
                logger.error("edit_or_generate_image failed: %s", str(e).strip() or "GeminiApiError")
                yield _emit_stream_error(e)
                return
            except Exception as e:
                logger.exception("edit_or_generate_image failed with unexpected error")
                yield _emit_stream_error(e)
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
            url = get_file_url(rel)

            gen_meta = {"source_asset_ids": selected_ids} if selected_ids else {}
            gen_meta["pose_variant"] = poses[_i]
            gen_meta["prompt_used"] = per_image_prompt

            # Describe generated
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

            image_msg = repo.add_message(
                session_id=sess.id,
                role="model",
                content=None,
                msg_type="image",
                meta={"asset_ids": [gen_media.id]},
            )
            repo.set_last_generated(sess.id, rel)

            try:
                save_generated_metadata(rel, {
                    "source": "gemini",
                    "user_id": uid,
                    "client_session_id": client_session_id,
                    "asset_id": gen_media.id,
                    "seq": gen_media.seq,
                    "prompt": plan.image_prompt or message,
                    "prompt_used": per_image_prompt,
                    "pose_variant": poses[_i],
                    **(gen_meta or {})
                })
            except Exception:
                pass

            db.commit()

            yield _sse(
                "message",
                {
                    "type": "generation_complete",
                    "image_url": url,
                    "file_name": os.path.basename(rel),
                    "prompt": plan.image_prompt or message,
                    "asset_id": gen_media.id,
                    "message_id": image_msg.id,
                    "index": _i + 1,
                    "total": image_count,
                },
            )

        # Optional: final status text (one line)
        done_txt = f"Готово: {image_count}/{image_count}"
        model_msg = repo.add_message(session_id=sess.id, role="model", content=done_txt, msg_type="text")
        db.commit()
        yield _sse("message", {"type": "chat", "content": done_txt, "message_id": model_msg.id})


    async def get_chat_history(self, *, user: Any, db) -> Dict[str, Any]:
        """Full chat history for the current user.

        Session is stable and equals user_id; no client_session_id required.
        """
        uid = _user_id(user)
        if uid is None:
            return {"messages": [], "assets": []}

        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)

        msgs = repo.list_messages(sess.id, limit=None)
        media = repo.list_media(sess.id, limit=None)

        assets: list[dict] = []
        for it in media:
            meta = it.meta if isinstance(it.meta, dict) else {}
            assets.append(
                {
                    "asset_id": it.id,
                    "seq": it.seq,
                    "kind": it.kind,
                    "source": it.source,
                    "file_url": get_file_url(it.relpath),
                    "file_name": os.path.basename(it.relpath),
                    "prompt": it.prompt,
                    "caption": (meta.get("caption") or meta.get("summary") or "") if isinstance(meta, dict) else "",
                    "meta": meta,
                }
            )

        messages: list[dict] = []
        for m in msgs:
            messages.append(
                {
                    "id": m.id,
                    "role": m.role,
                    "msg_type": m.msg_type,
                    "content": m.content,
                    "meta": m.meta,
                    "created_at": getattr(m, "created_at", None).isoformat() if getattr(m, "created_at", None) else None,
                }
            )

        # Return message stats for the client.
        try:
            msg_count = repo.count_messages(sess.id)
        except Exception:
            msg_count = len(msgs)

        return {
            "session_key": str(int(uid)),
            "message_count": msg_count,
            "limit": MAX_CHAT_MESSAGES,
            "locked": _is_chat_locked(msg_count),
            "messages": messages,
            "assets": assets,
        }

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

        # IMPORTANT: deleting chat messages must NOT delete generated images.
        deleted = repo.delete_messages_by_ids(sess.id, msg_ids)
        db.commit()

        try:
            msg_count = repo.count_messages(sess.id)
        except Exception:
            msg_count = len(repo.list_messages(sess.id, limit=None))

        return {
            "deleted": deleted,
            "deleted_media": 0,
            "message_count": msg_count,
            "limit": MAX_CHAT_MESSAGES,
            "locked": _is_chat_locked(msg_count),
        }

    async def clear_history(self, *, user: Any, db) -> Dict[str, Any]:
        uid = _user_id(user)
        if uid is None:
            return {"deleted": 0, "deleted_media": 0, "message_count": 0, "limit": MAX_CHAT_MESSAGES, "locked": False}

        repo = PhotoChatRepository(db)
        sess = repo.get_or_create_user_session(uid)

        # IMPORTANT: clearing chat must NOT delete generated images.
        msgs = repo.list_messages(sess.id, limit=None)
        deleted = 0
        if msgs:
            deleted = repo.delete_messages_by_ids(sess.id, [m.id for m in msgs])

        db.commit()

        try:
            msg_count = repo.count_messages(sess.id)
        except Exception:
            msg_count = 0

        return {
            "deleted": deleted,
            "deleted_media": 0,
            "message_count": msg_count,
            "limit": MAX_CHAT_MESSAGES,
            "locked": _is_chat_locked(msg_count),
        }
