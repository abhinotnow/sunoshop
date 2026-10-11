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


_inflight: dict[str, asyncio.Task] = {}  # one TTS request per line, shared by everyone waiting for it


async def _tts_and_store(mt, text: str, lang: str, g: str, aid: str) -> dict:
    try:
        wav = await mt.tts(text, lang, g)
    except AnuvaadUnavailable:
        return {"audio_url": None, "provider": "device", "error": f"tts {lang} not configured"}
    except AnuvaadError as e:
        log.warning("TTS failed: %s", e)
        return {"audio_url": None, "provider": "device", "error": str(e)}
    finally:
        _inflight.pop(aid, None)
    audio_store.put(aid, wav)
    return {"audio_url": audio_store.url(aid), "provider": "anuvaad"}


async def synthesize(text: str, lang: str, gender: str | None = None) -> dict:
    mt = anuvaad_client()
    g = gender or mt.gender
    aid = audio_store.audio_id(text, lang, g)
    if audio_store.get(aid) is not None:
        return {"audio_url": audio_store.url(aid), "provider": "cache"}
    task = _inflight.get(aid)
    if task is None:
        task = _inflight[aid] = asyncio.create_task(_tts_and_store(mt, text, lang, g, aid))
    return await asyncio.shield(task)  # a caller giving up never cancels the request others may be waiting on


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


async def attach_audio(lines: list[dict], lang: str, budget_s: float = 2.5) -> str:
    """Synthesize audio for lines in parallel, waiting at most `budget_s` so the result is never held back by a
    slow TTS. Lines not ready in time get no audio_url: the phone asks /api/speak, which joins the request still
    running here. Returns the provider used ('anuvaad', 'cache', 'device', or 'pending')."""
    spoken = [ln for ln in lines if ln.get("text")]
    tasks = [asyncio.ensure_future(synthesize(ln["text"], ln.get("lang_fallback", lang))) for ln in spoken]
    if not tasks:
        return "device"
    await asyncio.wait(tasks, timeout=budget_s)
    providers = set()
    for ln, task in zip(spoken, tasks):
        if not task.done():
            ln["audio_url"] = None
            providers.add("pending")
            continue
        res = task.result()
        ln["audio_url"] = res.get("audio_url")
        providers.add(res.get("provider"))
    if "anuvaad" in providers:
        return "anuvaad"
    if "cache" in providers:
        return "cache"
    if "pending" in providers:
        return "pending"
    return "device"
