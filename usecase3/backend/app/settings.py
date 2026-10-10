"""All configuration in one place. Values come from backend/.env (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DATA = ROOT / "data"
SCHEMA = BACKEND / "schema"
PROMPTS = BACKEND / "app" / "prompts"
CACHE = BACKEND / ".cache"
FRONTEND_DIST = ROOT / "frontend" / "dist"

load_dotenv(BACKEND / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = ""
    # Measured 11 Oct 2026: gemini-3.7/3.8-flash timed out (>25 s) on sign crops; 3.5-flash-lite took 4-5 s.
    reader_model: str = "gemini-3.5-flash-lite"   # reads all 3 frames (fast, cheap)
    arbiter_model: str = "gemini-3.5-flash-lite"  # independent second read at ultra-high resolution
    ask_model: str = "gemini-3.6-flash"           # answers spoken questions
    thinking_level: str = "minimal"              # reader 1 and ask: speed matters
    arbiter_thinking_level: str = "low"          # reader 2 checks every character, so it may think a little
    image_resolution: str = "high"               # tokens per frame for reader 1 (low|medium|high|ultra_high)
    arbiter_image_resolution: str = "ultra_high" # the zoomed crop: small Telugu/Hindi glyphs need the detail
    # True: reader 2 starts at once on the sharpest full frame, in parallel with reader 1 (about 5 s faster).
    # False: reader 2 waits for reader 1's sign box and reads a zoomed crop (better for far, small signs).
    arbiter_parallel: bool = True
    gemini_timeout_s: float = 12.0  # calls take 4-8 s; a hung call is retried instead of waited out

    anuvaad_config: Path = BACKEND / "config" / "anuvaad.json"
    anuvaad_verify_tls: bool = True
    anuvaad_timeout_s: float = 30.0
    tts_gender: str = "female"

    enable_paddleocr: bool = False
    max_frames: int = 3
    max_reads_per_sign: int = 3
    timezone: str = "Asia/Kolkata"
    cors_origins: tuple[str, ...] = field(default_factory=lambda: ("*",))


def _path(name: str, default: Path) -> Path:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    p = Path(raw)
    return p if p.is_absolute() else ROOT / p  # relative paths are relative to the repo root


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    cors = os.getenv("CORS_ORIGINS", "*")
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        reader_model=os.getenv("GEMINI_READER_MODEL", Settings.reader_model).strip(),
        arbiter_model=os.getenv("GEMINI_ARBITER_MODEL", Settings.arbiter_model).strip(),
        ask_model=os.getenv("GEMINI_ASK_MODEL", Settings.ask_model).strip(),
        thinking_level=os.getenv("GEMINI_THINKING_LEVEL", Settings.thinking_level).strip(),
        arbiter_thinking_level=os.getenv("GEMINI_ARBITER_THINKING_LEVEL", Settings.arbiter_thinking_level).strip(),
        image_resolution=os.getenv("GEMINI_IMAGE_RESOLUTION", Settings.image_resolution).strip(),
        arbiter_image_resolution=os.getenv("GEMINI_ARBITER_IMAGE_RESOLUTION", Settings.arbiter_image_resolution).strip(),
        gemini_timeout_s=float(os.getenv("GEMINI_TIMEOUT_S", Settings.gemini_timeout_s)),
        anuvaad_config=_path("ANUVAAD_CONFIG", Settings.anuvaad_config),
        anuvaad_verify_tls=_bool("ANUVAAD_VERIFY_TLS", True),
        anuvaad_timeout_s=float(os.getenv("ANUVAAD_TIMEOUT_S", Settings.anuvaad_timeout_s)),
        tts_gender=os.getenv("TTS_GENDER", Settings.tts_gender).strip() or "female",
        enable_paddleocr=_bool("ENABLE_PADDLEOCR", False),
        arbiter_parallel=_bool("ARBITER_PARALLEL", Settings.arbiter_parallel),
        max_frames=int(os.getenv("MAX_FRAMES", Settings.max_frames)),
        max_reads_per_sign=int(os.getenv("MAX_READS_PER_SIGN", Settings.max_reads_per_sign)),
        timezone=os.getenv("TIMEZONE", Settings.timezone),
        cors_origins=tuple(o.strip() for o in cors.split(",") if o.strip()),
    )
