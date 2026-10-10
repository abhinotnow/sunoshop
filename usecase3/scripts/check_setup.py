"""Check that everything Oriel needs is installed and that every key actually works.

Run from the repo root, with the venv active:

    python scripts/check_setup.py            # full check (makes a few real API calls)
    python scripts/check_setup.py --offline  # only files, packages and config (no API calls)

It prints OK / WARN / FAIL per item and a short "what to do" line for anything that is wrong.
Nothing is stored and no keys are printed.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import importlib.metadata
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

results: list[tuple[str, str, str]] = []


def report(status: str, item: str, fix: str = "") -> None:
    results.append((status, item, fix))
    line = f"  [{status:<4}] {item}"
    print(line)
    if fix and status != "OK":
        print(f"         -> {fix}")


def section(title: str) -> None:
    print(f"\n== {title}")


# ---------------------------------------------------------------- local checks

def check_python() -> None:
    section("Python")
    v = sys.version_info
    if (v.major, v.minor) == (3, 12):
        report("OK", f"Python {v.major}.{v.minor}.{v.micro}")
    elif v >= (3, 11):
        report("WARN", f"Python {v.major}.{v.minor} (3.12 is the tested version)")
    else:
        report("FAIL", f"Python {v.major}.{v.minor}", "install Python 3.12 and recreate the venv (see README, Setup)")
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    report("OK" if in_venv else "WARN", "running inside a virtual environment" if in_venv else "not inside a venv",
           "activate it first:  .venv\\Scripts\\activate   (Windows cmd)")


def check_packages() -> bool:
    section("Python packages (backend/requirements.txt)")
    needed = {"fastapi": "fastapi", "uvicorn": "uvicorn", "multipart": "python-multipart", "dotenv": "python-dotenv",
              "google.genai": "google-genai", "httpx": "httpx", "PIL": "pillow", "numpy": "numpy",
              "rapidfuzz": "rapidfuzz", "jsonschema": "jsonschema"}
    ok = True
    for mod, pkg in needed.items():
        try:
            importlib.import_module(mod)
            try:
                ver = importlib.metadata.version(pkg)
            except importlib.metadata.PackageNotFoundError:
                ver = ""
            report("OK", f"{pkg} {ver}".strip())
        except Exception as e:  # noqa: BLE001
            ok = False
            report("FAIL", f"{pkg} missing ({type(e).__name__})", "pip install -r backend/requirements.txt")
    try:
        from google import genai
        client = genai.Client(api_key="x")
        has = hasattr(client.aio, "interactions")
        report("OK" if has else "FAIL", "google-genai has the Interactions API" if has else "google-genai is too old",
               "pip install -U \"google-genai>=2.29\"")
        ok = ok and has
    except Exception as e:  # noqa: BLE001
        report("WARN", f"could not inspect google-genai: {e}")
    return ok


def check_files() -> None:
    section("Project files")
    env = ROOT / "backend" / ".env"
    report("OK" if env.exists() else "FAIL", "backend/.env", "copy backend/.env.example to backend/.env and add GEMINI_API_KEY")
    cfg = ROOT / "backend" / "config" / "anuvaad.json"
    if cfg.exists():
        try:
            json.loads(cfg.read_text(encoding="utf-8"))
            report("OK", "backend/config/anuvaad.json (valid JSON)")
        except json.JSONDecodeError as e:
            report("FAIL", f"backend/config/anuvaad.json is not valid JSON: line {e.lineno}", "check commas and quotes")
    else:
        report("WARN", "backend/config/anuvaad.json missing",
               "copy backend/config/anuvaad.example.json to anuvaad.json and paste your AnuvaadHub endpoints + tokens")
    for name in ("speech_templates.json", "guidance_phrases.json", "voice_commands.json", "traffic_signs.json",
                 "hyderabad_places.json"):
        p = ROOT / "data" / name
        report("OK" if p.exists() else "FAIL", f"data/{name}", "the zip was not fully extracted")
    dist = ROOT / "frontend" / "dist" / "index.html"
    report("OK" if dist.exists() else "WARN", "frontend/dist (built app)" if dist.exists() else "frontend not built yet",
           "cd frontend && npm install && npm run build")
    clips = ROOT / "frontend" / "public" / "audio" / "guidance" / "manifest.json"
    report("OK" if clips.exists() else "WARN", "pre-recorded guidance clips" if clips.exists() else "no pre-recorded guidance clips",
           "optional: python scripts/generate_guidance_audio.py (needs AnuvaadHub TTS); otherwise lines use /api/speak or the phone voice")


def check_node() -> None:
    section("Node.js (for building the frontend)")
    node = shutil.which("node")
    if not node:
        report("WARN", "node not found on PATH", "install Node.js 22 LTS from nodejs.org (only needed to build the frontend)")
        return
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
        parts = [int(x) for x in out.lstrip("v").split(".")[:2]]
        good = parts[0] > 22 or (parts[0] == 22 and parts[1] >= 12) or (parts[0] == 20 and parts[1] >= 19)
        report("OK" if good else "FAIL", f"node {out}", "Vite 8 needs Node 20.19+ or 22.12+: install Node 22 LTS")
    except Exception as e:  # noqa: BLE001
        report("WARN", f"could not run node: {e}")


def check_config() -> None:
    section("Configuration")
    from backend.app.services import anuvaad
    from backend.app.settings import get_settings

    s = get_settings()
    key = s.gemini_api_key
    if not key:
        report("FAIL", "GEMINI_API_KEY is empty", "put your key in backend/.env:  GEMINI_API_KEY=...")
    else:
        report("OK", f"GEMINI_API_KEY set ({len(key)} characters, starts with {key[:3]}...)")
    report("OK", f"models: reader={s.reader_model}  arbiter={s.arbiter_model}  ask={s.ask_model}")
    st = anuvaad.status()
    for kind in ("mt", "asr", "tts", "ocr"):
        have = [k for k, ok in st.get(kind, {}).items() if ok]
        miss = [k for k, ok in st.get(kind, {}).items() if not ok]
        if have:
            report("OK" if not miss else "WARN", f"AnuvaadHub {kind.upper()}: {', '.join(have)}"
                   + (f"  (blank: {', '.join(miss)})" if miss else ""),
                   "blank ones fall back (pivot via English / phone voice / text); fill them if you have them")
        else:
            report("WARN", f"AnuvaadHub {kind.upper()}: none configured",
                   "paste endpoint + token for each model into backend/config/anuvaad.json")
    if not s.anuvaad_verify_tls:
        report("WARN", "ANUVAAD_VERIFY_TLS=false (certificate checks off for AnuvaadHub only)")


# ---------------------------------------------------------------- live checks

async def live_gemini() -> None:
    section("Gemini (live)")
    from backend.app.services import gemini
    from backend.app.services.images import decode, encode_jpeg, fit
    from backend.app.services.sign_reader import read_frame
    from backend.app.settings import get_settings

    s = get_settings()
    if not s.gemini_api_key:
        report("FAIL", "skipped: no key")
        return
    tiny = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
    for role, name in (("reader", s.reader_model), ("arbiter/ask", s.arbiter_model)):
        t = time.perf_counter()
        try:
            out = await gemini.generate_json(name, 'Reply with {"ok": true}.', tiny, retries=1)
            ms = (time.perf_counter() - t) * 1000
            report("OK" if out.get("ok") else "WARN", f"{role} model {name} answered in {ms:.0f} ms")
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            fix = "check the key at aistudio.google.com/apikey"
            if "404" in msg or "not found" in msg.lower():
                fix = f"model name not available to this key: set GEMINI_{'READER' if role == 'reader' else 'ARBITER'}_MODEL in backend/.env to a model listed on ai.google.dev/gemini-api/docs/models"
            elif "429" in msg or "quota" in msg.lower():
                fix = "rate limit / quota: wait a minute or use another key"
            elif "401" in msg or "403" in msg or "api key" in msg.lower():
                fix = "the key was rejected: create a new one at aistudio.google.com/apikey"
            report("FAIL", f"{role} model {name}: {msg[:160]}", fix)
            return
    sample = ROOT / "eval" / "print" / "bus_001.png"
    if sample.exists():
        t = time.perf_counter()
        try:
            rec = await read_frame(encode_jpeg(fit(decode(sample.read_bytes()), 1600)))
            ms = (time.perf_counter() - t) * 1000
            routes = [r.get("value") for r in rec.get("route_numbers", [])]
            places = [p.get("romanized") for p in rec.get("places", [])]
            good = "218" in routes
            report("OK" if good else "WARN", f"read eval/print/bus_001.png in {ms:.0f} ms: routes={routes} places={places}",
                   "expected route 218 to Secunderabad; the reader may be weak on this model")
        except Exception as e:  # noqa: BLE001
            report("FAIL", f"sign read failed: {str(e)[:160]}")


async def live_anuvaad() -> None:
    section("AnuvaadHub (live, one tiny call per configured model)")
    from backend.app.services import anuvaad, ocr_prep
    from backend.app.services.images import decode

    c = anuvaad.AnuvaadClient()
    samples = {"en": "Bus stop", "te": "బస్ స్టాప్", "hi": "बस स्टॉप"}
    spoken: dict[str, bytes] = {}

    async def run(label: str, coro):
        t = time.perf_counter()
        try:
            out = await coro
            ms = (time.perf_counter() - t) * 1000
            shown = out if isinstance(out, str) else f"{len(out)} bytes of audio"
            report("OK" if out else "WARN", f"{label}: {str(shown)[:60]!r} ({ms:.0f} ms)", "empty answer: check the model")
            return out
        except anuvaad.AnuvaadError as e:
            msg = str(e)
            fix = "check the endpoint and token for this model in backend/config/anuvaad.json"
            if "TLS" in msg:
                fix = "set ANUVAAD_VERIFY_TLS=false in backend/.env"
            elif "401" in msg or "403" in msg:
                fix = "token rejected: copy it again from the AnuvaadHub dashboard"
            report("FAIL", f"{label}: {msg[:140]}", fix)
            return None

    try:
        for key in [k for k, ok in anuvaad.status().get("mt", {}).items() if ok]:
            src = key.split("-")[0]
            await run(f"MT {key}", c.translate(samples.get(src, "Bus stop"), *key.split("-")))
        for lang in [k for k, ok in anuvaad.status().get("tts", {}).items() if ok]:
            wav = await run(f"TTS {lang}", c.tts(samples.get(lang, "Bus stop"), lang))
            if wav:
                spoken[lang] = wav
        for lang in [k for k, ok in anuvaad.status().get("asr", {}).items() if ok]:
            if lang in spoken:
                await run(f"ASR {lang} (on the TTS audio)", c.asr(spoken[lang], lang))
            else:
                report("SKIP", f"ASR {lang}: no TTS audio in this language to test with (try it in the app)")
        sample = ROOT / "eval" / "print" / "bus_001.png"
        for lang in [k for k, ok in anuvaad.status().get("ocr", {}).items() if ok]:
            if sample.exists():
                await run(f"OCR {lang}", c.ocr(ocr_prep.prepare_for_ocr(decode(sample.read_bytes())), lang))
    finally:
        await c.aclose()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="skip live API calls")
    args = ap.parse_args()
    print(f"Oriel setup check  (repo: {ROOT})")
    check_python()
    pkgs_ok = check_packages()
    check_files()
    check_node()
    if pkgs_ok:
        check_config()
        if not args.offline:
            asyncio.run(live_gemini())
            asyncio.run(live_anuvaad())
    fails = sum(1 for r in results if r[0] == "FAIL")
    warns = sum(1 for r in results if r[0] == "WARN")
    print(f"\n{fails} problem(s), {warns} warning(s).")
    if fails == 0:
        print("Ready. Start the server from the repo root:\n  uvicorn backend.app.main:app --host 0.0.0.0 --port 8000")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
