from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import sys
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError
from sqlalchemy import delete, select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.routers.issues as issues_router_module
import app.services.card_service as card_service_module
from app.core.config import Settings
from app.core.database import AsyncSessionLocal, async_engine
from app.core.security import create_access_token, get_current_user
from app.main import app
from app.models import (
    Card,
    CardIssue,
    IssueCategory,
    IssueSeverity,
    IssueStatus,
    Store,
    StoreStatus,
    User,
    UserRole,
)
from app.schemas.issue import IssueFixRequest
from app.services.approval_service import apply_card_raw_snapshot
from app.services.card_scheduler import CardScheduler
from app.services.card_service import analyze_card, analyze_store_cards, should_refresh_product_dna
from app.services.issue_service import get_issue_stats, get_next_issue
from app.services.wb_validator import get_catalog, validate_card_characteristics


def _headers(user_id: int) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user_id)})}"}


async def _cleanup_entities(*, store_ids: list[int], user_ids: list[int]) -> None:
    async with AsyncSessionLocal() as session:
        if store_ids:
            await session.execute(delete(Store).where(Store.id.in_(store_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.id.in_(user_ids)))
        await session.commit()
    await async_engine.dispose()


async def _create_owner_and_store(session, suffix: str) -> tuple[User, Store]:
    owner = User(
        email=f"wb-backend-owner-{suffix}@example.com",
        hashed_password="x",
        role=UserRole.OWNER,
        is_active=True,
        is_verified=True,
    )
    session.add(owner)
    await session.commit()
    await session.refresh(owner)

    store = Store(
        owner_id=owner.id,
        name=f"WB Backend Store {suffix}",
        api_key=f"wb-key-{suffix}",
        status=StoreStatus.ACTIVE,
    )
    session.add(store)
    await session.commit()
    await session.refresh(store)
    return owner, store


def test_issue_fix_request_rejects_blank_fixed_value():
    with pytest.raises(ValidationError):
        IssueFixRequest(fixed_value="   ")


def test_settings_require_real_secret_key_in_production():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="production",
            SECRET_KEY="your-super-secret-key-change-in-production",
        )

    settings = Settings(
        _env_file=None,
        APP_ENV="development",
        SECRET_KEY="your-super-secret-key-change-in-production",
    )
    assert settings.APP_ENV == "development"


@pytest.mark.asyncio
async def test_get_current_user_returns_401_for_non_numeric_sub():
    class _FakeDB:
        async def execute(self, statement):
            raise AssertionError("DB must not be queried for invalid token payloads")

    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials=create_access_token({"sub": "abc"}),
    )

    with pytest.raises(HTTPException) as exc:
        await get_current_user(credentials=credentials, db=_FakeDB())

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_product_dna_is_reset_when_photos_or_subject_change():
    card = Card(
        subject_name="Old Subject",
        photos=["https://cdn.example.com/1.jpg"],
        raw_data={
            "subjectName": "Old Subject",
            "photos": [{"big": "https://cdn.example.com/1.jpg"}],
        },
        product_dna="cached-dna",
    )

    assert should_refresh_product_dna(card, next_raw_data=card.raw_data) is False
    assert should_refresh_product_dna(
        card,
        next_raw_data={
            "subjectName": "Old Subject",
            "photos": [{"big": "https://cdn.example.com/2.jpg"}],
        },
    ) is True
    assert should_refresh_product_dna(
        card,
        next_raw_data={
            "subjectName": "New Subject",
            "photos": [{"big": "https://cdn.example.com/1.jpg"}],
        },
    ) is True

    apply_card_raw_snapshot(
        card,
        {
            "subjectName": "Old Subject",
            "photos": [{"big": "https://cdn.example.com/2.jpg"}],
            "characteristics": [],
        },
    )
    assert card.product_dna is None


def test_required_characteristic_missing_is_critical():
    required_subject = 168
    required_names = [cm.name for cm in get_catalog().get_subject_chars(required_subject) if cm.required]
    assert required_names

    issues = validate_card_characteristics(
        {
            "subjectID": required_subject,
            "subjectName": "Куртки",
            "characteristics": [],
        }
    )

    missing_required = [issue for issue in issues if any(err.get("type") == "missing_required" for err in issue.get("errors", []))]
    assert missing_required
    assert all(issue["severity"] == "critical" for issue in missing_required)


@pytest.mark.asyncio
async def test_analyze_card_creates_title_issue_when_title_missing(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        monkeypatch.setattr(card_service_module.super_validator_service, "evaluate", lambda *args, **kwargs: {"final_score": 0})
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card = Card(
                store_id=store.id,
                nm_id=10010001,
                vendor_code=f"title-missing-{suffix}",
                title=None,
                description="x" * 1200,
                photos=["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg", "https://cdn.example.com/3.jpg"],
                videos=["https://cdn.example.com/video.mp4"],
                photos_count=3,
                videos_count=1,
                raw_data={
                    "description": "x" * 1200,
                    "photos": [
                        {"big": "https://cdn.example.com/1.jpg"},
                        {"big": "https://cdn.example.com/2.jpg"},
                        {"big": "https://cdn.example.com/3.jpg"},
                    ],
                    "videos": ["https://cdn.example.com/video.mp4"],
                },
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            await analyze_card(session, card, use_ai=False)

            result = await session.execute(
                select(CardIssue).where(CardIssue.card_id == card.id, CardIssue.code == "no_title")
            )
            issue = result.scalar_one_or_none()
            assert issue is not None
            assert issue.field_path == "title"
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_analyze_card_creates_description_issue_when_description_too_short(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        monkeypatch.setattr(card_service_module.super_validator_service, "evaluate", lambda *args, **kwargs: {"final_score": 0})
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card = Card(
                store_id=store.id,
                nm_id=10010002,
                vendor_code=f"description-short-{suffix}",
                title="T" * 45,
                description="too short",
                photos=["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg", "https://cdn.example.com/3.jpg"],
                videos=["https://cdn.example.com/video.mp4"],
                photos_count=3,
                videos_count=1,
                raw_data={
                    "title": "T" * 45,
                    "description": "too short",
                    "photos": [
                        {"big": "https://cdn.example.com/1.jpg"},
                        {"big": "https://cdn.example.com/2.jpg"},
                        {"big": "https://cdn.example.com/3.jpg"},
                    ],
                    "videos": ["https://cdn.example.com/video.mp4"],
                },
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            await analyze_card(session, card, use_ai=False)

            result = await session.execute(
                select(CardIssue).where(
                    CardIssue.card_id == card.id,
                    CardIssue.code == "description_too_short",
                )
            )
            issue = result.scalar_one_or_none()
            assert issue is not None
            assert issue.field_path == "description"
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_reanalyze_restores_skipped_issue_by_field_path_not_only_code(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        monkeypatch.setattr(card_service_module.super_validator_service, "evaluate", lambda *args, **kwargs: {"final_score": 0})
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card = Card(
                store_id=store.id,
                nm_id=10010003,
                vendor_code=f"restore-skip-{suffix}",
                title="T" * 45,
                description="D" * 1200,
                photos=["https://cdn.example.com/1.jpg"],
                photos_count=1,
                raw_data={
                    "title": "T" * 45,
                    "description": "D" * 1200,
                    "subjectID": 168,
                    "subjectName": "Куртки",
                    "photos": [{"big": "https://cdn.example.com/1.jpg"}],
                    "characteristics": [],
                },
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            await analyze_card(session, card, use_ai=False)

            result = await session.execute(
                select(CardIssue)
                .where(CardIssue.card_id == card.id, CardIssue.code == "wb_qualification")
                .order_by(CardIssue.field_path.asc())
            )
            issues = result.scalars().all()
            assert len(issues) >= 2

            skipped_issue = issues[0]
            other_issue = issues[1]
            skipped_field = skipped_issue.field_path
            other_field = other_issue.field_path

            skipped_issue.status = IssueStatus.SKIPPED
            skipped_issue.postpone_reason = "keep skipped"
            await session.commit()

            await analyze_card(session, card, use_ai=False)

            result = await session.execute(
                select(CardIssue)
                .where(CardIssue.card_id == card.id, CardIssue.code == "wb_qualification")
            )
            restored = {issue.field_path: issue for issue in result.scalars().all()}
            assert restored[skipped_field].status == IssueStatus.SKIPPED
            assert restored[skipped_field].postpone_reason == "keep skipped"
            assert restored[other_field].status == IssueStatus.PENDING
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_analyze_store_cards_limit_does_not_delete_other_cards_issues(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        analyzed_ids: list[int] = []

        async def _fake_analyze(db, card, use_ai=True):
            analyzed_ids.append(card.id)
            return [], {}

        monkeypatch.setattr(card_service_module, "analyze_card", _fake_analyze)

        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card_a = Card(store_id=store.id, nm_id=20010001, vendor_code=f"a-{suffix}", title="A", raw_data={"title": "A"})
            card_b = Card(store_id=store.id, nm_id=20010002, vendor_code=f"b-{suffix}", title="B", raw_data={"title": "B"})
            session.add_all([card_a, card_b])
            await session.commit()
            await session.refresh(card_a)
            await session.refresh(card_b)

            preserved_issue = CardIssue(
                card_id=card_b.id,
                code="preserved_issue",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.TITLE,
                title="Preserve me",
                status=IssueStatus.PENDING,
            )
            card_b.warnings_count = 1
            session.add(preserved_issue)
            await session.commit()

            await analyze_store_cards(session, store.id, use_ai=False, limit=1)

            assert len(analyzed_ids) == 1
            untouched_id = card_a.id if analyzed_ids[0] == card_b.id else card_b.id
            untouched = await session.get(Card, untouched_id)
            preserved_count = await session.execute(
                select(CardIssue).where(CardIssue.card_id == untouched_id)
            )
            assert len(preserved_count.scalars().all()) == 1
            if untouched_id == card_b.id:
                assert untouched.warnings_count == 1
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_scheduler_skip_flag_is_cleared_only_after_wb_timestamp_changes():
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            old_ts = datetime(2026, 4, 20, 10, 0, 0)
            card = Card(
                store_id=store.id,
                nm_id=30010001,
                vendor_code=f"scheduler-{suffix}",
                title="Scheduler",
                raw_data={"title": "Scheduler"},
                wb_updated_at=old_ts,
                skip_next_reanalyze=True,
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            scheduler = CardScheduler()

            unchanged = await scheduler._find_changed_cards(
                session,
                store.id,
                [{"nmID": card.nm_id, "updatedAt": old_ts.isoformat()}],
            )
            await session.refresh(card)
            assert unchanged == []
            assert card.skip_next_reanalyze is True

            own_update_ts = old_ts + timedelta(minutes=5)
            own_update = await scheduler._find_changed_cards(
                session,
                store.id,
                [{"nmID": card.nm_id, "updatedAt": own_update_ts.isoformat()}],
            )
            await session.refresh(card)
            assert own_update == []
            assert card.skip_next_reanalyze is False

            external_update_ts = own_update_ts + timedelta(minutes=5)
            external_update = await scheduler._find_changed_cards(
                session,
                store.id,
                [{"nmID": card.nm_id, "updatedAt": external_update_ts.isoformat()}],
            )
            assert external_update == [card.nm_id]
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_issue_stats_returns_by_category_and_next_issue_orders_by_card_priority():
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card_a = Card(
                store_id=store.id,
                nm_id=40010001,
                vendor_code=f"queue-a-{suffix}",
                title="Queue A",
                raw_data={"title": "Queue A"},
                critical_issues_count=3,
                warnings_count=0,
                improvements_count=0,
            )
            card_b = Card(
                store_id=store.id,
                nm_id=40010002,
                vendor_code=f"queue-b-{suffix}",
                title="Queue B",
                raw_data={"title": "Queue B"},
                critical_issues_count=1,
                warnings_count=0,
                improvements_count=0,
            )
            session.add_all([card_a, card_b])
            await session.commit()
            await session.refresh(card_a)
            await session.refresh(card_b)

            issue_a = CardIssue(
                card_id=card_a.id,
                code="title_issue",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.TITLE,
                title="Fix title",
                status=IssueStatus.PENDING,
            )
            issue_b = CardIssue(
                card_id=card_b.id,
                code="desc_issue",
                severity=IssueSeverity.CRITICAL,
                category=IssueCategory.DESCRIPTION,
                title="Fix description",
                status=IssueStatus.PENDING,
            )
            session.add_all([issue_a, issue_b])
            await session.commit()

            stats = await get_issue_stats(session, store.id)
            assert stats["by_category"]["title"] == 1
            assert stats["by_category"]["description"] == 1

            next_issue = await get_next_issue(session, store.id)
            assert next_issue is not None
            assert next_issue.card_id == card_a.id
            assert next_issue.id == issue_a.id
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_fix_issue_endpoint_rejects_invalid_allowed_value_and_wb_fixed_field(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    try:
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card = Card(
                store_id=store.id,
                nm_id=50010001,
                vendor_code=f"invalid-fix-{suffix}",
                title="Card title",
                raw_data={"title": "Card title", "characteristics": []},
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            invalid_issue = CardIssue(
                card_id=card.id,
                code="wb_allowed_values",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.CHARACTERISTICS,
                title="Invalid characteristic",
                field_path="characteristics.Цвет",
                allowed_values=["Красный", "Синий"],
                error_details=[{"type": "allowed_values"}],
                status=IssueStatus.PENDING,
            )
            wb_fixed_issue = CardIssue(
                card_id=card.id,
                code="wb_fixed_field",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.CHARACTERISTICS,
                title="Fixed characteristic",
                field_path="characteristics.Состав",
                status=IssueStatus.PENDING,
            )
            session.add_all([invalid_issue, wb_fixed_issue])
            await session.commit()
            await session.refresh(invalid_issue)
            await session.refresh(wb_fixed_issue)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            invalid_resp = await client.post(
                f"/stores/{store.id}/issues/{invalid_issue.id}/fix",
                headers=_headers(owner.id),
                json={"fixed_value": "zzzzzz", "apply_to_wb": False},
            )
            assert invalid_resp.status_code == 400
            assert any(
                marker in invalid_resp.json()["detail"].lower()
                for marker in ("допустимых", "палитру")
            )

            wb_fixed_resp = await client.post(
                f"/stores/{store.id}/issues/{wb_fixed_issue.id}/fix",
                headers=_headers(owner.id),
                json={"fixed_value": "manual", "apply_to_wb": False},
            )
            assert wb_fixed_resp.status_code == 400
            assert "cannot be fixed manually" in wb_fixed_resp.json()["detail"].lower()
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_fix_issue_endpoint_applies_single_characteristic_fix_to_wb(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    payloads: list[dict] = []

    class _FakeWB:
        async def update_card(self, payload):
            payloads.append(payload)
            return {"success": True}

    async def _noop_reanalyze(db, card):
        return None

    monkeypatch.setattr(issues_router_module, "_build_wb_client", lambda store: _FakeWB())
    monkeypatch.setattr(issues_router_module, "_safe_reanalyze_card_after_apply", _noop_reanalyze)

    try:
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card = Card(
                store_id=store.id,
                nm_id=60010001,
                vendor_code=f"apply-one-{suffix}",
                title="Card title",
                raw_data={
                    "title": "Card title",
                    "characteristics": [{"name": "Размер", "value": ["M"]}],
                },
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            issue = CardIssue(
                card_id=card.id,
                code="wb_allowed_values",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.CHARACTERISTICS,
                title="Fix size",
                field_path="characteristics.Размер",
                charc_id=123,
                allowed_values=["M", "L", "XL"],
                error_details=[{"type": "allowed_values"}],
                current_value="M",
                status=IssueStatus.PENDING,
            )
            session.add(issue)
            await session.commit()
            await session.refresh(issue)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                f"/stores/{store.id}/issues/{issue.id}/fix",
                headers=_headers(owner.id),
                json={"fixed_value": "L", "apply_to_wb": True},
            )
            assert response.status_code == 200

        assert payloads
        assert payloads[0]["nmID"] == 60010001
        assert any(item["name"] == "Размер" and item["value"] == ["L"] for item in payloads[0]["characteristics"])

        async with AsyncSessionLocal() as session:
            updated_card = await session.get(Card, card.id)
            updated_issue = await session.get(CardIssue, issue.id)
            assert updated_card.raw_data["characteristics"][0]["value"] == ["L"]
            assert updated_card.skip_next_reanalyze is True
            assert updated_issue.status == IssueStatus.FIXED
            assert updated_issue.fixed_value == "L"
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )


@pytest.mark.asyncio
async def test_apply_all_refreshes_local_snapshot_and_reanalyzes(monkeypatch):
    suffix = uuid4().hex[:8]
    owner = store = None
    payloads: list[dict] = []

    class _FakeWB:
        async def update_card(self, payload):
            payloads.append(payload)
            return {"success": True}

    async def _noop_reanalyze(db, card):
        return None

    monkeypatch.setattr(issues_router_module, "_build_wb_client", lambda store: _FakeWB())
    monkeypatch.setattr(issues_router_module, "_safe_reanalyze_card_after_apply", _noop_reanalyze)

    try:
        async with AsyncSessionLocal() as session:
            owner, store = await _create_owner_and_store(session, suffix)
            card = Card(
                store_id=store.id,
                nm_id=70010001,
                vendor_code=f"apply-all-{suffix}",
                title="Old title",
                description="Old description",
                raw_data={
                    "title": "Old title",
                    "description": "Old description",
                    "characteristics": [],
                },
            )
            session.add(card)
            await session.commit()
            await session.refresh(card)

            title_issue = CardIssue(
                card_id=card.id,
                code="title_issue",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.TITLE,
                title="Update title",
                field_path="title",
                fixed_value="New title",
                status=IssueStatus.FIXED,
            )
            description_issue = CardIssue(
                card_id=card.id,
                code="description_issue",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.DESCRIPTION,
                title="Update description",
                field_path="description",
                fixed_value="New description",
                status=IssueStatus.FIXED,
            )
            session.add_all([title_issue, description_issue])
            await session.commit()

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                f"/stores/{store.id}/issues/apply-all",
                headers=_headers(owner.id),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["applied"] == 2
            assert body["failed"] == 0

        assert payloads
        assert payloads[0]["title"] == "New title"
        assert payloads[0]["description"] == "New description"

        async with AsyncSessionLocal() as session:
            updated_card = await session.get(Card, card.id)
            title_issue_db = await session.execute(select(CardIssue).where(CardIssue.code == "title_issue"))
            description_issue_db = await session.execute(select(CardIssue).where(CardIssue.code == "description_issue"))
            title_issue_row = title_issue_db.scalar_one()
            description_issue_row = description_issue_db.scalar_one()

            assert updated_card.raw_data["title"] == "New title"
            assert updated_card.raw_data["description"] == "New description"
            assert updated_card.skip_next_reanalyze is True
            assert title_issue_row.status == IssueStatus.AUTO_FIXED
            assert description_issue_row.status == IssueStatus.AUTO_FIXED
    finally:
        await _cleanup_entities(
            store_ids=[store.id] if store is not None else [],
            user_ids=[owner.id] if owner is not None else [],
        )
