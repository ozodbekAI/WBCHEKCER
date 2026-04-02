from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class CardDraftPayload(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    brand: Optional[str] = None
    subject_name: Optional[str] = None
    characteristics: dict[str, str] = {}
    dimensions: dict[str, str] = {}
    package_type: Optional[str] = None
    complectation: Optional[str] = None


class CardDraftOut(BaseModel):
    id: int
    card_id: int
    author_id: int
    author_name: Optional[str] = None
    data: CardDraftPayload
    updated_at: datetime


class CardConfirmationSummaryOut(BaseModel):
    total_sections: int = 0
    confirmed_count: int = 0
    is_fully_confirmed: bool = False
    last_confirmed_at: Optional[datetime] = None
    last_confirmed_by_id: Optional[int] = None
    last_confirmed_by_name: Optional[str] = None


class TeamTicketCreate(BaseModel):
    type: str
    issue_id: Optional[int] = None
    approval_id: Optional[int] = None
    card_id: Optional[int] = None
    issue_title: Optional[str] = None
    issue_severity: Optional[str] = None
    issue_code: Optional[str] = None
    card_title: Optional[str] = None
    card_photo: Optional[str] = None
    card_nm_id: Optional[int] = None
    card_vendor_code: Optional[str] = None
    to_user_id: int
    note: Optional[str] = None


class TeamTicketOut(BaseModel):
    id: int
    type: str
    status: str
    store_id: int
    issue_id: Optional[int] = None
    approval_id: Optional[int] = None
    card_id: Optional[int] = None
    issue_title: Optional[str] = None
    issue_severity: Optional[str] = None
    issue_code: Optional[str] = None
    card_title: Optional[str] = None
    card_photo: Optional[str] = None
    card_nm_id: Optional[int] = None
    card_vendor_code: Optional[str] = None
    from_user_id: Optional[int] = None
    from_user_name: Optional[str] = None
    to_user_id: Optional[int] = None
    to_user_name: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class TeamActivityLogIn(BaseModel):
    action: str
    label: str
    timestamp: Optional[str] = None
    meta: dict[str, Any] = {}


class TeamWorkDayOut(BaseModel):
    date: str
    minutes: int
    sessions: int
    fixes: int


class TeamActionOut(BaseModel):
    id: str
    type: str
    label: str
    timestamp: str
    meta: dict[str, Any] = {}


class TeamSessionOut(BaseModel):
    id: str
    startedAt: str
    endedAt: Optional[str] = None
    activeTimeMs: int
    actions: list[TeamActionOut] = []


class TeamWorkMemberOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_online: bool
    today_minutes: int
    week_minutes: int
    month_minutes: int
    fixes_today: int
    fixes_week: int
    actions_today: int
    work_start_today: Optional[str] = None
    work_end_today: Optional[str] = None
    daily_breakdown: list[TeamWorkDayOut] = []
    sessions: list[TeamSessionOut] = []


class TeamWorklogOut(BaseModel):
    members: list[TeamWorkMemberOut] = []
    total_today_minutes: int = 0
    total_week_minutes: int = 0
    team_daily: list[TeamWorkDayOut] = []
