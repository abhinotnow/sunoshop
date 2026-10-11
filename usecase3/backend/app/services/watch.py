"""Continuous watch: one quick look every few seconds while the person walks.

One small frame, one fast Gemini call, no verification: it only answers "is there something to read, and where"
(the phone then runs the full verified read) and "is there something close they could trip on or walk into".
It never speaks what a sign says; that stays with the verified read (CLAUDE.md rule 1). Hazards are spoken
cautiously ("Careful, there may be ...") and only when new: the phone sends what it said recently.
"""

from __future__ import annotations

import logging
import time

from rapidfuzz import fuzz

from ..content import prompt, schema
from ..settings import get_settings
from . import gemini, images
from .compose import Builder
from .speech import attach_audio, finalize
from .text_utils import normalize_name
from .verify import _clean_sentences

log = logging.getLogger("oriel.watch")
MAX_SIDE_WATCH = 896


def _seen(h: str, recent: list[str]) -> bool:
    """Already said recently? ('a bus moving on the right' ~ 'moving bus on the right')."""
    a = normalize_name(h)
    return any(fuzz.token_set_ratio(a, normalize_name(r)) >= 75 for r in recent if r)


async def watch(frame: bytes, lang: str, recent: list[str] | None = None, mode: str = "standard") -> dict:
    s = get_settings()
    t = time.perf_counter()
    jpeg = images.encode_jpeg(images.fit(images.decode(frame), MAX_SIDE_WATCH), quality=80)
    model = (s.reader_models or (s.reader_model,))[0]
    raw = await gemini.generate_json(model, prompt("watch"), schema("watch"), images=[jpeg],
                                     resolution="low", thinking_level="minimal", retries=1)  # low: ~2 s faster, same hazards
    hazards = []
    for h in raw.get("hazards_en") or []:
        h = _clean_sentences(str(h)).strip().rstrip(".")
        if h and len(h.split()) <= 12 and not _seen(h, recent or []) and not _seen(h, hazards):
            hazards.append(h[0].lower() + h[1:] if h[:2] != h[:2].upper() else h)
    hazards = hazards[:2]

    lines: list[dict] = []
    if hazards:
        b = Builder(lang, mode, None)
        text = " and ".join(hazards)
        if lang == "en":
            b.line("key", "scene", "info", b.t("scene_hazard").replace("{text}", text), always=True)
        else:
            b.line("key", "scene", "info", pending={"template": "scene_hazard", "slot": "text", "source": text,
                                                    "src": "en", "mode": mode}, always=True)
        speech = {"key": b.key, "more": [], "spell": []}
        await finalize(speech, lang)
        await attach_audio(speech["key"], lang, budget_s=1.2)
        lines = speech["key"]

    box = raw.get("sign_box") or []
    return {"sign_visible": bool(raw.get("sign_visible")) and images.valid_box(box),
            "sign_box": box if images.valid_box(box) else [],
            "sign_kind": raw.get("sign_kind") or "none", "sign_key": (raw.get("sign_key") or "")[:60],
            "hazards": hazards, "lines": lines, "ms": round((time.perf_counter() - t) * 1000)}
