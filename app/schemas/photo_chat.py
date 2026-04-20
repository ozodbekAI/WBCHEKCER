from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class PhotoChatThreadContext(BaseModel):
    last_generated_asset_id: Optional[int] = None
    working_asset_ids: List[int] = Field(default_factory=list)
    pending_question: Optional[str] = None
    last_action: Optional[Dict[str, Any] | str] = None
    locale: Optional[str] = None

    @field_validator("working_asset_ids", mode="before")
    @classmethod
    def _normalize_working_asset_ids(cls, value: object) -> List[int]:
        if value is None:
            return []
        if not isinstance(value, list):
            value = [value]

        normalized: List[int] = []
        for item in value:
            try:
                normalized.append(int(item))
            except (TypeError, ValueError):
                continue
        return normalized

    @field_validator("pending_question", "locale", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class PhotoChatQuickActionIn(BaseModel):
    type: Optional[str] = None
    action: Optional[str] = None
    pose_prompt_id: Optional[int] = None
    prompt_id: Optional[int] = None
    scene_item_id: Optional[int] = None
    item_id: Optional[int] = None
    model_item_id: Optional[int] = None
    new_model_prompt: Optional[str] = None
    level: Optional[str] = None
    prompt: Optional[str] = None
    model: Optional[str] = None
    duration: Optional[int] = None
    resolution: Optional[str] = None


class PhotoChatStreamRequest(BaseModel):
    message: str = ""
    asset_ids: List[int] = Field(default_factory=list)
    photo_urls: List[str] = Field(default_factory=list)
    photo_url: Optional[str] = None
    quick_action: Optional[PhotoChatQuickActionIn] = None
    thread_id: Optional[int] = None
    request_id: Optional[str] = None
    locale: Optional[str] = None
    client_session_id: Optional[str] = None

    @field_validator("asset_ids", mode="before")
    @classmethod
    def _normalize_asset_ids(cls, value: object) -> List[int]:
        if value is None:
            return []
        if not isinstance(value, list):
            value = [value]

        normalized: List[int] = []
        for item in value:
            try:
                normalized.append(int(item))
            except (TypeError, ValueError):
                continue
        return normalized

    @field_validator("photo_urls", mode="before")
    @classmethod
    def _normalize_photo_urls(cls, value: object) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    @field_validator("message", mode="before")
    @classmethod
    def _normalize_message(cls, value: object) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("photo_url", "request_id", "locale", "client_session_id", mode="before")
    @classmethod
    def _normalize_string_fields(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class PhotoChatRequest(PhotoChatStreamRequest):
    pass


class PhotoChatAssetImportRequest(BaseModel):
    source_url: str
    client_session_id: Optional[str] = None


class PhotoChatAssetUploadResponse(BaseModel):
    asset_id: int
    seq: int
    file_url: str
    file_name: str
    caption: Optional[str] = None


class PhotoChatAssetOut(BaseModel):
    asset_id: int
    seq: int
    kind: str
    source: str
    file_url: str
    file_name: str
    prompt: Optional[str] = None
    caption: str = ""
    meta: Dict[str, Any] = Field(default_factory=dict)


class PhotoChatMessageOut(BaseModel):
    id: int
    role: str
    msg_type: str
    content: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    thread_id: Optional[int] = None
    request_id: Optional[str] = None


class PhotoSessionStatus(BaseModel):
    session_key: str
    message_count: int = 0
    limit: int = 0
    locked: bool = False


class PhotoChatHistoryResponse(PhotoSessionStatus):
    messages: List[PhotoChatMessageOut] = Field(default_factory=list)
    assets: List[PhotoChatAssetOut] = Field(default_factory=list)


class PhotoChatDeleteRequest(BaseModel):
    message_ids: List[int] = Field(default_factory=list)


class PhotoChatDeleteResponse(BaseModel):
    deleted: int = 0
    deleted_media: int = 0
    message_count: int = 0
    limit: int = 0
    locked: bool = False


class PhotoGeneratorRequest(BaseModel):
    generator_type: str
    asset_ids: List[int] = Field(default_factory=list)
    thread_id: Optional[int] = None
    locale: Optional[str] = None
    prompt: Optional[str] = None
    scene_item_id: Optional[int] = None
    pose_prompt_id: Optional[int] = None
    model_item_id: Optional[int] = None
    video_scenario_id: Optional[int] = None
    model: Optional[str] = None
    duration: Optional[int] = None
    resolution: Optional[str] = None

    @field_validator("asset_ids", mode="before")
    @classmethod
    def _normalize_generator_asset_ids(cls, value: object) -> List[int]:
        if value is None:
            return []
        if not isinstance(value, list):
            value = [value]

        normalized: List[int] = []
        for item in value:
            try:
                normalized.append(int(item))
            except (TypeError, ValueError):
                continue
        return normalized

    @field_validator(
        "generator_type",
        "locale",
        "prompt",
        "model",
        "resolution",
        mode="before",
    )
    @classmethod
    def _normalize_generator_strings(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator(
        "thread_id",
        "scene_item_id",
        "pose_prompt_id",
        "model_item_id",
        "video_scenario_id",
        "duration",
        mode="before",
    )
    @classmethod
    def _normalize_generator_ints(cls, value: object) -> Optional[int]:
        if value is None or value == "":
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


class PhotoGeneratorResponse(BaseModel):
    thread_id: int
    active_thread_id: int
    generator_action: str
    context_state: PhotoChatThreadContext = Field(default_factory=PhotoChatThreadContext)
    asset: PhotoChatAssetOut


class PhotoChatThreadOut(BaseModel):
    id: int
    session_id: int
    is_active: bool
    context: PhotoChatThreadContext = Field(default_factory=PhotoChatThreadContext)


class PhotoChatAnalyzeResponse(BaseModel):
    mode: str
    needs_image: bool = False
    message: Optional[str] = None
