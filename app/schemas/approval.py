from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ── Approval Schemas ──

class ApprovalOut(BaseModel):
    id: int
    store_id: int
    card_id: int
    prepared_by_id: int
    reviewed_by_id: Optional[int] = None
    status: str
    changes: list = []
    total_fixes: int = 0
    submit_note: Optional[str] = None
    reviewer_comment: Optional[str] = None
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    applied_at: Optional[datetime] = None

    # Joined fields (populated in route)
    prepared_by_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    card_title: Optional[str] = None
    card_nm_id: Optional[int] = None
    card_vendor_code: Optional[str] = None
    card_photo: Optional[str] = None

    class Config:
        from_attributes = True


class ApprovalSubmitRequest(BaseModel):
    card_id: int
    note: Optional[str] = None
    reviewer_ids: Optional[list[int]] = None


class ApprovalReviewRequest(BaseModel):
    action: str  # "approve" or "reject"
    comment: Optional[str] = None


class ApprovalListOut(BaseModel):
    items: list[ApprovalOut] = []
    total: int = 0


# ── Team Schemas ──

class TeamMemberOut(BaseModel):
    id: int
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    is_active: bool
    last_login: Optional[datetime] = None
    created_at: datetime
    custom_permissions: Optional[list[str]] = None
    permissions: list[str] = []

    # Activity stats
    fixes_total: int = 0
    fixes_today: int = 0
    approvals_pending: int = 0
    approvals_approved: int = 0

    class Config:
        from_attributes = True


class TeamMemberUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    custom_permissions: Optional[list[str]] = None


class TeamInviteRequest(BaseModel):
    email: str
    role: str = "manager"
    first_name: Optional[str] = None
    custom_permissions: Optional[list[str]] = None


class RoleInfo(BaseModel):
    id: str
    name: str
    description: str
    permissions: list[str]
    user_count: int = 0


class PermissionInfo(BaseModel):
    id: str
    label: str
    group: str


class PermissionsListOut(BaseModel):
    permissions: list[PermissionInfo] = []
    groups: dict[str, list[str]] = {}
