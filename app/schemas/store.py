from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# === Store Schemas ===

class StoreCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    api_key: str = Field(..., min_length=10)


class StoreUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)


class StoreOut(BaseModel):
    id: int
    name: str
    status: str
    status_message: Optional[str] = None
    
    wb_supplier_id: Optional[str] = None
    wb_supplier_name: Optional[str] = None
    
    total_cards: int = 0
    critical_issues: int = 0
    warnings_count: int = 0
    growth_potential: int = 0
    
    last_sync_at: Optional[datetime] = None
    last_analysis_at: Optional[datetime] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class StoreStats(BaseModel):
    total_cards: int
    critical_issues: int
    warnings_count: int
    improvements_count: int
    growth_potential: int  # Percentage
    average_score: float
    
    # By severity
    issues_by_severity: dict
    
    # By category
    issues_by_category: dict


class StoreValidationResult(BaseModel):
    is_valid: bool
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    error_message: Optional[str] = None


class StoreSyncResult(BaseModel):
    total_cards: int
    new_cards: int
    updated_cards: int
    deleted_cards: int
    errors: List[str] = []


class OnboardRequest(BaseModel):
    """Request to onboard a new store: API key → validate → sync → analyze"""
    api_key: str = Field(..., min_length=10, description="WB API key")
    name: Optional[str] = Field(None, max_length=255, description="Store name (auto-detected if not set)")
    use_ai: bool = Field(True, description="Enable AI analysis (Gemini)")


class OnboardResult(BaseModel):
    """Result of the full onboarding flow"""
    store_id: int
    store_name: str
    supplier_name: Optional[str] = None
    supplier_id: Optional[str] = None
    
    cards_synced: int = 0
    cards_new: int = 0
    cards_analyzed: int = 0
    issues_found: int = 0
    ai_enabled: bool = True
