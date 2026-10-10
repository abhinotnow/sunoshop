import copy
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from backend.app.services.sign_reader import EMPTY_RECORD  # noqa: E402


def rec(**kw) -> dict:
    """A SignRecord with sensible defaults; override any field."""
    r = copy.deepcopy(EMPTY_RECORD)
    r.update({"sign_found": True, "sign_count": 1, "sign_category": "bus_route_board",
              "main_sign_box": [200, 150, 600, 850], "languages_present": ["te", "en"]})
    r.update(kw)
    return r


def route(value, legibility="clear"):
    return {"value": value, "legibility": legibility, "box": []}


def place(text, script, romanized, role="destination", legibility="clear"):
    return {"text": text, "script": script, "romanized": romanized, "role": role, "legibility": legibility}


SECUNDERABAD = [place("సికింద్రాబాద్", "Telugu", "Secunderabad"), place("SECUNDERABAD", "Latin", "Secunderabad")]


@pytest.fixture
def bus_218():
    return [rec(route_numbers=[route("218")], places=SECUNDERABAD) for _ in range(3)]
