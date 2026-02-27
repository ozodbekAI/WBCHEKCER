from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


# === Issue Schemas ===

class IssueBase(BaseModel):
    code: str
    severity: str  # critical, warning, improvement, info
    category: str  # title, description, photos, etc.
    title: str
    description: Optional[str] = None


class IssueOut(IssueBase):
    id: int
    card_id: int
    
    current_value: Optional[str] = None
    field_path: Optional[str] = None
    
    suggested_value: Optional[str] = None
    alternatives: List[str] = []
    
    # WB validation fields
    charc_id: Optional[int] = None
    allowed_values: List[Any] = []
    error_details: List[Any] = []
    
    # AI validation fields
    ai_suggested_value: Optional[str] = None
    ai_reason: Optional[str] = None
    ai_alternatives: List[str] = []
    
    # Source
    source: Optional[str] = None  # 'code', 'ai', 'merged'
    
    score_impact: int = 0
    
    status: str
    fixed_value: Optional[str] = None
    fixed_at: Optional[datetime] = None
    
    created_at: datetime
    
    class Config:
        from_attributes = True


class IssueWithCard(IssueOut):
    """Issue with card info"""
    card_nm_id: int
    card_title: Optional[str] = None
    card_vendor_code: Optional[str] = None
    card_photos: List[str] = []


class IssueListOut(BaseModel):
    items: List[IssueOut]
    total: int
    page: int
    limit: int


class IssuesGrouped(BaseModel):
    critical: List[IssueWithCard] = []
    warnings: List[IssueWithCard] = []
    improvements: List[IssueWithCard] = []
    postponed: List[IssueWithCard] = []
    
    critical_count: int = 0
    warnings_count: int = 0
    improvements_count: int = 0
    postponed_count: int = 0


class IssueFixRequest(BaseModel):
    """Request to fix an issue"""
    fixed_value: str  # The value user chose
    apply_to_wb: bool = True  # Whether to push to WB


class IssueSkipRequest(BaseModel):
    """Request to skip an issue"""
    reason: Optional[str] = None


class IssuePostponeRequest(BaseModel):
    """Request to postpone an issue"""
    postpone_until: Optional[datetime] = None
    reason: Optional[str] = None


class IssueBatchAction(BaseModel):
    """Batch action on multiple issues"""
    issue_ids: List[int]
    action: str  # fix, skip, postpone
    value: Optional[str] = None  # For fix action
    reason: Optional[str] = None


class IssueSuggestion(BaseModel):
    """Suggested fix for an issue"""
    value: str
    confidence: float = 0.0  # 0-1
    reason: Optional[str] = None
    is_recommended: bool = False


# === Issue Stats ===

class IssueStats(BaseModel):
    total: int = 0
    pending: int = 0
    fixed: int = 0
    skipped: int = 0
    postponed: int = 0
    
    by_severity: dict = {}
    by_category: dict = {}
    
    potential_score_gain: int = 0


class DailyActivity(BaseModel):
    date: str
    fixed_count: int = 0
    new_issues_count: int = 0


class QueueProgress(BaseModel):
    """Progress of issue fixing queue"""
    total: int = 0
    pending: int = 0
    fixed: int = 0
    skipped: int = 0
    postponed: int = 0
    progress_percent: float = 0.0


class ApplyResult(BaseModel):
    """Result of applying fixes to WB"""
    total_issues: int = 0
    applied: int = 0
    failed: int = 0
    errors: List[str] = []
