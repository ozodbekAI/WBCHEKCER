from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.photo_chat import PhotoChatStreamRequest


def test_photo_chat_stream_request_accepts_and_normalizes_model_fields():
    payload = PhotoChatStreamRequest(
        message="  hello  ",
        planner_model="  gemini-3.1-pro-preview  ",
        generation_model="  gemini-3-pro-image-preview  ",
        model_profile="  quality  ",
        allow_quality_fallback=False,
    )

    assert payload.message == "hello"
    assert payload.planner_model == "gemini-3.1-pro-preview"
    assert payload.generation_model == "gemini-3-pro-image-preview"
    assert payload.model_profile == "quality"
    assert payload.allow_quality_fallback is False


def test_photo_chat_stream_request_remains_backward_compatible_without_new_fields():
    payload = PhotoChatStreamRequest(message="hello", asset_ids=[1, "2", "bad"])

    assert payload.message == "hello"
    assert payload.asset_ids == [1, 2]
    assert payload.planner_model is None
    assert payload.generation_model is None
    assert payload.model_profile is None
    assert payload.allow_quality_fallback is None
