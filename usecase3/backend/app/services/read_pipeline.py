"""The READ pipeline, streamed stage by stage so the app can show it live.

  frames (1-3, face-blurred on the phone)
   -> quality: sharpness + brightness per frame, pick the sharpest
   -> reader 1: Gemini Flash-Lite reads every frame in parallel (SignRecord each)
   -> OCR: Google Cloud Vision on the sharpest frame (words inside the sign box) + PaddleOCR on the crop (optional)
   -> reader 2: an independent read of the sharpest frame at ultra-high resolution; it starts in parallel with
      reader 1 (ARBITER_PARALLEL=true) or waits for reader 1's sign box and reads a zoomed crop (false)
   -> verify: agreement across frames + independent check -> confirmed / uncertain / unreadable
   -> guidance: repositioning advice and whether to read again
   -> compose: sentences in the user's language from templates (names in their script)
   -> tts: AnuvaadHub speech for the key lines (cached)
Each stage yields {"type": "stage", ...}; the last event is {"type": "result", ...}.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import AsyncIterator

from ..settings import get_settings
from . import guidance as guidance_mod
from . import images, sign_reader, vision_ocr
from .compose import compose
from .gemini import GeminiError
from .speech import attach_audio, fill_names, finalize
from .verify import Evidence, consensus_box, verify

log = logging.getLogger("oriel.read")


def stage(name: str, status: str, ms: float | None = None, **detail) -> dict:
    ev = {"type": "stage", "stage": name, "status": status}
    if ms is not None:
        ev["ms"] = round(ms)
    if detail:
        ev["detail"] = detail
    return ev


def _summary(rec: dict) -> str:
    if not rec.get("sign_found"):
        return "no sign"
    bits = [rec.get("sign_category", "")]
    bits += [r.get("value", "") for r in rec.get("route_numbers", [])][:2]
    bits += [p.get("romanized", "") for p in rec.get("places", [])][:2]
    bits += [s.get("code", "") for s in rec.get("symbols", [])][:2]
    if rec.get("business", {}).get("name_romanized"):
        bits.append(rec["business"]["name_romanized"])
    return ", ".join(b for b in bits if b)


async def _paddle(crop) -> str:
    try:
        from . import paddle
    except Exception:  # noqa: BLE001
        return ""
    return await asyncio.to_thread(paddle.read_text, crop)


async def run_read(frames: list[bytes], lang: str, mode: str = "standard", reads_used: int = 0,
                   device: dict | None = None, style: str | None = None) -> AsyncIterator[dict]:
    s = get_settings()
    t_all = time.perf_counter()
    timings: dict[str, int] = {}

    # ---- decode + quality
    t = time.perf_counter()
    try:
        imgs = [images.decode(b) for b in frames[: s.max_frames]]
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "code": "bad_image", "message": f"could not open image: {e}"}
        return
    sharp = [images.sharpness(i) for i in imgs]
    bright = [images.brightness(i) for i in imgs]
    best = max(range(len(imgs)), key=lambda k: sharp[k])
    jpegs = [images.encode_jpeg(images.fit(i, images.MAX_SIDE_READER)) for i in imgs]
    timings["quality"] = round((time.perf_counter() - t) * 1000)
    yield stage("quality", "done", timings["quality"], frames=len(imgs), sharpness=[round(x) for x in sharp],
                brightness=[round(x) for x in bright], sharpest=best)

    # ---- reader 2 starts now on the sharpest full frame when running in parallel (it never sees reader 1's answer)
    early_arb: asyncio.Task | None = None
    if s.arbiter_parallel:
        full = images.encode_jpeg(images.fit(imgs[best], images.MAX_SIDE_ARBITER))
        early_arb = asyncio.create_task(sign_reader.arbiter_read(full))
    # ---- OCR reader (different technology): Cloud Vision on the same full frame, also started now; only the words
    # inside reader 1's sign box are used later, so a neighbouring board cannot confirm anything
    vision_task = (asyncio.create_task(vision_ocr.read_words(images.fit(imgs[best], images.MAX_SIDE_ARBITER)))
                   if vision_ocr.configured() else None)
    early = [t for t in (early_arb, vision_task) if t]
    for task in early:  # if cancelled or never awaited (no sign), an error must not be logged as unhandled
        task.add_done_callback(lambda tk: tk.cancelled() or tk.exception())

    # ---- reader 1 on every frame, streamed as each one finishes
    t = time.perf_counter()
    yield stage("read", "running", frames=len(jpegs), model=", ".join((s.reader_models or (s.reader_model,))[:len(jpegs)]))

    async def one(k: int):
        try:
            models = s.reader_models or (s.reader_model,)
            return k, await sign_reader.read_frame(jpegs[k], models[k % len(models)]), None
        except GeminiError as e:
            return k, None, str(e)

    records: dict[int, dict] = {}
    errors: list[str] = []
    for fut in asyncio.as_completed([one(k) for k in range(len(jpegs))]):
        k, rec, err = await fut
        if rec is not None:
            records[k] = rec
            yield stage("read", "progress", frame=k, summary=_summary(rec))
        else:
            errors.append(err)
            yield stage("read", "progress", frame=k, error=err)
    timings["read"] = round((time.perf_counter() - t) * 1000)
    if not records:
        for task in early:
            task.cancel()
        yield {"type": "error", "code": "reader_unavailable", "message": errors[0] if errors else "reader failed"}
        return
    recs = [records[k] for k in sorted(records)]
    yield stage("read", "done", timings["read"], ok=len(recs), failed=len(errors))

    # ---- reader 2 (arbiter) + OCR on a zoomed crop of the sharpest frame
    t = time.perf_counter()
    ev = Evidence()
    any_sign = any(r.get("sign_found") for r in recs)
    if any_sign:
        box = consensus_box(recs)
        crop = images.crop_box(imgs[best], box) if box else images.fit(imgs[best], images.MAX_SIDE_READER)
        yield stage("second_reader", "running", model=s.arbiter_model, crop=bool(box) and not early_arb,
                    ocr=[n for n, on in (("cloud_vision", bool(vision_task)), ("paddleocr", s.enable_paddleocr)) if on])
        arb_task = early_arb or asyncio.create_task(
            sign_reader.arbiter_read(images.encode_jpeg(images.fit(crop, images.MAX_SIDE_READER))))
        paddle_task = asyncio.create_task(_paddle(crop)) if s.enable_paddleocr else None
        try:
            ev.arbiter = await arb_task
            ev.arbiter_ran = True
        except GeminiError as e:
            ev.notes.append(f"arbiter failed: {e}")
        if vision_task:
            words = await vision_task
            ev.ocr_text = vision_ocr.text_in_box(words, box)
            ev.ocr_ran = bool(words)  # Vision answered (it may rightly find no words in the box)
            if not words:
                ev.notes.append("cloud vision: no answer")
        if paddle_task:
            ptxt = await paddle_task
            if ptxt:
                ev.ocr_text = (ev.ocr_text + "\n" + ptxt).strip()
                ev.ocr_ran = True
        timings["second_reader"] = round((time.perf_counter() - t) * 1000)
        yield stage("second_reader", "done", timings["second_reader"],
                    arbiter=("unreadable crop" if ev.arbiter and not ev.arbiter.get("legible", True)
                             else ", ".join((ev.arbiter or {}).get("route_numbers", []) +
                                            [p.get("romanized", "") for p in (ev.arbiter or {}).get("places", [])]) or
                             ("failed" if not ev.arbiter_ran else "nothing extra")),
                    ocr=(ev.ocr_text[:80] if ev.ocr_ran else "not configured"))
    else:
        for task in early:
            task.cancel()
        yield stage("second_reader", "skipped", reason="no sign in any frame")

    # ---- verify + guidance
    t = time.perf_counter()
    verified = verify(recs, ev)
    reads_now = reads_used + 1
    step = guidance_mod.next_step(verified, reads_now, s.max_reads_per_sign, device)
    timings["verify"] = round((time.perf_counter() - t) * 1000)
    counts = {st: sum(1 for f in verified["fields"] if f["status"] == st) for st in ("confirmed", "uncertain", "unreadable")}
    yield stage("verify", "done", timings["verify"], category=verified.get("category"), **counts)
    yield stage("guidance", "done", action=step["action"], phrases=step["phrase_ids"], reason=step["reason"])

    # ---- compose in the user's language
    t = time.perf_counter()
    await fill_names(verified, lang)
    speech = compose(verified, lang, mode, style)
    mt_trace = await finalize(speech, lang)
    timings["compose"] = round((time.perf_counter() - t) * 1000)
    yield stage("compose", "done", timings["compose"], lines=len(speech["key"]) + len(speech["more"]), translations=mt_trace)

    # ---- speech for the key lines (more / spell are synthesized when asked for)
    t = time.perf_counter()
    provider = await attach_audio(speech["key"], lang) if speech["key"] else "none"
    timings["tts"] = round((time.perf_counter() - t) * 1000)
    yield stage("tts", "done", timings["tts"], provider=provider)

    timings["total"] = round((time.perf_counter() - t_all) * 1000)
    yield {"type": "result", "verified": verified, "speech": speech, "next_step": step, "reads_used": reads_now,
           "lang": lang, "mode": mode, "timings_ms": timings}
