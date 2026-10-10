"""Loads the language data in /data once. Frontend and backend share these files."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .settings import DATA, PROMPTS, SCHEMA

LANGS = ("te", "hi", "en")


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def templates() -> dict:
    return _load(DATA / "speech_templates.json")


@lru_cache(maxsize=None)
def phrases() -> dict[str, dict[str, str]]:
    return {p["id"]: p for p in _load(DATA / "guidance_phrases.json")["phrases"]}


@lru_cache(maxsize=None)
def traffic_signs() -> dict:
    return _load(DATA / "traffic_signs.json")


@lru_cache(maxsize=None)
def places_raw() -> dict:
    return _load(DATA / "hyderabad_places.json")


@lru_cache(maxsize=None)
def schema(name: str) -> dict:
    """Schema without $-meta keys, ready for Gemini structured output."""
    raw = _load(SCHEMA / f"{name}.schema.json")
    return {k: v for k, v in raw.items() if not k.startswith("$")}


@lru_cache(maxsize=None)
def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def phrase(pid: str, lang: str) -> str:
    p = phrases().get(pid)
    if not p:
        return ""
    return p.get(lang) or p.get("en", "")
