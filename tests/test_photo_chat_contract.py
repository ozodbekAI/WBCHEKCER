from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.controllers.photo_chat_controller as controller_module
from app.controllers.photo_chat_controller import PhotoChatController, StreamState
from app.core.database import Base
from app.models.photo_chat import (
    PhotoChatMedia,
    PhotoChatMessage,
    PhotoChatSession,
    PhotoChatThread,
    default_photo_chat_thread_context,
)
from app.services.photo_chat_repository import PhotoChatRepository


def _make_repo() -> PhotoChatRepository:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(
        engine,
        tables=[
            PhotoChatSession.__table__,
            PhotoChatThread.__table__,
            PhotoChatMessage.__table__,
            PhotoChatMedia.__table__,
        ],
    )
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
    return PhotoChatRepository(session_factory())


def _parse_sse_chunk(chunk: str) -> dict:
    lines = [line for line in chunk.strip().splitlines() if line]
    assert lines[0] == "event: message"
    assert sum(1 for line in lines if line.startswith("event:")) == 1
    data_line = next(line for line in lines if line.startswith("data: "))
    return json.loads(data_line[len("data: ") :])


async def _collect_chunks(stream) -> list[str]:
    chunks: list[str] = []
    async for chunk in stream:
        chunks.append(chunk)
    return chunks


class _FakeGenerateAgent:
    def __init__(self):
        self.last_generation_kwargs = None

    def needs_vision_planner(self, **kwargs):
        return True

    def planner_image_limit(self, **kwargs):
        return 2

    async def plan_action(self, **kwargs):
        return {
            "intent": "generate_image",
            "assistant_message": "",
            "selected_asset_ids": None,
            "image_prompt": "Create a premium studio hero image with soft natural lighting.",
            "image_count": 1,
            "aspect_ratio": "1:1",
        }

    def build_rich_prompt(self, basic_prompt, selected_assets, selected_asset_ids):
        return basic_prompt

    async def edit_or_generate_image(self, **kwargs):
        self.last_generation_kwargs = kwargs
        return "", b"fake-image-bytes", "image/jpeg"

    async def describe_image_rich(self, *args, **kwargs):
        return {}

    async def generate_text(self, *args, **kwargs):
        return "fallback"


class _FakeQuestionAgent:
    def needs_vision_planner(self, **kwargs):
        return False

    def planner_image_limit(self, **kwargs):
        return 2

    async def plan_action(self, **kwargs):
        return {
            "intent": "question",
            "assistant_message": "",
            "selected_asset_ids": None,
            "image_prompt": None,
            "image_count": None,
            "aspect_ratio": None,
        }

    async def generate_text(self, *args, **kwargs):
        return "fallback"


class _FakeQuickActionAgent:
    def needs_vision_planner(self, **kwargs):
        return True

    def planner_image_limit(self, **kwargs):
        return 2

    async def describe_image_rich(self, *args, **kwargs):
        return {}


def test_only_message_event_is_used_for_supported_sse_payload_types():
    controller = PhotoChatController.__new__(PhotoChatController)
    state = StreamState(request_id="req-contract", thread_id=77)
    supported_types = [
        "ack",
        "chat",
        "question",
        "generation_start",
        "images_start",
        "image_started",
        "generation_complete",
        "error",
        "context_state",
    ]

    for payload_type in supported_types:
        payload = _parse_sse_chunk(controller._emit(state, payload_type, marker=payload_type))
        assert payload["type"] == payload_type
        assert payload["request_id"] == "req-contract"
        assert payload["thread_id"] == 77


def test_prompt_sanitization_preserves_image_refs():
    controller = PhotoChatController.__new__(PhotoChatController)

    cleaned = controller._strip_multi_words("Blend Image 1 into Image 2 as a collage grid composition")

    assert "Image 1" in cleaned
    assert "Image 2" in cleaned
    assert "collage" not in cleaned.lower()
    assert "grid" not in cleaned.lower()


def test_generate_image_stream_is_not_coerced_to_edit_image(monkeypatch):
    repo = _make_repo()
    controller = PhotoChatController.__new__(PhotoChatController)
    controller._agent = _FakeGenerateAgent()

    monkeypatch.setattr(controller_module, "_save_bytes_to_media_photos", lambda content, ext: "photos/contract-generated.jpg")
    monkeypatch.setattr(controller_module, "save_generated_metadata", lambda *args, **kwargs: None)

    chunks = asyncio.run(
        _collect_chunks(
            controller.chat_stream(
                user={"id": 808},
                db=repo.db,
                payload={
                    "message": "Create a new hero image for this campaign",
                    "request_id": "req-generate",
                    "base_url": "https://backend.example.com",
                },
            )
        )
    )

    payloads = [_parse_sse_chunk(chunk) for chunk in chunks]
    types = [payload["type"] for payload in payloads]

    assert all(chunk.startswith("event: message\n") for chunk in chunks)
    assert types == ["ack", "images_start", "image_started", "generation_complete", "chat", "context_state"]
    assert "question" not in types
    assert payloads[0]["request_id"] == "req-generate"
    assert payloads[0]["thread_id"] == payloads[-1]["thread_id"]

    session = repo.get_or_create_user_session(808)
    assert len(repo.list_media(session.id, limit=None)) == 1

    repo.db.close()


def test_generation_model_is_forwarded_to_image_generation(monkeypatch):
    repo = _make_repo()
    controller = PhotoChatController.__new__(PhotoChatController)
    controller._agent = _FakeGenerateAgent()

    monkeypatch.setattr(controller_module, "_save_bytes_to_media_photos", lambda content, ext: "photos/contract-generated.jpg")
    monkeypatch.setattr(controller_module, "save_generated_metadata", lambda *args, **kwargs: None)

    asyncio.run(
        _collect_chunks(
            controller.chat_stream(
                user={"id": 809},
                db=repo.db,
                payload={
                    "message": "Create a new hero image for this campaign",
                    "request_id": "req-generate-model",
                    "generation_model": "gemini-3-pro-image-preview",
                    "model_profile": "quality",
                    "allow_quality_fallback": False,
                    "base_url": "https://backend.example.com",
                },
            )
        )
    )

    assert controller._agent.last_generation_kwargs["model"] == "gemini-3-pro-image-preview"
    assert controller._agent.last_generation_kwargs["model_profile"] == "quality"
    assert controller._agent.last_generation_kwargs["allow_quality_fallback"] is False
    assert controller._agent.last_generation_kwargs["trace_id"] == "req-generate-model"

    repo.db.close()


def test_locale_behavior_uses_uzbek_for_question_fallback():
    controller = PhotoChatController.__new__(PhotoChatController)
    controller._agent = _FakeQuestionAgent()

    result = asyncio.run(
        controller._planner(
            user_message="iltimos fonini ochroq qiling",
            history=[{"role": "user", "text": "iltimos fonini ochroq qiling"}],
            assets=[],
            thread_context={},
        )
    )

    assert result.intent == "question"
    assert result.assistant_message == "Iltimos, aynan nimani o'zgartirish yoki yaratish kerakligini aniqlashtirib bering."


def test_image_sensitive_planner_failure_returns_controlled_question_without_text_degrade():
    class _FailingVisionAgent:
        def needs_vision_planner(self, **kwargs):
            return True

        async def plan_action(self, **kwargs):
            raise RuntimeError("planner crashed")

        async def generate_text(self, *args, **kwargs):
            raise AssertionError("generate_text must not be called for image-sensitive planner failures")

    controller = PhotoChatController.__new__(PhotoChatController)
    controller._agent = _FailingVisionAgent()

    result = asyncio.run(
        controller._planner(
            user_message="remove background from this image",
            history=[{"role": "user", "text": "remove background from this image"}],
            assets=[{"asset_id": 1, "caption": "shirt"}],
            thread_context={"working_asset_ids": [1]},
            recent_image_bytes=[(1, b"123", "image/jpeg")],
            planner_model="gemini-3.1-pro-preview",
            model_profile="quality",
            allow_quality_fallback=False,
            trace_id="planner-fail",
        )
    )

    assert result.intent == "question"
    assert "couldn't safely process that image request" in result.assistant_message.lower()


def test_generate_video_quick_action_stream_persists_result_without_name_error(monkeypatch):
    repo = _make_repo()
    controller = PhotoChatController.__new__(PhotoChatController)
    controller._agent = _FakeQuickActionAgent()

    session = repo.get_or_create_user_session(user_id=1202)
    source_media = repo.add_media(session.id, relpath="photos/source.jpg", kind="image", source="upload")
    repo.db.commit()

    async def _fake_generate_video(**kwargs):
        return {"video": b"fake-video-bytes"}

    monkeypatch.setattr(controller_module.kie_service, "generate_video", _fake_generate_video)
    monkeypatch.setattr(controller_module, "_save_bytes_to_media_photos", lambda content, ext: "photos/generated-video.mp4")
    monkeypatch.setattr(controller_module, "save_generated_file", lambda content, kind="image": "photos/generated-video.mp4")
    monkeypatch.setattr(controller_module, "save_generated_metadata", lambda *args, **kwargs: None)

    chunks = asyncio.run(
        _collect_chunks(
            controller.chat_stream(
                user={"id": 1202},
                db=repo.db,
                payload={
                    "message": "make a short promo video",
                    "request_id": "req-video",
                    "asset_ids": [source_media.id],
                    "quick_action": {
                        "type": "generate-video",
                        "prompt": "Create a short promo video",
                        "model": "hailuo/minimax-video-01-live",
                        "duration": 5,
                        "resolution": "720p",
                    },
                    "base_url": "https://backend.example.com",
                },
            )
        )
    )

    payloads = [_parse_sse_chunk(chunk) for chunk in chunks]
    types = [payload["type"] for payload in payloads]

    assert types == ["ack", "generation_start", "generation_complete", "context_state"]
    assert payloads[2]["media_type"] == "video"
    assert payloads[2]["image_url"].endswith("/media/photos/generated-video.mp4")

    session_assets = repo.list_media(session.id, limit=None)
    assert any(item.kind == "video" for item in session_assets)

    repo.db.close()


def test_clear_mode_all_resets_messages_and_context_but_keeps_media():
    repo = _make_repo()
    controller = PhotoChatController.__new__(PhotoChatController)

    session = repo.get_or_create_user_session(user_id=909)
    thread = repo.get_or_create_active_thread(session.id)
    media = repo.add_media(session.id, relpath="photos/persisted.jpg", kind="image", source="upload")
    repo.add_message(
        session_id=session.id,
        thread_id=thread.id,
        role="user",
        content="edit the last image",
        meta={"asset_ids": [media.id]},
    )
    repo.update_thread_context(
        thread.id,
        working_asset_ids=[media.id],
        last_generated_asset_id=media.id,
        pending_question="Which change?",
        locale="uz",
    )
    repo.db.commit()

    result = asyncio.run(
        controller.clear_history(
            user={"id": 909},
            db=repo.db,
            payload={"thread_id": thread.id, "clear_mode": "all"},
        )
    )

    assert result["clear_mode"] == "all"
    assert result["deleted"] == 1
    assert result["deleted_media"] == 0
    assert result["context_state"] == default_photo_chat_thread_context()
    assert repo.list_thread_messages(thread.id, limit=None) == []
    assert [item.id for item in repo.list_media(session.id, limit=None)] == [media.id]

    repo.db.close()


def test_history_endpoint_returns_requested_thread_and_context_state():
    repo = _make_repo()
    controller = PhotoChatController.__new__(PhotoChatController)

    session = repo.get_or_create_user_session(user_id=1001)
    original_thread = repo.get_or_create_active_thread(session.id)
    media = repo.add_media(session.id, relpath="photos/thread-asset.jpg", kind="image", source="upload")
    repo.add_message(
        session_id=session.id,
        thread_id=original_thread.id,
        request_id="req-history",
        role="user",
        content="edit Image 1",
        meta={"asset_ids": [media.id]},
    )
    repo.update_thread_context(
        original_thread.id,
        working_asset_ids=[media.id],
        last_generated_asset_id=media.id,
        locale="uz",
    )
    active_thread = repo.create_new_thread(session.id, context={"locale": "en"})
    repo.add_message(session_id=session.id, thread_id=active_thread.id, role="user", content="new thread")
    repo.db.commit()

    result = asyncio.run(
        controller.get_chat_history(
            user={"id": 1001},
            db=repo.db,
            thread_id=original_thread.id,
            base_url="https://backend.example.com",
        )
    )

    assert result["thread_id"] == original_thread.id
    assert result["active_thread_id"] == active_thread.id
    assert result["context_state"] == {
        "last_generated_asset_id": media.id,
        "working_asset_ids": [media.id],
        "pending_question": None,
        "last_action": None,
        "locale": "uz",
    }
    assert len(result["messages"]) == 1
    assert result["messages"][0]["thread_id"] == original_thread.id
    assert result["messages"][0]["request_id"] == "req-history"
    assert len(result["assets"]) == 1
    assert result["assets"][0]["file_url"] == "https://backend.example.com/media/photos/thread-asset.jpg"

    repo.db.close()
