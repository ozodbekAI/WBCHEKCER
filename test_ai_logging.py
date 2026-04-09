#!/usr/bin/env python3
"""
Test AI logging - check what data is sent to AI
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

pytestmark = pytest.mark.skip(reason="Manual Gemini smoke script; not part of automated pytest coverage")

from app.services.gemini_service import GeminiService


async def test_audit():
    """Test what audit_card sends to AI"""
    gemini = GeminiService()
    
    # Fake card data
    test_card = {
        "subjectID": 123,
        "subjectName": "Костюмы",
        "vendorCode": "TEST-001",
        "brand": "ZARA",
        "title": "Костюм женский летний",  # ← Should NOT be sent
        "description": "Красивый стильный костюм...",  # ← Should NOT be sent
        "characteristics": [
            {"id": 1, "name": "Тип низа", "value": "юбка"},
            {"id": 2, "name": "Цвет", "value": "черный"},
        ]
    }
    
    print("\n" + "="*60)
    print("🔍 Testing audit_card - what gets sent to AI")
    print("="*60)
    
    # This will log compact_card keys
    issues, tokens = await asyncio.to_thread(
        gemini.audit_card, 
        test_card, 
        "Техническое описание: на фото костюм с брюками, бежевый цвет"
    )
    
    print(f"\n✅ Found {len(issues)} issues")
    print(f"📊 Tokens: {tokens}")
    
    if issues:
        print("\nIssues found:")
        for i, issue in enumerate(issues[:3], 1):
            print(f"  {i}. {issue.get('name')}: {issue.get('message')}")


async def test_generate_fixes():
    """Test what generate_fixes sends to AI"""
    gemini = GeminiService()
    
    test_card = {
        "subjectName": "Костюмы",
        "brand": "ZARA",
        "title": "Костюм женский летний",  # ← Should NOT be sent
        "description": "Красивый стильный костюм...",  # ← Should NOT be sent
        "characteristics": [
            {"name": "Тип низа", "value": "брюки"},
            {"name": "Цвет", "value": "бежевый"},
        ]
    }
    
    test_issues = [
        {
            "id": "0",
            "name": "Тип низа",
            "error_type": "allowed_values",
            "message": "Неверное значение",
            "allowed_values": ["юбка", "брюки", "шорты"],
        }
    ]
    
    print("\n" + "="*60)
    print("🔍 Testing generate_fixes - what gets sent to AI")
    print("="*60)
    
    fixes, tokens = await asyncio.to_thread(
        gemini.generate_fixes,
        test_card,
        test_issues,
        "Техническое описание: на фото костюм с брюками, бежевый цвет"
    )
    
    print(f"\n✅ Generated {len(fixes)} fixes")
    print(f"📊 Tokens: {tokens}")
    
    if fixes:
        print("\nFixes:")
        for key, fix in list(fixes.items())[:3]:
            print(f"  {key}: {fix.get('recommended_value')}")


if __name__ == "__main__":
    print("\n" + "="*60)
    print("🧪 AI Logging Test")
    print("="*60)
    print("\nChecking what data is sent to AI...")
    print("✅ = Should be sent")
    print("❌ = Should NOT be sent")
    print("\nExpected:")
    print("  ✅ characteristics")
    print("  ✅ brand, subjectName")
    print("  ❌ title")
    print("  ❌ description")
    
    asyncio.run(test_audit())
    asyncio.run(test_generate_fixes())
    
    print("\n" + "="*60)
    print("✅ Test complete! Check logs above for '[audit_card]' and '[generate_fixes]'")
    print("="*60 + "\n")
