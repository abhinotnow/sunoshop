"""The ASK pipeline (the speech-to-speech chain the hackathon requires), streamed live:

  user's voice (te/hi/en)
   -> ASR      AnuvaadHub speech recognition in the input language
   -> MT       input language -> English (numbers checked)
   -> AI       Gemini answers ONLY from the verified sign facts (+ photo), with safety rules
   -> MT       English -> output language, route numbers and place names protected by placeholders
   -> TTS      AnuvaadHub speech in the output language
Misheard questions come back as a yes/no confirmation instead of a guess.
"""

from __future__ import annotations

import asyncio

import json
import logging
import time
from datetime import datetime
from typing import AsyncIterator
from zoneinfo import ZoneInfo

from ..content import prompt, schema
from ..settings import get_settings
from . import gemini
from .anuvaad import AnuvaadError, AnuvaadUnavailable, client as anuvaad_client
from .compose import route_words
from .gemini import GeminiError
from .safe_translate import UnsafeTranslation, translate_protected
from .speech import synthesize
from .text_utils import normalize_route

log = logging.getLogger("oriel.ask")

MIN_QUESTION_CHARS = 2


def stage(name: str, status: str, ms: float | None = None, **detail) -> dict:
    ev = {"type": "stage", "stage": name, "status": status}
    if ms is not None:
        ev["ms"] = round(ms)
    if detail:
        ev["detail"] = detail
    return ev


def facts_text(context: dict | None) -> str:
    """Compact, model-friendly list of verified facts with their status."""
    if not context or not context.get("sign_found"):
        return "No sign has been read yet."
    lines = [f"category: {context.get('category', 'unknown')}"]
    for f in context.get("fields", [])[:20]:
        bits = [f.get("kind", ""), f"value={f.get('value', '')!r}", f"status={f.get('status', '')}"]
        for k in ("role", "applies_to", "number", "countdown", "open", "close", "product"):
            if f.get(k):
                bits.append(f"{k}={f[k]!r}")
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def renderings_for(context: dict | None, lang: str, extra_terms: list[str]) -> dict[str, str]:
    """How each protected term should be said in the output language."""
    out: dict[str, str] = {}
    for f in (context or {}).get("fields", []):
        v = f.get("value")
        if not v:
            continue
        if f.get("kind") == "route":
            out[v] = route_words(v, lang)
        elif f.get("kind") in ("place", "business"):
            out[v] = (f.get("texts") or {}).get(lang) or v
    for term in extra_terms:
        if term and term not in out:
            nr = normalize_route(term)
            if nr and nr[0].isdigit() and len(nr) <= 6:
                out[term] = route_words(nr, lang)
    return out


async def _gemini_translate(text: str, tgt: str, keep: list[str]) -> str:
    names = {"te": "Telugu", "hi": "Hindi", "en": "English"}
    sch = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
    p = (f"Translate into simple spoken {names[tgt]}. Keep these exactly as given, do not translate or change "
         f"them: {', '.join(keep) or 'none'}. Output only the translation.\n\nTEXT: {text}")
    res = await gemini.generate_json(get_settings().arbiter_model, p, sch)
    return res.get("text", "").strip()


async def run_ask(*, audio: bytes | None, text: str | None, in_lang: str, out_lang: str,
                  context: dict | None, frame_jpeg: bytes | None, confirmed: bool = False) -> AsyncIterator[dict]:
    s = get_settings()
    mt = anuvaad_client()
    timings: dict[str, int] = {}

    # ---- 1. ASR
    question = (text or "").strip()
    if audio:
        t = time.perf_counter()
        yield stage("asr", "running", lang=in_lang)
        try:
            question = await mt.asr(audio, in_lang)
        except AnuvaadUnavailable:
            yield {"type": "error", "code": "asr_unavailable", "message": f"speech recognition for {in_lang} is not configured"}
            return
        except AnuvaadError as e:
            yield {"type": "error", "code": "asr_failed", "message": str(e)}
            return
        timings["asr"] = round((time.perf_counter() - t) * 1000)
        yield stage("asr", "done", timings["asr"], text=question)
    else:
        yield stage("asr", "skipped", text=question, reason="text given")
    if len(question.strip(" .?,।")) < MIN_QUESTION_CHARS:
        yield {"type": "error", "code": "no_speech", "message": "nothing was recognized", "phrase_id": "didnt_catch"}
        return

    # ---- 2. MT in -> English
    t = time.perf_counter()
    try:
        q_en, path = await translate_protected(mt, question, in_lang, "en")
    except (AnuvaadUnavailable, AnuvaadError, UnsafeTranslation) as e:
        try:
            q_en, path = await _gemini_translate(question, "en", []), f"gemini fallback ({e})"
        except GeminiError as e2:
            yield {"type": "error", "code": "translate_failed", "message": str(e2)}
            return
    timings["translate_in"] = round((time.perf_counter() - t) * 1000)
    yield stage("translate_in", "done", timings["translate_in"], text=q_en, path=path)

    # ---- 3. AI answer grounded in the sign
    t = time.perf_counter()
    now = datetime.now(ZoneInfo(s.timezone)).strftime("%A %H:%M")
    extra = (f"CURRENT TIME (Hyderabad): {now}\n\nSIGN FACTS:\n{facts_text(context)}\n\n"
             f"QUESTION: {q_en}\n" + ("The user already confirmed this question; do not ask again.\n" if confirmed else ""))
    try:
        ans = await gemini.generate_json(s.ask_model, prompt("ask"), schema("ask"),
                                         images=[frame_jpeg] if frame_jpeg else None, extra_text=extra)
    except GeminiError as e:
        yield {"type": "error", "code": "ai_unavailable", "message": str(e)}
        return
    if confirmed:
        ans["needs_confirmation"] = False
    answer_en = (ans.get("confirm_question_en") if ans.get("needs_confirmation") else ans.get("answer_en")) or ""
    timings["ai"] = round((time.perf_counter() - t) * 1000)
    yield stage("ai", "done", timings["ai"], text=answer_en, confidence=ans.get("confidence"),
                grounded=ans.get("grounded_in_sign"), confirm=bool(ans.get("needs_confirmation")))

    # ---- 4. MT English -> out, names/numbers protected
    t = time.perf_counter()
    rend = renderings_for(context, out_lang, ans.get("protected_terms", []))
    try:
        answer_out, path = await translate_protected(mt, answer_en, "en", out_lang, rend)
    except (AnuvaadUnavailable, AnuvaadError, UnsafeTranslation) as e:
        try:
            answer_out = await _gemini_translate(answer_en, out_lang, list(rend.values()))
            path = f"gemini fallback ({e})"
        except GeminiError:
            answer_out, path = answer_en, "untranslated"
    timings["translate_out"] = round((time.perf_counter() - t) * 1000)
    yield stage("translate_out", "done", timings["translate_out"], text=answer_out, path=path)

    # ---- 5. TTS
    t = time.perf_counter()
    speak_lang = out_lang if path != "untranslated" else "en"
    task = asyncio.ensure_future(synthesize(answer_out, speak_lang))
    try:
        res = await asyncio.wait_for(asyncio.shield(task), timeout=2.5)
    except asyncio.TimeoutError:  # still synthesizing: keeps running; /api/speak joins the same request
        res = {"audio_url": None, "provider": "pending"}
    timings["tts"] = round((time.perf_counter() - t) * 1000)
    yield stage("tts", "done", timings["tts"], provider=res.get("provider"))

    yield {"type": "result", "question": question, "question_en": q_en, "answer_en": answer_en,
           "answer": answer_out, "answer_lang": speak_lang, "audio_url": res.get("audio_url"),
           "needs_confirmation": bool(ans.get("needs_confirmation")), "confidence": ans.get("confidence"),
           "out_of_scope": bool(ans.get("out_of_scope")), "timings_ms": timings}


def parse_context(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None
