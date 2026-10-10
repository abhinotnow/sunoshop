"""End-to-end API tests with Gemini and AnuvaadHub replaced by fakes."""

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import main
from backend.app.services import ask_pipeline, gemini, read_pipeline, sign_reader, speech

from .conftest import SECUNDERABAD, rec, route


def jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (20, 90, 60)).save(buf, "JPEG")
    return buf.getvalue()


def events(resp):
    out = []
    for block in resp.text.split("\n\n"):
        if block.startswith("data: "):
            out.append(json.loads(block[6:]))
    return out


@pytest.fixture
def client(monkeypatch):
    async def fake_read(_):
        return rec(route_numbers=[route("218")], places=SECUNDERABAD)

    async def fake_arbiter(_):
        return {"legible": True, "route_numbers": ["218"], "places": [], "platform": None, "business_name_romanized": "",
                "symbols": [], "speed_limit_value": "", "pedestrian_signal_state": "none"}

    async def no_audio(text, lang, gender=None):
        return {"audio_url": None, "provider": "device"}

    monkeypatch.setattr(sign_reader, "read_frame", fake_read)
    monkeypatch.setattr(sign_reader, "arbiter_read", fake_arbiter)
    monkeypatch.setattr(speech, "synthesize", no_audio)
    monkeypatch.setattr(ask_pipeline, "synthesize", no_audio)
    return TestClient(main.app)


def test_read_streams_stages_and_result(client):
    files = [("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(3)]
    resp = client.post("/api/read", files=files, data={"lang": "en"})
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
    evs = events(resp)
    stages = [e["stage"] for e in evs if e["type"] == "stage" and e["status"] == "done"]
    assert stages == ["quality", "read", "second_reader", "verify", "guidance", "compose", "tts"]
    result = next(e for e in evs if e["type"] == "result")
    assert result["speech"]["key"][0]["text"] == "The sign says: bus two one eight, to Secunderabad."
    assert result["next_step"]["action"] == "done" and result["reads_used"] == 1
    assert evs[-1]["type"] == "end"


def test_read_rejects_bad_input(client):
    assert client.post("/api/read", files=[("frames", ("a.jpg", jpeg(), "image/jpeg"))], data={"lang": "fr"}).status_code == 422
    files = [("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(4)]
    assert client.post("/api/read", files=files, data={"lang": "en"}).status_code == 422


def test_read_reports_reader_outage(client, monkeypatch):
    async def down(_):
        raise gemini.GeminiError("503 unavailable")
    monkeypatch.setattr(sign_reader, "read_frame", down)
    evs = events(client.post("/api/read", files=[("frames", ("a.jpg", jpeg(), "image/jpeg"))], data={"lang": "te"}))
    err = next(e for e in evs if e["type"] == "error")
    assert err["code"] == "reader_unavailable"


def test_ask_text_question_english(client, monkeypatch):
    async def fake_json(model, prompt, schema, images=None, extra_text=None, retries=2):
        assert "SIGN FACTS" in extra_text and "218" in extra_text
        return {"answer_en": "The sign says bus 218 goes to Secunderabad.", "confidence": "high", "grounded_in_sign": True,
                "needs_confirmation": False, "confirm_question_en": "", "out_of_scope": False, "protected_terms": ["218", "Secunderabad"]}
    monkeypatch.setattr(gemini, "generate_json", fake_json)
    ctx = {"sign_found": True, "category": "bus_route_board",
           "fields": [{"kind": "route", "value": "218", "status": "confirmed"},
                      {"kind": "place", "value": "Secunderabad", "status": "confirmed", "texts": {"en": "Secunderabad"}}]}
    evs = events(client.post("/api/ask", data={"text": "Which bus goes to Secunderabad?", "in_lang": "en",
                                                "out_lang": "en", "context": json.dumps(ctx)}))
    result = next(e for e in evs if e["type"] == "result")
    assert result["answer"] == "The sign says bus 218 goes to Secunderabad."
    assert [e["stage"] for e in evs if e["type"] == "stage" and e["status"] in ("done", "skipped")] == \
        ["asr", "translate_in", "ai", "translate_out", "tts"]


def test_ask_empty_speech_asks_to_repeat(client):
    evs = events(client.post("/api/ask", data={"text": " . ", "in_lang": "en", "out_lang": "en"}))
    err = next(e for e in evs if e["type"] == "error")
    assert err["code"] == "no_speech" and err["phrase_id"] == "didnt_catch"


def test_compose_endpoint_switches_language(client):
    files = [("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(3)]
    result = next(e for e in events(client.post("/api/read", files=files, data={"lang": "en"})) if e["type"] == "result")
    resp = client.post("/api/compose", json={"verified": result["verified"], "lang": "te", "mode": "simple"})
    assert resp.status_code == 200
    assert "సికింద్రాబాద్" in resp.json()["speech"]["key"][0]["text"]


def test_health(client):
    body = client.get("/api/health").json()
    assert body["gemini"]["configured"] is True and body["known_places"] >= 90


@pytest.mark.parametrize("parallel", [True, False])
def test_second_reader_modes(client, monkeypatch, parallel):
    """Parallel: reader 2 reads the full sharpest frame. Crop mode: it reads the sign box. Either way, once."""
    import dataclasses
    from PIL import Image
    import io
    seen: list[tuple[int, int]] = []

    async def fake_read(_):
        return rec(route_numbers=[route("218")], places=SECUNDERABAD, main_sign_box=[250, 250, 750, 750])

    async def spy_arbiter(jpeg_bytes):
        seen.append(Image.open(io.BytesIO(jpeg_bytes)).size)
        return {"legible": True, "route_numbers": ["218"], "places": [], "platform": None, "business_name_romanized": "",
                "symbols": [], "speed_limit_value": "", "pedestrian_signal_state": "none"}

    base = read_pipeline.get_settings()
    monkeypatch.setattr(read_pipeline, "get_settings", lambda: dataclasses.replace(base, arbiter_parallel=parallel))
    monkeypatch.setattr(sign_reader, "read_frame", fake_read)
    monkeypatch.setattr(sign_reader, "arbiter_read", spy_arbiter)
    files = [("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(3)]
    evs = events(client.post("/api/read", files=files, data={"lang": "en"}))
    result = next(e for e in evs if e["type"] == "result")
    assert result["speech"]["key"][0]["text"].startswith("The sign says")
    assert len(seen) == 1
    full = Image.open(io.BytesIO(jpeg())).size
    assert (seen[0] == full) if parallel else (seen[0] != full)
