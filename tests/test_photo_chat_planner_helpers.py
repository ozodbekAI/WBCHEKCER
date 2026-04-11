from __future__ import annotations

import asyncio
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.controllers.photo_chat_controller import PhotoChatController
from app.services.photo_chat_agent import PhotoChatAgent, resolve_photo_chat_locale


def test_resolve_photo_chat_locale_prefers_thread_locale():
    locale = resolve_photo_chat_locale(
        user_message="make it warmer",
        history=[{"role": "user", "text": "please edit the last one"}],
        thread_context={"locale": "ru-RU"},
    )

    assert locale == "ru"


def test_resolve_photo_chat_locale_falls_back_to_latest_user_message_language():
    locale = resolve_photo_chat_locale(
        user_message="[User sent 2 image(s) without text - understand intent from context]",
        history=[
            {"role": "model", "text": "What should I change?"},
            {"role": "user", "text": "iltimos fonini ochroq qiling"},
        ],
        thread_context={},
    )

    assert locale == "uz"


def test_strip_multi_words_preserves_image_refs():
    controller = PhotoChatController.__new__(PhotoChatController)

    cleaned = controller._strip_multi_words("Use Image 1 on Image 2 in a collage grid layout")

    assert "Image 1" in cleaned
    assert "Image 2" in cleaned
    assert "collage" not in cleaned.lower()
    assert "grid" not in cleaned.lower()


def test_make_single_image_prompt_keeps_refs_without_forced_background_outfit_or_full_body():
    controller = PhotoChatController.__new__(PhotoChatController)

    prompt = controller._make_single_image_prompt(
        "Put the jacket from Image 1 onto Image 2 and keep the lighting natural.",
        "Standing confidently, full body, hands relaxed, elegant posture",
    )

    assert "Image 1" in prompt
    assert "Image 2" in prompt
    assert "SAME location/background" not in prompt
    assert "SAME outfit" not in prompt
    assert "Full-body shot" not in prompt


def test_plan_action_with_context_delegates_to_plan_action_with_thread_context():
    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    captured = {}

    async def fake_plan_action(**kwargs):
        captured.update(kwargs)
        return {"intent": "chat", "assistant_message": "ok"}

    agent.plan_action = fake_plan_action

    result = asyncio.run(
        agent.plan_action_with_context(
            user_message="make it brighter",
            history=[{"role": "user", "text": "make it brighter"}],
            assets=[{"asset_id": 1}],
            thread_context={"last_generated_asset_id": 99},
            trace_id="test-trace",
            recent_image_bytes=[(1, b"123", "image/jpeg")],
        )
    )

    assert result == {"intent": "chat", "assistant_message": "ok"}
    assert captured["thread_context"] == {"last_generated_asset_id": 99}
    assert captured["trace_id"] == "test-trace"
    assert captured["recent_image_bytes"] == [(1, b"123", "image/jpeg")]
