from __future__ import annotations

import asyncio
import base64
import random
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx
import logging


logger = logging.getLogger("gemini.api")


@dataclass
class GeminiPart:
    text: Optional[str] = None
    inline_data_b64: Optional[str] = None
    inline_mime: Optional[str] = None


class GeminiApiError(RuntimeError):
    pass


def b64encode_bytes(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


class GeminiApiClient:
    """Minimal Gemini REST client.

    Uses Google Gemini API (generativelanguage.googleapis.com) directly, to avoid SDK drift.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        timeout_s: float = 240.0,
        *,
        max_retries: int = 4,
        backoff_base_s: float = 1.0,
        backoff_max_s: float = 20.0,
    ):
        if not api_key:
            raise GeminiApiError("GEMINI_API_KEY is not configured")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = int(max_retries)
        self.backoff_base_s = float(backoff_base_s)
        self.backoff_max_s = float(backoff_max_s)
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_s, connect=10.0, read=timeout_s, write=timeout_s, pool=timeout_s),
            headers={
                "x-goog-api-key": api_key,
                "Content-Type": "application/json",
            },
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def generate_content(
        self,
        model: str,
        contents: List[Dict[str, Any]],
        generation_config: Optional[Dict[str, Any]] = None,
        *,
        service_tier: Optional[str] = None,
        timeout_s: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}/models/{model}:generateContent"
        payload: Dict[str, Any] = {"contents": contents}
        if generation_config:
            payload["generationConfig"] = generation_config
        if service_tier:
            payload["service_tier"] = service_tier

        def _retry_after_s(resp: httpx.Response) -> Optional[float]:
            raw = (resp.headers.get("retry-after") or "").strip()
            if not raw:
                return None
            try:
                return float(raw)
            except Exception:
                return None

        retries = self.max_retries if max_retries is None else max(0, int(max_retries))
        last_error_text = ""
        for attempt in range(retries + 1):
            try:
                resp = await self._client.post(url, json=payload, timeout=timeout_s)
            except httpx.TimeoutException as e:
                last_error_text = f"{type(e).__name__}: {e}"
                retryable = True
                if attempt >= retries:
                    raise GeminiApiError(f"Gemini error timeout: {last_error_text}")

                wait_s = min(self.backoff_max_s, self.backoff_base_s * (2 ** attempt))
                wait_s = wait_s * (1.0 + random.random() * 0.25)
                await asyncio.sleep(wait_s)
                continue
            if resp.status_code < 400:
                data = resp.json()
                usage = data.get("usageMetadata") or {}
                logger.info(
                    "gemini usage model=%s tier=%s effective_tier=%s prompt=%s candidates=%s total=%s",
                    model,
                    service_tier or "standard",
                    resp.headers.get("x-gemini-service-tier") or "standard",
                    usage.get("promptTokenCount"),
                    usage.get("candidatesTokenCount"),
                    usage.get("totalTokenCount"),
                )
                return data

            last_error_text = resp.text
            retryable = resp.status_code in (408, 429) or 500 <= resp.status_code <= 599
            if not retryable or attempt >= retries:
                raise GeminiApiError(f"Gemini error {resp.status_code}: {last_error_text}")

            wait_s = _retry_after_s(resp)
            if wait_s is None:
                wait_s = min(self.backoff_max_s, self.backoff_base_s * (2 ** attempt))
                wait_s = wait_s * (1.0 + random.random() * 0.25)  # jitter

            await asyncio.sleep(wait_s)

        raise GeminiApiError(f"Gemini error: {last_error_text}")

    @staticmethod
    def extract_text_and_images(resp: Dict[str, Any]) -> Tuple[str, List[GeminiPart]]:
        candidates = resp.get("candidates") or []
        if not candidates:
            prompt_feedback = resp.get("promptFeedback")
            raise GeminiApiError(f"No candidates returned. promptFeedback={prompt_feedback}")

        candidate = candidates[0]
        
        # 1. BLOKLANISHLARNI TEKSHIRISH (SAFETY, RECITATION va h.k.)
        finish_reason = candidate.get("finishReason")
        if finish_reason and finish_reason not in ("STOP", "MAX_TOKENS"):
            raise GeminiApiError(f"Gemini API javobni blokladi! Sabab (finishReason): {finish_reason}")

        parts = (candidate.get("content") or {}).get("parts") or []
        out: List[GeminiPart] = []
        text_chunks: List[str] = []

        for p in parts:
            if p.get("text") is not None:
                txt = str(p.get("text"))
                text_chunks.append(txt)
                out.append(GeminiPart(text=txt))
                continue

            inline = p.get("inlineData") or p.get("inline_data")
            if inline is not None:
                b64 = inline.get("data")
                mime = inline.get("mimeType") or inline.get("mime_type")
                if b64:
                    out.append(GeminiPart(inline_data_b64=str(b64), inline_mime=str(mime or "")))

        return "\n".join([t for t in text_chunks if t.strip()]), out
