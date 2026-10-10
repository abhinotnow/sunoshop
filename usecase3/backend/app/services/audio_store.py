"""Caches synthesized speech on disk (backend/.cache/audio) so repeated lines are instant.

Only generated speech is stored here. Camera frames and the user's voice are never stored.
"""

from __future__ import annotations

import hashlib
import re

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


def put(aid: str, wav: bytes) -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path_for(aid).write_bytes(wav)


def url(aid: str) -> str:
    return f"/api/audio/{aid}.wav"
