"""AnuvaadHub (Bhashini) client: translation (MT), speech recognition (ASR), speech (TTS) and OCR.

API format (from the AnuvaadHub specification):
  POST <api_endpoint>   header  access-token: <token>
  MT   json {"input_text": str}            -> data.output_text     (max 50 words)
  ASR  form audio_file=<wav>               -> data.recognized_text (max ~20 s, < 5 MB)
  TTS  json {"text": str, "gender": str}   -> data.s3_url (WAV)    (max 30 words, no special characters)
  OCR  form file=<jpg/png>                 -> data.decoded_text    (< 5 MB, white background)

Each model has its OWN endpoint and token (one per language or language pair). They live in
backend/config/anuvaad.json; see anuvaad.example.json. Missing models raise AnuvaadUnavailable so
callers can fall back (pivot through English, device voice, or text only).
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import time
import wave
from dataclasses import dataclass
from functools import lru_cache

import httpx

from ..settings import get_settings
from .text_utils import chunk_words, sanitize_for_tts

log = logging.getLogger("oriel.anuvaad")

MT_MAX_WORDS = 45   # spec: 50
TTS_MAX_WORDS = 28  # spec: 30
ASR_MAX_BYTES = 4_900_000
OCR_MAX_BYTES = 4_900_000


class AnuvaadError(RuntimeError):
    pass


class AnuvaadUnavailable(AnuvaadError):
    """The model is not configured in anuvaad.json."""


@dataclass(frozen=True)
class Model:
    endpoint: str
    token: str


@lru_cache(maxsize=1)
def load_config() -> dict:
    path = get_settings().anuvaad_config
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log.error("anuvaad.json is not valid JSON: %s", e)
        return {}


def model(kind: str, key: str) -> Model | None:
    entry = (load_config().get(kind) or {}).get(key) or {}
    endpoint, token = (entry.get("endpoint") or "").strip(), (entry.get("token") or "").strip()
    return Model(endpoint, token) if endpoint and token else None


def status() -> dict:
    cfg = load_config()
    out: dict[str, dict[str, bool]] = {}
    for kind in ("mt", "asr", "tts", "ocr"):
        out[kind] = {k: model(kind, k) is not None for k in (cfg.get(kind) or {})}
    return out


class AnuvaadClient:
    def __init__(self, http: httpx.AsyncClient | None = None):
        s = get_settings()
        self._http = http or httpx.AsyncClient(timeout=s.anuvaad_timeout_s, verify=s.anuvaad_verify_tls,
                                               follow_redirects=True)
        self.gender = s.tts_gender

    async def aclose(self) -> None:
        await self._http.aclose()

    # ---------- low level ----------

    async def _post(self, m: Model, *, json_body: dict | None = None, files: dict | None = None,
                    timeout: float | None = None) -> dict:
        try:
            r = await self._http.post(m.endpoint, headers={"access-token": m.token}, json=json_body, files=files,
                                      timeout=timeout if timeout else httpx.USE_CLIENT_DEFAULT)
        except httpx.ConnectError as e:
            if "CERTIFICATE" in str(e).upper() or "SSL" in str(e).upper():
                raise AnuvaadError("TLS certificate check failed: set ANUVAAD_VERIFY_TLS=false in backend/.env") from e
            raise AnuvaadError(f"cannot reach AnuvaadHub: {e}") from e
        except httpx.TimeoutException as e:
            raise AnuvaadError("AnuvaadHub timed out") from e
        try:
            body = r.json()
        except ValueError:
            raise AnuvaadError(f"HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code >= 400 or body.get("status") not in ("success", None) or body.get("error"):
            raise AnuvaadError(f"HTTP {r.status_code}: {body.get('message') or body.get('error') or r.text[:200]}")
        return body.get("data") or {}

    # ---------- MT ----------

    def can_translate(self, src: str, tgt: str) -> bool:
        if src == tgt:
            return True
        if model("mt", f"{src}-{tgt}"):
            return True
        return src != "en" and tgt != "en" and bool(model("mt", f"{src}-en") and model("mt", f"en-{tgt}"))

    async def _mt_direct(self, text: str, src: str, tgt: str) -> str:
        m = model("mt", f"{src}-{tgt}")
        if not m:
            raise AnuvaadUnavailable(f"mt {src}-{tgt}")
        outs = []
        for chunk in chunk_words(text, MT_MAX_WORDS):
            data = await self._post(m, json_body={"input_text": chunk}, timeout=10.0)  # MT answers in < 1 s
            out = (data.get("output_text") or "").strip()
            if not out:
                raise AnuvaadError(f"mt {src}-{tgt} returned empty text")
            outs.append(out)
        return " ".join(outs)

    async def translate(self, text: str, src: str, tgt: str) -> str:
        if src == tgt or not text.strip():
            return text
        if model("mt", f"{src}-{tgt}"):
            return await self._mt_direct(text, src, tgt)
        if src != "en" and tgt != "en" and model("mt", f"{src}-en") and model("mt", f"en-{tgt}"):
            return await self._mt_direct(await self._mt_direct(text, src, "en"), "en", tgt)  # pivot via English
        raise AnuvaadUnavailable(f"mt {src}-{tgt}")

    # ---------- ASR ----------

    async def asr(self, wav: bytes, lang: str) -> str:
        m = model("asr", lang)
        if not m:
            raise AnuvaadUnavailable(f"asr {lang}")
        if len(wav) > ASR_MAX_BYTES:
            raise AnuvaadError("audio too long (max about 20 seconds)")
        data = await self._post(m, files={"audio_file": ("speech.wav", wav, "audio/wav")}, timeout=12.0)
        return (data.get("recognized_text") or "").strip()

    # ---------- TTS ----------

    async def tts(self, text: str, lang: str, gender: str | None = None) -> bytes:
        """WAV bytes. Long text is split into <= 28-word chunks and the WAVs are joined."""
        m = model("tts", lang)
        if not m:
            raise AnuvaadUnavailable(f"tts {lang}")
        clean = sanitize_for_tts(text)
        if not clean:
            raise AnuvaadError("nothing to speak after removing special characters")
        chunks = chunk_words(clean, TTS_MAX_WORDS)
        datas = await asyncio.gather(*[self._post(m, json_body={"text": c, "gender": gender or self.gender}) for c in chunks])
        wavs = []
        for d in datas:
            url = d.get("s3_url")
            if not url:
                raise AnuvaadError("tts returned no audio url")
            r = await self._http.get(url)
            if r.status_code != 200:
                raise AnuvaadError(f"could not download tts audio: HTTP {r.status_code}")
            wavs.append(r.content)
        return join_wavs(wavs)

    # ---------- OCR ----------

    async def ocr(self, png: bytes, lang: str) -> str:
        m = model("ocr", lang)
        if not m:
            raise AnuvaadUnavailable(f"ocr {lang}")
        if len(png) > OCR_MAX_BYTES:
            raise AnuvaadError("image too large for OCR")
        data = await self._post(m, files={"file": ("sign.png", png, "image/png")})
        return (data.get("decoded_text") or "").strip()


def join_wavs(wavs: list[bytes], gap_ms: int = 120) -> bytes:
    """Concatenate WAV files with a short pause. Mismatched formats: keep the first."""
    if len(wavs) == 1:
        return wavs[0]
    try:
        params = None
        frames: list[bytes] = []
        for w in wavs:
            with wave.open(io.BytesIO(w)) as r:
                p = r.getparams()
                if params is None:
                    params = p
                elif (p.nchannels, p.sampwidth, p.framerate) != (params.nchannels, params.sampwidth, params.framerate):
                    log.warning("TTS chunks have different formats; returning first chunk only")
                    return wavs[0]
                if frames:
                    frames.append(b"\x00" * int(params.framerate * gap_ms / 1000) * params.sampwidth * params.nchannels)
                frames.append(r.readframes(r.getnframes()))
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(params.nchannels)
            w.setsampwidth(params.sampwidth)
            w.setframerate(params.framerate)
            w.writeframes(b"".join(frames))
        return out.getvalue()
    except wave.Error:
        log.warning("TTS audio is not plain PCM WAV; returning first chunk only")
        return wavs[0]


_shared: AnuvaadClient | None = None


def client() -> AnuvaadClient:
    global _shared
    if _shared is None:
        _shared = AnuvaadClient()
    return _shared


def timer() -> float:
    return time.perf_counter()
