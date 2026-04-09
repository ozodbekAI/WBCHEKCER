from datetime import datetime
from pathlib import Path
import sys
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import AsyncSessionLocal
from app.core.security import create_access_token
from app.core.time import utc_now
from app.main import app
from app.models import (
    ApprovalStatus,
    Card,
    CardApproval,
    CardIssue,
    IssueCategory,
    IssueSeverity,
    IssueStatus,
    Store,
    StoreStatus,
    User,
    UserRole,
)


pytestmark = pytest.mark.asyncio


async def test_team_scope_and_cross_store_guards():
    suffix = uuid4().hex[:8]
    owner_a = owner_b = member_a = inactive_member = outsider = None
    store_a = store_b = card_b = approval_b = None

    try:
        async with AsyncSessionLocal() as session:
            owner_a = User(
                email=f"qa-owner-a-{suffix}@example.com",
                hashed_password="x",
                role=UserRole.OWNER,
                is_active=True,
                is_verified=True,
            )
            owner_b = User(
                email=f"qa-owner-b-{suffix}@example.com",
                hashed_password="x",
                role=UserRole.OWNER,
                is_active=True,
                is_verified=True,
            )
            member_a = User(
                email=f"qa-member-a-{suffix}@example.com",
                hashed_password="x",
                role=UserRole.MANAGER,
                is_active=True,
                is_verified=True,
            )
            inactive_member = User(
                email=f"qa-member-inactive-{suffix}@example.com",
                hashed_password="x",
                role=UserRole.VIEWER,
                is_active=False,
                is_verified=True,
            )
            outsider = User(
                email=f"qa-outsider-{suffix}@example.com",
                hashed_password="x",
                role=UserRole.OWNER,
                is_active=True,
                is_verified=True,
            )
            session.add_all([owner_a, owner_b, member_a, inactive_member, outsider])
            await session.commit()
            for user in (owner_a, owner_b, member_a, inactive_member, outsider):
                await session.refresh(user)

            store_a = Store(
                owner_id=owner_a.id,
                name=f"QA Store A {suffix}",
                api_key="qa-key-a",
                status=StoreStatus.ACTIVE,
            )
            store_b = Store(
                owner_id=owner_b.id,
                name=f"QA Store B {suffix}",
                api_key="qa-key-b",
                status=StoreStatus.ACTIVE,
            )
            session.add_all([store_a, store_b])
            await session.commit()
            await session.refresh(store_a)
            await session.refresh(store_b)

            member_a.store_id = store_a.id
            inactive_member.store_id = store_a.id
            await session.commit()

            card_a = Card(
                store_id=store_a.id,
                nm_id=10000001,
                vendor_code=f"qa-a-{suffix}",
                title="Card A",
                raw_data={"title": "Card A"},
            )
            card_b = Card(
                store_id=store_b.id,
                nm_id=10000002,
                vendor_code=f"qa-b-{suffix}",
                title="Card B",
                raw_data={"title": "Card B"},
            )
            session.add_all([card_a, card_b])
            await session.commit()
            await session.refresh(card_a)
            await session.refresh(card_b)

            issue_a = CardIssue(
                card_id=card_a.id,
                code=f"qa-issue-a-{suffix}",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.TITLE,
                title="Issue A",
                status=IssueStatus.FIXED,
                current_value="old",
                fixed_value="new",
                fixed_at=utc_now(),
                fixed_by_id=member_a.id,
            )
            issue_b = CardIssue(
                card_id=card_b.id,
                code=f"qa-issue-b-{suffix}",
                severity=IssueSeverity.WARNING,
                category=IssueCategory.TITLE,
                title="Issue B",
                status=IssueStatus.FIXED,
                current_value="old",
                fixed_value="new",
                fixed_at=utc_now(),
                fixed_by_id=member_a.id,
            )
            approval_b = CardApproval(
                store_id=store_b.id,
                card_id=card_b.id,
                prepared_by_id=owner_b.id,
                status=ApprovalStatus.PENDING,
                changes=[],
                total_fixes=0,
            )
            session.add_all([issue_a, issue_b, approval_b])
            await session.commit()
            await session.refresh(approval_b)

        owner_a_headers = {"Authorization": f"Bearer {create_access_token({'sub': str(owner_a.id)})}"}
        outsider_headers = {"Authorization": f"Bearer {create_access_token({'sub': str(outsider.id)})}"}

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            outsider_roles = await client.get(f"/stores/{store_a.id}/team/roles", headers=outsider_headers)
            assert outsider_roles.status_code == 403

            outsider_members = await client.get(f"/stores/{store_a.id}/team/members", headers=outsider_headers)
            assert outsider_members.status_code == 403

            owner_members = await client.get(f"/stores/{store_a.id}/team/members", headers=owner_a_headers)
            assert owner_members.status_code == 200
            member_emails = {row["email"] for row in owner_members.json()}
            assert owner_a.email in member_emails
            assert member_a.email in member_emails
            assert inactive_member.email in member_emails
            assert outsider.email not in member_emails
            assert owner_b.email not in member_emails

            foreign_update = await client.patch(
                f"/stores/{store_a.id}/team/members/{owner_b.id}",
                headers=owner_a_headers,
                json={"role": "viewer"},
            )
            assert foreign_update.status_code == 404

            foreign_submit = await client.post(
                f"/stores/{store_a.id}/team/approvals/submit",
                headers=owner_a_headers,
                json={"card_id": card_b.id},
            )
            assert foreign_submit.status_code == 404

            foreign_review = await client.post(
                f"/stores/{store_a.id}/team/approvals/{approval_b.id}/review",
                headers=owner_a_headers,
                json={"action": "approve"},
            )
            assert foreign_review.status_code == 404

            activity = await client.get(f"/stores/{store_a.id}/team/activity", headers=owner_a_headers)
            assert activity.status_code == 200
            members = activity.json()["members"]
            member_entry = next(row for row in members if row["email"] == member_a.email)
            assert member_entry["fixes_today"] == 1
            assert member_entry["fixes_all_time"] == 1
    finally:
        async with AsyncSessionLocal() as session:
            if store_a is not None and store_b is not None:
                await session.execute(delete(Store).where(Store.id.in_([store_a.id, store_b.id])))
            if all(user is not None for user in (owner_a, owner_b, member_a, inactive_member, outsider)):
                await session.execute(delete(User).where(User.id.in_([
                    owner_a.id,
                    owner_b.id,
                    member_a.id,
                    inactive_member.id,
                    outsider.id,
                ])))
            await session.commit()
