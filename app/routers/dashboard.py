from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..core.database import get_db
from ..core.security import get_current_user
from ..core.time import utc_now
from ..models import User, Store, Card, CardIssue, IssueStatus, IssueSeverity
from ..schemas import DashboardStats, WorkspaceDashboard, TaskCategory
from ..services.issue_service import non_dedicated_media_issue_filter

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardStats)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get main dashboard stats"""
    # Get user's stores
    stores_result = await db.execute(
        select(Store).where(Store.owner_id == current_user.id)
    )
    stores = list(stores_result.scalars().all())
    store_ids = [s.id for s in stores]
    
    if not store_ids:
        return DashboardStats()
    
    # Total cards
    cards_result = await db.execute(
        select(func.count(Card.id)).where(Card.store_id.in_(store_ids))
    )
    total_cards = cards_result.scalar() or 0
    
    # Average score
    avg_result = await db.execute(
        select(func.avg(Card.score)).where(Card.store_id.in_(store_ids))
    )
    avg_score = float(avg_result.scalar() or 0)
    
    # Critical issues
    critical_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id.in_(store_ids),
            CardIssue.severity == IssueSeverity.CRITICAL,
            CardIssue.status.in_([IssueStatus.PENDING, IssueStatus.SKIPPED])
        )
    )
    critical = critical_result.scalar() or 0
    
    # Warnings
    warnings_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id.in_(store_ids),
            CardIssue.severity == IssueSeverity.WARNING,
            CardIssue.status.in_([IssueStatus.PENDING, IssueStatus.SKIPPED]),
            non_dedicated_media_issue_filter(),
        )
    )
    warnings = warnings_result.scalar() or 0
    
    # Improvements
    improvements_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id.in_(store_ids),
            CardIssue.severity == IssueSeverity.IMPROVEMENT,
            CardIssue.status.in_([IssueStatus.PENDING, IssueStatus.SKIPPED]),
            non_dedicated_media_issue_filter(),
        )
    )
    improvements = improvements_result.scalar() or 0
    
    # Fixed today
    today_start = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
    fixed_today_result = await db.execute(
        select(func.count(CardIssue.id))
        .join(Card)
        .where(
            Card.store_id.in_(store_ids),
            CardIssue.status == IssueStatus.FIXED,
            CardIssue.fixed_at >= today_start
        )
    )
    fixed_today = fixed_today_result.scalar() or 0
    
    # Calculate potential growth
    potential_growth = f"+{int((100 - avg_score) * 0.26)}%"
    potential_revenue = f"+{int(total_cards * 50)} ₽/мес"
    
    return DashboardStats(
        total_cards=total_cards,
        average_score=round(avg_score, 1),
        critical_issues=critical,
        warnings=warnings,
        improvements=improvements,
        fixed_today=fixed_today,
        growth_potential=potential_growth,
        potential_revenue=potential_revenue,
    )


@router.get("/stores/{store_id}", response_model=WorkspaceDashboard)
async def get_store_dashboard(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get workspace dashboard for a specific store"""
    # Get store — allow owner, admin, or invited member
    store_result = await db.execute(
        select(Store).where(Store.id == store_id)
    )
    store = store_result.scalar_one_or_none()

    if not store:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found")

    is_owner = store.owner_id == current_user.id
    role_value = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    is_admin = role_value == "admin"
    is_member = getattr(current_user, 'store_id', None) == store_id
    if not (is_owner or is_admin or is_member):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Get issue counts (PENDING + SKIPPED)
    critical_result = await db.execute(
        select(
            func.count(CardIssue.id).label("issues"),
            func.count(func.distinct(CardIssue.card_id)).label("cards")
        )
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.severity == IssueSeverity.CRITICAL,
            CardIssue.status.in_([IssueStatus.PENDING, IssueStatus.SKIPPED])
        )
    )
    critical_row = critical_result.one()
    
    warnings_result = await db.execute(
        select(
            func.count(CardIssue.id).label("issues"),
            func.count(func.distinct(CardIssue.card_id)).label("cards")
        )
        .join(Card)
        .where(
            Card.store_id == store_id,
            CardIssue.severity == IssueSeverity.WARNING,
            CardIssue.status.in_([IssueStatus.PENDING, IssueStatus.SKIPPED]),
            non_dedicated_media_issue_filter(),
        )
    )
    warnings_row = warnings_result.one()
    
    # Calculate potential revenue
    avg_score_result = await db.execute(
        select(func.avg(Card.score)).where(Card.store_id == store_id)
    )
    avg_score = avg_score_result.scalar() or 0
    potential_revenue = f"+{int(store.total_cards * 50)} ₽/мес"
    
    # Get cards count for "by cards" category
    cards_with_issues = await db.execute(
        select(func.count(func.distinct(Card.id)))
        .join(CardIssue)
        .where(
            Card.store_id == store_id,
            CardIssue.status.in_([IssueStatus.PENDING, IssueStatus.SKIPPED])
        )
    )
    cards_count = cards_with_issues.scalar() or 0
    
    return WorkspaceDashboard(
        store_name=store.name,
        critical=TaskCategory(
            name="Критичные",
            description="Блокируют показы или продажи",
            issues_count=critical_row.issues,
            cards_count=critical_row.cards,
            problems_count=3,  # Simplified
            color="red",
            action_label="Начать",
        ),
        incoming=TaskCategory(
            name="Входящие",
            description="Новые задачи на проверку",
            issues_count=warnings_row.issues,
            cards_count=warnings_row.cards,
            problems_count=3,
            color="blue",
            action_label="Начать",
        ),
        by_cards=TaskCategory(
            name="По карточкам",
            description="Улучшения для каждой карточки",
            issues_count=store.total_cards,
            cards_count=cards_count,
            problems_count=0,
            color="purple",
            action_label="Начать",
        ),
        potential_revenue=potential_revenue,
        fixed_today=0,  # Would need activity tracking
        active_tests=0,
    )
