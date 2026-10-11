"""Acceptance tests: the promises Oriel makes as an assistant for blind, older and hand-impaired users.

Each test is one condition a working Oriel must meet (CLAUDE.md "Non-negotiables" and README sections 4-9).
Gemini, Cloud Vision and AnuvaadHub are fakes, so these run without keys.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main
from backend.app.services import compose as compose_mod
from backend.app.services import read_pipeline, sign_reader, speech, vision_ocr
from backend.app.services.compose import compose
from backend.app.services.verify import Evidence, verify

from .conftest import SECUNDERABAD, place, rec, route

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
LANGS = ("te", "hi", "en")


def load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def jpeg(color=(20, 90, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), color).save(buf, "JPEG")
    return buf.getvalue()


def events(resp) -> list[dict]:
    return [json.loads(b[6:]) for b in resp.text.split("\n\n") if b.startswith("data: ")]


def arb(**kw) -> dict:
    base = {"legible": True, "route_numbers": [], "places": [], "platform": None, "business_name_romanized": "",
            "business_name_text": "", "text_lines": [], "symbols": [], "speed_limit_value": "",
            "pedestrian_signal_state": "none"}
    base.update(kw)
    return base


@pytest.fixture
def app(monkeypatch):
    """The real app with fake readers. Set READER / ARBITER / VISION to change what they 'see'."""
    state = {"reader": rec(route_numbers=[route("218")], places=SECUNDERABAD),
             "arbiter": arb(route_numbers=["218"]), "vision": [], "delay": 0.0, "reader_fail": set(), "calls": 0}

    async def fake_read(jpeg_bytes, model=None):
        await asyncio.sleep(state["delay"])
        state["calls"] += 1
        if state["reader_fail"] == "all" or (state["reader_fail"] == "first" and state["calls"] == 1):
            from backend.app.services.gemini import GeminiError
            raise GeminiError(f"{model}: 429 quota")
        return state["reader"]

    async def fake_arbiter(_):
        await asyncio.sleep(state["delay"])
        return state["arbiter"]

    async def fake_vision(_img, langs=None):
        await asyncio.sleep(state["delay"])
        return state["vision"]

    async def no_audio(text, lang, gender=None):
        return {"audio_url": None, "provider": "device"}

    monkeypatch.setattr(sign_reader, "read_frame", fake_read)
    monkeypatch.setattr(sign_reader, "arbiter_read", fake_arbiter)
    monkeypatch.setattr(vision_ocr, "configured", lambda: True)
    monkeypatch.setattr(vision_ocr, "read_words", fake_vision)
    class FakeMT:  # translation without the network: marks the text so tests can see it was translated
        gender = "female"

        def can_translate(self, src, tgt):
            return True

        async def translate(self, text, src, tgt):
            return f"[{tgt}] {text}"

    monkeypatch.setattr(speech, "synthesize", no_audio)
    monkeypatch.setattr(speech, "anuvaad_client", lambda: FakeMT())
    return TestClient(main.app), state


def read(client, lang="en", n=2) -> dict:
    files = [("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(n)]
    evs = events(client.post("/api/read", files=files, data={"lang": lang}))
    return next(e for e in evs if e["type"] in ("result", "error"))


# ------------------------------------------------------------------ 1. it speaks the user's language, all of it

def test_every_spoken_string_exists_in_telugu_hindi_and_english():
    missing = []
    for key, t in load("speech_templates.json")["templates"].items():
        missing += [f"template {key}/{l}" for l in LANGS if not (t.get(l) or "").strip()]
    for ph in load("guidance_phrases.json")["phrases"]:
        missing += [f"phrase {ph['id']}/{l}" for l in LANGS if not (ph.get(l) or "").strip()]
    for cmd, words in load("voice_commands.json")["commands"].items():
        missing += [f"command {cmd}/{l}" for l in LANGS if not words.get(l)]
    for code, sign in load("traffic_signs.json")["signs"].items():
        missing += [f"traffic sign {code}/{l}" for l in LANGS if not (sign.get(l) or "").strip()]
    assert not missing, missing


def test_every_phrase_the_app_can_say_is_defined():
    """Phrase ids used by the phone app and by the guidance planner all exist in data/guidance_phrases.json."""
    known = {p["id"] for p in load("guidance_phrases.json")["phrases"]}
    src = (ROOT / "frontend/src/hooks/useOriel.ts").read_text(encoding="utf-8")
    used = set()
    for block in re.findall(r"sayPhrases\(\[([^\]]*)\]", src):
        block = re.sub(r'===\s*"[a-z_]+"', "", block)  # comparisons such as  to === "user"  are not phrases
        used |= set(re.findall(r'"([a-z_]+)"', block))
    for block in re.findall(r"const phrase = ([^;]+);", src):  # phrases picked into a variable first
        used |= {a or b for a, b in re.findall(r'\?\s*"([a-z_]+)"|:\s*"([a-z_]+)"', block)}
    used |= set(re.findall(r'tail\.push\("([a-z_]+)"\)', src))
    used |= set(re.findall(r'"(offer_[a-z_]+)"', src))
    guidance = (ROOT / "backend/app/services/guidance.py").read_text(encoding="utf-8")
    used |= set(re.findall(r'append\("([a-z_]+)"\)', guidance))
    used |= set(re.findall(r'"((?:move|aim|tilt|no|step|several|too|ask)_[a-z_]+)"', guidance))
    assert used, "the scan found nothing: update the patterns"
    assert sorted(used - known) == []


def test_every_template_compose_uses_exists():
    known = set(load("speech_templates.json")["templates"])
    src = (ROOT / "backend/app/services/compose.py").read_text(encoding="utf-8")
    used = set(re.findall(r'b\.t\("([a-z_]+)"\)', src)) | set(re.findall(r'"template": "([a-z_]+)"', src))
    used |= {k for pair in re.findall(r'b\.t\("([a-z_]+)" if [^"]+ else "([a-z_]+)"\)', src) for k in pair}
    assert used and sorted(used - known) == []


def test_every_guidance_phrase_is_pre_recorded_in_all_three_languages():
    """Guidance must play instantly (no network round trip while the user is aiming)."""
    manifest_path = ROOT / "frontend/public/audio/guidance/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    missing = []
    for ph in load("guidance_phrases.json")["phrases"]:
        for l in LANGS:
            url = manifest.get(ph["id"], {}).get(l)
            if not url or not (ROOT / "frontend/public" / url.lstrip("/")).exists():
                missing.append(f"{ph['id']}/{l}")
    assert not missing, f"run: python scripts/generate_guidance_audio.py  (missing {missing})"


# ------------------------------------------------------------------ 2. it never misleads

def test_the_sign_says_only_when_an_independent_reader_agrees(app):
    client, state = app
    state["arbiter"] = arb(route_numbers=["21B"])  # the second reader saw something else
    res = read(client)
    line = res["speech"]["key"][0]
    assert line["status"] == "uncertain" and "looks like" in line["text"].lower()
    assert not any(l["status"] == "confirmed" and l["kind"] == "route" for l in res["speech"]["key"])


def test_ocr_inside_the_sign_box_can_confirm_but_text_elsewhere_cannot(app):
    client, state = app
    state["arbiter"] = arb()  # reader 2 is silent about the route
    state["reader"] = rec(route_numbers=[route("218")], places=SECUNDERABAD, main_sign_box=[200, 150, 600, 850])
    state["vision"] = [("218", (950, 10, 990, 60))]  # "218" on something at the bottom-left corner, not the sign
    assert read(client)["speech"]["key"][0]["status"] == "uncertain"
    state["vision"] = [("218", (300, 400, 360, 500))]  # inside the sign box
    assert read(client)["speech"]["key"][0]["status"] == "confirmed"


def test_never_says_it_is_safe_to_cross():
    t = load("speech_templates.json")["templates"]
    for key, tpl in t.items():
        assert "safe to cross" not in (tpl.get("en") or "").lower(), key
    assert "listen" in t["signal_walk"]["en"].lower()
    walk = [rec(sign_category="pedestrian_signal", pedestrian_signal={"state": "walk", "countdown": None})] * 2
    v = verify(walk, Evidence(arbiter=arb(pedestrian_signal_state="walk"), arbiter_ran=True))
    for lang in LANGS:
        for line in compose(v, lang)["key"]:
            assert "safe" not in line["text"].lower()


def test_no_sign_means_no_fact_is_spoken(app):
    client, state = app
    state["reader"] = rec(sign_found=False, sign_category="none", main_sign_box=[], route_numbers=[], places=[])
    res = read(client)
    assert res["speech"]["key"] == [] and res["next_step"]["action"] == "guide"


# ------------------------------------------------------------------ 3. key facts never go through translation

@pytest.mark.parametrize("lang", ["te", "hi"])
def test_route_and_place_come_from_templates_even_when_translation_is_down(app, monkeypatch, lang):
    client, _ = app

    class DownMT:
        gender = "female"

        def can_translate(self, *a):
            return True

        async def translate(self, *a, **k):
            raise RuntimeError("translation service down")

    monkeypatch.setattr(speech, "anuvaad_client", lambda: DownMT())
    res = read(client, lang=lang)
    line = res["speech"]["key"][0]
    assert line["status"] == "confirmed" and not line.get("pending")
    digits = compose_mod.route_words("218", lang)
    assert digits in line["text"]
    assert ("సికింద్రాబాద్" if lang == "te" else "Secunderabad") in line["text"] or lang == "hi"


# ------------------------------------------------------------------ 4. it stores nothing personal

def test_a_read_stores_no_image(app, tmp_path):
    client, _ = app
    before = {p for p in ROOT.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png") and ".venv" not in p.parts
              and "node_modules" not in p.parts}
    read(client)
    after = {p for p in ROOT.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png") and ".venv" not in p.parts
             and "node_modules" not in p.parts}
    assert after == before


# ------------------------------------------------------------------ 5. it is fast and keeps working when a model fails

def test_readers_run_in_parallel(app):
    """2 frames + reader 2 + OCR each take 0.4 s: in parallel the read is ~0.4 s, in series it would be 1.6 s."""
    client, state = app
    state["delay"] = 0.4
    t = time.perf_counter()
    res = read(client)
    assert res["type"] == "result"
    assert time.perf_counter() - t < 1.2


def test_one_frame_failing_still_gives_an_honest_answer(app):
    client, state = app
    state["reader_fail"] = "first"  # one frame's read fails (quota, overload)
    res = read(client)
    assert res["type"] == "result"
    assert res["speech"]["key"], "something useful is still said"
    assert all(l["status"] in ("confirmed", "uncertain", "unreadable", "info") for l in res["speech"]["key"])


def test_all_readers_down_is_reported_not_hidden(app):
    client, state = app
    state["reader_fail"] = "all"
    res = read(client)
    assert res["type"] == "error" and res["code"] == "reader_unavailable"


def test_spoken_key_lines_are_short():
    v = verify([rec(route_numbers=[route("218")], places=SECUNDERABAD)] * 2,
               Evidence(arbiter=arb(route_numbers=["218"]), arbiter_ran=True))
    for lang in LANGS:
        out = compose(v, lang)
        assert 1 <= len(out["key"]) <= compose_mod.MAX_KEY_LINES
        assert all(len(l["text"].split()) <= 25 for l in out["key"])


# ------------------------------------------------------------------ 6. it tells you what is set up

def test_health_lists_every_reader(app):
    client, _ = app
    body = client.get("/api/health").json()
    for key in ("gemini", "anuvaad", "paddleocr", "cloud_vision", "gemini_keys", "known_places"):
        assert key in body


# ------------------------------------------------------------------ 7. it helps with everything, not only signs

def scene_rec(desc="A wooden table with a steel water bottle on the left and a door straight ahead.", hazards=()):
    return rec(sign_found=False, sign_category="none", main_sign_box=[], route_numbers=[], places=[],
               scene={"description_en": desc, "hazards_en": list(hazards), "objects_en": ["table", "bottle", "door"]})


def test_no_sign_describes_what_is_in_front(app):
    client, state = app
    state["reader"] = scene_rec(hazards=["two steps going down in front"])
    res = read(client)
    texts = [l["text"] for l in res["speech"]["key"]]
    assert res["next_step"]["action"] == "guide" and "no_sign_try" in res["next_step"]["phrase_ids"]  # reposition
    assert texts[0].startswith("Careful, there may be two steps going down")  # hazard first
    assert "water bottle" in texts[1]
    assert all(l["status"] != "confirmed" for l in res["speech"]["key"])  # a description is never "the sign says"


def test_scene_never_repeats_a_claim_that_the_way_is_safe():
    v = verify([scene_rec("A zebra crossing ahead. The road is clear and it is safe to cross. A bus on the right.",
                          hazards=["a bus on the right", "nothing in your way"])] * 2)
    said = " ".join(l["text"] for l in compose(v, "en")["key"]).lower()
    assert "safe" not in said and "road is clear" not in said and "nothing in your way" not in said
    assert "zebra crossing" in said and "bus on the right" in said


def test_currency_needs_frames_and_a_second_reader():
    note = rec(sign_category="currency", currency=[{"value": "500", "legibility": "clear"}])
    sure = verify([note] * 2, Evidence(arbiter=arb(currency_values=["500"]), arbiter_ran=True))
    assert compose(sure, "en")["key"][0]["text"] == "This is a 500 rupee note."
    unsure = verify([note] * 2, Evidence(arbiter=arb(currency_values=["200"]), arbiter_ran=True))
    assert compose(unsure, "en")["key"][0]["text"] == "It looks like a 500 rupee note, please check."


def test_medicine_strip_reads_name_and_dose(app):
    client, state = app
    state["reader"] = rec(sign_category="product", languages_present=["en"],
                          business={"name_text": "DOLO 650", "name_script": "Latin", "name_romanized": "Dolo 650",
                                    "category_en": "paracetamol tablets", "hours_text": "", "open_time": "",
                                    "close_time": "", "open_hint": "none"},
                          other_text=[{"text": "Paracetamol Tablets IP 650 mg", "script": "Latin", "legibility": "clear"},
                                      {"text": "EXP 08/2027", "script": "Latin", "legibility": "clear"}])
    state["arbiter"] = arb(business_name_romanized="DOLO 650", text_lines=["Paracetamol Tablets IP 650 mg", "EXP 08/2027"])
    res = read(client)
    said = " ".join(l["text"] for l in res["speech"]["key"] + res["speech"]["more"])
    assert "Dolo 650" in said and "650 mg" in said and "08/2027" in said
    assert res["speech"]["key"][0]["status"] == "confirmed"


@pytest.mark.parametrize("lang", ["te", "hi"])
def test_scene_lines_are_spoken_in_the_users_language_or_marked_english(app, monkeypatch, lang):
    client, state = app
    state["reader"] = scene_rec()
    res = read(client, lang=lang)
    for line in res["speech"]["key"]:
        assert line["text"] and not line.get("pending")
        assert line.get("lang_fallback") in (None, "en")


# ------------------------------------------------------------------ 8. continuous watch while walking

@pytest.fixture
def watcher(app, monkeypatch):
    client, _ = app
    from backend.app.services import watch as watch_mod
    seen = {"raw": {}}

    async def fake_json(*a, **k):
        return seen["raw"]
    monkeypatch.setattr(watch_mod.gemini, "generate_json", fake_json)
    return client, seen


def look(client, recent=(), lang="en"):
    return client.post("/api/watch", files={"frame": ("f.jpg", jpeg(), "image/jpeg")},
                       data={"lang": lang, "recent": json.dumps(list(recent))})


def test_watch_warns_about_new_hazards_only(watcher):
    client, seen = watcher
    seen["raw"] = {"sign_visible": False, "sign_box": [], "sign_kind": "none", "sign_key": "",
                   "hazards_en": ["Steps going down just ahead", "a moving bus on the right"]}
    body = look(client).json()
    assert body["lines"][0]["text"] == "Careful, there may be steps going down just ahead and a moving bus on the right. Check with your cane."
    again = look(client, recent=body["hazards"]).json()  # the same view a moment later
    assert again["lines"] == [] and again["hazards"] == []


def test_watch_never_speaks_a_sign_or_a_safe_claim(watcher):
    client, seen = watcher
    seen["raw"] = {"sign_visible": True, "sign_box": [200, 100, 500, 900], "sign_kind": "bus_route_board",
                   "sign_key": "blue board 218", "hazards_en": ["the road is clear to cross"]}
    body = look(client).json()
    assert body["sign_visible"] and body["sign_box"] == [200, 100, 500, 900]
    assert body["lines"] == []  # the sign is read by the verified pipeline; the safe claim is dropped


def test_watch_ignores_an_invalid_box_and_reports_outage(watcher, monkeypatch):
    client, seen = watcher
    seen["raw"] = {"sign_visible": True, "sign_box": [900, 900, 100, 100], "sign_kind": "shop", "sign_key": "x", "hazards_en": []}
    assert look(client).json()["sign_visible"] is False
    from backend.app.services import watch as watch_mod
    from backend.app.services.gemini import GeminiError

    async def down(*a, **k):
        raise GeminiError("429 quota")
    monkeypatch.setattr(watch_mod.gemini, "generate_json", down)
    r = look(client)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "watch_unavailable"
