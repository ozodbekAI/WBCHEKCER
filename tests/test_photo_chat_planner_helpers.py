from __future__ import annotations

import asyncio
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.controllers.photo_chat_controller import PhotoChatController
from app.services.gemini_api import GeminiApiError
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
            model="gemini-3.1-pro-preview",
            model_profile="quality",
            allow_quality_fallback=False,
        )
    )

    assert result == {"intent": "chat", "assistant_message": "ok"}
    assert captured["thread_context"] == {"last_generated_asset_id": 99}
    assert captured["trace_id"] == "test-trace"
    assert captured["recent_image_bytes"] == [(1, b"123", "image/jpeg")]
    assert captured["model"] == "gemini-3.1-pro-preview"
    assert captured["model_profile"] == "quality"
    assert captured["allow_quality_fallback"] is False


def test_generate_content_with_fallback_retries_when_model_is_missing():
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append((model, service_tier, timeout_s, max_retries))
            if model == "gemini-3.1-pro-preview":
                raise GeminiApiError("Gemini error 404: NOT_FOUND")
            return {"ok": True, "model": model, "contents": contents}

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    result = asyncio.run(
        agent._generate_content_with_fallback(
            model="gemini-3.1-pro-preview",
            fallback_model="gemini-3.1-flash-lite-preview",
            contents=[{"role": "user", "parts": [{"text": "hello"}]}],
            trace_id="fallback-test",
            operation="generate_text",
        )
    )

    assert result["model"] == "gemini-3.1-flash-lite-preview"
    assert agent.api.calls == [
        ("gemini-3.1-pro-preview", None, None, None),
        ("gemini-3.1-flash-lite-preview", None, None, None),
    ]


def test_generate_content_with_fallback_does_not_retry_for_non_retryable_errors():
    class _FakeApi:
        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            raise GeminiApiError("Gemini error 400: bad request")

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    try:
        asyncio.run(
            agent._generate_content_with_fallback(
                model="gemini-3.1-pro-preview",
                fallback_model="gemini-3.1-flash-lite-preview",
                contents=[{"role": "user", "parts": [{"text": "hello"}]}],
                trace_id="fallback-test",
                operation="generate_text",
            )
        )
    except GeminiApiError as exc:
        assert "400" in str(exc)
    else:
        raise AssertionError("Expected GeminiApiError to be raised")


def test_generate_content_with_fallback_retries_when_model_is_temporarily_unavailable():
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append((model, service_tier, timeout_s, max_retries))
            if model == "gemini-3-pro-image-preview":
                raise GeminiApiError("Gemini error 503: model is experiencing high demand and is UNAVAILABLE")
            return {"ok": True, "model": model, "contents": contents}

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    result = asyncio.run(
        agent._generate_content_with_fallback(
            model="gemini-3-pro-image-preview",
            fallback_model="gemini-3.1-flash-image-preview",
            contents=[{"role": "user", "parts": [{"text": "hello"}]}],
            trace_id="fallback-test",
            operation="edit_or_generate_image",
        )
    )

    assert result["model"] == "gemini-3.1-flash-image-preview"
    assert agent.api.calls == [
        ("gemini-3-pro-image-preview", None, None, None),
        ("gemini-3-pro-image-preview", None, None, None),
        ("gemini-3.1-flash-image-preview", None, None, None),
    ]


def test_generate_content_with_fallback_retries_when_model_times_out():
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append((model, service_tier, timeout_s, max_retries))
            if model == "gemini-3-pro-image-preview":
                raise GeminiApiError("Gemini error timeout: ReadTimeout")
            return {"ok": True, "model": model, "contents": contents}

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    result = asyncio.run(
        agent._generate_content_with_fallback(
            model="gemini-3-pro-image-preview",
            fallback_model="gemini-3.1-flash-image-preview",
            contents=[{"role": "user", "parts": [{"text": "hello"}]}],
            timeout_s=35,
            fallback_timeout_s=45,
            trace_id="fallback-test",
            operation="edit_or_generate_image",
        )
    )

    assert result["model"] == "gemini-3.1-flash-image-preview"
    assert agent.api.calls == [
        ("gemini-3-pro-image-preview", None, 35, None),
        ("gemini-3-pro-image-preview", None, 35, None),
        ("gemini-3.1-flash-image-preview", None, 45, None),
    ]


def test_generate_content_with_fallback_retries_without_service_tier_when_not_entitled():
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append((model, service_tier, timeout_s, max_retries))
            if service_tier == "priority":
                raise GeminiApiError("Gemini error 403: Priority inference is available to Tier 2 & Tier 3 users")
            return {"ok": True, "model": model, "service_tier": service_tier}

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    result = asyncio.run(
        agent._generate_content_with_fallback(
            model="gemini-3.1-pro-preview",
            fallback_model="gemini-3.1-flash-lite-preview",
            contents=[{"role": "user", "parts": [{"text": "hello"}]}],
            service_tier="priority",
            trace_id="fallback-test",
            operation="generate_text",
        )
    )

    assert result["model"] == "gemini-3.1-pro-preview"
    assert result["service_tier"] is None
    assert agent.api.calls == [
        ("gemini-3.1-pro-preview", "priority", None, None),
        ("gemini-3.1-pro-preview", None, None, None),
    ]


def test_generate_content_with_fallback_blocks_quality_downgrade_when_disabled():
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append((model, service_tier, timeout_s, max_retries))
            raise GeminiApiError("Gemini error 503: high demand")

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    try:
        asyncio.run(
            agent._generate_content_with_fallback(
                model="gemini-3.1-pro-preview",
                fallback_model="gemini-3.1-flash-lite-preview",
                contents=[{"role": "user", "parts": [{"text": "hello"}]}],
                allow_quality_fallback=False,
                trace_id="fallback-test",
                operation="plan_action_vision",
            )
        )
    except GeminiApiError as exc:
        assert "503" in str(exc)
    else:
        raise AssertionError("Expected GeminiApiError to be raised")

    assert agent.api.calls == [
        ("gemini-3.1-pro-preview", None, None, None),
        ("gemini-3.1-pro-preview", None, None, None),
    ]


def test_plan_action_text_blocks_quality_downgrade_when_disabled(monkeypatch):
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append((model, service_tier, timeout_s, max_retries))
            raise GeminiApiError("Gemini error 503: high demand")

    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MODEL_FALLBACK", "gemini-3.1-flash-lite-preview")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_SERVICE_TIER", "standard")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_TIMEOUT_S", 15)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MAX_RETRIES", 0)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_FALLBACK_MAX_RETRIES", 1)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_THINKING_LEVEL", "low")

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    try:
        asyncio.run(
            agent.plan_action_text(
                user_message="hello there",
                history=[{"role": "user", "text": "hello there"}],
                assets=[],
                thread_context={},
                allow_quality_fallback=False,
                trace_id="planner-text-no-fallback",
            )
        )
    except GeminiApiError as exc:
        assert "503" in str(exc)
    else:
        raise AssertionError("Expected GeminiApiError to be raised")

    assert agent.api.calls == [
        ("gemini-3.1-pro-preview", "standard", 15, 0),
        ("gemini-3.1-pro-preview", "standard", 15, 0),
    ]


def test_needs_vision_planner_routes_by_assets_context_and_message():
    agent = PhotoChatAgent.__new__(PhotoChatAgent)

    assert agent.needs_vision_planner(user_message="hello there", assets=[], recent_image_bytes=None, thread_context={}) is False
    assert agent.needs_vision_planner(user_message="remove background", assets=[], recent_image_bytes=None, thread_context={}) is True
    assert agent.needs_vision_planner(user_message="hello there", assets=[{"asset_id": 1}], recent_image_bytes=None, thread_context={}) is True
    assert agent.needs_vision_planner(user_message="same but brighter", assets=[], recent_image_bytes=None, thread_context={"last_generated_asset_id": 4}) is True


def test_planner_image_limit_is_two_by_default_and_four_for_explicit_multi_image_requests():
    agent = PhotoChatAgent.__new__(PhotoChatAgent)

    assert agent.planner_image_limit(
        user_message="make it brighter",
        assets=[{"asset_id": 1}, {"asset_id": 2}],
        recent_image_bytes=[(1, b"a", "image/jpeg"), (2, b"b", "image/jpeg")],
        thread_context={},
    ) == 2
    assert agent.planner_image_limit(
        user_message="Put the outfit from Image 1 onto Image 2",
        assets=[{"asset_id": 1}, {"asset_id": 2}],
        recent_image_bytes=[(1, b"a", "image/jpeg"), (2, b"b", "image/jpeg")],
        thread_context={},
    ) == 4


def test_model_resolution_uses_profile_defaults_and_validates_requested_model(caplog):
    agent = PhotoChatAgent.__new__(PhotoChatAgent)

    assert agent._resolve_text_model(None, "fast") == "gemini-3.1-flash-lite-preview"
    assert agent._resolve_image_model(None, "quality") == "gemini-3-pro-image-preview"
    assert agent._resolve_vision_model("gemini-3.1-pro-preview", "fast") == "gemini-3.1-pro-preview"

    with caplog.at_level("WARNING", logger="photo.chat.agent"):
        resolved = agent._resolve_image_model("gemini-2.5-pro", "quality")

    assert resolved == "gemini-3-pro-image-preview"
    assert "invalid requested image model" in caplog.text


def test_generate_text_uses_low_thinking_and_fast_failover_settings(monkeypatch):
    class _FakeApi:
        def __init__(self):
            self.calls = []

        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            self.calls.append(
                {
                    "model": model,
                    "generation_config": generation_config,
                    "service_tier": service_tier,
                    "timeout_s": timeout_s,
                    "max_retries": max_retries,
                }
            )
            return {
                "candidates": [{"content": {"parts": [{"text": "OK"}], "role": "model"}, "finishReason": "STOP", "index": 0}],
                "usageMetadata": {},
            }

        @staticmethod
        def extract_text_and_images(resp):
            return "OK", []

    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MODEL_FALLBACK", "gemini-3.1-flash-lite-preview")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_SERVICE_TIER", "standard")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_TIMEOUT_S", 15)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MAX_RETRIES", 0)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_FALLBACK_MAX_RETRIES", 1)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_THINKING_LEVEL", "low")

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    result = asyncio.run(agent.generate_text("hello", history=[]))

    assert result == "OK"
    assert agent.api.calls == [
        {
            "model": "gemini-3.1-pro-preview",
            "generation_config": {"thinkingConfig": {"thinkingLevel": "low"}},
            "service_tier": "standard",
            "timeout_s": 15,
            "max_retries": 0,
        }
    ]


def test_generate_text_logs_selected_and_actual_models(monkeypatch, caplog):
    class _FakeApi:
        async def generate_content(self, *, model, contents, generation_config=None, service_tier=None, timeout_s=None, max_retries=None):
            return {
                "modelVersion": "gemini-3.1-pro-preview",
                "candidates": [{"content": {"parts": [{"text": "OK"}], "role": "model"}, "finishReason": "STOP", "index": 0}],
                "usageMetadata": {},
            }

        @staticmethod
        def extract_text_and_images(resp):
            return "OK", []

    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MODEL_FALLBACK", "gemini-3.1-flash-lite-preview")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_SERVICE_TIER", "standard")
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_TIMEOUT_S", 15)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_MAX_RETRIES", 0)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_FALLBACK_MAX_RETRIES", 1)
    monkeypatch.setattr("app.services.photo_chat_agent.settings.GEMINI_TEXT_THINKING_LEVEL", "low")

    agent = PhotoChatAgent.__new__(PhotoChatAgent)
    agent.api = _FakeApi()
    agent._sem = asyncio.Semaphore(1)

    with caplog.at_level("INFO", logger="photo.chat.agent"):
        result = asyncio.run(agent.generate_text("hello", history=[], model="gemini-3.1-pro-preview", trace_id="log-test"))

    assert result == "OK"
    assert "selected_model=gemini-3.1-pro-preview" in caplog.text
    assert "actual_model_used=gemini-3.1-pro-preview" in caplog.text
