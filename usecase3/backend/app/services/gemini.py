"""Gemini calls: structured JSON via generateContent, with timeouts and a model fallback chain.

Why generateContent and not the Interactions API: measured on 11 Oct 2026, the Interactions API hung until our
timeout when a model was out of quota (it never returned the 429), and took 6-7 s for a one-word answer.
generateContent answers the same image read in ~1.7 s and returns a 429 in under a second.

Fallback: every model has its own free-tier daily quota. When a model answers 429 (quota), 404 (not available
for this key) or keeps timing out, it is parked for a while and the call moves on to the next model in
GEMINI_FALLBACK_MODELS at once, so one exhausted model never stalls a read.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time

from google import genai
from google.genai import types

from ..settings import get_settings

log = logging.getLogger("oriel.gemini")


class GeminiError(RuntimeError):
    pass


_clients: dict[int, genai.Client] = {}
_parked: dict[tuple[int, str], float] = {}  # (key index, model) -> time.monotonic() until which it is skipped
# (key index, model) -> (success rate, seconds per answer), both moving averages of recent calls. Google's load
# moves between models during the day (measured 11 Oct: the "fast" model failed every call for an hour while
# others answered in 1-2 s), so calls start with whichever model has been answering well lately.
_health: dict[tuple[int, str], tuple[float, float]] = {}
_UNTRIED = (0.7, 4.0)


def record(model: str, ok: bool, seconds: float, key_index: int = 0) -> None:
    rate, lat = _health.get((key_index, model), _UNTRIED)
    a = 0.4
    _health[(key_index, model)] = (rate * (1 - a) + (1.0 if ok else 0.0) * a,
                                   lat * (1 - a) + seconds * a if ok else lat)


def _score(c: tuple[int, str]) -> float:
    rate, lat = _health.get(c, _UNTRIED)
    return rate - min(lat, 20.0) / 20.0  # higher is better


def keys() -> list[str]:
    s = get_settings()
    return [k for k in (s.gemini_api_key, *s.gemini_extra_keys) if k]


def client(key_index: int = 0) -> genai.Client:
    ks = keys()
    if not ks:
        raise GeminiError("GEMINI_API_KEY is not set in backend/.env")
    if key_index not in _clients:
        _clients[key_index] = genai.Client(api_key=ks[key_index])
    return _clients[key_index]


def configured() -> bool:
    return bool(keys())


def park(model: str, seconds: float, key_index: int = 0) -> None:
    _parked[(key_index, model)] = time.monotonic() + seconds


def parked(model: str, key_index: int = 0) -> bool:
    return _parked.get((key_index, model), 0) > time.monotonic()


def model_chain(first: str) -> list[tuple[int, str]]:
    """(key, model) pairs to try: the requested model, then the fallbacks, on the first key, then on each extra
    key. Parked pairs go last (never dropped: a parked model may have recovered)."""
    models: list[str] = []
    for m in [first, *get_settings().gemini_fallback_models]:
        if m and m not in models:
            models.append(m)
    chain = [(k, m) for k in range(len(keys()) or 1) for m in models]
    live = [c for c in chain if not parked(c[1], c[0])]
    head = live[:1] if live and live[0] == (0, first) and _health.get(live[0], _UNTRIED)[0] >= 0.5 else []
    rest = sorted((c for c in live if c not in head), key=_score, reverse=True)  # stable: ties keep the list order
    return head + rest + [c for c in chain if parked(c[1], c[0])]


_RES = {"low": "MEDIA_RESOLUTION_LOW", "medium": "MEDIA_RESOLUTION_MEDIUM", "high": "MEDIA_RESOLUTION_HIGH",
        "ultra_high": "MEDIA_RESOLUTION_ULTRA_HIGH"}


def _image_part(data: bytes, mime: str = "image/jpeg", resolution: str = "") -> types.Part:
    part = types.Part.from_bytes(data=data, mime_type=mime)
    if resolution in _RES:  # more image tokens = small Telugu/Hindi glyphs survive
        part.media_resolution = types.PartMediaResolution(level=_RES[resolution])
    return part


def _retry_after(msg: str) -> float:
    m = re.search(r"retryDelay'?\"?:\s*'?\"?(\d+)", msg)
    return min(3600.0, float(m.group(1))) if m else 600.0


class _Skip(Exception):
    """This (key, model) cannot answer now (quota, not available, hung): move on to the next one."""


async def _attempt(k: int, m: str, parts: list, images: list[bytes], schema: dict, res: str, level: str) -> dict:
    """One model on one key. Options the model rejects (thinking level, resolution) are dropped and retried here."""
    s = get_settings()
    use_res, use_level = bool(res), bool(level)
    started = time.monotonic()
    for _ in range(3):
        contents = parts + [_image_part(img, resolution=res if use_res else "") for img in images]
        cfg = types.GenerateContentConfig(response_mime_type="application/json", response_json_schema=schema)
        if use_level:
            cfg.thinking_config = types.ThinkingConfig(thinking_level=level.upper())
        try:
            r = await asyncio.wait_for(client(k).aio.models.generate_content(model=m, contents=contents, config=cfg),
                                       timeout=s.gemini_timeout_s)
            if not r.text:
                raise GeminiError("empty response")
            out = json.loads(r.text)
            record(m, True, time.monotonic() - started, k)
            return out
        except Exception as e:  # noqa: BLE001 - classified below
            msg = str(e)
            low = msg.lower()
            if use_level and "thinking" in low and ("400" in low or "invalid" in low or "support" in low):
                use_level = False
                continue
            if use_res and "resolution" in low and ("400" in low or "invalid" in low or "support" in low):
                use_res = False
                continue
            record(m, False, time.monotonic() - started, k)
            if "429" in low or "resource_exhausted" in low or "quota" in low:
                park(m, _retry_after(msg), k)
                log.warning("Gemini %s (key %d) out of quota, parked", m, k)
                raise _Skip(msg) from e
            if "404" in low or "not found" in low or "not supported" in low:
                park(m, 3600, k)
                raise _Skip(msg) from e
            if isinstance(e, asyncio.TimeoutError):
                park(m, 60, k)  # a hung model is skipped for a minute
                raise _Skip("timeout") from e
            if isinstance(e, json.JSONDecodeError) or any(
                    t in low for t in ("500", "502", "503", "504", "unavailable", "overloaded", "deadline")):
                park(m, 30, k)  # "high demand": give it half a minute
                raise _Skip(msg) from e
            raise
    raise _Skip("options rejected")


async def generate_json(model: str, prompt: str, schema: dict, images: list[bytes] | None = None,
                        extra_text: str | None = None, retries: int = 2,
                        resolution: str | None = None, thinking_level: str | None = None) -> dict:
    """Structured JSON from Gemini. Text goes before the image (Gemini docs recommendation).

    Hedged: `model` is asked first; if it has not answered after GEMINI_HEDGE_S, the next model in the chain is
    asked too and the first good answer wins (the free tier sometimes holds a request instead of refusing it).
    A model that fails (quota, busy, unavailable, hung) is replaced by the next one at once, until the chain is
    used up or GEMINI_DEADLINE_S passes. At most 2 requests run at the same time. `retries` is kept for callers
    that want fewer models: retries=0 means only the first model and one hedge."""
    s = get_settings()
    res = s.image_resolution if resolution is None else resolution
    level = s.thinking_level if thinking_level is None else thinking_level
    parts: list = [prompt] + ([extra_text] if extra_text else [])
    chain = model_chain(model)
    if retries == 0:
        chain = chain[:2]
    deadline = time.monotonic() + s.gemini_deadline_s
    running: dict[asyncio.Task, str] = {}
    last_err: Exception | None = None
    nxt = 0

    def launch() -> bool:
        nonlocal nxt
        if nxt >= len(chain):
            return False
        k, m = chain[nxt]
        nxt += 1
        running[asyncio.create_task(_attempt(k, m, parts, images or [], schema, res, level))] = m
        return True

    launch()
    try:
        while running:
            left = deadline - time.monotonic()
            if left <= 0:
                last_err = last_err or GeminiError("deadline")
                break
            done, _ = await asyncio.wait(running, timeout=min(s.gemini_hedge_s, left), return_when=asyncio.FIRST_COMPLETED)
            if not done:  # slow: hedge with the next model, keep waiting for both
                if len(running) < 2:
                    launch()
                continue
            for task in done:
                m = running.pop(task)
                try:
                    out = task.result()
                    if m != model:
                        log.info("Gemini %s answered for %s", m, model)
                    return out
                except _Skip as e:
                    last_err = e
                    if len(running) < 2:
                        launch()
                except Exception as e:  # noqa: BLE001 - a hard error (e.g. bad key): give up
                    last_err = e
                    running.clear()
                    break
    finally:
        for task in running:
            task.cancel()
    log.warning("Gemini %s failed: %s", model, last_err)
    raise GeminiError(f"{model}: {type(last_err).__name__}: {str(last_err)[:300]}")
