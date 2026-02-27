import json
import os
import uuid
from app.core.config import settings


def save_generated_file(content: bytes, kind: str = "image", prefix: str = "") -> str:
    """
    Returns relative path (e.g. "photos/<uuid>.png" or "videos/<uuid>.mp4")
    
    Args:
        content: File bytes
        kind: "image" or "video"
        prefix: Optional prefix for filename (e.g. "mask_")
    """
    kind = (kind or "image").lower()
    if kind not in ("image", "video"):
        kind = "image"

    ext = ".png" if kind == "image" else ".mp4"
    folder = "photos" if kind == "image" else "videos"

    file_name = f"{prefix}{uuid.uuid4().hex}{ext}"
    rel_path = os.path.join(folder, file_name).replace("\\", "/")

    abs_path = os.path.join(settings.MEDIA_ROOT, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    with open(abs_path, "wb") as f:
        f.write(content)

    return rel_path


def get_file_url(rel_path: str) -> str:
    """
    Always returns public URL to backend media:
      <PUBLIC_BASE_URL>/media/<rel_path>
    """
    rel_path = (rel_path or "").lstrip("/").replace("\\", "/")
    return f"{settings.PUBLIC_BASE_URL}/media/{rel_path}"


def delete_generated_file(rel_path: str) -> bool:
    rel_path = (rel_path or "").lstrip("/").replace("\\", "/")
    abs_path = os.path.join(settings.MEDIA_ROOT, rel_path)
    if os.path.exists(abs_path) and os.path.isfile(abs_path):
        os.remove(abs_path)
        return True
    return False


def _metadata_rel_path(rel_path: str) -> str:
    rel_path = (rel_path or "").lstrip("/").replace("\\", "/")
    base, _ = os.path.splitext(rel_path)
    return f"{base}.json"


def save_generated_metadata(rel_path: str, metadata: dict) -> None:
    if not rel_path:
        return
    meta_rel = _metadata_rel_path(rel_path)
    abs_path = os.path.join(settings.MEDIA_ROOT, meta_rel)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    try:
        with open(abs_path, "w", encoding="utf-8") as f:
            json.dump(metadata or {}, f, ensure_ascii=False)
    except Exception:
        pass


def load_generated_metadata(rel_path: str) -> dict:
    if not rel_path:
        return {}
    meta_rel = _metadata_rel_path(rel_path)
    abs_path = os.path.join(settings.MEDIA_ROOT, meta_rel)
    if not os.path.exists(abs_path):
        return {}
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def delete_generated_metadata(rel_path: str) -> bool:
    meta_rel = _metadata_rel_path(rel_path)
    abs_path = os.path.join(settings.MEDIA_ROOT, meta_rel)
    if os.path.exists(abs_path) and os.path.isfile(abs_path):
        os.remove(abs_path)
        return True
    return False
