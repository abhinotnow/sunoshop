"""POST /api/read: read a sign from 1-3 frames (streamed)."""

from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..services.read_pipeline import run_read
from .common import MAX_IMAGE_BYTES, check_lang, sse

router = APIRouter()


@router.post("/read")
async def read(frames: list[UploadFile] = File(..., description="1-3 JPEG frames, faces already blurred"),
               lang: str = Form("en"), mode: str = Form("standard"), reads_used: int = Form(0),
               device: str = Form("", description="JSON from the phone, e.g. {\"tilt\": \"up\"}"),
               digit_style: str = Form("")):
    lang = check_lang(lang)
    if not 1 <= len(frames) <= 3:
        raise HTTPException(422, "send between 1 and 3 frames")
    data = []
    for f in frames:
        b = await f.read()
        if not b:
            raise HTTPException(422, "empty frame")
        if len(b) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "frame larger than 8 MB")
        data.append(b)
    try:
        dev = json.loads(device) if device else None
    except json.JSONDecodeError:
        dev = None
    mode = mode if mode in ("standard", "simple") else "standard"
    style = digit_style if digit_style in ("native", "english") else None
    return sse(run_read(data, lang, mode, max(0, reads_used), dev, style))
