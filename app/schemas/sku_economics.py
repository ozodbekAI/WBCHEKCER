from datetime import date, datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SourceMode = Literal["ok", "partial", "manual", "manual_required", "error", "empty"]
ItemStatus = Literal["stop", "rescue", "control", "grow", "low_data"]
DiagnosisKind = Literal["traffic", "card", "economics", "data"]
PrecisionKind = Literal["exact", "estimated", "manual", "mixed", "unallocated"]
AlertLevel = Literal["info", "warning", "error", "success"]
PriorityLevel = Literal["critical", "high", "medium", "low"]
TrendSignal = Literal["worsening", "improving", "stable", "volatile", "new", "no_history"]


class AdAnalysisSourceStatusOut(BaseModel):
    id: str
    label: str
    mode: SourceMode
    detail: Optional[str] = None
    records: int = 0
    automatic: bool = True


class AdAnalysisAlertOut(BaseModel):
    level: AlertLevel
    title: str
    description: str
    action: Optional[str] = None


class AdAnalysisBudgetMoveOut(BaseModel):
    from_nm_id: Optional[int] = None
    from_title: str
    from_amount: float = 0
    to_nm_id: Optional[int] = None
    to_title: str
    uplift_percent: Optional[int] = None


class AdAnalysisCampaignOut(BaseModel):
    advert_id: Optional[int] = None
    title: str
    ad_cost: float = 0
    ad_gmv: float = 0
    drr: float = 0
    linked_skus: int = 0
    precision: PrecisionKind = "exact"
    precision_label: str = "Точные данные"


class AdAnalysisIssueSummaryOut(BaseModel):
    total: int = 0
    critical: int = 0
    warnings: int = 0
    photos: int = 0
    price: int = 0
    text: int = 0
    docs: int = 0
    top_titles: List[str] = Field(default_factory=list)


class AdAnalysisMetricsOut(BaseModel):
    revenue: float = 0
    wb_costs: float = 0
    cost_price: float = 0
    gross_profit_before_ads: float = 0
    ad_cost: float = 0
    net_profit: float = 0
    profit_per_order: float = 0
    max_cpo: float = 0
    actual_cpo: float = 0
    profit_delta: float = 0
    views: int = 0
    clicks: int = 0
    ad_orders: int = 0
    ad_gmv: float = 0
    ctr: float = 0
    cr: float = 0
    open_count: int = 0
    cart_count: int = 0
    order_count: int = 0
    buyout_count: int = 0
    add_to_cart_percent: float = 0
    cart_to_order_percent: float = 0
    cpc: float = 0
    drr: float = 0


class AdAnalysisTrendOut(BaseModel):
    signal: TrendSignal = "no_history"
    label: str = "Без истории"
    summary: str = ""
    actual_cpo_change: float = 0
    net_profit_change: float = 0
    profit_delta_change: float = 0
    orders_change: int = 0
    ctr_change: float = 0
    cr_change: float = 0


class AdAnalysisItemOut(BaseModel):
    nm_id: int
    card_id: Optional[int] = None
    title: Optional[str] = None
    vendor_code: Optional[str] = None
    photo_url: Optional[str] = None
    wb_link: Optional[str] = None
    workspace_link: Optional[str] = None
    price: Optional[float] = None
    card_score: Optional[int] = None
    status: ItemStatus
    status_label: str
    diagnosis: DiagnosisKind
    diagnosis_label: str
    status_reason: str
    status_hint: str
    action_title: str
    action_description: str
    priority: PriorityLevel = "medium"
    priority_label: str
    precision: PrecisionKind
    precision_label: str
    trend: AdAnalysisTrendOut = Field(default_factory=AdAnalysisTrendOut)
    issue_summary: AdAnalysisIssueSummaryOut
    metrics: AdAnalysisMetricsOut
    spend_sources: Dict[str, float] = Field(default_factory=dict)
    insights: List[str] = Field(default_factory=list)
    steps: List[str] = Field(default_factory=list)
    risk_flags: List[str] = Field(default_factory=list)


class AdAnalysisUploadNeedsOut(BaseModel):
    period_start: date
    period_end: date
    missing_costs_count: int = 0
    missing_cost_nm_ids: List[int] = Field(default_factory=list)
    needs_manual_spend: bool = False
    needs_manual_finance: bool = False
    can_upload_costs: bool = True
    can_upload_manual_spend: bool = True
    can_upload_manual_finance: bool = True


class AdAnalysisUploadUnresolvedRowOut(BaseModel):
    row_number: int
    raw_nm_id: Optional[str] = None
    raw_vendor_code: Optional[str] = None
    raw_title: Optional[str] = None


class AdAnalysisOverviewOut(BaseModel):
    store_id: int
    generated_at: datetime
    snapshot_ready: bool = False
    period_start: date
    period_end: date
    available_period_start: Optional[date] = None
    available_period_end: Optional[date] = None
    previous_period_start: Optional[date] = None
    previous_period_end: Optional[date] = None
    selected_preset: str = "custom"
    page: int = 1
    page_size: int = 50
    total_items: int = 0
    total_pages: int = 0
    total_skus: int = 0
    total_revenue: float = 0
    total_ad_spend: float = 0
    total_net_profit: float = 0
    exact_spend: float = 0
    estimated_spend: float = 0
    manual_spend: float = 0
    unallocated_spend: float = 0
    profitable_count: int = 0
    problematic_count: int = 0
    loss_count: int = 0
    worsening_count: int = 0
    improving_count: int = 0
    main_takeaway: str = ""
    status_counts: Dict[str, int] = Field(default_factory=dict)
    source_statuses: List[AdAnalysisSourceStatusOut] = Field(default_factory=list)
    alerts: List[AdAnalysisAlertOut] = Field(default_factory=list)
    budget_moves: List[AdAnalysisBudgetMoveOut] = Field(default_factory=list)
    campaigns: List[AdAnalysisCampaignOut] = Field(default_factory=list)
    upload_needs: AdAnalysisUploadNeedsOut
    critical_preview: List[AdAnalysisItemOut] = Field(default_factory=list)
    growth_preview: List[AdAnalysisItemOut] = Field(default_factory=list)
    items: List[AdAnalysisItemOut] = Field(default_factory=list)


class AdAnalysisUploadResultOut(BaseModel):
    imported: int
    updated: int
    file_name: str
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    notes: List[str] = Field(default_factory=list)
    detected_headers: List[str] = Field(default_factory=list)
    matched_fields: Dict[str, str] = Field(default_factory=dict)
    resolved_by_vendor_code: int = 0
    unresolved_count: int = 0
    unresolved_preview: List[AdAnalysisUploadUnresolvedRowOut] = Field(default_factory=list)
