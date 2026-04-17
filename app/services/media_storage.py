import json
import os
import ipaddress
import uuid
from urllib.parse import urlparse
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


def get_file_url(rel_path: str, base_url: str | None = None) -> str:
    """
    Always returns public URL to backend media:
      <PUBLIC_BASE_URL>/media/<rel_path>
    """

    def _is_private_or_local_host(url: str) -> bool:
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
        except Exception:
            return True

        if not host:
            return True
        if host in {"localhost", "127.0.0.1", "::1"}:
            return True

        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            return False

        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_link_local
        )

    rel_path = (rel_path or "").lstrip("/").replace("\\", "/")
    candidates = [
        (base_url or "").strip().rstrip("/"),
        (settings.MEDIA_PUBLIC_BASE_URL or "").strip().rstrip("/"),
        (settings.PUBLIC_BASE_URL or "").strip().rstrip("/"),
    ]

    public_candidates = [url for url in candidates if url and not _is_private_or_local_host(url)]
    resolved_base_url = public_candidates[0] if public_candidates else (candidates[0] if candidates[0] else "")

    return f"{resolved_base_url}/media/{rel_path}"


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
