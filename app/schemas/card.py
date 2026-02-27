from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, model_validator

from .issue import IssueOut


# === Card Schemas ===

class CardBase(BaseModel):
    nm_id: int
    vendor_code: Optional[str] = None
    title: Optional[str] = None
    brand: Optional[str] = None



class CardOut(CardBase):
    id: int
    store_id: int
    
    description: Optional[str] = None
    subject_name: Optional[str] = None
    category_name: Optional[str] = None
    
    photos_count: int = 0
    videos_count: int = 0
    
    main_photo_url: Optional[str] = None
    
    price: Optional[float] = None
    discount: Optional[int] = None
    
    score: Optional[int] = None
    score_breakdown: Optional[Dict[str, Any]] = None
    
    critical_issues_count: int = 0
    warnings_count: int = 0
    improvements_count: int = 0
    growth_points_count: int = 0
    
    last_analysis_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

    @model_validator(mode="before")
    @classmethod
    def _set_main_photo(cls, values: Any) -> Any:
        """Extract first photo URL from photos list as main_photo_url."""
        if isinstance(values, dict):
            photos = values.get("photos") or []
            if photos and not values.get("main_photo_url"):
                values["main_photo_url"] = photos[0]
        else:
            # ORM model
            photos = getattr(values, "photos", None) or []
            main = getattr(values, "main_photo_url", None)
            if photos and not main:
                try:
                    values.main_photo_url = photos[0]
                except AttributeError:
                    pass
        return values


class CardDetail(CardOut):
    """Detailed card with all info"""
    imt_id: Optional[int] = None
    photos: List[str] = []
    videos: List[str] = []
    characteristics: Dict[str, Any] = {}
    dimensions: Dict[str, Any] = {}
    raw_data: Dict[str, Any] = {}
    issues: List[IssueOut] = []


class CardListOut(BaseModel):
    items: List[CardOut]
    total: int
    page: int
    limit: int
    pages: int


class CardFilter(BaseModel):
    search: Optional[str] = None
    min_score: Optional[int] = None
    max_score: Optional[int] = None
    has_critical: Optional[bool] = None
    has_warnings: Optional[bool] = None
    category_name: Optional[str] = None


class CardScoreBreakdown(BaseModel):
    title_score: int = 0
    description_score: int = 0
    photos_score: int = 0
    video_score: int = 0
    characteristics_score: int = 0
    seo_score: int = 0
    total_score: int = 0
    max_possible: int = 100
