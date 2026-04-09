from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.core.dependencies import get_db_dependency
from app.models import Store

from app.schemas.promotion import PromotionCreateRequest, PromotionUpdateRequest
from app.controllers.promotion_controller import PromotionController
from app.services.wb_token_access import ensure_store_feature_access

router = APIRouter(prefix="/promotion", tags=["Promotion"])
controller = PromotionController()


def _extract_user_id(user: Any) -> int:
    if isinstance(user, dict):
        raw_uid = user.get("user_id") or user.get("id")
    else:
        raw_uid = getattr(user, "id", None) or getattr(user, "user_id", None)
    if raw_uid is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    try:
        return int(raw_uid)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user context") from exc


def _resolve_promotion_store(db: Session, user: Any, explicit_store_id: int | None) -> Store | None:
    user_id = _extract_user_id(user)
    raw_role = getattr(user, "role", None)
    role_value = raw_role.value if hasattr(raw_role, "value") else raw_role
    member_store_id = int(getattr(user, "store_id", 0) or 0)

    candidate_ids: list[int] = []
    if explicit_store_id is not None:
        candidate_ids.append(int(explicit_store_id))
    elif member_store_id:
        candidate_ids.append(member_store_id)

    owned_ids = [
        int(store_id)
        for (store_id,) in db.query(Store.id)
        .filter(Store.owner_id == int(user_id))
        .order_by(Store.id.asc())
        .all()
    ]
    candidate_ids.extend(owned_ids)

    seen: set[int] = set()
    for store_id in candidate_ids:
        if store_id in seen:
            continue
        seen.add(store_id)

        store = db.query(Store).filter(Store.id == int(store_id)).first()
        if not store:
            continue

        is_owner = int(getattr(store, "owner_id", 0) or 0) == int(user_id)
        is_admin = role_value == "admin"
        is_member = member_store_id == int(store.id)
        if not (is_owner or is_admin or is_member):
            if explicit_store_id is not None:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            continue

        return store

    if explicit_store_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")
    return None

@router.post("/create_company")
async def create_company(
    request: PromotionCreateRequest,
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.create_company(request.model_dump(), db, user, store_id=getattr(store, "id", x_store_id))

@router.post("/update")
async def update_company(
    request: PromotionUpdateRequest,
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.update_company(request.model_dump(), db, user, store_id=getattr(store, "id", x_store_id))

@router.get("/balance")
async def get_balance(
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.get_balance(db, user, store_id=getattr(store, "id", x_store_id))

@router.get("/running")
async def list_running(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.list_running(db, user, page=page, page_size=page_size, store_id=getattr(store, "id", x_store_id))

@router.get("/pending")
async def list_pending(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.list_pending(db, user, page=page, page_size=page_size, store_id=getattr(store, "id", x_store_id))

@router.get("/failed")
async def list_failed(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.list_failed(db, user, page=page, page_size=page_size, store_id=getattr(store, "id", x_store_id))

@router.get("/finished")
async def list_finished(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.list_finished(db, user, page=page, page_size=page_size, store_id=getattr(store, "id", x_store_id))

@router.get("/company/{company_id}/stats")
async def company_stats(
    company_id: int,
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.company_stats(company_id, db, user, store_id=getattr(store, "id", x_store_id))

@router.get("/company/{company_id}/debug")
async def company_debug(
    company_id: int,
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.company_debug(company_id, db, user, store_id=getattr(store, "id", x_store_id))

@router.post("/company/{company_id}/start")
async def start_company(
    company_id: int,
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.start_company(company_id, db, user, store_id=getattr(store, "id", x_store_id))


@router.post("/company/{company_id}/stop")
async def stop_company(
    company_id: int,
    x_store_id: int | None = Header(default=None, alias="X-Store-Id"),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    store = _resolve_promotion_store(db, user, x_store_id)
    if store is not None:
        ensure_store_feature_access(store, "ab_tests")
    return await controller.stop_company(company_id, db, user, store_id=getattr(store, "id", x_store_id))
