"""GET /api/health: what is configured, so the app (and you) can see missing pieces at a glance."""

from __future__ import annotations

from fastapi import APIRouter

from ..services import anuvaad, gemini
from ..services.places import gazetteer
from ..settings import get_settings

router = APIRouter()


@router.get("/health")
async def health():
    s = get_settings()
    st = anuvaad.status()
    return {
        "ok": gemini.configured(),
        "gemini": {"configured": gemini.configured(), "reader": s.reader_model, "arbiter": s.arbiter_model, "ask": s.ask_model},
        "anuvaad": st,
        "anuvaad_config_found": s.anuvaad_config.exists(),
        "paddleocr": s.enable_paddleocr,
        "known_places": len(gazetteer()),
        "languages": ["te", "hi", "en"],
    }
