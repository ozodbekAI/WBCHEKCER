from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict


# === Task Schemas ===

class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    status: str
    task_type: str
    
    total_items: int = 0
    processed_items: int = 0
    progress_percent: float = 0.0
    
    result: Dict[str, Any] = {}
    error_message: Optional[str] = None
    
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    
class TaskCreate(BaseModel):
    task_type: str  # full_analysis, quick_analysis, sync_cards


# === Analysis Result Schemas ===

class AnalysisResultSummary(BaseModel):
    total_cards: int
    analyzed_cards: int
    total_issues: int
    
    critical_count: int
    warnings_count: int
    improvements_count: int
    
    average_score: float
    potential_growth: int  # Percentage
    
    estimated_fix_time: int  # Minutes


class AnalysisProgress(BaseModel):
    task_id: int
    status: str
    progress_percent: float
    current_step: str
    estimated_remaining: int  # Seconds


# === Dashboard Schemas ===

class DashboardStats(BaseModel):
    # Store stats
    total_cards: int = 0
    average_score: float = 0.0
    
    # Issues
    critical_issues: int = 0
    warnings: int = 0
    improvements: int = 0
    
    # Progress
    fixed_today: int = 0
    active_ab_tests: int = 0
    
    # Potential
    growth_potential: str = "+0%"
    potential_revenue: str = "+0 ₽/мес"
    
    # Recent activity
    recent_activity: List[Dict[str, Any]] = []


class TaskCategory(BaseModel):
    """Category of tasks (critical, incoming, by cards, etc.)"""
    name: str
    description: str
    issues_count: int
    cards_count: int
    problems_count: int
    color: str  # red, blue, purple, gray
    action_label: str


class WorkspaceDashboard(BaseModel):
    """Main workspace dashboard data"""
    store_name: str
    
    # Task categories
    critical: TaskCategory
    incoming: TaskCategory
    by_cards: TaskCategory
    
    # Tools
    ab_tests_active: int = 0
    new_reviews: int = 0
    
    # Growth potential
    potential_revenue: str
    fixed_today: int
    active_tests: int
    
    # Activity
    recent_activity: List[Dict[str, Any]] = []
