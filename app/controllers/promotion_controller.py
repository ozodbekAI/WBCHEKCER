# controllers/promotion_controller.py
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services.promotion_service import PromotionService


class PromotionController:
    def __init__(self) -> None:
        self.service = PromotionService()

    def _extract_user_id(self, user: Any) -> int:
        if isinstance(user, dict):
            raw_uid = user.get("user_id") or user.get("id")
        else:
            raw_uid = getattr(user, "id", None) or getattr(user, "user_id", None)
        if raw_uid is None:
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            return int(raw_uid)
        except (TypeError, ValueError):
            raise HTTPException(status_code=401, detail="Invalid user context")

    async def create_company(self, payload: dict, db: Session, user: Any) -> dict:
        return self.service.create_company(db=db, user_id=self._extract_user_id(user), payload=payload)

    async def update_company(self, payload: dict, db: Session, user: Any) -> dict:
        return self.service.update_company_and_start(db=db, user_id=self._extract_user_id(user), payload=payload)

    async def get_balance(self, db: Session, user: Any) -> dict:
        return self.service.get_balance(db=db, user_id=self._extract_user_id(user))

    async def list_running(self, db: Session, user: Any, page: int = 1, page_size: int = 6) -> dict:
        return self.service.list_running(
            db=db, 
            user_id=self._extract_user_id(user), 
            page=page, 
            page_size=page_size
        )
    
    async def list_failed(self, db: Session, user: Any, page: int = 1, page_size: int = 6) -> dict:
        return self.service.list_failed(
            db=db, 
            user_id=self._extract_user_id(user), 
            page=page, 
            page_size=page_size
        )

    async def list_pending(self, db: Session, user: Any, page: int = 1, page_size: int = 6) -> dict:
        return self.service.list_pending(
            db=db, 
            user_id=self._extract_user_id(user), 
            page=page, 
            page_size=page_size
        )
    
    async def list_finished(self, db: Session, user: Any, page: int = 1, page_size: int = 6) -> dict:
        return self.service.list_finished(
            db=db, 
            user_id=self._extract_user_id(user), 
            page=page, 
            page_size=page_size
        )

    async def company_stats(self, company_id: int, db: Session, user: Any) -> dict:
        return self.service.company_stats(db=db, user_id=self._extract_user_id(user), company_id=company_id)

    async def company_debug(self, company_id: int, db: Session, user: Any) -> dict:
        try:
            return self.service.company_debug(db=db, user_id=self._extract_user_id(user), company_id=company_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    async def start_company(self, company_id: int, db: Session, user: Any) -> dict:
        return self.service.start_company(db=db, user_id=self._extract_user_id(user), company_id=company_id)
