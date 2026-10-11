"""Reader 1 (every frame) and Reader 2 (independent arbiter: full sharpest frame or zoomed crop, at ultra-high resolution)."""

from __future__ import annotations

from ..content import prompt, schema
from ..settings import get_settings
from . import gemini

EMPTY_RECORD = {
    "sign_found": False, "sign_count": 0, "sign_category": "none", "main_sign_box": [],
    "languages_present": [], "route_numbers": [], "places": [], "platform": None, "arrows": [],
    "symbols": [], "pedestrian_signal": {"state": "none", "countdown": None},
    "business": {"name_text": "", "name_script": "Other", "name_romanized": "", "category_en": "",
                 "hours_text": "", "open_time": "", "close_time": "", "open_hint": "none"},
    "advertisement": {"brand": "", "product_en": "", "offer_text": ""},
    "other_text": [], "table_description": "", "cut_off_sides": [], "quality_issues": [], "unclear_parts": [],
    "currency": [], "scene": {"description_en": "", "hazards_en": [], "objects_en": []},
}


def normalize_record(rec: dict) -> dict:
    """Fill any missing keys so downstream code never KeyErrors on a partial model answer."""
    out = {**EMPTY_RECORD, **(rec or {})}
    out["pedestrian_signal"] = {**EMPTY_RECORD["pedestrian_signal"], **(out.get("pedestrian_signal") or {})}
    out["business"] = {**EMPTY_RECORD["business"], **(out.get("business") or {})}
    out["advertisement"] = {**EMPTY_RECORD["advertisement"], **(out.get("advertisement") or {})}
    out["scene"] = {**EMPTY_RECORD["scene"], **(out.get("scene") or {})}
    for key in ("route_numbers", "places", "arrows", "symbols", "other_text", "cut_off_sides",
                "quality_issues", "unclear_parts", "languages_present", "main_sign_box", "currency"):
        if not isinstance(out.get(key), list):
            out[key] = []
    return out


async def read_frame(jpeg: bytes, model: str | None = None) -> dict:
    s = get_settings()
    rec = await gemini.generate_json(model or s.reader_model, prompt("read_sign"), schema("sign_record"), images=[jpeg])
    return normalize_record(rec)


async def arbiter_read(crop_jpeg: bytes) -> dict:
    """Independent read: different model, zoomed crop, and NO hint of reader 1's answer (avoids anchoring)."""
    s = get_settings()
    return await gemini.generate_json(s.arbiter_model, prompt("arbiter"), schema("arbiter"), images=[crop_jpeg],
                                      resolution=s.arbiter_image_resolution, thinking_level=s.arbiter_thinking_level)
