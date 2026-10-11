# Tests the FastAPI health endpoint and voice WebSocket.
# Exports health and end-to-end WebSocket regression tests.
# Depends on pytest, FastAPI's test client, and backend modules.

import base64
import json

from fastapi.testclient import TestClient

from backend import bhashini, main, pipeline
from backend.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_catalog_loader_merges_generated_image_alt_text(tmp_path, monkeypatch):
    catalog_path = tmp_path / "catalog.json"
    cache_path = tmp_path / "image_alt_text_cache.json"
    image_url = "https://m.media-amazon.com/image.jpg"
    catalog_path.write_text(json.dumps([{
        "parent_asin": "p_001",
        "images": [{"variant": "MAIN", "large": image_url}],
    }]), encoding="utf-8")
    cache_path.write_text(json.dumps({
        "urls": {image_url: "hash1"},
        "images": {"hash1": {"en": "A mug on a table.", "hi": "मेज पर मग।", "te": "బల్లపై కప్పు."}},
    }), encoding="utf-8")
    monkeypatch.setattr(main, "CATALOG_PATH", catalog_path)
    monkeypatch.setattr(main, "IMAGE_ALT_TEXT_CACHE_PATH", cache_path)

    catalog = main._load_catalog()

    assert catalog[0]["alt_text"]["en"] == "A mug on a table."
    assert catalog[0]["images"][0]["alt_text"]["te"] == "బల్లపై కప్పు."


def test_websocket_telugu_query_returns_grounded_spoken_entity(monkeypatch) -> None:
    product = {
        "parent_asin": "p_001",
        "title": "Demo phone",
        "details": {"Battery capacity": "5000 mAh"},
        "review_chunks": [],
    }
    monkeypatch.setattr(main, "CATALOG", [product])
    monkeypatch.setattr(bhashini, "recognize_speech", lambda _audio, _lang: "battery ela undi")

    def translate(text: str, source: str, target: str) -> str:
        if source == "te" and target == "en":
            return "battery of p_001"
        if source == "en" and target == "te":
            assert "[PROD_1]" in text
            assert "[NUMBER_1]" in text
            return "[PROD_1] బ్యాటరీ సామర్థ్యం [NUMBER_1] mAh."
        raise AssertionError(f"unexpected translation direction: {source}-{target}")

    monkeypatch.setattr(bhashini, "translate_text", translate)
    monkeypatch.setattr(
        pipeline,
        "answer_grounded",
        lambda _query, _retrieval: "Demo phone battery capacity is 5000 mAh.",
    )
    monkeypatch.setattr(bhashini, "synthesize_speech", lambda _text, _lang: b"mock-wave-bytes")

    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"type": "session.start", "lang": "te", "mode": "push_to_talk", "rate": 1.0})
        websocket.send_json(
            {
                "type": "audio.utterance",
                "audio_base64": base64.b64encode(b"mock-wave-bytes").decode("ascii"),
                "content_type": "audio/wav",
                "sample_rate_hz": 16000,
                "channels": 1,
                "duration_ms": 250,
            }
        )
        asr_result = websocket.receive_json()
        reply_sentence = websocket.receive_json()
        reply_done = websocket.receive_json()

    assert asr_result == {"type": "asr.result", "text": "battery ela undi", "plausible": True}
    assert reply_sentence["type"] == "reply.sentence"
    assert reply_sentence["text"] == "Demo phone బ్యాటరీ సామర్థ్యం 5000 mAh."
    assert base64.b64decode(reply_sentence["audio_base64"]) == b"mock-wave-bytes"
    assert reply_done == {"type": "reply.done", "grounded": True}


def test_websocket_requests_retry_for_implausible_asr(monkeypatch) -> None:
    monkeypatch.setattr(bhashini, "recognize_speech", lambda _audio, _lang: "!!!")
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"type": "session.start", "lang": "en", "mode": "push_to_talk", "rate": 1.0})
        websocket.send_json(
            {
                "type": "audio.utterance",
                "audio_base64": base64.b64encode(b"mock-wave-bytes").decode("ascii"),
                "duration_ms": 250,
            }
        )
        assert websocket.receive_json()["plausible"] is False
        assert websocket.receive_json() == {
            "type": "check_again", "reason": "The audio was unclear. Please try again."
        }


def test_websocket_maps_transient_bhashini_failure_to_retry(monkeypatch) -> None:
    def slow_asr(_audio, _lang):
        raise TimeoutError("simulated slow Bhashini request")

    monkeypatch.setattr(bhashini, "recognize_speech", slow_asr)
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"type": "session.start", "lang": "en", "mode": "push_to_talk", "rate": 1.0})
        websocket.send_json(
            {"type": "audio.utterance", "audio_base64": base64.b64encode(b"audio").decode("ascii"), "duration_ms": 250}
        )
        assert websocket.receive_json() == {
            "type": "error", "code": "backend_service_error", "fallback": "retry"
        }


def test_websocket_maps_open_bhashini_circuit_to_offline(monkeypatch) -> None:
    def offline_asr(_audio, _lang):
        raise bhashini.BhashiniOfflineError("simulated open circuit")

    monkeypatch.setattr(bhashini, "recognize_speech", offline_asr)
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"type": "session.start", "lang": "en", "mode": "push_to_talk", "rate": 1.0})
        websocket.send_json(
            {"type": "audio.utterance", "audio_base64": base64.b64encode(b"audio").decode("ascii"), "duration_ms": 250}
        )
        assert websocket.receive_json() == {
            "type": "error", "code": "bhashini_offline", "fallback": "offline"
        }


def test_websocket_boundary_maps_unexpected_worker_failure_to_retry(monkeypatch) -> None:
    def unexpected_failure(*_args, **_kwargs):
        raise RuntimeError("private detail")

    monkeypatch.setattr(main, "handle_utterance", unexpected_failure)
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"type": "session.start", "lang": "en", "mode": "push_to_talk", "rate": 1.0})
        websocket.send_json(
            {"type": "audio.utterance", "audio_base64": base64.b64encode(b"audio").decode("ascii"), "duration_ms": 250}
        )
        assert websocket.receive_json() == {
            "type": "error", "code": "backend_service_error", "fallback": "retry"
        }


def test_websocket_simpler_reuses_last_grounded_answer_with_speech_controls(monkeypatch) -> None:
    transcripts = iter(("battery p_001", "simpler"))
    monkeypatch.setattr(bhashini, "recognize_speech", lambda _audio, _lang: next(transcripts))
    monkeypatch.setattr(pipeline, "answer_grounded", lambda _query, _evidence: "The battery demonstrates sufficient durability.")
    monkeypatch.setattr(bhashini, "synthesize_speech", lambda _text, _lang: b"mock-wave-bytes")
    monkeypatch.setattr(main, "CATALOG", [{"parent_asin": "p_001", "title": "Demo phone"}])

    audio = {
        "type": "audio.utterance",
        "audio_base64": base64.b64encode(b"mock-wave-bytes").decode("ascii"),
        "duration_ms": 250,
    }
    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"type": "session.start", "lang": "en", "mode": "push_to_talk", "rate": 1.0})
        websocket.send_json(audio)
        websocket.receive_json()  # ASR
        first_sentence = websocket.receive_json()
        websocket.receive_json()  # reply.done

        websocket.send_json(audio)
        websocket.receive_json()  # ASR
        simpler_sentence = websocket.receive_json()
        simpler_done = websocket.receive_json()

    assert first_sentence["rate"] == 1.0
    assert first_sentence["pause_ms"] == 250
    assert simpler_sentence["text"] == "The battery shows enough strength."
    assert simpler_sentence["rate"] == 0.8
    assert simpler_sentence["pause_ms"] == 600
    assert simpler_done == {"type": "reply.done", "grounded": True}
