"""Shared helpers for routers: validation and server-sent-event streaming."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ..content import LANGS

log = logging.getLogger("oriel.api")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_AUDIO_BYTES = 5 * 1024 * 1024


def check_lang(lang: str, name: str = "lang") -> str:
    lang = (lang or "").strip().lower()
    if lang not in LANGS:
        raise HTTPException(422, f"{name} must be one of {', '.join(LANGS)}")
    return lang


def sse(events: AsyncIterator[dict]) -> StreamingResponse:
    """Stream events as server-sent events. Each event is one `data: {json}` block.

    SSE (rather than plain chunked JSON) keeps tunnels and proxies from buffering, so the
    pipeline appears live on the phone.
    """
    async def gen():
        try:
            async for ev in events:
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001 - always end the stream with a readable error
            log.exception("pipeline crashed")
            yield f"data: {json.dumps({'type': 'error', 'code': 'server_error', 'message': str(e)})}\n\n"
        yield "data: {\"type\": \"end\"}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})
