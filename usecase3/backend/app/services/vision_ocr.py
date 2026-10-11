"""Google Cloud Vision OCR: an independent text reader (different technology from Gemini) for verification.

Credentials, first one found wins (all optional; without them this reader is simply off):
  GOOGLE_VISION_API_KEY              a Cloud Console API key with the Cloud Vision API enabled
                                     (AI Studio Gemini keys are refused by Vision)
  GOOGLE_VISION_CREDENTIALS_JSON     the whole service-account JSON (handy on Render / Cloud Run)
  GOOGLE_APPLICATION_CREDENTIALS     path to a service-account JSON file, or the Cloud Run identity
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import time

import httpx

log = logging.getLogger("oriel.vision")

URL = "https://vision.googleapis.com/v1/images:annotate"
SCOPE = "https://www.googleapis.com/auth/cloud-vision"

_creds = None
_token: tuple[str, float] = ("", 0.0)
_http: httpx.AsyncClient | None = None


def _api_key() -> str:
    return os.getenv("GOOGLE_VISION_API_KEY", "").strip()


def _service_account():
    global _creds
    if _creds is not None:
        return _creds or None
    _creds = False
    try:
        from google.oauth2 import service_account
        raw = os.getenv("GOOGLE_VISION_CREDENTIALS_JSON", "").strip()
        if raw:
            _creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=[SCOPE])
        elif os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip():
            import google.auth
            _creds, _ = google.auth.default(scopes=[SCOPE])
    except Exception as e:  # noqa: BLE001
        log.error("Cloud Vision credentials could not be loaded: %s", e)
        _creds = False
    return _creds or None


def configured() -> bool:
    return bool(_api_key()) or _service_account() is not None


async def _bearer() -> str:
    global _token
    if _token[0] and _token[1] > time.time() + 60:
        return _token[0]
    creds = _service_account()
    from google.auth.transport.requests import Request
    await asyncio.to_thread(creds.refresh, Request())
    _token = (creds.token, creds.expiry.timestamp() if creds.expiry else time.time() + 1800)
    return _token[0]


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=8.0)
    return _http


async def read_words(img, langs: list[str] | None = None) -> list[tuple[str, tuple[int, int, int, int]]]:
    """Words Cloud Vision finds in a PIL image, each with its box [ymin, xmin, ymax, xmax] on a 0-1000 scale
    (the same convention as the Gemini reader). [] when not configured or on any error."""
    if not configured():
        return []
    w, h = img.size
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=90)
    body = {"requests": [{"image": {"content": base64.b64encode(buf.getvalue()).decode("ascii")},
                          "features": [{"type": "TEXT_DETECTION"}],
                          "imageContext": {"languageHints": langs or ["te", "hi", "en"]}}]}
    try:
        if _api_key():
            r = await _client().post(URL, params={"key": _api_key()}, json=body)
        else:
            r = await _client().post(URL, json=body, headers={"Authorization": f"Bearer {await _bearer()}"})
        r.raise_for_status()
        res = r.json()["responses"][0]
        if "error" in res:
            raise RuntimeError(res["error"].get("message", "vision error"))
    except Exception as e:  # noqa: BLE001 - an optional reader must never break a read
        log.warning("Cloud Vision OCR failed: %s", str(e)[:200])
        return []
    words = []
    for ann in res.get("textAnnotations", [])[1:]:  # [0] is the whole text; the rest are single words
        vs = ann.get("boundingPoly", {}).get("vertices", [])
        xs = [v.get("x", 0) for v in vs] or [0]
        ys = [v.get("y", 0) for v in vs] or [0]
        box = (round(min(ys) / h * 1000), round(min(xs) / w * 1000), round(max(ys) / h * 1000), round(max(xs) / w * 1000))
        words.append((ann.get("description", ""), box))
    return words


def text_in_box(words: list[tuple[str, tuple[int, int, int, int]]], box: list[int] | None, pad: float = 0.12) -> str:
    """Join the words whose centre lies inside `box` (padded); all words when there is no box."""
    if not box or len(box) != 4:
        return " ".join(w for w, _ in words)
    y0, x0, y1, x1 = box
    py, px = (y1 - y0) * pad, (x1 - x0) * pad
    keep = [w for w, (a, b, c, d) in words
            if y0 - py <= (a + c) / 2 <= y1 + py and x0 - px <= (b + d) / 2 <= x1 + px]
    return " ".join(keep)
