from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.photo_error_mapper import map_photo_error


def test_map_photo_error_recovers_from_task_failed_wrapper():
    mapped = map_photo_error(
        "Task failed: Gemini could not generate an image with the given prompt. Please try again with a different prompt. (code: 500)",
        context="chat_stream:generation",
    )
    assert mapped["code"] == "photo_generation_empty_result"
    assert "Сформулируйте задачу проще" in str(mapped["message"])


def test_map_photo_error_handles_image_size_task_error():
    mapped = map_photo_error(
        "Task failed: Failed to create task: image_size is not within the range of allowed options (code: 500)",
        context="chat_stream",
    )
    assert mapped["code"] == "photo_invalid_image_size"
    assert "1:1" in str(mapped["message"])


def test_map_photo_error_exposes_gemini_http_details():
    mapped = map_photo_error(
        'Gemini error 500: {"error":{"message":"backend exploded"}}',
        context="chat_stream:generation",
    )
    assert mapped["code"] == "photo_gemini_upstream_error"
    assert mapped["provider"] == "gemini"
    assert mapped["where"] == "chat_stream:generation:gemini_http"
    assert mapped["debug"]["provider_status_code"] == 500
    assert mapped["debug"]["reason"] == "http_error"


def test_map_photo_error_exposes_block_reason_details():
    mapped = map_photo_error(
        "Gemini API javobni blokladi! Sabab (finishReason): SAFETY",
        context="chat_stream:generation",
    )
    assert mapped["code"] == "photo_generation_blocked"
    assert mapped["provider"] == "gemini"
    assert mapped["debug"]["finish_reason"] == "SAFETY"
    assert mapped["debug"]["where"] == "chat_stream:generation:gemini_finish_reason"
