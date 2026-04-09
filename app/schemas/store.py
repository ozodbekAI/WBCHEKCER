from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


# === Store Schemas ===

class StoreCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    api_key: str = Field(..., min_length=10)


class StoreUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    api_key: Optional[str] = Field(None, min_length=10)


class StoreWbFeatureAccessOut(BaseModel):
    label: str
    allowed: bool
    reason: Optional[str] = None
    message: str
    required_categories: List[str] = Field(default_factory=list)
    required_categories_labels: List[str] = Field(default_factory=list)
    missing_categories: List[str] = Field(default_factory=list)
    missing_categories_labels: List[str] = Field(default_factory=list)
    requires_write: bool = False
    source_slot: Optional[str] = None
    source_label: Optional[str] = None
    using_specific_key: bool = False
    recommended_slots: List[str] = Field(default_factory=list)
    recommended_slot_labels: List[str] = Field(default_factory=list)


class StoreWbTokenSnapshotOut(BaseModel):
    decoded: bool = False
    decode_error: Optional[str] = None
    token_type: Optional[str] = None
    scope_mask: Optional[int] = None
    categories: List[str] = Field(default_factory=list)
    category_labels: List[str] = Field(default_factory=list)
    read_only: bool = False
    expires_at: Optional[datetime] = None


class StoreWbKeySlotOut(BaseModel):
    slot_key: str
    label: str
    configured: bool = False
    is_default: bool = False
    feature_keys: List[str] = Field(default_factory=list)
    feature_labels: List[str] = Field(default_factory=list)
    token_access: StoreWbTokenSnapshotOut = Field(default_factory=StoreWbTokenSnapshotOut)
    updated_at: Optional[datetime] = None


class StoreWbTokenAccessOut(BaseModel):
    decoded: bool = False
    decode_error: Optional[str] = None
    token_type: Optional[str] = None
    scope_mask: Optional[int] = None
    categories: List[str] = Field(default_factory=list)
    category_labels: List[str] = Field(default_factory=list)
    read_only: bool = False
    expires_at: Optional[datetime] = None
    features: dict[str, StoreWbFeatureAccessOut] = Field(default_factory=dict)
    key_slots: List[StoreWbKeySlotOut] = Field(default_factory=list)


class StoreApiKeyUpdateRequest(BaseModel):
    api_key: str = Field(..., min_length=10)


class StoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
    wb_token_access: StoreWbTokenAccessOut = Field(default_factory=StoreWbTokenAccessOut)
    
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
    wb_token_access: Optional[StoreWbTokenAccessOut] = None


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
    wb_token_access: Optional[StoreWbTokenAccessOut] = None


class OnboardStartResponse(BaseModel):
    task_id: str
    status: str = "started"


class OnboardTaskStatus(BaseModel):
    task_id: str
    status: str
    step: str
    progress: int = 0
    store_id: Optional[int] = None
    result: Optional[OnboardResult] = None
    error: Optional[str] = None
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
