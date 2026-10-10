# SunoShop's FastAPI entry point and initial health endpoint.
# Exports the FastAPI app and loaded external-service configuration values.
# Depends on FastAPI and python-dotenv; secrets are supplied through environment variables.

import os

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()

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


@app.get("/health")
def health() -> dict[str, str]:
    """Report that the API process is ready to serve requests."""
    return {"status": "ok"}
