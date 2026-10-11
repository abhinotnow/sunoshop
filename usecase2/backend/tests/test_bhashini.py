# Tests AnuvaadHub ASR, MT, and TTS behavior, request shapes, and input validation.
# Exports pytest tests for backend.bhashini speech functions.
# Depends on pytest and the requests mock fixture.

import io
import wave

import pytest

from backend.bhashini import (
    BhashiniOfflineError,
    _reset_circuit_breaker,
    _run_with_circuit_breaker,
    recognize_speech,
    synthesize_speech,
    translate_text,
)


@pytest.fixture(autouse=True)
def reset_breaker_between_tests():
    _reset_circuit_breaker()
    yield
    _reset_circuit_breaker()


def make_wav(seconds: float = 1) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16_000)
        wav_file.writeframes(b"\x00\x00" * int(16_000 * seconds))
    return buffer.getvalue()


@pytest.mark.parametrize("lang", ["en", "hi", "te"])
def test_mock_asr_returns_canned_transcription(lang: str) -> None:
    text = recognize_speech(make_wav(), lang, mock=True)

    assert text


def test_real_asr_sends_an_input_file_and_access_token(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, object]:
            return {"status": "success", "data": {"recognized_text": "  hello  "}}

    def fake_post(url: str, **kwargs: object) -> FakeResponse:
        assert url == "https://asr.example.test"
        assert kwargs["headers"] == {"access-token": "test-token"}
        files = kwargs["files"]
        assert isinstance(files, dict)
        assert files["audio_file"][2] == "audio/wav"
        return FakeResponse()

    monkeypatch.setattr("backend.bhashini.requests.post", fake_post)
    transcript = recognize_speech(
        make_wav(),
        "en",
        mock=False,
        endpoint="https://asr.example.test",
        token="test-token",
    )

    assert transcript == "hello"


def test_asr_rejects_invalid_wav() -> None:
    with pytest.raises(ValueError, match="valid WAV"):
        recognize_speech(b"not wav", "en", mock=True)


def test_asr_rejects_unknown_language() -> None:
    with pytest.raises(ValueError, match="lang must"):
        recognize_speech(make_wav(), "fr", mock=True)


@pytest.mark.parametrize(
    ("source", "target"),
    [("en", "hi"), ("hi", "en"), ("en", "te"), ("te", "en"), ("hi", "te"), ("te", "hi")],
)
def test_mock_translation_supports_each_language_pair(source: str, target: str) -> None:
    result = translate_text("Hello there", source, target, mock=True)

    assert result


def test_real_translation_sends_text_and_access_token(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, object]:
            return {"status": "success", "data": {"output_text": "  नमस्ते  "}}

    def fake_post(url: str, **kwargs: object) -> FakeResponse:
        assert url == "https://mt.example.test"
        assert kwargs["headers"] == {"access-token": "test-token"}
        assert kwargs["json"] == {"input_text": "Hello"}
        return FakeResponse()

    monkeypatch.setattr("backend.bhashini.requests.post", fake_post)
    result = translate_text(
        "Hello",
        "en",
        "hi",
        mock=False,
        endpoint="https://mt.example.test",
        token="test-token",
    )

    assert result == "नमस्ते"


def test_translation_rejects_more_than_50_words() -> None:
    with pytest.raises(ValueError, match="at most 50 words"):
        translate_text("word " * 51, "en", "hi", mock=True)


def test_translation_rejects_unsupported_pair() -> None:
    with pytest.raises(ValueError, match="Supported language pairs"):
        translate_text("Hello", "en", "fr", mock=True)


@pytest.mark.parametrize("lang", ["en", "hi", "te"])
def test_mock_tts_returns_wav_bytes(lang: str) -> None:
    audio = synthesize_speech("Hello there", lang, mock=True)

    assert audio.startswith(b"RIFF")
    assert audio[8:12] == b"WAVE"


def test_real_tts_posts_text_and_downloads_wav(monkeypatch: pytest.MonkeyPatch) -> None:
    expected_audio = make_wav()

    class FakeResponse:
        def __init__(self, payload: dict[str, object] | None = None, content: bytes = b"") -> None:
            self.payload = payload
            self.content = content

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, object]:
            assert self.payload is not None
            return self.payload

    def fake_post(url: str, **kwargs: object) -> FakeResponse:
        assert url == "https://tts.example.test"
        assert kwargs["headers"] == {"access-token": "test-token"}
        assert kwargs["json"] == {"text": "Hello there", "gender": "female"}
        return FakeResponse({"status": "success", "data": {"s3_url": "https://audio.example.test/a.wav"}})

    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        assert url == "https://audio.example.test/a.wav"
        return FakeResponse(content=expected_audio)

    monkeypatch.setattr("backend.bhashini.requests.post", fake_post)
    monkeypatch.setattr("backend.bhashini.requests.get", fake_get)
    audio = synthesize_speech(
        "Hello there",
        "en",
        mock=False,
        endpoint="https://tts.example.test",
        token="test-token",
    )

    assert audio == expected_audio


def test_tts_breaker_measures_inference_and_asset_download_separately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_audio = make_wav()
    moments = iter([0.0, 1.9, 2.0, 2.7])

    class FakeResponse:
        content = expected_audio

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, object]:
            return {"status": "success", "data": {"s3_url": "https://audio.example.test/a.wav"}}

    monkeypatch.setattr("backend.bhashini.time.monotonic", lambda: next(moments))
    monkeypatch.setattr("backend.bhashini.requests.post", lambda *args, **kwargs: FakeResponse())
    monkeypatch.setattr("backend.bhashini.requests.get", lambda *args, **kwargs: FakeResponse())

    audio = synthesize_speech("Split the timing checks", "en", mock=False,
                              endpoint="https://tts.example.test", token="test-token")

    assert audio == expected_audio


def test_tts_caches_wav_for_same_text(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def unexpected_post(*args: object, **kwargs: object) -> None:
        nonlocal calls
        calls += 1
        raise AssertionError("mock TTS should not make an API call")

    monkeypatch.setattr("backend.bhashini.requests.post", unexpected_post)
    first = synthesize_speech("Cache this phrase", "en", mock=True)
    second = synthesize_speech("Cache this phrase", "en", mock=True)

    assert first == second
    assert calls == 0


def test_tts_rejects_special_characters_and_more_than_30_words() -> None:
    with pytest.raises(ValueError, match="only letters and spaces"):
        synthesize_speech("Price is $10", "en", mock=True)
    with pytest.raises(ValueError, match="at most 30 words"):
        synthesize_speech("word " * 31, "en", mock=True)


def test_tts_accepts_unicode_marks_and_rejects_invalid_gender() -> None:
    audio = synthesize_speech("नमस्ते दुनिया", "hi", mock=True)
    assert audio.startswith(b"RIFF")
    with pytest.raises(ValueError, match="gender"):
        synthesize_speech("Hello", "en", "other", mock=True)


def test_circuit_breaker_opens_after_three_slow_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    moments = iter([0.0, 3.1, 4.0, 7.1, 8.0, 11.1])
    monkeypatch.setattr("backend.bhashini.time.monotonic", lambda: next(moments))
    calls = 0

    def slow_operation() -> str:
        nonlocal calls
        calls += 1
        return "late response"

    for _ in range(2):
        with pytest.raises(TimeoutError, match="3 second"):
            _run_with_circuit_breaker(slow_operation)

    with pytest.raises(BhashiniOfflineError) as error:
        _run_with_circuit_breaker(slow_operation)
    assert error.value.fallback == "offline"

    with pytest.raises(BhashiniOfflineError) as open_error:
        _run_with_circuit_breaker(slow_operation)
    assert open_error.value.fallback == "offline"
    assert calls == 3
