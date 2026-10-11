"""Pre-record every guidance phrase (data/guidance_phrases.json) with AnuvaadHub TTS.

Why: guidance ("hold still", "move closer", "tilt up") must play INSTANTLY while the user is aiming.
A network round trip per instruction would arrive after the user has already moved.

Output:
    frontend/public/audio/guidance/<lang>/<phrase_id>.wav
    frontend/public/audio/guidance/manifest.json    {phrase_id: {lang: "/audio/guidance/<lang>/<id>.wav"}}

The app loads the manifest on start; phrases without a clip fall back to /api/speak, then the phone voice.
The backend serves these files even if you generate them after `npm run build`.

Usage (repo root, venv active):
    python scripts/generate_guidance_audio.py                 # all languages that have TTS configured
    python scripts/generate_guidance_audio.py --langs te hi   # only some languages
    python scripts/generate_guidance_audio.py --force         # re-record existing clips (after editing a phrase)

IMPORTANT: the Telugu and Hindi phrases are drafts. Have a native speaker check them first.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

OUT = ROOT / "frontend" / "public" / "audio" / "guidance"


async def main() -> int:
    from backend.app.services import anuvaad, audio_store

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--langs", nargs="*", default=["te", "hi", "en"])
    ap.add_argument("--force", action="store_true", help="re-record clips that already exist")
    ap.add_argument("--concurrency", type=int, default=3)
    args = ap.parse_args()

    data = json.loads((ROOT / "data" / "guidance_phrases.json").read_text(encoding="utf-8"))
    phrases = data["phrases"]
    review = data.get("_review", {})
    langs = [l for l in args.langs if anuvaad.model("tts", l)]
    skipped = [l for l in args.langs if l not in langs]
    if skipped:
        print(f"No TTS model configured for: {', '.join(skipped)} (those lines will use /api/speak or the phone voice)")
    if not langs:
        print("Nothing to do: add TTS endpoints + tokens to backend/config/anuvaad.json")
        return 1
    for l in langs:
        if "DRAFT" in str(review.get(l, "")):
            print(f"NOTE: {l} phrases are marked DRAFT in data/guidance_phrases.json - have a native speaker check them.")

    manifest_path = OUT / "manifest.json"
    manifest: dict = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    client = anuvaad.AnuvaadClient()
    sem = asyncio.Semaphore(max(1, args.concurrency))
    made = failed = kept = 0

    async def one(pid: str, lang: str, text: str):
        nonlocal made, failed, kept
        path = OUT / lang / f"{pid}.wav"
        url = f"/audio/guidance/{lang}/{pid}.wav"
        if path.exists() and not args.force:
            manifest.setdefault(pid, {})[lang] = url
            kept += 1
            return
        async with sem:
            try:
                wav = await client.tts(text, lang)
            except anuvaad.AnuvaadError as e:
                failed += 1
                print(f"  FAIL {lang}/{pid}: {e}")
                return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(audio_store.shrink_wav(wav))
        manifest.setdefault(pid, {})[lang] = url
        made += 1
        print(f"  ok   {lang}/{pid}  ({len(wav) // 1024} KB)")

    try:
        await asyncio.gather(*[one(p["id"], l, p[l]) for p in phrases for l in langs if p.get(l)])
    finally:
        await client.aclose()

    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print(f"\n{made} recorded, {kept} kept, {failed} failed. Manifest: {manifest_path.relative_to(ROOT)}")
    return 1 if failed and not made and not kept else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
