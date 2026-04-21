from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db_dependency
from app.core.dependencies import get_current_user
from app.controllers.photo_chat_controller import PhotoChatController
from app.core.config import settings
from app.services.photo_chat_agent import PhotoChatAgent
from app.schemas.photo_chat import (
    PhotoChatAssetImportRequest,
    PhotoChatStreamRequest,
    PhotoGeneratorRequest,
    PhotoGeneratorResponse,
)
from app.services.model_repository import ModelRepository
from app.services.scence_repositories import PoseRepository, SceneCategoryRepository
from app.models.generator import VideoScenario
from app.services.photo_error_mapper import map_photo_error


router = APIRouter(prefix="/api/photo", tags=["Photo Chat"])
logger = logging.getLogger("photo.chat.router")


def _sse_message(data: Dict[str, Any]) -> str:
    payload = json.dumps(data or {}, ensure_ascii=False)
    return f"event: message\ndata: {payload}\n\n"


def _mapped_photo_http_exception(raw_error: Any, *, context: str, default_status: int = 400) -> HTTPException:
    mapped = map_photo_error(raw_error, context=context)
    status_code = int(mapped.get("http_status") or default_status)
    return HTTPException(status_code=status_code, detail=mapped)


class CatalogItem(BaseModel):
    id: int
    name: str
    label: str
    prompt: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None


class CatalogAllResponse(BaseModel):
    scenes: List[CatalogItem]
    poses: List[CatalogItem]
    models: List[CatalogItem]
    videos: List[CatalogItem]


class PhotoChatModelOption(BaseModel):
    id: str
    label: str
    description: Optional[str] = None


class PhotoChatModelsResponse(BaseModel):
    generation_models: List[PhotoChatModelOption]
    default_generation_model: str


class PhotoChatClearRequest(BaseModel):
    thread_id: Optional[int] = None
    clear_mode: str = "messages"


def _request_base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@router.get("/catalog/all", response_model=CatalogAllResponse)
async def get_all_catalogs(
    current_user: Any = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    # Require auth (value itself is not needed further).
    _ = current_user

    scene_repo = SceneCategoryRepository(db)
    pose_repo = PoseRepository(db)
    model_repo = ModelRepository(db)

    scenes_hierarchy = scene_repo.get_full_hierarchy()
    poses_hierarchy = pose_repo.get_full_hierarchy()
    models_hierarchy = model_repo.get_full_hierarchy()

    scenes: List[CatalogItem] = []
    for _cat_id, cat_data in scenes_hierarchy.items():
        cat_name = str(cat_data.get("name") or "").strip()
        for _sub_id, sub_data in (cat_data.get("subcategories") or {}).items():
            sub_name = str(sub_data.get("name") or "").strip()
            for item in (sub_data.get("items") or []):
                item_name = str(item.get("name") or "").strip()
                label = " — ".join([part for part in [cat_name, sub_name, item_name] if part]) or item_name
                scenes.append(
                    CatalogItem(
                        id=int(item.get("id")),
                        name=item_name or label,
                        label=label,
                        prompt=item.get("prompt"),
                        category=cat_name or None,
                        subcategory=sub_name or None,
                    )
                )

    poses: List[CatalogItem] = []
    for _group_id, group_data in poses_hierarchy.items():
        group_name = str(group_data.get("name") or "").strip()
        for _sub_id, sub_data in (group_data.get("subgroups") or {}).items():
            sub_name = str(sub_data.get("name") or "").strip()
            for prompt in (sub_data.get("prompts") or []):
                prompt_name = str(prompt.get("name") or "").strip()
                label = " — ".join([part for part in [group_name, sub_name, prompt_name] if part]) or prompt_name
                poses.append(
                    CatalogItem(
                        id=int(prompt.get("id")),
                        name=prompt_name or label,
                        label=label,
                        prompt=prompt.get("prompt"),
                        category=group_name or None,
                        subcategory=sub_name or None,
                    )
                )

    models: List[CatalogItem] = []
    for _cat_id, cat_data in models_hierarchy.items():
        cat_name = str(cat_data.get("name") or "").strip()
        for _sub_id, sub_data in (cat_data.get("subcategories") or {}).items():
            sub_name = str(sub_data.get("name") or "").strip()
            for item in (sub_data.get("items") or []):
                item_name = str(item.get("name") or "").strip()
                label = " — ".join([part for part in [cat_name, sub_name, item_name] if part]) or item_name
                models.append(
                    CatalogItem(
                        id=int(item.get("id")),
                        name=item_name or label,
                        label=label,
                        prompt=item.get("prompt"),
                        category=cat_name or None,
                        subcategory=sub_name or None,
                    )
                )

    videos: List[CatalogItem] = []
    from sqlalchemy import select as _select
    vs_rows = db.execute(_select(VideoScenario).where(VideoScenario.is_active == True).order_by(VideoScenario.order_index)).scalars().all()
    for vs in vs_rows:
        videos.append(CatalogItem(
            id=int(vs.id),
            name=str(vs.name),
            label=str(vs.name),
            prompt=vs.prompt,
        ))

    return CatalogAllResponse(scenes=scenes, poses=poses, models=models, videos=videos)


@router.get("/chat/models", response_model=PhotoChatModelsResponse)
async def get_chat_models(
    current_user: Any = Depends(get_current_user),
):
    _ = current_user
    return PhotoChatModelsResponse(
        generation_models=[
            PhotoChatModelOption(**item)
            for item in PhotoChatAgent.generation_model_options()
        ],
        default_generation_model=PhotoChatAgent.default_generation_model(),
    )


@router.post("/assets/upload")
async def upload_chat_asset(
    request: Request,
    file: UploadFile = File(...),
    # client_session_id is deprecated: session is always per-user.
    # Keep it optional for backward compatibility with older frontends.
    client_session_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    try:
        content = await file.read()
        controller = PhotoChatController()
        try:
            return await controller.upload_asset(
                user=current_user,
                db=db,
                client_session_id=(client_session_id or ""),
                base_url=_request_base_url(request),
                content=content,
                filename=file.filename or "upload.jpg",
                content_type=file.content_type or "image/jpeg",
            )
        finally:
            await controller.close()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo assets/upload failed")
        raise _mapped_photo_http_exception(e, context="assets_upload", default_status=400)


@router.post("/assets/import")
async def import_chat_asset(
    request: Request,
    payload: PhotoChatAssetImportRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    client_session_id = (payload.client_session_id or "").strip()
    source_url = payload.source_url.strip()
    if not source_url:
        raise _mapped_photo_http_exception("source_url is required", context="assets_import", default_status=400)

    controller = PhotoChatController()
    try:
        return await controller.import_asset_from_url(
            user=current_user,
            db=db,
            client_session_id=client_session_id,
            source_url=source_url,
            base_url=_request_base_url(request),
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo assets/import failed")
        raise _mapped_photo_http_exception(e, context="assets_import", default_status=400)
    finally:
        await controller.close()


@router.post("/chat/stream")
async def chat_stream(
    request: Request,
    payload: PhotoChatStreamRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    quick_action = payload.quick_action
    logger.info(
        "photo chat stream endpoint called | user=%s request_id=%s thread=%s quick_action=%s photo_urls=%s asset_ids=%s planner_model=%s generation_model=%s profile=%s allow_quality_fallback=%s",
        getattr(current_user, "id", None) if not isinstance(current_user, dict) else current_user.get("id") or current_user.get("user_id"),
        payload.request_id,
        payload.thread_id,
        bool(quick_action),
        payload.photo_urls or payload.photo_url,
        payload.asset_ids,
        payload.planner_model,
        payload.generation_model,
        payload.model_profile,
        payload.allow_quality_fallback,
    )

    controller = PhotoChatController()
    payload_dict = payload.model_dump(exclude_none=True)
    payload_dict.setdefault("base_url", _request_base_url(request))
    request_id = str(payload.request_id or "").strip() or None
    fallback_thread_id = int(payload.thread_id) if isinstance(payload.thread_id, int) else None
    keepalive_interval_s = max(5.0, float(settings.PHOTO_CHAT_STREAM_KEEPALIVE_S or 15.0))

    async def event_gen() -> AsyncGenerator[str, None]:
        upstream = controller.chat_stream(user=current_user, db=db, payload=payload_dict)
        next_chunk_task: Optional[asyncio.Task[str]] = None
        try:
            while True:
                if await request.is_disconnected():
                    logger.info(
                        "photo chat stream disconnected before next chunk | request_id=%s thread_id=%s",
                        request_id,
                        fallback_thread_id,
                    )
                    break

                next_chunk_task = asyncio.create_task(upstream.__anext__())

                while True:
                    done, _pending = await asyncio.wait(
                        {next_chunk_task},
                        timeout=keepalive_interval_s,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if next_chunk_task in done:
                        break
                    if await request.is_disconnected():
                        logger.info(
                            "photo chat stream disconnected during keepalive wait | request_id=%s thread_id=%s",
                            request_id,
                            fallback_thread_id,
                        )
                        next_chunk_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await next_chunk_task
                        return
                    yield _sse_message(
                        {
                            "type": "keepalive",
                            "request_id": request_id,
                            "thread_id": fallback_thread_id,
                        }
                    )

                try:
                    chunk = await next_chunk_task
                except StopAsyncIteration:
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.exception(
                        "photo chat stream crashed after response start | request_id=%s thread_id=%s",
                        request_id,
                        fallback_thread_id,
                    )
                    mapped = map_photo_error(exc, context="chat_stream:stream")
                    yield _sse_message(
                        {
                            "type": "error",
                            "request_id": request_id,
                            "thread_id": fallback_thread_id,
                            "message": mapped.get("message"),
                            "code": mapped.get("code"),
                            "retryable": bool(mapped.get("retryable", True)),
                            "where": mapped.get("where"),
                            "provider": mapped.get("provider"),
                            "reason": mapped.get("reason"),
                            "error": mapped,
                        }
                    )
                    break
                else:
                    yield chunk
                finally:
                    next_chunk_task = None
        finally:
            if next_chunk_task is not None and not next_chunk_task.done():
                next_chunk_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await next_chunk_task
            with contextlib.suppress(Exception):
                await upstream.aclose()
            await controller.close()

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/generator/run", response_model=PhotoGeneratorResponse)
async def run_generator(
    request: Request,
    payload: PhotoGeneratorRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.run_generator(
            user=current_user,
            db=db,
            payload=payload.model_dump(exclude_none=True),
            base_url=_request_base_url(request),
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo generator/run failed")
        raise _mapped_photo_http_exception(e, context="generator_run", default_status=400)
    finally:
        await controller.close()


@router.post("/threads/new")
async def create_chat_thread(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.create_new_thread(
            user=current_user,
            db=db,
            base_url=_request_base_url(request),
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo threads/new failed")
        raise _mapped_photo_http_exception(e, context="threads_new", default_status=400)
    finally:
        await controller.close()


@router.get("/threads")
async def list_chat_threads(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.list_threads(user=current_user, db=db)
    finally:
        await controller.close()


@router.delete("/threads/{thread_id}")
async def delete_chat_thread(
    thread_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.delete_thread(user=current_user, db=db, thread_id=thread_id)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo threads/delete failed")
        raise _mapped_photo_http_exception(e, context="threads_delete", default_status=400)
    finally:
        await controller.close()


@router.get("/chat/history")
async def get_chat_history(
    request: Request,
    thread_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.get_chat_history(
            user=current_user,
            db=db,
            thread_id=thread_id,
            base_url=_request_base_url(request),
        )
    finally:
        await controller.close()


@router.post("/chat/messages/delete")
async def delete_chat_messages(
    payload: Dict[str, Any],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    """Delete one or many messages by ids (telegram-like multi-select delete)."""
    controller = PhotoChatController()
    try:
        return await controller.delete_messages(user=current_user, db=db, payload=payload)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo chat/messages/delete failed")
        raise _mapped_photo_http_exception(e, context="chat_delete_messages", default_status=400)
    finally:
        await controller.close()


@router.post("/chat/assets/delete")
async def delete_chat_assets(
    payload: Dict[str, Any],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.delete_assets(user=current_user, db=db, payload=payload)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo chat/assets/delete failed")
        raise _mapped_photo_http_exception(e, context="chat_delete_assets", default_status=400)
    finally:
        await controller.close()


@router.post("/chat/clear")
async def clear_chat_history(
    payload: Optional[PhotoChatClearRequest] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.clear_history(
            user=current_user,
            db=db,
            payload=(payload.model_dump(exclude_none=True) if payload else {}),
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo chat/clear failed")
        raise _mapped_photo_http_exception(e, context="chat_clear", default_status=400)
    finally:
        await controller.close()
