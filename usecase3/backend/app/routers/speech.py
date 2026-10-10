"""Speech utilities: /speak (TTS), /asr (speech recognition), /translate, /compose."""

from __future__ import annotations

import copy

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..services import audio_store
from ..services.anuvaad import AnuvaadError, AnuvaadUnavailable, client as anuvaad_client
from ..services.compose import compose
from ..services.safe_translate import UnsafeTranslation, translate_protected
from ..services.speech import attach_audio, fill_names, finalize, synthesize
from .common import MAX_AUDIO_BYTES, check_lang

router = APIRouter()


class SpeakIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=600)
    lang: str = "en"


@router.post("/speak")
async def speak(body: SpeakIn):
    lang = check_lang(body.lang)
    return await synthesize(body.text, lang)


@router.post("/asr")
async def asr(audio: UploadFile = File(...), lang: str = Form("en")):
    lang = check_lang(lang)
    wav = await audio.read()
    if not wav or len(wav) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "audio missing or larger than 5 MB")
    try:
        text = await anuvaad_client().asr(wav, lang)
    except AnuvaadUnavailable:
        raise HTTPException(503, detail={"code": "asr_unavailable", "message": f"speech recognition for {lang} is not configured"})
    except AnuvaadError as e:
        raise HTTPException(502, detail={"code": "asr_failed", "message": str(e)})
    return {"text": text, "lang": lang}


class TranslateIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=1200)
    src: str
    tgt: str


@router.post("/translate")
async def translate(body: TranslateIn):
    src, tgt = check_lang(body.src, "src"), check_lang(body.tgt, "tgt")
    try:
        out, path = await translate_protected(anuvaad_client(), body.text, src, tgt)
    except AnuvaadUnavailable:
        raise HTTPException(503, detail={"code": "mt_unavailable", "message": f"translation {src}-{tgt} is not configured"})
    except (AnuvaadError, UnsafeTranslation) as e:
        raise HTTPException(502, detail={"code": "mt_failed", "message": str(e)})
    return {"text": out, "path": path}


class ComposeIn(BaseModel):
    verified: dict
    lang: str = "en"
    mode: str = "standard"
    digit_style: str | None = None


@router.post("/compose")
async def recompose(body: ComposeIn):
    """Re-say an already verified sign in another language or in simpler words, without reading again."""
    lang = check_lang(body.lang)
    verified = copy.deepcopy(body.verified)
    await fill_names(verified, lang)
    mode = body.mode if body.mode in ("standard", "simple") else "standard"
    speech = compose(verified, lang, mode, body.digit_style if body.digit_style in ("native", "english") else None)
    await finalize(speech, lang)
    provider = await attach_audio(speech["key"], lang) if speech["key"] else "none"
    return {"speech": speech, "lang": lang, "mode": mode, "provider": provider, "verified": verified}


@router.get("/audio/{aid}.wav")
async def audio(aid: str):
    try:
        data = audio_store.get(aid)
    except ValueError:
        raise HTTPException(400, "bad audio id")
    if data is None:
        raise HTTPException(404, "audio not found")
    return Response(data, media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})
