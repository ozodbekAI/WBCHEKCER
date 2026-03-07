import asyncio
from sqlalchemy import delete, update, select, func
from app.core.database import AsyncSessionLocal
from app.models.issue import CardIssue
from app.models.card import Card

async def reset():
    async with AsyncSessionLocal() as db:
        # Delete all issues
        result = await db.execute(select(func.count()).select_from(CardIssue))
        issues_count = result.scalar()
        
        await db.execute(delete(CardIssue))
        
        # Reset cards
        await db.execute(update(Card).values(
            score=0,
            critical_issues_count=0,
            warnings_count=0,
            improvements_count=0,
            growth_points_count=0,
            product_dna=None,
            skip_next_reanalyze=False,
            last_analysis_at=None
        ))
        
        await db.commit()
        
        # Count cards
        result = await db.execute(select(func.count()).select_from(Card))
        cards_count = result.scalar()
        
        print(f'\n✅ Tahlillar o\'chirildi!')
        print(f'   • Issues: {issues_count}')
        print(f'   • Cards: {cards_count}\n')

asyncio.run(reset())
