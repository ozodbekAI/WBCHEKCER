from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.shop import Shop
from app.models.feedback import Feedback
from app.models.question import Question
from app.models.enums import JobType, DraftStatus
from app.repos.shop_repo import ShopRepo
from app.repos.feedback_repo import FeedbackRepo
from app.repos.draft_repo import DraftRepo
from app.repos.question_repo import QuestionRepo
from app.repos.question_draft_repo import QuestionDraftRepo
from app.repos.job_repo import JobRepo
from app.repos.chat_repo import ChatRepo
from app.repos.shop_billing_repo import ShopBillingRepo
from app.repos.system_flags_repo import SystemFlagsRepo
from app.services.sync import sync_feedbacks, sync_questions
from app.services.product_cards_sync import sync_product_cards
from app.services.openai_client import OpenAIService
from app.services.prompt_store import get_global_bundle
from app.services.drafting import generate_draft_text, effective_mode_for_rating, contains_blacklist
from app.services.question_drafting import generate_question_draft_text
from app.services.gpt_accounting import record_gpt_usage
from app.services.wb_client import WBClient
from app.core.crypto import decrypt_secret
from app.services.wb_chat_client import WBChatClient
from app.services.chat_drafting import generate_chat_reply


async def handle_job(session: AsyncSession, job_type: str, payload: dict) -> None:
    if job_type == JobType.sync_shop.value:
        await _job_sync_shop(session, payload)
        return
    if job_type == JobType.sync_questions.value:
        await _job_sync_questions(session, payload)
        return
    if job_type == JobType.generate_draft.value:
        await _job_generate_draft(session, payload)
        return
    if job_type == JobType.publish_answer.value:
        await _job_publish_answer(session, payload)
        return
    if job_type == JobType.generate_question_draft.value:
        await _job_generate_question_draft(session, payload)
        return
    if job_type == JobType.publish_question_answer.value:
        await _job_publish_question_answer(session, payload)
        return
    if job_type == JobType.sync_chats.value:
        await _job_sync_chats(session, payload)
        return
    if job_type == JobType.sync_chat_events.value:
        await _job_sync_chat_events(session, payload)
        return
    if job_type == JobType.generate_chat_draft.value:
        await _job_generate_chat_draft(session, payload)
        return
    if job_type == JobType.send_chat_message.value:
        await _job_send_chat_message(session, payload)
        return
    if job_type == JobType.sync_product_cards.value:
        await _job_sync_product_cards(session, payload)
        return
    raise ValueError(f"Unknown job type: {job_type}")


async def _ensure_ops_allowed(session: AsyncSession, settings_obj, kind: str) -> None:
    if await SystemFlagsRepo(session).is_kill_switch_on():
        raise RuntimeError("Kill switch enabled")

    cfg = getattr(settings_obj, "config", None) or {}
    if bool(cfg.get("kill_switch")):
        raise RuntimeError("Kill switch enabled")
    if kind == "generation" and bool(cfg.get("generation_disabled")):
        raise RuntimeError("Generation disabled")
    if kind == "publish" and bool(cfg.get("publishing_disabled")):
        raise RuntimeError("Publishing disabled")


def _text_hits_blacklist(text: str | None, keywords: list) -> bool:
    if not text:
        return False
    t = text.lower()
    for kw in keywords or []:
        if isinstance(kw, str) and kw.strip() and kw.strip().lower() in t:
            return True
    return False


async def _job_sync_shop(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    raw_is_answered = payload.get("is_answered", None)
    # None means "sync all" (both answered and unanswered)
    is_answered: bool | None
    if raw_is_answered is None:
        is_answered = None
    else:
        is_answered = bool(raw_is_answered)
    take = int(payload.get("take", 500))
    skip = int(payload.get("skip", 0))
    order = payload.get("order", "dateDesc")
    date_from_unix = payload.get("date_from_unix")
    date_to_unix = payload.get("date_to_unix")
    max_total = payload.get("max_total")

    shop = await session.get(Shop, shop_id)
    if not shop:
        return

    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return
    await _ensure_ops_allowed(session, settings_obj, "publish")

    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return

    await _ensure_ops_allowed(session, settings_obj, "generation")
    await _ensure_ops_allowed(session, settings_obj, "publish")
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return

    await _ensure_ops_allowed(session, settings_obj, "generation")

    statuses = (False, True) if is_answered is None else (is_answered,)
    for status in statuses:
        await sync_feedbacks(
            session,
            shop,
            settings_obj,
            is_answered=status,
            take=take,
            skip=skip,
            order=order,
            date_from_unix=date_from_unix,
            date_to_unix=date_to_unix,
            max_total=int(max_total) if max_total is not None else None,
        )

    # Reconcile old waiting items:
    # if text/pros/cons are all empty, no reply is needed -> move to answered bucket.
    repo = FeedbackRepo(session)
    await repo.mark_empty_unanswered_as_answered(shop_id=shop_id)

    # Also process previously drafted answers when sync/start runs:
    # if store is in auto-publish mode, old drafted items should be sent too.
    # Only rating_mode_map matters - min_rating_to_autopublish is ignored
    if settings_obj.automation_enabled and settings_obj.auto_publish and (is_answered is None or is_answered is False):
        pending_drafts = await DraftRepo(session).list_pending(shop_id=shop_id, limit=1000)
        job_repo = JobRepo(session)
        for d in pending_drafts:
            fb = getattr(d, "feedback", None)
            if not fb:
                continue
            if fb.answer_text or d.status != DraftStatus.drafted.value:
                continue
            rating = fb.product_valuation or 0
            eff_mode = effective_mode_for_rating(settings_obj, rating)
            if eff_mode != "auto":
                continue
            if contains_blacklist(fb, settings_obj):
                continue
            await job_repo.enqueue(
                JobType.publish_answer.value,
                {"shop_id": shop_id, "feedback_id": fb.id, "draft_id": d.id, "source": "auto"},
            )

    if settings_obj.automation_enabled and settings_obj.auto_draft and (is_answered is None or is_answered is False) and (settings_obj.reply_mode in ("semi", "auto")):
        # Auto-generate drafts for newest unanswered feedbacks, but respect
        # (1) per-sync limit and (2) owner's credit balance.
        per_sync_limit = int(getattr(settings_obj, "auto_draft_limit_per_sync", 0) or 0)
        credits_per_draft = int(getattr(settings, "CREDITS_PER_DRAFT", 1) or 1)

        available = await ShopBillingRepo(session).get_balance(shop_id)
        max_by_balance = available // credits_per_draft if credits_per_draft > 0 else per_sync_limit

        if per_sync_limit > 0:
            cap = min(per_sync_limit, max_by_balance)
        else:
            cap = max_by_balance

        if cap > 0:
            # We may skip some feedbacks based on rating mode; fetch a bit more to fill the cap.
            feedbacks = await repo.list_unanswered_without_drafts(shop_id=shop_id, limit=max(cap * 3, cap))
            job_repo = JobRepo(session)
            queued = 0
            for fb in feedbacks:
                if queued >= cap:
                    break
                eff_mode = effective_mode_for_rating(settings_obj, fb.product_valuation or 0)
                if eff_mode == "manual":
                    continue
                await job_repo.enqueue(
                    JobType.generate_draft.value,
                    {"shop_id": shop_id, "feedback_id": fb.id, "source": "auto"},
                )
                queued += 1

    await session.flush()


async def _job_sync_questions(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    raw_is_answered = payload.get("is_answered", None)
    is_answered: bool | None
    if raw_is_answered is None:
        is_answered = None
    else:
        is_answered = bool(raw_is_answered)
    take = int(payload.get("take", 500))
    skip = int(payload.get("skip", 0))
    order = payload.get("order", "dateDesc")
    date_from_unix = payload.get("date_from_unix")
    date_to_unix = payload.get("date_to_unix")

    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return

    statuses = (False, True) if is_answered is None else (is_answered,)
    for status in statuses:
        await sync_questions(
            session,
            shop,
            settings_obj,
            is_answered=status,
            take=take,
            skip=skip,
            order=order,
            date_from_unix=date_from_unix,
            date_to_unix=date_to_unix,
        )

    # Update last questions sync timestamp
    settings_obj.last_questions_sync_at = datetime.now(timezone.utc)
    await session.flush()


async def _job_sync_product_cards(session: AsyncSession, payload: dict) -> None:
    """Sync product cards (Content API) to be able to return product photos with feedbacks."""
    shop_id = int(payload["shop_id"])
    pages = int(payload.get("pages", 5))
    limit = int(payload.get("limit", 100))

    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return

    await sync_product_cards(session, shop, settings_obj, pages=pages, limit=limit)

    await session.flush()


async def _job_generate_draft(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    feedback_id = int(payload["feedback_id"])
    source = (payload.get("source") or "auto").lower()

    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return

    # Start/Stop toggle: if this job came from the scheduler, respect automation_enabled.
    if source == "auto" and not bool(getattr(settings_obj, "automation_enabled", False)):
        return

    feedback = await session.get(Feedback, feedback_id)
    if not feedback or feedback.answer_text:
        return

    # If rating is configured as 'manual', auto jobs should not generate.
    rating = feedback.product_valuation or 0
    eff_mode = effective_mode_for_rating(settings_obj, rating)
    if source == "auto" and eff_mode == "manual":
        return

    # Billing: charge credits before spending OpenAI tokens.
    credits_per_draft = int(getattr(settings, "CREDITS_PER_DRAFT", 1) or 1)
    charged = False
    if credits_per_draft > 0:
        charged = await ShopBillingRepo(session).try_charge(
            shop_id,
            amount=credits_per_draft,
            reason="feedback_draft",
            meta={"shop_id": shop_id, "feedback_id": feedback_id, "wb_id": feedback.wb_id},
        )
        if not charged:
            raise RuntimeError("Insufficient credits")

    # If blacklist detected -> keep manual workflow (still can draft, but never auto-publish)
    bl_hit = contains_blacklist(feedback, settings_obj)

    openai = OpenAIService()
    bundle = await get_global_bundle(session)
    try:
        text, model, response_id, prompt_tokens, completion_tokens, _debug_report = await generate_draft_text(
            openai, feedback, settings_obj, bundle=bundle
        )
    except Exception:
        # Refund credits if generation failed.
        if charged and credits_per_draft > 0:
            await ShopBillingRepo(session).apply_credits(
                shop_id,
                delta=credits_per_draft,
                reason="refund_feedback_draft_error",
                meta={"shop_id": shop_id, "feedback_id": feedback_id, "wb_id": feedback.wb_id},
            )
        raise
    draft = await DraftRepo(session).create(feedback_id=feedback.id, text=text, openai_model=model, openai_response_id=response_id)
    await record_gpt_usage(
        session,
        shop_id=shop_id,
        model=model,
        operation_type="review_draft",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        response_id=response_id,
    )
    # rating-based workflow (already computed above)

    # Auto-publish decision: respect store settings
    # 1. automation_enabled must be true
    # 2. auto_publish setting must be enabled
    # 3. rating must be >= min_rating_to_autopublish
    # 4. no blacklist keywords
    # 5. rating mode must be "auto"
    should_auto_publish = (
        source == "auto" and 
        bool(getattr(settings_obj, "automation_enabled", False)) and
        bool(getattr(settings_obj, "auto_publish", False)) and
        (rating >= int(getattr(settings_obj, "min_rating_to_autopublish", 0))) and
        (not bl_hit) and 
        eff_mode == "auto"
    )
    
    if should_auto_publish:
        await JobRepo(session).enqueue(
            JobType.publish_answer.value,
            {"shop_id": shop_id, "feedback_id": feedback.id, "draft_id": draft.id, "source": "auto"},
        )


async def _job_publish_answer(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    feedback_id = int(payload["feedback_id"])
    draft_id = payload.get("draft_id")
    source = (payload.get("source") or "auto").lower()

    shop = await session.get(Shop, shop_id)
    if not shop:
        return

    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return
    await _ensure_ops_allowed(session, settings_obj, "publish")

    if source == "auto" and not bool(getattr(settings_obj, "automation_enabled", False)):
        # Auto-publish is disabled.
        return
    feedback = await session.get(Feedback, feedback_id)
    if not feedback or feedback.answer_text:
        return

    draft_repo = DraftRepo(session)
    draft = None
    if draft_id is not None:
        draft = await draft_repo.get(int(draft_id))
    if draft is None:
        draft = await draft_repo.latest_for_feedback(feedback.id)
    if not draft:
        return

    # Optional billing for publish step (defaults to 0 credits).
    credits_per_publish = int(getattr(settings, "CREDITS_PER_PUBLISH", 0) or 0)
    publish_charged = False
    if credits_per_publish > 0:
        publish_charged = await ShopBillingRepo(session).try_charge(
            shop_id,
            amount=credits_per_publish,
            reason="feedback_publish",
            meta={"shop_id": shop_id, "feedback_id": feedback_id, "wb_id": feedback.wb_id, "draft_id": draft.id},
        )
        if not publish_charged:
            raise RuntimeError("Insufficient credits")

    token = decrypt_secret(shop.wb_token_enc)
    wb = WBClient(token=token)
    try:
        await wb.feedback_answer_create(wb_id=feedback.wb_id, text=draft.text)
    except Exception:
        if publish_charged and credits_per_publish > 0:
            await ShopBillingRepo(session).apply_credits(
                shop_id,
                delta=credits_per_publish,
                reason="refund_feedback_publish_error",
                meta={"shop_id": shop_id, "feedback_id": feedback_id, "wb_id": feedback.wb_id, "draft_id": draft.id},
            )
        raise
    finally:
        await wb.aclose()

    feedback.answer_text = draft.text
    feedback.answer_state = "system"
    draft.status = DraftStatus.published.value
    await session.flush()


async def _job_generate_question_draft(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    question_id = int(payload["question_id"])

    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj:
        return

    question = await session.get(Question, question_id)
    if not question or question.answer_text:
        return

    bl_hit = _text_hits_blacklist(question.text, settings_obj.blacklist_keywords)

    # Billing: charge credits before spending OpenAI tokens.
    credits_per_draft = int(getattr(settings, "CREDITS_PER_DRAFT", 1) or 1)
    charged = False
    if credits_per_draft > 0:
        charged = await ShopBillingRepo(session).try_charge(
            shop_id,
            amount=credits_per_draft,
            reason="question_draft",
            meta={"shop_id": shop_id, "question_id": question_id, "wb_id": question.wb_id},
        )
        if not charged:
            raise RuntimeError("Insufficient credits")

    openai = OpenAIService()
    bundle = await get_global_bundle(session)
    try:
        text, model, response_id, prompt_tokens, completion_tokens, _debug_report = await generate_question_draft_text(
            openai, question, settings_obj, bundle=bundle
        )
    except Exception:
        if charged and credits_per_draft > 0:
            await ShopBillingRepo(session).apply_credits(
                shop_id,
                delta=credits_per_draft,
                reason="refund_question_draft_error",
                meta={"shop_id": shop_id, "question_id": question_id, "wb_id": question.wb_id},
            )
        raise
    draft = await QuestionDraftRepo(session).create(question_id=question.id, text=text, openai_model=model, openai_response_id=response_id)
    await record_gpt_usage(
        session,
        shop_id=shop_id,
        model=model,
        operation_type="question_draft",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        response_id=response_id,
    )

    # UI parity: auto-publish for questions is defined by mode = "auto" (plus blacklist guard).
    # Older versions also had `questions_auto_publish`, but it would block UI mode.
    if (not bl_hit) and settings_obj.questions_reply_mode == "auto":
        await JobRepo(session).enqueue(
            JobType.publish_question_answer.value,
            {"shop_id": shop_id, "question_id": question.id, "draft_id": draft.id},
        )


async def _job_publish_question_answer(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    question_id = int(payload["question_id"])
    draft_id = payload.get("draft_id")

    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    question = await session.get(Question, question_id)
    if not question or question.answer_text:
        return

    draft_repo = QuestionDraftRepo(session)
    draft = None
    if draft_id is not None:
        draft = await draft_repo.get(int(draft_id))
    if draft is None:
        draft = await draft_repo.latest_for_question(question.id)
    if not draft:
        return

    token = decrypt_secret(shop.wb_token_enc)
    wb = WBClient(token=token)
    try:
        await wb.question_answer_or_edit(wb_id=question.wb_id, text=draft.text)
    finally:
        await wb.aclose()

    question.answer_text = draft.text
    draft.status = DraftStatus.published.value
    draft.published_at = datetime.now(timezone.utc)
    await session.flush()


async def _job_sync_chats(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj or not settings_obj.chat_enabled:
        return

    await _ensure_ops_allowed(session, settings_obj, "publish")

    await _ensure_ops_allowed(session, settings_obj, "generation")

    token = decrypt_secret(shop.wb_token_enc)
    client = WBChatClient(token=token)
    try:
        resp = await client.chats_list()
    finally:
        await client.aclose()

    chats = resp.get("result") or []
    repo = ChatRepo(session)
    for ch in chats:
        await repo.upsert_session(shop_id=shop_id, payload=ch)

    settings_obj.last_chat_sync_at = datetime.now(timezone.utc)
    await session.flush()


async def _job_sync_chat_events(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj or not settings_obj.chat_enabled:
        return

    token = decrypt_secret(shop.wb_token_enc)
    client = WBChatClient(token=token)
    try:
        resp = await client.events(next_ms=settings_obj.chat_next_ms)
    finally:
        await client.aclose()

    result = resp.get("result") or {}
    nxt = result.get("next")
    total = result.get("totalEvents") or 0
    events = result.get("events") or []

    repo = ChatRepo(session)
    for ev in events:
        await repo.add_event(shop_id=shop_id, ev=ev)

    if nxt is not None:
        settings_obj.chat_next_ms = int(nxt)

    settings_obj.last_chat_sync_at = datetime.now(timezone.utc)

    # If there are still events to consume, re-enqueue one more pull (keeps each job short).
    if int(total) > 0:
        await JobRepo(session).enqueue(JobType.sync_chat_events.value, {"shop_id": shop_id})

    await session.flush()


async def _job_generate_chat_draft(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    chat_id = payload["chat_id"]

    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj or not settings_obj.chat_enabled:
        return

    repo = ChatRepo(session)
    events = await repo.list_events(shop_id=shop_id, chat_id=chat_id, limit=50, offset=0)
    last_text = None
    ctx = None
    for ev in events:
        msg = ev.message or {}
        t = msg.get("text") if isinstance(msg, dict) else None
        if t:
            last_text = t
            ctx = (msg.get("attachments") or {}) if isinstance(msg, dict) else None
            break
    if not last_text:
        return

    # Billing: charge credits before spending OpenAI tokens.
    credits_per_draft = int(getattr(settings, "CREDITS_PER_DRAFT", 1) or 1)
    charged = False
    if credits_per_draft > 0:
        charged = await ShopBillingRepo(session).try_charge(
            shop_id,
            amount=credits_per_draft,
            reason="chat_draft",
            meta={"shop_id": shop_id, "chat_id": chat_id},
        )
        if not charged:
            raise RuntimeError("Insufficient credits")

    openai = OpenAIService()
    bundle = await get_global_bundle(session)
    try:
        text, model, rid, prompt_tokens, completion_tokens, _debug_report = await generate_chat_reply(
            openai, settings_obj, last_text, context=ctx, bundle=bundle
        )
    except Exception:
        if charged and credits_per_draft > 0:
            await ShopBillingRepo(session).apply_credits(
                shop_id,
                delta=credits_per_draft,
                reason="refund_chat_draft_error",
                meta={"shop_id": shop_id, "chat_id": chat_id},
            )
        raise

    await repo.create_draft(shop_id=shop_id, chat_id=chat_id, text=text, openai_model=model, openai_response_id=rid)
    await record_gpt_usage(
        session,
        shop_id=shop_id,
        model=model,
        operation_type="chat_reply",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        response_id=rid,
    )
    await record_gpt_usage(
        session,
        shop_id=shop_id,
        model=model,
        operation_type="chat_reply",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        response_id=rid,
    )


async def _job_send_chat_message(session: AsyncSession, payload: dict) -> None:
    shop_id = int(payload["shop_id"])
    chat_id = payload["chat_id"]
    text = payload.get("text")

    shop = await session.get(Shop, shop_id)
    if not shop:
        return
    settings_obj = await ShopRepo(session).get_settings(shop_id)
    if not settings_obj or not settings_obj.chat_enabled:
        return

    repo = ChatRepo(session)
    sess = await repo.get_session_by_chat_id(shop_id=shop_id, chat_id=chat_id)
    if not sess:
        return

    if not text:
        d = await repo.latest_draft(shop_id=shop_id, chat_id=chat_id)
        if not d:
            return
        text = d.text

    token = decrypt_secret(shop.wb_token_enc)
    client = WBChatClient(token=token)
    try:
        await client.send_message(reply_sign=sess.reply_sign, message=text)
    finally:
        await client.aclose()
