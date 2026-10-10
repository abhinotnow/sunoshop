"""Speech output and name rendering, with honest fallbacks.

synthesize()   text -> cached WAV via AnuvaadHub TTS. If TTS is not configured or fails, the line
               is returned without audio and the app speaks it with the phone's own voice.
fill_names()   make sure every place/shop name has a form in the user's script before composing:
               sign text in that script > known-place list > MT of the name > keep Latin.
finalize()     translate the few free-text lines (never key facts), with number safety checks.
"""

from __future__ import annotations

import asyncio
import logging

from . import audio_store
from .anuvaad import AnuvaadError, AnuvaadUnavailable, client as anuvaad_client
from .compose import pending_lines, resolve
from .places import gazetteer
from .safe_translate import UnsafeTranslation, translate_protected

log = logging.getLogger("oriel.speech")


async def synthesize(text: str, lang: str, gender: str | None = None) -> dict:
    mt = anuvaad_client()
    g = gender or mt.gender
    aid = audio_store.audio_id(text, lang, g)
    if audio_store.get(aid) is not None:
        return {"audio_url": audio_store.url(aid), "provider": "cache"}
    try:
        wav = await mt.tts(text, lang, g)
    except AnuvaadUnavailable:
        return {"audio_url": None, "provider": "device", "error": f"tts {lang} not configured"}
    except AnuvaadError as e:
        log.warning("TTS failed: %s", e)
        return {"audio_url": None, "provider": "device", "error": str(e)}
    audio_store.put(aid, wav)
    return {"audio_url": audio_store.url(aid), "provider": "anuvaad"}


async def fill_names(verified: dict, lang: str) -> None:
    mt = anuvaad_client()
    gaz = gazetteer()
    jobs = []
    for f in verified.get("fields", []):
        if f["kind"] not in ("place", "business", "advertisement") or not f.get("value"):
            continue
        texts = f.setdefault("texts", {})
        src = f.setdefault("text_source", {})
        if texts.get(lang):
            src.setdefault(lang, "sign")
            continue
        place = next((p for p in [gaz.match(f["value"])] if p), None) if f["kind"] == "place" else None
        if place and place.name(lang):
            texts[lang], src[lang] = place.name(lang), "known-place list"
            continue
        if lang == "en":
            texts["en"], src["en"] = f["value"], "romanized"
            continue
        if mt.can_translate("en", lang):
            jobs.append((f, mt.translate(f["value"], "en", lang)))
        else:
            texts[lang], src[lang] = f["value"], "latin"
    if jobs:
        results = await asyncio.gather(*[j for _, j in jobs], return_exceptions=True)
        for (f, _), res in zip(jobs, results):
            ok = isinstance(res, str) and res.strip()
            f["texts"][lang] = res.strip() if ok else f["value"]
            f["text_source"][lang] = "mt" if ok else "latin"


async def finalize(speech: dict, lang: str) -> list[dict]:
    """Translate pending free-text lines. Returns a trace of what happened per line."""
    mt = anuvaad_client()
    lines = pending_lines(speech)
    trace = []

    async def one(line: dict):
        p = line["pending"]
        try:
            out, path = await translate_protected(mt, p["source"], p["src"], lang)
            resolve(line, out, lang)
            trace.append({"line": line["id"], "path": path})
        except (AnuvaadUnavailable, AnuvaadError, UnsafeTranslation) as e:
            resolve(line, None, lang)
            trace.append({"line": line["id"], "path": "untranslated", "reason": str(e)})

    await asyncio.gather(*[one(ln) for ln in lines])
    return trace


async def attach_audio(lines: list[dict], lang: str) -> str:
    """Synthesize audio for lines in parallel. Returns the provider used ('anuvaad', 'cache', 'device')."""
    results = await asyncio.gather(*[synthesize(ln["text"], ln.get("lang_fallback", lang)) for ln in lines if ln.get("text")])
    providers = set()
    for ln, res in zip([ln for ln in lines if ln.get("text")], results):
        ln["audio_url"] = res.get("audio_url")
        providers.add(res.get("provider"))
    if "anuvaad" in providers:
        return "anuvaad"
    if "cache" in providers:
        return "cache"
    return "device"
