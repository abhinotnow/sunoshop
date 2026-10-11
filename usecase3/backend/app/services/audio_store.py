"""Caches synthesized speech on disk (backend/.cache/audio) so repeated lines are instant.

Only generated speech is stored here. Camera frames and the user's voice are never stored.
"""

from __future__ import annotations

import hashlib
import io
import re
import wave

import numpy as np

from ..settings import CACHE

AUDIO_DIR = CACHE / "audio"
_ID = re.compile(r"^[a-f0-9]{24}$")


def audio_id(text: str, lang: str, gender: str) -> str:
    return hashlib.sha1(f"{lang}|{gender}|{text}".encode("utf-8")).hexdigest()[:24]


def path_for(aid: str):
    if not _ID.match(aid):
        raise ValueError("bad audio id")
    return AUDIO_DIR / f"{aid}.wav"


def get(aid: str) -> bytes | None:
    p = path_for(aid)
    return p.read_bytes() if p.exists() else None


def shrink_wav(data: bytes, target_rate: int = 16000) -> bytes:
    """48 kHz TTS speech -> 16 kHz (3x smaller, same clarity for a voice: starts sooner on a phone network).
    Only exact multiples of the target rate, 16-bit mono, are converted; anything else is returned unchanged."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            rate, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            frames = w.readframes(n)
        if ch != 1 or width != 2 or rate <= target_rate or rate % target_rate:
            return data
        k = rate // target_rate
        pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32)
        pcm = pcm[: len(pcm) // k * k].reshape(-1, k).mean(axis=1)  # average k samples: a simple low-pass
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(target_rate)
            w.writeframes(np.clip(pcm, -32768, 32767).astype("<i2").tobytes())
        return out.getvalue()
    except (wave.Error, EOFError, ValueError):
        return data


def put(aid: str, wav: bytes) -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path_for(aid).write_bytes(shrink_wav(wav))


def url(aid: str) -> str:
    return f"/api/audio/{aid}.wav"
