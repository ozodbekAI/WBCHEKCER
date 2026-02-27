# backend/schemas/photo.py (UPDATED)
from typing import List, Optional
from pydantic import BaseModel, HttpUrl


# ==== GENERATION REQUEST/RESPONSE ====

class SceneGenerateRequest(BaseModel):
    photo_url: str
    item_id: int


class PoseGenerateRequest(BaseModel):
    photo_url: str
    prompt_id: int


class CustomGenerateRequest(BaseModel):
    photo_url: str
    prompt: str
    translate_to_en: bool = True


# NEW: Enhance Photo
class EnhancePhotoRequest(BaseModel):
    photo_url: str
    level: str = "medium"  # "light", "medium", "strong"


# NEW: Video Generation
class VideoGenerateRequest(BaseModel):
    photo_url: str
    prompt: str
    duration: int = 5  # секунды
    resolution: str = "1280x720"
    model: Optional[str] = "grok/minimax-2.5"
    translate_to_en: bool = True


class PhotoGenerateResponse(BaseModel):
    image_base64: str


class VideoGenerateResponse(BaseModel):
    video_base64: str


# ==== PUBLIC OUT MODELS ДЛЯ ШАБЛОНОВ ====

class SceneCategoryOut(BaseModel):
    id: int
    name: str
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


class SceneSubcategoryOut(BaseModel):
    id: int
    category_id: int
    name: str
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


class SceneItemOut(BaseModel):
    id: int
    subcategory_id: int
    name: str
    prompt: str
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


class PoseGroupOut(BaseModel):
    id: int
    name: str
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


class PoseSubgroupOut(BaseModel):
    id: int
    group_id: int
    name: str
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


class PosePromptOut(BaseModel):
    id: int
    subgroup_id: int
    name: str
    prompt: str
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


# ==== ADMIN CREATE / UPDATE СХЕМАЛАРИ ====

class SceneCategoryCreate(BaseModel):
    name: str
    order_index: int = 0


class SceneCategoryUpdate(BaseModel):
    name: Optional[str] = None
    order_index: Optional[int] = None


class SceneSubcategoryCreate(BaseModel):
    name: str
    order_index: int = 0


class SceneSubcategoryUpdate(BaseModel):
    name: Optional[str] = None
    order_index: Optional[int] = None


class SceneItemCreate(BaseModel):
    name: str
    prompt: str
    order_index: int = 0


class SceneItemUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    order_index: Optional[int] = None


class PoseGroupCreate(BaseModel):
    name: str
    order_index: int = 0


class PoseGroupUpdate(BaseModel):
    name: Optional[str] = None
    order_index: Optional[int] = None


class PoseSubgroupCreate(BaseModel):
    name: str
    order_index: int = 0


class PoseSubgroupUpdate(BaseModel):
    name: Optional[str] = None
    order_index: Optional[int] = None


class PosePromptCreate(BaseModel):
    name: str
    prompt: str
    order_index: int = 0


class PosePromptUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    order_index: Optional[int] = None


class PhotoGenerateResponse(BaseModel):
    image_base64: str   # frontend preview uchun
    file_name: str      # diskdagi fayl nomi
    file_url: str       # static URL (agar kerak bo‘lsa)


class VideoGenerateResponse(BaseModel):
    video_base64: str
    file_name: str
    file_url: str


class NormalizeOwnModelRequest(BaseModel):
    """
    Normalizatsiya – O'Z MODELI bilan (2 ta foto: tovar + model foto)
    """
    item_photo_url: HttpUrl | str
    model_photo_url: HttpUrl | str


class NormalizeNewModelRequest(BaseModel):
    """
    Normalizatsiya – YANGI MODEL (model_prompt DBdan yoki manual)
    """
    item_photo_url: HttpUrl | str
    model_item_id: Optional[int] = None   # ModelItem.id (model promtlar daraxti)
    model_prompt: Optional[str] = None    # agar DBsiz matn bilan ishlatsa
    translate_to_en: bool = True          # xohlasangiz translator ishlatasiz


class UploadPhotoResponse(BaseModel):
    file_name: str
    file_url: HttpUrl | str