#!/usr/bin/env python3
"""
Reset All Analyses Script
--------------------------
O'chiradi:
  - Barcha CardIssue yozuvlari
  - Card tahlil ma'lumotlari (score, product_dna, counts)
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import delete, update, select, func
from app.core.database import AsyncSessionLocal
from app.models.issue import CardIssue
from app.models.card import Card


async def reset_all_analyses():
    """Barcha tahlillarni o'chirish"""
    
    print("\n" + "="*60)
    print("⚠️  BARCHA TAHLILLARNI O'CHIRISH")
    print("="*60)
    print("\nBu amal quyidagilarni o'chiradi:")
    print("  • Barcha CardIssue yozuvlari (muammolar)")
    print("  • Kartalar tahlil ma'lumotlari (score, product_dna)")
    print("  • AI tomonidan yaratilgan barcha ma'lumotlar")
    print("\n⚠️  BU AMALNI BEKOR QILIB BO'LMAYDI!")
    print("="*60)
    
    response = input("\nDavom etasizmi? (ha/yo'q): ").lower().strip()
    if response not in ['ha', 'yes', 'y']:
        print("\n❌ Bekor qilindi\n")
        return
    
    async with AsyncSessionLocal() as db:
        try:
            # 1. Count issues
            count_query = select(func.count()).select_from(CardIssue)
            result = await db.execute(count_query)
            total_issues = result.scalar()
            
            print(f"\n🗑️  {total_issues} ta muammo o'chirilmoqda...")
            
            # 2. Delete all issues
            delete_stmt = delete(CardIssue)
            await db.execute(delete_stmt)
            await db.commit()
            print(f"   ✅ {total_issues} ta muammo o'chirildi")
            
            # 3. Count cards
            count_query = select(func.count()).select_from(Card)
            result = await db.execute(count_query)
            total_cards = result.scalar()
            
            print(f"\n🔄 {total_cards} ta karta ma'lumotlari tiklanmoqda...")
            
            # 4. Reset card analysis data
            update_stmt = update(Card).values(
                score=0,
                critical_issues_count=0,
                warnings_count=0,
                improvements_count=0,
                growth_points_count=0,
                product_dna=None,
                skip_next_reanalyze=False,
                last_analysis_at=None
            )
            await db.execute(update_stmt)
            await db.commit()
            print(f"   ✅ {total_cards} ta karta ma'lumotlari tiklandi")
            
            # 5. Summary
            print("\n" + "="*60)
            print("✅ BARCHA TAHLILLAR MUVAFFAQIYATLI O'CHIRILDI!")
            print("="*60)
            print(f"\n📊 Natija:")
            print(f"   • O'chirilgan muammolar: {total_issues}")
            print(f"   • Tiklangan kartalar: {total_cards}")
            print("\n💡 Keyingi qadamlar:")
            print("   1. Yangi tahlil uchun sync bosing")
            print("   2. Yoki scheduler avtomatik tahlil qiladi (10 min)")
            print("\n")
            
        except Exception as e:
            await db.rollback()
            print(f"\n❌ Xatolik: {e}\n")
            raise


if __name__ == "__main__":
    asyncio.run(reset_all_analyses())
