"""
Scheduler status endpoint
"""
from fastapi import APIRouter, Depends

from ..core.security import get_current_user
from ..models import User

router = APIRouter(prefix="/scheduler", tags=["Scheduler"])


@router.get("/status")
async def get_scheduler_status(
    current_user: User = Depends(get_current_user),
):
    """Get auto-analysis scheduler status: last/next tick times."""
    from ..services.card_scheduler import card_scheduler
    return card_scheduler.get_status()
