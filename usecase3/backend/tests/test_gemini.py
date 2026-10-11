"""gemini.generate_json: options sent, fallbacks that never stall a read, quota parking, extra keys."""

from __future__ import annotations

import asyncio
import dataclasses
from types import SimpleNamespace

import pytest

from backend.app.services import gemini


class FakeModels:
    def __init__(self, behaviour):
        self.behaviour = behaviour  # (key_index, model) -> exception message or None (= answer)
        self.calls: list[tuple[int, str, object]] = []

    def bind(self, key_index):
        async def generate_content(model, contents, config):
            self.calls.append((key_index, model, contents, config))
            err = self.behaviour(key_index, model)
            if err:
                raise RuntimeError(err)
            return SimpleNamespace(text='{"ok": true}')
        return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))


@pytest.fixture
def fake(monkeypatch):
    def install(behaviour=lambda k, m: None, fallbacks=("b", "c"), extra_keys=()):
        f = FakeModels(behaviour)
        base = gemini.get_settings()
        s = dataclasses.replace(base, gemini_api_key="k0", gemini_extra_keys=tuple(extra_keys),
                                gemini_fallback_models=tuple(fallbacks), gemini_timeout_s=1.0)
        monkeypatch.setattr(gemini, "get_settings", lambda: s)
        monkeypatch.setattr(gemini, "client", lambda k=0: f.bind(k))
        monkeypatch.setattr(gemini, "_parked", {})
        return f
    return install


def run(**kw):
    return asyncio.run(gemini.generate_json("a", "prompt", {"type": "object"}, images=[b"jpg"], **kw))


def test_resolution_and_thinking_are_sent(fake):
    f = fake()
    assert run(resolution="ultra_high", thinking_level="low") == {"ok": True}
    _, model, contents, cfg = f.calls[0]
    assert model == "a"
    assert contents[-1].media_resolution.level.value == "MEDIA_RESOLUTION_ULTRA_HIGH"
    assert cfg.thinking_config.thinking_level.value == "LOW"
    assert cfg.response_mime_type == "application/json"


def test_quota_moves_to_the_next_model_at_once_and_parks_it(fake):
    f = fake(lambda k, m: "429 RESOURCE_EXHAUSTED 'retryDelay': '1627s'" if m == "a" else None)
    assert run(retries=0) == {"ok": True}
    assert [c[1] for c in f.calls] == ["a", "b"]
    assert gemini.parked("a")
    f.calls.clear()
    run(retries=0)  # the parked model is skipped next time
    assert [c[1] for c in f.calls] == ["b"]


def test_unsupported_thinking_level_is_dropped_on_the_same_model(fake):
    f = fake(lambda k, m: None)
    seen = []

    def behaviour(k, m):
        seen.append(m)
        return "400 INVALID_ARGUMENT thinking level not supported" if len(seen) == 1 else None
    f.behaviour = behaviour
    assert run(thinking_level="minimal", retries=0) == {"ok": True}
    assert [c[1] for c in f.calls] == ["a", "a"] and f.calls[1][3].thinking_config is None


def test_every_model_out_of_quota_uses_the_extra_key(fake):
    f = fake(lambda k, m: "429 quota" if k == 0 else None, extra_keys=("k1",))
    assert run() == {"ok": True}
    assert f.calls[-1][0] == 1


def test_hard_errors_still_raise(fake):
    fake(lambda k, m: "401 api key invalid")
    with pytest.raises(gemini.GeminiError):
        run(retries=2)


def test_a_hung_model_is_hedged_not_waited_out(fake, monkeypatch):
    import time

    f = fake()
    s = dataclasses.replace(gemini.get_settings(), gemini_timeout_s=5.0, gemini_hedge_s=0.05)
    monkeypatch.setattr(gemini, "get_settings", lambda: s)

    def bind(k):
        async def generate_content(model, contents, config):
            f.calls.append((k, model, contents, config))
            if model == "a":
                await asyncio.sleep(5)  # held by the server, never refused
            return SimpleNamespace(text='{"ok": true}')
        return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    monkeypatch.setattr(gemini, "client", bind)
    t = time.perf_counter()
    assert run(retries=1) == {"ok": True}
    assert time.perf_counter() - t < 1.0
    assert [c[1] for c in f.calls] == ["a", "b"]
