# AnuvaadHub ASR, machine translation, and TTS clients with a shared circuit breaker.
# Exports speech functions and BhashiniOfflineError for callers that need offline fallback.
# Depends on requests, python-dotenv, and per-model settings in environment variables.

from __future__ import annotations

import io
import hashlib
import os
from pathlib import Path
import time
import unicodedata
import wave
from typing import Any, Callable, TypeVar

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

ASR_MOCK_TEXT = {
    "en": "Show me the product details.",
    "hi": "मुझे उत्पाद की जानकारी दिखाइए।",
    "te": "ఉత్పత్తి వివరాలు చూపించండి.",
}
MAX_AUDIO_BYTES = 5_000_000
MAX_AUDIO_SECONDS = 20
MT_PAIRS = {"en-hi", "hi-en", "en-te", "te-en", "hi-te", "te-hi"}
MT_MOCK_TEXT = {
    "en-hi": "नमस्ते, आपका उत्पाद उपलब्ध है।",
    "hi-en": "Hello, your product is available.",
    "en-te": "నమస్కారం, మీ ఉత్పత్తి అందుబాటులో ఉంది.",
    "te-en": "Hello, your product is available.",
    "hi-te": "నమస్కారం, మీ ఉత్పత్తి అందుబాటులో ఉంది.",
    "te-hi": "नमस्ते, आपका उत्पाद उपलब्ध है।",
}
TTS_MAX_WORDS = 30
TTS_CACHE: dict[str, bytes] = {}
TTS_MOCK_SECONDS = 0.25
BREAKER_TIMEOUT_SECONDS = 3.0
BREAKER_FAILURE_THRESHOLD = 3
_consecutive_failures = 0
_circuit_open = False
Result = TypeVar("Result")


class BhashiniOfflineError(RuntimeError):
    """Raised when the shared Bhashini circuit is open and offline fallback is needed."""

    fallback = "offline"


def _reset_circuit_breaker() -> None:
    """Reset in-memory breaker state for isolated tests and process startup."""
    global _consecutive_failures, _circuit_open
    _consecutive_failures = 0
    _circuit_open = False


def _run_with_circuit_breaker(operation: Callable[[], Result]) -> Result:
    """Run one remote request; three consecutive errors or calls over 3s open the breaker."""
    global _consecutive_failures
    if _circuit_open:
        raise BhashiniOfflineError("AnuvaadHub circuit is open; use offline fallback")

    started = time.monotonic()
    try:
        result = operation()
    except Exception as exc:
        _record_failure(exc)
        raise

    elapsed = time.monotonic() - started
    if elapsed > BREAKER_TIMEOUT_SECONDS:
        error = TimeoutError("AnuvaadHub request exceeded the 3 second limit")
        _record_failure(error)
        raise error

    _consecutive_failures = 0
    return result


def _record_failure(error: Exception) -> None:
    """Count a failed call and open the breaker once its consecutive-failure limit is hit."""
    global _consecutive_failures, _circuit_open
    _consecutive_failures += 1
    if _consecutive_failures >= BREAKER_FAILURE_THRESHOLD:
        _circuit_open = True
        raise BhashiniOfflineError("AnuvaadHub circuit is open; use offline fallback") from error


def _validate_wav(wav_bytes: bytes) -> None:
    """Validate the audio constraints required by the shared client contract."""
    if not wav_bytes or len(wav_bytes) >= MAX_AUDIO_BYTES:
        raise ValueError("WAV audio must be non-empty and smaller than 5 MB")

    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_rate = wav_file.getframerate()
            frames = wav_file.getnframes()
            duration = frames / sample_rate if sample_rate else 0
    except (wave.Error, EOFError) as exc:
        raise ValueError("Audio must be a valid WAV file") from exc

    if channels != 1 or sample_rate != 16_000:
        raise ValueError("WAV audio must be mono at 16 kHz")
    if duration <= 0 or duration > MAX_AUDIO_SECONDS:
        raise ValueError("WAV audio duration must be between 0 and 20 seconds")


def recognize_speech(
    wav_bytes: bytes,
    lang: str,
    *,
    mock: bool | None = None,
    endpoint: str | None = None,
    token: str | None = None,
) -> str:
    """Transcribe a 16 kHz mono WAV using the selected AnuvaadHub ASR model."""
    language = lang.lower()
    if language not in ASR_MOCK_TEXT:
        raise ValueError("lang must be one of: en, hi, te")
    _validate_wav(wav_bytes)

    use_mock = (
        os.getenv("MOCK_BHASHINI", "1").strip().lower() in {"1", "true", "yes"}
        if mock is None
        else mock
    )
    if use_mock:
        return ASR_MOCK_TEXT[language]

    endpoint = endpoint or os.getenv(f"BHASHINI_ASR_{language.upper()}_URL", "")
    token = token or os.getenv(f"BHASHINI_ASR_{language.upper()}_TOKEN", "")
    if not endpoint or not token:
        raise RuntimeError(f"Missing AnuvaadHub ASR endpoint or token for {language}")

    def request_transcription() -> str:
        response = requests.post(
            endpoint,
            headers={"access-token": token},
            files={"audio_file": ("utterance.wav", wav_bytes, "audio/wav")},
            timeout=BREAKER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        try:
            payload: dict[str, Any] = response.json()
        except ValueError as exc:
            raise RuntimeError("AnuvaadHub ASR returned invalid JSON") from exc

        if payload.get("status") != "success":
            raise RuntimeError("AnuvaadHub ASR inference failed")

        data = payload.get("data")
        text = data.get("recognized_text") if isinstance(data, dict) else None
        if not isinstance(text, str):
            raise RuntimeError("AnuvaadHub ASR response is missing recognized_text")
        return text.strip()

    return _run_with_circuit_breaker(request_transcription)


def translate_text(
    text: str,
    source: str,
    target: str,
    *,
    mock: bool | None = None,
    endpoint: str | None = None,
    token: str | None = None,
) -> str:
    """Translate up to 50 words with the configured AnuvaadHub language-pair model."""
    source_language = source.lower()
    target_language = target.lower()
    pair = f"{source_language}-{target_language}"
    if pair not in MT_PAIRS:
        raise ValueError("Supported language pairs: en/hi/te in either direction")
    if not text.strip():
        raise ValueError("text must be non-empty")
    if len(text.split()) > 50:
        raise ValueError("AnuvaadHub translation input must be at most 50 words")

    use_mock = (
        os.getenv("MOCK_BHASHINI", "1").strip().lower() in {"1", "true", "yes"}
        if mock is None
        else mock
    )
    if use_mock:
        return MT_MOCK_TEXT[pair]

    pair_key = f"{source_language.upper()}_{target_language.upper()}"
    endpoint = endpoint or os.getenv(f"BHASHINI_MT_{pair_key}_URL", "")
    token = token or os.getenv(f"BHASHINI_MT_{pair_key}_TOKEN", "")
    if not endpoint or not token:
        raise RuntimeError(f"Missing AnuvaadHub MT endpoint or token for {pair}")

    def request_translation() -> str:
        response = requests.post(
            endpoint,
            headers={"access-token": token},
            json={"input_text": text},
            timeout=BREAKER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        try:
            payload: dict[str, Any] = response.json()
        except ValueError as exc:
            raise RuntimeError("AnuvaadHub MT returned invalid JSON") from exc

        if payload.get("status") != "success":
            raise RuntimeError("AnuvaadHub MT inference failed")

        data = payload.get("data")
        translated = data.get("output_text") if isinstance(data, dict) else None
        if not isinstance(translated, str):
            raise RuntimeError("AnuvaadHub MT response is missing output_text")
        return translated.strip()

    return _run_with_circuit_breaker(request_translation)


def _prepare_tts_text(text: str) -> str:
    """Validate API text constraints; callers convert numbers and strip symbols first."""
    normalized = " ".join(text.split())
    if not normalized:
        raise ValueError("TTS text must be non-empty")
    if len(normalized.split()) > TTS_MAX_WORDS:
        raise ValueError("AnuvaadHub TTS input must be at most 30 words")
    if any(
        not (char.isspace() or unicodedata.category(char)[0] in {"L", "M"})
        for char in normalized
    ):
        raise ValueError("TTS text must contain only letters and spaces")
    return normalized


def _mock_wav() -> bytes:
    """Return a short valid silent WAV for offline development and tests."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16_000)
        wav_file.writeframes(b"\x00\x00" * int(16_000 * TTS_MOCK_SECONDS))
    return buffer.getvalue()


def synthesize_speech(
    text: str,
    lang: str,
    gender: str = "female",
    *,
    mock: bool | None = None,
    endpoint: str | None = None,
    token: str | None = None,
) -> bytes:
    """Return WAV bytes from AnuvaadHub TTS, cached by language, voice, and text."""
    language = lang.lower()
    if language not in ASR_MOCK_TEXT:
        raise ValueError("lang must be one of: en, hi, te")
    voice_gender = gender.lower()
    if voice_gender not in {"male", "female"}:
        raise ValueError("gender must be male or female")
    tts_text = _prepare_tts_text(text)
    use_mock = (
        os.getenv("MOCK_BHASHINI", "1").strip().lower() in {"1", "true", "yes"}
        if mock is None
        else mock
    )
    cache_key = hashlib.sha256(
        f"{language}:{voice_gender}:{use_mock}:{tts_text}".encode("utf-8")
    ).hexdigest()
    if cache_key in TTS_CACHE:
        return TTS_CACHE[cache_key]
    if use_mock:
        audio = _mock_wav()
        TTS_CACHE[cache_key] = audio
        return audio

    endpoint = endpoint or os.getenv(f"BHASHINI_TTS_{language.upper()}_URL", "")
    token = token or os.getenv(f"BHASHINI_TTS_{language.upper()}_TOKEN", "")
    if not endpoint or not token:
        raise RuntimeError(f"Missing AnuvaadHub TTS endpoint or token for {language}")

    def request_audio_url() -> str:
        response = requests.post(
            endpoint,
            headers={"access-token": token},
            json={"text": tts_text, "gender": voice_gender},
            timeout=BREAKER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        try:
            payload: dict[str, Any] = response.json()
        except ValueError as exc:
            raise RuntimeError("AnuvaadHub TTS returned invalid JSON") from exc

        if payload.get("status") != "success":
            raise RuntimeError("AnuvaadHub TTS inference failed")
        data = payload.get("data")
        audio_url = data.get("s3_url") if isinstance(data, dict) else None
        if not isinstance(audio_url, str) or not audio_url.startswith("https://"):
            raise RuntimeError("AnuvaadHub TTS response is missing a valid HTTPS s3_url")
        return audio_url

    audio_url = _run_with_circuit_breaker(request_audio_url)

    def download_audio() -> bytes:
        audio_response = requests.get(audio_url, timeout=BREAKER_TIMEOUT_SECONDS)
        audio_response.raise_for_status()
        audio = audio_response.content
        if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
            raise RuntimeError("AnuvaadHub TTS download is not a WAV file")
        return audio

    audio = _run_with_circuit_breaker(download_audio)
    TTS_CACHE[cache_key] = audio
    return audio
