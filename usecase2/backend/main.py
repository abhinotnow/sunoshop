# SunoShop's FastAPI entry point, health endpoint, catalog, and voice WebSocket.
# Exports the FastAPI app and loaded external-service configuration values.
# Depends on FastAPI, Pydantic models, the pipeline, and python-dotenv.

import asyncio
import base64
import binascii
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend import bhashini
from backend.ingest import CACHE_PATH as IMAGE_ALT_TEXT_CACHE_PATH, apply_cached_alt_text
from backend.models import AudioUtterance, SessionStart
from backend.pipeline import handle_utterance

logger = logging.getLogger(__name__)

load_dotenv(Path(__file__).with_name(".env"))

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MOCK_BHASHINI = os.getenv("MOCK_BHASHINI", "1").strip().lower() in {"1", "true", "yes"}


def _credentials(name: str) -> dict[str, str]:
    """Load one AnuvaadHub endpoint/token pair without exposing it in logs."""
    return {
        "url": os.getenv(f"BHASHINI_{name}_URL", ""),
        "token": os.getenv(f"BHASHINI_{name}_TOKEN", ""),
    }


# AnuvaadHub has separate models/endpoints for each task and language direction.
BHASHINI_ASR = {lang: _credentials(f"ASR_{lang}") for lang in ("EN", "HI", "TE")}
BHASHINI_MT = {
    pair: _credentials(f"MT_{pair}")
    for pair in ("EN_HI", "HI_EN", "EN_TE", "TE_EN", "HI_TE", "TE_HI")
}
BHASHINI_TTS = {lang: _credentials(f"TTS_{lang}") for lang in ("EN", "HI", "TE")}
BHASHINI_OCR = _credentials("OCR")

app = FastAPI(title="SunoShop API")
CATALOG_PATH = Path(__file__).with_name("data") / "catalog.json"


def _load_catalog() -> list[dict[str, object]]:
    if not CATALOG_PATH.exists():
        return []
    try:
        payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(payload, dict):
        payload = payload.get("products", [])
    if not isinstance(payload, list):
        return []
    if IMAGE_ALT_TEXT_CACHE_PATH.exists():
        try:
            image_cache = json.loads(IMAGE_ALT_TEXT_CACHE_PATH.read_text(encoding="utf-8"))
            payload = apply_cached_alt_text(payload, image_cache)
        except (OSError, json.JSONDecodeError, AttributeError, TypeError):
            # Catalog product answers remain available if the optional local cache is invalid.
            pass
    return payload


CATALOG = _load_catalog()


@app.get("/health")
def health() -> dict[str, str]:
    """Report that the API process is ready to serve requests."""
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    language = None
    rate = 1.0
    session_state: dict[str, object] = {}
    try:
        while True:
            payload = await websocket.receive_json()
            message_type = payload.get("type") if isinstance(payload, dict) else None
            if message_type == "session.start":
                session = SessionStart.model_validate(payload)
                language = session.lang
                rate = session.rate
                continue
            if message_type != "audio.utterance" or language is None:
                await websocket.send_json(
                    {"type": "error", "code": "session_or_message_invalid", "fallback": "retry"}
                )
                continue

            try:
                utterance = AudioUtterance.model_validate(payload)
                wav_bytes = base64.b64decode(utterance.audio_base64, validate=True)
            except (ValueError, binascii.Error):
                logger.warning("Rejected audio WebSocket message: invalid schema or base64")
                await websocket.send_json(
                    {"type": "error", "code": "audio_message_invalid", "fallback": "retry"}
                )
                continue

            logger.info(
                "Voice audio accepted: lang=%s duration_ms=%s wav_bytes=%s",
                language,
                utterance.duration_ms,
                len(wav_bytes),
            )

            try:
                events = await asyncio.to_thread(
                    handle_utterance,
                    wav_bytes,
                    language,
                    CATALOG,
                    rate,
                    session_state=session_state,
                )
            except bhashini.BhashiniOfflineError:
                logger.warning("Voice pipeline unavailable: AnuvaadHub circuit is open")
                events = [{"type": "error", "code": "bhashini_offline", "fallback": "offline"}]
            except Exception as exc:
                logger.exception("Voice pipeline failed (%s)", type(exc).__name__)
                events = [{"type": "error", "code": "backend_service_error", "fallback": "retry"}]
            for event in events:
                if event.get("type") == "asr.result":
                    text = event.get("text", "")
                    logger.info(
                        "ASR response received: chars=%s plausible=%s",
                        len(text),
                        event.get("plausible"),
                    )
                await websocket.send_json(event)
    except WebSocketDisconnect:
        return
