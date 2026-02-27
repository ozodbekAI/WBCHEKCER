from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class PhotoChatRequest(BaseModel):
    message: str
    photo_urls: Optional[List[str]] = None
    client_session_id: str


class PhotoChatAnalyzeResponse(BaseModel):
    mode: str
    needs_image: bool = False
    message: Optional[str] = None


class PhotoSessionStatus(BaseModel):
    client_session_id: str
    total_images: int = 0
    last_generated_url: Optional[str] = None
