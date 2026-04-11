from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.controllers.photo_chat_controller import PhotoChatController, StreamState
from app.core.config import settings
from app.services.media_storage import get_file_url


def test_emit_uses_message_event_with_thread_and_request_ids():
    controller = PhotoChatController.__new__(PhotoChatController)

    chunk = controller._emit(
        StreamState(request_id="req-123", thread_id=42),
        "chat",
        content="hello",
    )

    assert chunk.startswith("event: message\n")
    assert "\nevent: generation_start\n" not in f"\n{chunk}"

    payload = json.loads(chunk.split("data: ", 1)[1])
    assert payload == {
        "type": "chat",
        "request_id": "req-123",
        "thread_id": 42,
        "content": "hello",
    }


def test_get_file_url_prefers_explicit_base_url_then_media_public_base(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://public.example.com")
    monkeypatch.setattr(settings, "MEDIA_PUBLIC_BASE_URL", "https://media.example.com")

    assert get_file_url("photos/example.png", base_url="https://request.example.com") == (
        "https://request.example.com/media/photos/example.png"
    )
    assert get_file_url("photos/example.png") == "https://media.example.com/media/photos/example.png"


def test_get_file_url_falls_back_to_relative_media_path(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "")
    monkeypatch.setattr(settings, "MEDIA_PUBLIC_BASE_URL", "")

    assert get_file_url("photos/example.png") == "/media/photos/example.png"
