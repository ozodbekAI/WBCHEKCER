from __future__ import annotations

import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db_dependency
from app.core.dependencies import get_current_user
from app.controllers.photo_chat_controller import PhotoChatController
from app.services.model_repository import ModelRepository
from app.services.scence_repositories import PoseRepository, SceneCategoryRepository
from app.models.generator import VideoScenario
from app.services.photo_error_mapper import map_photo_error


router = APIRouter(prefix="/api/photo", tags=["Photo Chat"])
logger = logging.getLogger("photo.chat.router")


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


@router.post("/assets/upload")
async def upload_chat_asset(
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
    payload: Dict[str, Any],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    # client_session_id is deprecated: session is always per-user.
    client_session_id = (payload.get("client_session_id") or "").strip()
    source_url = (payload.get("source_url") or "").strip()
    if not source_url:
        raise _mapped_photo_http_exception("source_url is required", context="assets_import", default_status=400)

    controller = PhotoChatController()
    try:
        return await controller.import_asset_from_url(
            user=current_user,
            db=db,
            client_session_id=client_session_id,
            source_url=source_url,
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
    payload: Dict[str, Any],
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()

    async def event_gen() -> AsyncGenerator[str, None]:
        try:
            async for chunk in controller.chat_stream(user=current_user, db=db, payload=payload):
                yield chunk
        finally:
            await controller.close()

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.get("/chat/history")
async def get_chat_history(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    """Return full chat history for the current user (stable across reloads/browsers)."""
    controller = PhotoChatController()
    try:
        return await controller.get_chat_history(user=current_user, db=db)
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


@router.post("/chat/clear")
async def clear_chat_history(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db_dependency),
):
    controller = PhotoChatController()
    try:
        return await controller.clear_history(user=current_user, db=db)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("photo chat/clear failed")
        raise _mapped_photo_http_exception(e, context="chat_clear", default_status=400)
    finally:
        await controller.close()
