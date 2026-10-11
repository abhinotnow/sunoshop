"""attach_audio never holds the result back for a slow TTS, and one line is synthesized only once."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from backend.app.services import audio_store, speech


def test_slow_tts_does_not_block_and_is_shared(monkeypatch, tmp_path):
    monkeypatch.setattr(audio_store, "AUDIO_DIR", tmp_path)
    calls = []

    async def slow_tts(text, lang, g):
        calls.append(text)
        await asyncio.sleep(0.3)
        return b"RIFF....WAVE"

    monkeypatch.setattr(speech, "anuvaad_client", lambda: SimpleNamespace(gender="female", tts=slow_tts))

    async def scenario():
        lines = [{"text": "The sign says: Koti."}]
        provider = await speech.attach_audio(lines, "en", budget_s=0.05)
        assert provider == "pending" and lines[0]["audio_url"] is None
        later = await speech.synthesize("The sign says: Koti.", "en")  # the phone asks: joins the running request
        assert later["audio_url"]
        assert calls == ["The sign says: Koti."]

    asyncio.run(scenario())


def test_shrink_wav_48k_to_16k():
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes(b"\x10\x00" * 48000)
    out = audio_store.shrink_wav(buf.getvalue())
    with wave.open(io.BytesIO(out)) as w:
        assert w.getframerate() == 16000 and w.getnframes() == 16000
    assert audio_store.shrink_wav(b"not a wav") == b"not a wav"
