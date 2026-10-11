"""Tests for image download validation, cached Gemini descriptions, and catalog merging."""

import base64
import json

import pytest

from backend import ingest


def test_describe_image_sends_inline_image_and_returns_short_caption(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "A red mug on a white table."}]}}]}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr(ingest.requests, "post", fake_post)

    result = ingest.describe_image(b"sample-image", "image/jpeg", api_key="test-key")

    assert result == "A red mug on a white table."
    assert captured["headers"]["x-goog-api-key"] == "test-key"
    parts = captured["json"]["contents"][0]["parts"]
    assert parts[1]["inline_data"]["data"] == base64.b64encode(b"sample-image").decode("ascii")
    assert "under 50 words" in parts[0]["text"]


def test_describe_image_caps_overlong_model_output(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "word " * 51}]}}]}

    monkeypatch.setattr(ingest.requests, "post", lambda *_args, **_kwargs: Response())
    result = ingest.describe_image(b"img", "image/jpeg", api_key="test-key")
    assert len(result.split()) == 50


def test_download_image_rejects_non_amazon_hosts_before_network():
    with pytest.raises(ValueError, match="approved Amazon image host"):
        ingest.download_image("https://127.0.0.1/private.jpg")


def test_image_alt_text_caches_by_content_hash_and_translates_once(tmp_path):
    cache_path = tmp_path / "alt-cache.json"
    calls = {"vision": 0, "translation": 0}

    def fetcher(_url):
        return b"same-image", "image/jpeg"

    def describer(_image, _mime, _key):
        calls["vision"] += 1
        return "A blue coffee scoop on a white background."

    def translator(text, source, target):
        calls["translation"] += 1
        return f"{target}: {text}"

    rows = [{"meta": {"parent_asin": "p1", "images": [
        {"variant": "MAIN", "large": "https://m.media-amazon.com/a.jpg"},
        {"variant": "PT01", "large": "https://m.media-amazon.com/b.jpg"},
    ]}}]
    cache = ingest.generate_alt_texts(
        rows,
        cache_path=cache_path,
        fetcher=fetcher,
        describer=describer,
        translator=translator,
    )

    assert calls == {"vision": 1, "translation": 2}
    assert len(cache["images"]) == 1
    assert rows[0]["meta"]["alt_text"]["en"] == "A blue coffee scoop on a white background."
    assert rows[0]["meta"]["images"][1]["alt_text"]["te"].startswith("te:")
    assert json.loads(cache_path.read_text(encoding="utf-8"))["urls"]

    second_cache = ingest.generate_alt_texts(
        [{"meta": {"parent_asin": "p1", "images": [
            {"variant": "MAIN", "large": "https://m.media-amazon.com/a.jpg"},
        ]}}],
        cache_path=cache_path,
        fetcher=fetcher,
        describer=describer,
        translator=translator,
    )
    assert second_cache["images"] == cache["images"]
    assert calls == {"vision": 1, "translation": 2}


def test_apply_cached_alt_text_enriches_main_and_secondary_images():
    cache = {
        "urls": {"https://m.media-amazon.com/main.jpg": "main-hash"},
        "images": {"main-hash": {"en": "Main view.", "hi": "मुख्य दृश्य।", "te": "ప్రధాన దృశ్యం."}},
    }
    products = [{"parent_asin": "p1", "images": [
        {"variant": "MAIN", "large": "https://m.media-amazon.com/main.jpg"},
    ]}]

    enriched = ingest.apply_cached_alt_text(products, cache)

    assert enriched[0]["alt_text"]["en"] == "Main view."
    assert enriched[0]["images"][0]["alt_text"]["te"] == "ప్రధాన దృశ్యం."
