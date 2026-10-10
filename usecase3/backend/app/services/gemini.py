"""Thin async wrapper around the Gemini Interactions API with retries and timeouts."""

from __future__ import annotations

import asyncio
import base64
import json
import logging

from google import genai

from ..settings import get_settings

log = logging.getLogger("oriel.gemini")


class GeminiError(RuntimeError):
    pass


_client: genai.Client | None = None


def client() -> genai.Client:
    global _client
    if _client is None:
        key = get_settings().gemini_api_key
        if not key:
            raise GeminiError("GEMINI_API_KEY is not set in backend/.env")
        _client = genai.Client(api_key=key)
    return _client


def configured() -> bool:
    return bool(get_settings().gemini_api_key)


def _image_part(data: bytes, mime: str = "image/jpeg", resolution: str = "") -> dict:
    part = {"type": "image", "data": base64.b64encode(data).decode("ascii"), "mime_type": mime}
    if resolution:
        part["resolution"] = resolution  # low | medium | high | ultra_high: more image tokens = small text survives
    return part


async def generate_json(model: str, prompt: str, schema: dict, images: list[bytes] | None = None,
                        extra_text: str | None = None, retries: int = 2,
                        resolution: str | None = None, thinking_level: str | None = None) -> dict:
    """Structured JSON from Gemini. Text goes before the image (Gemini docs recommendation)."""
    s = get_settings()
    parts: list[dict] = [{"type": "text", "text": prompt}]
    if extra_text:
        parts.append({"type": "text", "text": extra_text})
    res = s.image_resolution if resolution is None else resolution
    for img in images or []:
        parts.append(_image_part(img, resolution=res))
    kwargs: dict = {
        "model": model,
        "input": parts,
        "response_format": {"type": "text", "mime_type": "application/json", "schema": schema},
    }
    level = s.thinking_level if thinking_level is None else thinking_level
    if level:
        kwargs["generation_config"] = {"thinking_level": level}

    last_err: Exception | None = None
    attempt = 0
    while True:
        try:
            result = await asyncio.wait_for(client().aio.interactions.create(**kwargs), timeout=s.gemini_timeout_s)
            text = result.output_text
            if not text:
                raise GeminiError("empty response")
            return json.loads(text)
        except Exception as e:  # noqa: BLE001 - we classify below
            msg = str(e).lower()
            # Unsupported options are dropped and retried at once; that does not use up a retry.
            if "generation_config" in kwargs and "think" in msg:
                kwargs.pop("generation_config")  # model does not support this thinking_level
                continue
            if "resolution" in msg and [p.pop("resolution") for p in parts if "resolution" in p]:
                continue  # model does not accept a per-image resolution: use its default
            last_err = e
            retryable = isinstance(e, (asyncio.TimeoutError, json.JSONDecodeError)) or any(
                k in msg for k in ("429", "500", "502", "503", "504", "unavailable", "overloaded", "deadline", "timeout"))
            if attempt < retries and retryable:
                await asyncio.sleep(0.8 * (2 ** attempt))
                attempt += 1
                continue
            break
    log.warning("Gemini %s failed: %s", model, last_err)
    raise GeminiError(f"{model}: {type(last_err).__name__}: {last_err}")
