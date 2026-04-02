from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, List, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import (
    ActivityLog,
    CardConfirmedSection,
    CardDraft,
    CardIssue,
    IssueStatus,
    TeamTicket,
    TicketStatus,
    TicketType,
    User,
    UserRole,
)
from ..schemas.workflow import (
    CardConfirmationSummaryOut,
    CardDraftOut,
    TeamActionOut,
    TeamSessionOut,
    TeamTicketOut,
    TeamWorkDayOut,
    TeamWorkMemberOut,
    TeamWorklogOut,
)


CARD_WORKFLOW_SECTIONS = (
    "basic",
    "description",
    "characteristics",
    "sizes",
    "media",
    "package",
    "docs",
)


def _utc_now() -> datetime:
    return datetime.utcnow()


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone().replace(tzinfo=None)
    return dt


def _user_name(user: Optional[User], fallback_id: Optional[int] = None) -> Optional[str]:
    if user:
        return user.full_name
    if fallback_id:
        return f"Пользователь #{fallback_id}"
    return None


def _draft_to_out(draft: CardDraft) -> CardDraftOut:
    return CardDraftOut(
        id=draft.id,
        card_id=draft.card_id,
        author_id=draft.author_id,
        author_name=_user_name(draft.author, draft.author_id),
        data=draft.data or {},
        updated_at=draft.updated_at,
    )


async def get_preferred_card_draft(
    db: AsyncSession,
    card_id: int,
    current_user_id: int,
) -> Optional[CardDraftOut]:
    own_r = await db.execute(
        select(CardDraft)
        .where(CardDraft.card_id == card_id, CardDraft.author_id == current_user_id)
        .options(selectinload(CardDraft.author))
        .order_by(CardDraft.updated_at.desc())
        .limit(1)
    )
    own = own_r.scalar_one_or_none()
    if own:
        return _draft_to_out(own)

    latest_r = await db.execute(
        select(CardDraft)
        .where(CardDraft.card_id == card_id)
        .options(selectinload(CardDraft.author))
        .order_by(CardDraft.updated_at.desc())
        .limit(1)
    )
    latest = latest_r.scalar_one_or_none()
    return _draft_to_out(latest) if latest else None


async def save_card_draft(
    db: AsyncSession,
    card_id: int,
    author_id: int,
    data: dict[str, Any],
) -> CardDraftOut:
    result = await db.execute(
        select(CardDraft)
        .where(CardDraft.card_id == card_id, CardDraft.author_id == author_id)
        .options(selectinload(CardDraft.author))
    )
    draft = result.scalar_one_or_none()
    if draft:
        draft.data = data
        draft.updated_at = _utc_now()
    else:
        draft = CardDraft(card_id=card_id, author_id=author_id, data=data)
        db.add(draft)
    await db.commit()
    await db.refresh(draft)
    await db.refresh(draft, attribute_names=["author"])
    return _draft_to_out(draft)


async def delete_card_draft(
    db: AsyncSession,
    card_id: int,
    author_id: int,
) -> bool:
    result = await db.execute(
        select(CardDraft).where(CardDraft.card_id == card_id, CardDraft.author_id == author_id)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        return False
    await db.delete(draft)
    await db.commit()
    return True


async def list_confirmed_sections(db: AsyncSession, card_id: int) -> list[str]:
    result = await db.execute(
        select(CardConfirmedSection.section)
        .where(CardConfirmedSection.card_id == card_id)
        .order_by(CardConfirmedSection.section.asc())
    )
    return [section for section in result.scalars().all() if section]


async def get_card_confirmation_summaries(
    db: AsyncSession,
    card_ids: list[int],
) -> dict[int, CardConfirmationSummaryOut]:
    ids = [int(card_id) for card_id in card_ids if int(card_id) > 0]
    if not ids:
        return {}

    total_sections = len(CARD_WORKFLOW_SECTIONS)
    summaries = {
        card_id: CardConfirmationSummaryOut(total_sections=total_sections)
        for card_id in ids
    }
    seen_sections: dict[int, set[str]] = defaultdict(set)

    result = await db.execute(
        select(CardConfirmedSection)
        .where(
            CardConfirmedSection.card_id.in_(ids),
            CardConfirmedSection.section.in_(CARD_WORKFLOW_SECTIONS),
        )
        .options(selectinload(CardConfirmedSection.confirmed_by))
        .order_by(
            CardConfirmedSection.card_id.asc(),
            CardConfirmedSection.updated_at.desc(),
            CardConfirmedSection.id.desc(),
        )
    )

    for row in result.scalars().all():
        summary = summaries.get(row.card_id)
        if not summary:
            continue

        section = (row.section or "").strip().lower()
        if section and section not in seen_sections[row.card_id]:
            seen_sections[row.card_id].add(section)
            summary.confirmed_count += 1

        if summary.last_confirmed_at is None:
            summary.last_confirmed_at = row.updated_at
            summary.last_confirmed_by_id = row.confirmed_by_id
            summary.last_confirmed_by_name = _user_name(row.confirmed_by, row.confirmed_by_id)

    for summary in summaries.values():
        summary.is_fully_confirmed = summary.confirmed_count >= summary.total_sections

    return summaries


async def confirm_card_section(
    db: AsyncSession,
    card_id: int,
    section: str,
    user_id: int,
) -> None:
    result = await db.execute(
        select(CardConfirmedSection).where(
            CardConfirmedSection.card_id == card_id,
            CardConfirmedSection.section == section,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.confirmed_by_id = user_id
        row.updated_at = _utc_now()
    else:
        db.add(CardConfirmedSection(card_id=card_id, section=section, confirmed_by_id=user_id))
    await db.commit()


async def unconfirm_card_section(
    db: AsyncSession,
    card_id: int,
    section: str,
) -> bool:
    result = await db.execute(
        select(CardConfirmedSection).where(
            CardConfirmedSection.card_id == card_id,
            CardConfirmedSection.section == section,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


def _ticket_to_out(ticket: TeamTicket) -> TeamTicketOut:
    return TeamTicketOut(
        id=ticket.id,
        type=ticket.type.value if hasattr(ticket.type, "value") else str(ticket.type),
        status=ticket.status.value if hasattr(ticket.status, "value") else str(ticket.status),
        store_id=ticket.store_id,
        issue_id=ticket.issue_id,
        approval_id=ticket.approval_id,
        card_id=ticket.card_id,
        issue_title=ticket.issue_title,
        issue_severity=ticket.issue_severity,
        issue_code=ticket.issue_code,
        card_title=ticket.card_title,
        card_photo=ticket.card_photo,
        card_nm_id=ticket.card_nm_id,
        card_vendor_code=ticket.card_vendor_code,
        from_user_id=ticket.from_user_id,
        from_user_name=_user_name(ticket.from_user, ticket.from_user_id),
        to_user_id=ticket.to_user_id,
        to_user_name=_user_name(ticket.to_user, ticket.to_user_id),
        note=ticket.note,
        created_at=ticket.created_at,
        completed_at=ticket.completed_at,
    )


async def create_team_ticket(
    db: AsyncSession,
    *,
    store_id: int,
    from_user_id: int,
    to_user_id: int,
    ticket_type: str,
    issue_id: Optional[int] = None,
    approval_id: Optional[int] = None,
    card_id: Optional[int] = None,
    issue_title: Optional[str] = None,
    issue_severity: Optional[str] = None,
    issue_code: Optional[str] = None,
    card_title: Optional[str] = None,
    card_photo: Optional[str] = None,
    card_nm_id: Optional[int] = None,
    card_vendor_code: Optional[str] = None,
    note: Optional[str] = None,
) -> TeamTicketOut:
    ticket = TeamTicket(
        store_id=store_id,
        type=TicketType(ticket_type),
        status=TicketStatus.PENDING,
        issue_id=issue_id,
        approval_id=approval_id,
        card_id=card_id,
        issue_title=issue_title,
        issue_severity=issue_severity,
        issue_code=issue_code,
        card_title=card_title,
        card_photo=card_photo,
        card_nm_id=card_nm_id,
        card_vendor_code=card_vendor_code,
        from_user_id=from_user_id,
        to_user_id=to_user_id,
        note=note,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)

    result = await db.execute(
        select(TeamTicket)
        .where(TeamTicket.id == ticket.id)
        .options(
            selectinload(TeamTicket.from_user),
            selectinload(TeamTicket.to_user),
        )
    )
    full = result.scalar_one()
    return _ticket_to_out(full)


async def create_team_tickets(
    db: AsyncSession,
    *,
    store_id: int,
    from_user_id: int,
    to_user_ids: list[int],
    ticket_type: str,
    issue_id: Optional[int] = None,
    approval_id: Optional[int] = None,
    card_id: Optional[int] = None,
    issue_title: Optional[str] = None,
    issue_severity: Optional[str] = None,
    issue_code: Optional[str] = None,
    card_title: Optional[str] = None,
    card_photo: Optional[str] = None,
    card_nm_id: Optional[int] = None,
    card_vendor_code: Optional[str] = None,
    note: Optional[str] = None,
) -> List[TeamTicketOut]:
    normalized_ids: list[int] = []
    seen: set[int] = set()
    for raw_id in to_user_ids or []:
        try:
            user_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if user_id <= 0 or user_id in seen:
            continue
        seen.add(user_id)
        normalized_ids.append(user_id)

    if not normalized_ids:
        return []

    tickets: list[TeamTicket] = []
    for to_user_id in normalized_ids:
        ticket = TeamTicket(
            store_id=store_id,
            type=TicketType(ticket_type),
            status=TicketStatus.PENDING,
            issue_id=issue_id,
            approval_id=approval_id,
            card_id=card_id,
            issue_title=issue_title,
            issue_severity=issue_severity,
            issue_code=issue_code,
            card_title=card_title,
            card_photo=card_photo,
            card_nm_id=card_nm_id,
            card_vendor_code=card_vendor_code,
            from_user_id=from_user_id,
            to_user_id=to_user_id,
            note=note,
        )
        tickets.append(ticket)
        db.add(ticket)

    await db.flush()
    created_ids = [ticket.id for ticket in tickets if ticket.id]
    await db.commit()

    result = await db.execute(
        select(TeamTicket)
        .where(TeamTicket.id.in_(created_ids))
        .options(
            selectinload(TeamTicket.from_user),
            selectinload(TeamTicket.to_user),
        )
        .order_by(TeamTicket.id.asc())
    )
    created = {ticket.id: _ticket_to_out(ticket) for ticket in result.scalars().all()}
    return [created[ticket_id] for ticket_id in created_ids if ticket_id in created]


async def list_team_tickets(
    db: AsyncSession,
    *,
    store_id: int,
    participant_user_id: int,
    status_filter: Optional[str] = None,
    ticket_type: Optional[str] = None,
) -> list[TeamTicketOut]:
    query = (
        select(TeamTicket)
        .where(
            TeamTicket.store_id == store_id,
            or_(
                TeamTicket.from_user_id == participant_user_id,
                TeamTicket.to_user_id == participant_user_id,
            ),
        )
        .options(
            selectinload(TeamTicket.from_user),
            selectinload(TeamTicket.to_user),
        )
        .order_by(TeamTicket.created_at.desc())
    )

    if status_filter:
        try:
            query = query.where(TeamTicket.status == TicketStatus(status_filter))
        except ValueError:
            return []
    if ticket_type:
        try:
            query = query.where(TeamTicket.type == TicketType(ticket_type))
        except ValueError:
            return []

    result = await db.execute(query)
    return [_ticket_to_out(ticket) for ticket in result.scalars().all()]


async def mark_team_ticket_done(
    db: AsyncSession,
    *,
    store_id: int,
    ticket_id: int,
    current_user_id: int,
) -> Optional[TeamTicketOut]:
    result = await db.execute(
        select(TeamTicket)
        .where(TeamTicket.id == ticket_id, TeamTicket.store_id == store_id)
        .options(
            selectinload(TeamTicket.from_user),
            selectinload(TeamTicket.to_user),
        )
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        return None
    if ticket.status != TicketStatus.DONE:
        ticket.status = TicketStatus.DONE
        ticket.completed_at = _utc_now()
        ticket.completed_by_id = current_user_id
        await db.commit()
        await db.refresh(ticket)
    return _ticket_to_out(ticket)


async def log_team_activity(
    db: AsyncSession,
    *,
    user_id: int,
    store_id: int,
    action: str,
    label: str,
    timestamp: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    created_at = _parse_iso(timestamp) or _utc_now()
    details = {
        "label": label,
        "timestamp": created_at.isoformat(),
        "meta": meta or {},
    }
    entity_type = None
    entity_id = None
    if isinstance(meta, dict):
        if meta.get("issueId") is not None:
            entity_type = "issue"
            entity_id = meta.get("issueId")
        elif meta.get("cardId") is not None:
            entity_type = "card"
            entity_id = meta.get("cardId")
        elif meta.get("nmId") is not None:
            entity_type = "card"
            entity_id = meta.get("nmId")

    db.add(
        ActivityLog(
            user_id=user_id,
            store_id=store_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id if isinstance(entity_id, int) else None,
            details=details,
            created_at=created_at,
        )
    )
    await db.commit()


def _session_minutes(ms: int) -> int:
    return max(0, int(round(ms / 60000)))


def _dt_iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _ensure_day_bucket(days: dict[str, dict[str, int]], date_key: str) -> dict[str, int]:
    if date_key not in days:
        days[date_key] = {"minutes": 0, "sessions": 0, "fixes": 0}
    return days[date_key]


def _build_sessions(actions: list[TeamActionOut], now: datetime) -> list[TeamSessionOut]:
    sessions: list[TeamSessionOut] = []
    active: Optional[dict[str, Any]] = None

    def flush_session(force_end: Optional[datetime] = None) -> None:
        nonlocal active
        if not active:
            return
        started_at = active["started_at"]
        last_dt = active.get("last_dt") or started_at
        ended_at = active.get("ended_at") or force_end
        effective_end = ended_at or last_dt or now
        active_time_ms = max(0, int((effective_end - started_at).total_seconds() * 1000))
        sessions.append(
            TeamSessionOut(
                id=active["id"],
                startedAt=started_at.isoformat(),
                endedAt=_dt_iso(ended_at),
                activeTimeMs=active_time_ms,
                actions=active["actions"],
            )
        )
        active = None

    for action in actions:
        action_dt = _parse_iso(action.timestamp) or now
        if action.type == "session_started":
            flush_session(force_end=action_dt)
            active = {
                "id": action.id,
                "started_at": action_dt,
                "ended_at": None,
                "last_dt": action_dt,
                "actions": [action],
            }
            continue

        if not active:
            active = {
                "id": f"implicit-{action.id}",
                "started_at": action_dt,
                "ended_at": None,
                "last_dt": action_dt,
                "actions": [],
            }

        active["actions"].append(action)
        active["last_dt"] = action_dt

        if action.type == "session_ended":
            active["ended_at"] = action_dt
            flush_session()

    flush_session()
    return sessions


async def build_team_worklog(
    db: AsyncSession,
    *,
    store_id: int,
    days: int = 30,
) -> TeamWorklogOut:
    safe_days = max(7, min(days, 30))
    now = _utc_now()
    start_date = (now - timedelta(days=safe_days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    today_key = now.date().isoformat()
    week_start = (now - timedelta(days=6)).date().isoformat()

    users_r = await db.execute(
        select(User).where(
            User.is_active == True,
            User.role != UserRole.ADMIN,
            or_(User.store_id == store_id, User.stores.any(id=store_id)),
        )
    )
    users = list(users_r.scalars().all())
    if not users:
        return TeamWorklogOut(members=[], total_today_minutes=0, total_week_minutes=0, team_daily=[])

    user_ids = [u.id for u in users]

    logs_r = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.store_id == store_id,
            ActivityLog.user_id.in_(user_ids),
            ActivityLog.created_at >= start_date,
        )
        .order_by(ActivityLog.user_id.asc(), ActivityLog.created_at.asc(), ActivityLog.id.asc())
    )
    logs = list(logs_r.scalars().all())

    fixes_r = await db.execute(
        select(CardIssue)
        .where(
            CardIssue.fixed_by_id.in_(user_ids),
            CardIssue.status.in_([IssueStatus.FIXED, IssueStatus.AUTO_FIXED]),
            CardIssue.fixed_at >= start_date,
        )
        .order_by(CardIssue.fixed_by_id.asc(), CardIssue.fixed_at.asc())
    )
    fixes = list(fixes_r.scalars().all())

    logs_by_user: dict[int, list[TeamActionOut]] = defaultdict(list)
    for log in logs:
        details = log.details or {}
        meta = details.get("meta") if isinstance(details.get("meta"), dict) else {}
        ts = details.get("timestamp") if isinstance(details, dict) else None
        logs_by_user[log.user_id].append(
            TeamActionOut(
                id=str(log.id),
                type=log.action,
                label=details.get("label") or log.action,
                timestamp=ts or log.created_at.isoformat(),
                meta=meta or {},
            )
        )

    fixes_by_user: dict[int, list[CardIssue]] = defaultdict(list)
    for issue in fixes:
        if issue.fixed_by_id:
            fixes_by_user[issue.fixed_by_id].append(issue)

    day_keys = [
        (start_date + timedelta(days=offset)).date().isoformat()
        for offset in range(safe_days)
    ]

    members: list[TeamWorkMemberOut] = []
    for user in users:
        actions = logs_by_user.get(user.id, [])
        sessions = _build_sessions(actions, now)

        day_map: dict[str, dict[str, int]] = {}
        for key in day_keys:
            day_map[key] = {"minutes": 0, "sessions": 0, "fixes": 0}

        for session in sessions:
            key = session.startedAt[:10]
            if key in day_map:
                bucket = _ensure_day_bucket(day_map, key)
                bucket["minutes"] += _session_minutes(session.activeTimeMs)
                bucket["sessions"] += 1

        actions_today = 0
        for action in actions:
            if action.timestamp[:10] == today_key and action.type not in {"session_started", "session_ended"}:
                actions_today += 1

        fixes_today = 0
        fixes_week = 0
        for issue in fixes_by_user.get(user.id, []):
            key = issue.fixed_at.date().isoformat() if issue.fixed_at else None
            if not key:
                continue
            if key == today_key:
                fixes_today += 1
            if key >= week_start:
                fixes_week += 1
            if key in day_map and issue.status in {IssueStatus.FIXED, IssueStatus.AUTO_FIXED}:
                day_map[key]["fixes"] += 1

        today_minutes = day_map[today_key]["minutes"] if today_key in day_map else 0
        week_minutes = sum(day_map[key]["minutes"] for key in day_keys[-7:])
        month_minutes = sum(bucket["minutes"] for bucket in day_map.values())

        today_sessions = [session for session in sessions if session.startedAt[:10] == today_key]
        work_start_today = today_sessions[0].startedAt if today_sessions else None
        work_end_today = None
        if today_sessions:
            last_session = today_sessions[-1]
            work_end_today = last_session.endedAt or (last_session.actions[-1].timestamp if last_session.actions else None)

        members.append(
            TeamWorkMemberOut(
                id=user.id,
                name=user.full_name,
                email=user.email,
                role=user.role.value if hasattr(user.role, "value") else str(user.role),
                is_online=bool(user.last_active_at and (now - user.last_active_at).total_seconds() < 120),
                today_minutes=today_minutes,
                week_minutes=week_minutes,
                month_minutes=month_minutes,
                fixes_today=fixes_today,
                fixes_week=fixes_week,
                actions_today=actions_today,
                work_start_today=work_start_today,
                work_end_today=work_end_today,
                daily_breakdown=[
                    TeamWorkDayOut(
                        date=key,
                        minutes=day_map[key]["minutes"],
                        sessions=day_map[key]["sessions"],
                        fixes=day_map[key]["fixes"],
                    )
                    for key in day_keys
                ],
                sessions=sessions,
            )
        )

    members.sort(key=lambda item: (item.today_minutes, item.fixes_today, item.actions_today), reverse=True)

    team_daily: list[TeamWorkDayOut] = []
    for idx, key in enumerate(day_keys):
        team_daily.append(
            TeamWorkDayOut(
                date=key,
                minutes=sum(member.daily_breakdown[idx].minutes for member in members),
                sessions=sum(member.daily_breakdown[idx].sessions for member in members),
                fixes=sum(member.daily_breakdown[idx].fixes for member in members),
            )
        )

    total_today_minutes = sum(member.today_minutes for member in members)
    total_week_minutes = sum(member.week_minutes for member in members)

    return TeamWorklogOut(
        members=members,
        total_today_minutes=total_today_minutes,
        total_week_minutes=total_week_minutes,
        team_daily=team_daily,
    )
