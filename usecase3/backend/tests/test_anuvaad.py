"""AnuvaadHub client against a fake server that follows the published API spec."""

import asyncio
import io
import json
import wave

import httpx
import pytest

from backend.app.services import anuvaad


def wav_bytes(seconds=0.2, rate=22050):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(rate * seconds))
    return buf.getvalue()


CONFIG = {
    "mt": {"en-hi": {"endpoint": "https://hub.test/mt-en-hi", "token": "t1"},
           "te-en": {"endpoint": "https://hub.test/mt-te-en", "token": "t2"},
           "en-te": {"endpoint": "https://hub.test/mt-en-te", "token": "t3"}},
    "asr": {"te": {"endpoint": "https://hub.test/asr-te", "token": "t4"}},
    "tts": {"hi": {"endpoint": "https://hub.test/tts-hi", "token": "t5"}},
    "ocr": {"en": {"endpoint": "https://hub.test/ocr-en", "token": "t6"}},
}


@pytest.fixture
def fake(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        url = str(request.url)
        assert url.startswith("https://audio.test") or request.headers.get("access-token", "").startswith("t")
        ok = lambda data: httpx.Response(200, json={"status": "success", "message": "ok", "data": data, "error": None, "code": 200})  # noqa: E731
        if "/mt-" in url:
            body = json.loads(request.content)
            text = body["input_text"]
            assert len(text.split()) <= 50
            return ok({"output_text": f"[{text}]"})
        if "/asr-" in url:
            assert b'name="audio_file"' in request.content and b"audio/wav" in request.content
            return ok({"recognized_text": "బస్సు ఎక్కడ"})
        if "/tts-" in url:
            body = json.loads(request.content)
            assert len(body["text"].split()) <= 30 and body["gender"] in ("male", "female")
            assert "'" not in body["text"] and "#" not in body["text"]
            return ok({"s3_url": f"https://audio.test/{len(calls)}.wav"})
        if url.startswith("https://audio.test"):
            return httpx.Response(200, content=wav_bytes())
        if "/ocr-" in url:
            assert b'name="file"' in request.content
            return ok({"decoded_text": "218 SECUNDERABAD"})
        return httpx.Response(404, json={"status": "error", "message": "not found"})

    monkeypatch.setattr(anuvaad, "load_config", lambda: CONFIG)
    client = anuvaad.AnuvaadClient(http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return client, calls


def test_mt_chunks_long_text(fake):
    client, calls = fake
    text = " ".join(f"w{i}." for i in range(120))
    out = asyncio.run(client.translate(text, "en", "hi"))
    assert out.startswith("[") and len(calls) == 3


def test_mt_pivots_through_english(fake):
    client, calls = fake
    out = asyncio.run(client.translate("ఎక్కడ", "te", "hi"))
    assert out == "[[ఎక్కడ]]"
    assert [str(c.url).rsplit("/", 1)[1] for c in calls] == ["mt-te-en", "mt-en-hi"]


def test_missing_model_is_unavailable(fake):
    client, _ = fake
    with pytest.raises(anuvaad.AnuvaadUnavailable):
        asyncio.run(client.tts("hello", "te"))


def test_asr_and_ocr(fake):
    client, _ = fake
    assert asyncio.run(client.asr(wav_bytes(), "te")) == "బస్సు ఎక్కడ"
    assert asyncio.run(client.ocr(b"\x89PNG fake", "en")) == "218 SECUNDERABAD"


def test_tts_sanitizes_chunks_and_joins(fake):
    client, _ = fake
    long = "Say 'more' to hear #the rest. " * 10
    audio = asyncio.run(client.tts(long, "hi"))
    with wave.open(io.BytesIO(audio)) as w:
        assert w.getnframes() > int(22050 * 0.2) * 2  # several chunks joined


def test_error_payload_raises(monkeypatch):
    def handler(request):
        return httpx.Response(401, json={"status": "error", "message": "invalid access token", "data": None})
    monkeypatch.setattr(anuvaad, "load_config", lambda: CONFIG)
    client = anuvaad.AnuvaadClient(http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    with pytest.raises(anuvaad.AnuvaadError, match="invalid access token"):
        asyncio.run(client.translate("hi", "en", "hi"))
