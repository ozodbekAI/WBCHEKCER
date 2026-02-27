from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.core.dependencies import get_db_dependency

from app.schemas.promotion import PromotionCreateRequest, PromotionUpdateRequest
from app.controllers.promotion_controller import PromotionController

router = APIRouter(prefix="/promotion", tags=["Promotion"])
controller = PromotionController()

@router.post("/create_company")
async def create_company(
    request: PromotionCreateRequest,
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.create_company(request.model_dump(), db, user)

@router.post("/update")
async def update_company(
    request: PromotionUpdateRequest,
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.update_company(request.model_dump(), db, user)

@router.get("/balance")
async def get_balance(
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.get_balance(db, user)

@router.get("/running")
async def list_running(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.list_running(db, user, page=page, page_size=page_size)

@router.get("/pending")
async def list_pending(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.list_pending(db, user, page=page, page_size=page_size)

@router.get("/failed")
async def list_failed(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.list_failed(db, user, page=page, page_size=page_size)

@router.get("/finished")
async def list_finished(
    page: int = Query(1, ge=1),
    page_size: int = Query(6, ge=1, le=100),
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.list_finished(db, user, page=page, page_size=page_size)

@router.get("/company/{company_id}/stats")
async def company_stats(
    company_id: int,
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.company_stats(company_id, db, user)

@router.get("/company/{company_id}/debug")
async def company_debug(
    company_id: int,
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.company_debug(company_id, db, user)

@router.post("/company/{company_id}/start")
async def start_company(
    company_id: int,
    db: Session = Depends(get_db_dependency),
    user: Any = Depends(get_current_user),
):
    return await controller.start_company(company_id, db, user)

