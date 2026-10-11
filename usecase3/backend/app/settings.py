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
    # Extra keys from OTHER Google projects (free-tier quota is per project): used when every model on the
    # first key is out of quota.
    gemini_extra_keys: tuple[str, ...] = ()
    # Reader 1: frame k is read by reader_models[k]. Different models per frame avoid the free tier's per-model
    # burst throttle, spread the daily quota, and make "frames agree" stronger (different models, different slips).
    reader_models: tuple[str, ...] = ()  # empty: frame 1 and frame 2 are both read by reader_model
    # Tried in order when a model is out of quota (429), unavailable (404) or hangs. Each model has its own
    # free-tier daily quota, so a longer chain means more reads per day.
    gemini_fallback_models: tuple[str, ...] = ("gemini-3.1-flash-lite", "gemini-3.5-flash-lite",
                                               "gemini-3.1-flash-lite-preview", "gemini-flash-lite-latest",
                                               "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-3.6-flash",
                                               "gemini-3.7-flash", "gemini-3.8-flash", "gemini-flash-latest")
    # Measured 11 Oct 2026 (generateContent): 3.1-flash-lite read a route in 1.7 s. Exhausted models fall back.
    reader_model: str = "gemini-3.1-flash-lite"   # reads every frame (fast, cheap)
    arbiter_model: str = "gemini-3.5-flash-lite"  # reader 2: a different model from reader 1 (falls back when out of quota)
    ask_model: str = "gemini-3.1-flash-lite-preview"      # answers spoken questions
    thinking_level: str = "minimal"              # reader 1 and ask: speed matters
    arbiter_thinking_level: str = "low"          # reader 2 checks every character, so it may think a little
    image_resolution: str = "high"               # tokens per frame for reader 1 (low|medium|high|ultra_high)
    arbiter_image_resolution: str = "ultra_high" # the zoomed crop: small Telugu/Hindi glyphs need the detail
    # True: reader 2 starts at once on the sharpest full frame, in parallel with reader 1 (about 5 s faster).
    # False: reader 2 waits for reader 1's sign box and reads a zoomed crop (better for far, small signs).
    arbiter_parallel: bool = True
    gemini_timeout_s: float = 10.0
    scene_descriptions: bool = True  # hazards ("Careful, there may be ...") and "Here is what I can see"
    gemini_hedge_s: float = 0.0  # 0 = off: a failed model is replaced one at a time, never in parallel
    gemini_translate_fallback: bool = True  # AnuvaadHub MT down: Gemini translates (same safety checks)     # no answer after this long: also ask the next model, first answer wins
    gemini_deadline_s: float = 18.0  # a whole Gemini call (all fallbacks) gives up after this  # calls take 4-8 s; a hung call is retried instead of waited out

    anuvaad_config: Path = BACKEND / "config" / "anuvaad.json"
    anuvaad_verify_tls: bool = True
    anuvaad_timeout_s: float = 30.0
    tts_gender: str = "female"

    enable_paddleocr: bool = False
    max_frames: int = 2
    max_reads_per_sign: int = 3
    timezone: str = "Asia/Kolkata"
    cors_origins: tuple[str, ...] = field(default_factory=lambda: ("*",))


def _path(name: str, default: Path) -> Path:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    p = Path(raw)
    return p if p.is_absolute() else ROOT / p  # relative paths are relative to the repo root


def _list(name: str) -> tuple[str, ...]:
    return tuple(x.strip() for x in os.getenv(name, "").split(",") if x.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    cors = os.getenv("CORS_ORIGINS", "*")
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_extra_keys=_list("GEMINI_API_KEYS") or (),
        reader_models=_list("GEMINI_READER_MODELS") or Settings.reader_models,
        gemini_fallback_models=_list("GEMINI_FALLBACK_MODELS") or Settings.gemini_fallback_models,
        reader_model=os.getenv("GEMINI_READER_MODEL", Settings.reader_model).strip(),
        arbiter_model=os.getenv("GEMINI_ARBITER_MODEL", Settings.arbiter_model).strip(),
        ask_model=os.getenv("GEMINI_ASK_MODEL", Settings.ask_model).strip(),
        thinking_level=os.getenv("GEMINI_THINKING_LEVEL", Settings.thinking_level).strip(),
        arbiter_thinking_level=os.getenv("GEMINI_ARBITER_THINKING_LEVEL", Settings.arbiter_thinking_level).strip(),
        image_resolution=os.getenv("GEMINI_IMAGE_RESOLUTION", Settings.image_resolution).strip(),
        arbiter_image_resolution=os.getenv("GEMINI_ARBITER_IMAGE_RESOLUTION", Settings.arbiter_image_resolution).strip(),
        gemini_timeout_s=float(os.getenv("GEMINI_TIMEOUT_S", Settings.gemini_timeout_s)),
        gemini_hedge_s=float(os.getenv("GEMINI_HEDGE_S", Settings.gemini_hedge_s)),
        scene_descriptions=_bool("SCENE_DESCRIPTIONS", True),
        gemini_translate_fallback=_bool("GEMINI_TRANSLATE_FALLBACK", True),
        gemini_deadline_s=float(os.getenv("GEMINI_DEADLINE_S", Settings.gemini_deadline_s)),
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
