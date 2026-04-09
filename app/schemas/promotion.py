# schemas/promotion.py
from __future__ import annotations

from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field


class PromotionPhotoIn(BaseModel):
    order: int
    file_url: str


class PromotionCreateRequest(BaseModel):
    nm_id: int
    card_id: Optional[int] = None
    title: str
    from_main: bool = False
    main_photo_url: Optional[str] = None
    max_slots: int = 5
    keep_winner_as_main: bool = True
    photos: List[PromotionPhotoIn] = Field(default_factory=list)
    photos_count: int = 0
    delete_test_photos: bool = True


class PromotionCreateResponse(BaseModel):
    company_id: int
    wb_company_id: int
    wb_save_ad_response: Dict[str, Any]
    wb_min_bids_response: Any


class PromotionUpdateRequest(BaseModel):
    id_company: int
    company_id: Optional[int] = None
    nm_id: int
    card_id: Optional[int] = None
    title: str
    title_changed: bool = False
    from_main: bool = False
    max_slots: int = 5
    keep_winner_as_main: bool = True
    photos_count: int = 0
    views_per_photo: int
    cpm: int
    spend_rub: int = 0
    estimated_spend_rub: Optional[int] = None
    auto_deposit: bool = True
    deposit_rub: Optional[int] = None
    payment_source: Optional[str] = None
    use_promo_bonus: Optional[bool] = None
    delete_test_photos: bool = True
    photos: List[PromotionPhotoIn] = Field(default_factory=list)



class PromotionPhotoOut(BaseModel):
    order: int
    file_url: str
    wb_url: Optional[str] = None
    shows: int = 0
    clicks: int = 0
    ctr: float = 0.0
    is_winner: bool = False
    winner_score: Optional[float] = None
    winner_score_confidence: Optional[float] = None
    winner_score_conversion_source: Optional[str] = None
    winner_score_reason: Optional[str] = None

class PromotionCompanyOut(BaseModel):
    id_company: int
    company_id: int
    nm_id: int
    card_id: Optional[int] = None
    title: str
    status: str
    spend_rub: int
    estimated_spend_rub: int = 0
    winner_decision: Optional[str] = None
    views_per_photo: int
    photos_count: int
    winner_photo_order: Optional[int] = None
    photos: List[PromotionPhotoOut] = []

class PaginationOut(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int

class PromotionListOut(BaseModel):
    items: List[PromotionCompanyOut]
    pagination: PaginationOut
