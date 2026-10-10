"""POST /api/ask: spoken (or typed) question about the sign -> spoken answer (streamed)."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..services import images
from ..services.ask_pipeline import parse_context, run_ask
from .common import MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, check_lang, sse

router = APIRouter()


@router.post("/ask")
async def ask(audio: UploadFile | None = File(None, description="16 kHz mono WAV, max ~20 s"),
              text: str = Form(""), in_lang: str = Form("en"), out_lang: str = Form("en"),
              context: str = Form("", description="the last 'verified' object from /api/read, as JSON"),
              frame: UploadFile | None = File(None, description="optional JPEG of the sign"),
              confirmed: bool = Form(False)):
    in_lang, out_lang = check_lang(in_lang, "in_lang"), check_lang(out_lang, "out_lang")
    wav = await audio.read() if audio else None
    if wav and len(wav) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "audio larger than 5 MB (keep questions under 20 seconds)")
    if not wav and not text.strip():
        raise HTTPException(422, "send audio or text")
    jpeg = None
    if frame:
        raw = await frame.read()
        if raw and len(raw) <= MAX_IMAGE_BYTES:
            jpeg = images.encode_jpeg(images.fit(images.decode(raw), 1280))
    return sse(run_ask(audio=wav, text=text, in_lang=in_lang, out_lang=out_lang,
                       context=parse_context(context), frame_jpeg=jpeg, confirmed=confirmed))
