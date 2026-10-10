"""gemini.generate_json: per-image resolution, per-call thinking level, and fallbacks that do not burn retries."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.app.services import gemini


class FakeClient:
    def __init__(self, failures: list[str]):
        self.failures = list(failures)
        self.calls: list[dict] = []
        self.aio = SimpleNamespace(interactions=SimpleNamespace(create=self.create))

    async def create(self, **kwargs):
        self.calls.append(json.loads(json.dumps(kwargs)))  # snapshot: the caller mutates kwargs between tries
        if self.failures:
            raise RuntimeError(self.failures.pop(0))
        return SimpleNamespace(output_text='{"ok": true}')


@pytest.fixture
def fake(monkeypatch):
    def install(failures=()):
        c = FakeClient(list(failures))
        monkeypatch.setattr(gemini, "client", lambda: c)
        return c
    return install


def run(**kw):
    return asyncio.run(gemini.generate_json("m", "prompt", {"type": "object"}, images=[b"jpg"], **kw))


def test_resolution_and_thinking_are_sent(fake):
    c = fake()
    assert run(resolution="ultra_high", thinking_level="low") == {"ok": True}
    sent = c.calls[0]
    assert sent["input"][-1]["resolution"] == "ultra_high"
    assert sent["generation_config"] == {"thinking_level": "low"}


def test_empty_resolution_is_left_out(fake):
    c = fake()
    run(resolution="")
    assert "resolution" not in c.calls[0]["input"][-1]


def test_unsupported_thinking_level_does_not_use_up_the_only_try(fake):
    c = fake(["400 thinking_level minimal is not supported for this model"])
    assert run(thinking_level="minimal", retries=0) == {"ok": True}
    assert "generation_config" in c.calls[0] and "generation_config" not in c.calls[1]


def test_unsupported_resolution_falls_back_to_default(fake):
    c = fake(["400 invalid field resolution"])
    assert run(resolution="ultra_high", retries=0) == {"ok": True}
    assert "resolution" not in c.calls[1]["input"][-1]


def test_hard_errors_still_raise(fake):
    fake(["401 api key invalid"])
    with pytest.raises(gemini.GeminiError):
        run(retries=2)
