# Oriel: notes for Claude Code

Zero-tap city-sign reader (Telugu, Hindi, English) for blind, older and hand-impaired users. Megathon 2026, Use Case 3. Full explanation in README.md; read sections 4–9 before changing behaviour.

## Non-negotiables

1. **Never mislead a blind user.** A fact is spoken as "the sign says" only when `verify.py` marks it `confirmed`. Do not loosen verification rules to make demos look better; add a test instead.
2. **Key facts never go through machine translation.** They come from `data/speech_templates.json`. Only free text uses `safe_translate.translate_protected` (placeholders + number check).
3. **Never say it is safe to cross.** Walk signals are "appears to show ... listen to the traffic".
4. **Keys only on the server**: `backend/.env`, `backend/config/anuvaad.json` (both git-ignored). Never import keys into `frontend/`.
5. **Store nothing personal**: no images, no audio recordings, no accounts. Faces are pixelated on the phone (`frontend/src/lib/vision.ts`).
6. Every spoken string must exist in **te, hi and en**. Telugu/Hindi strings are drafts until a native speaker checks them.

## Layout

- `backend/app/services/read_pipeline.py`: READ pipeline (quality → reader 1 ×3 → reader 2 + OCR → verify → guidance → compose → tts), yields SSE stage events.
- `backend/app/services/ask_pipeline.py`: ASK pipeline (ASR → MT → Gemini → MT → TTS).
- `backend/app/services/verify.py`: confirmation rules. `guidance.py`: repositioning. `compose.py`: sentences.
- `backend/app/services/anuvaad.py`: AnuvaadHub (Bhashini) client, one endpoint + token per model.
- `backend/app/services/gemini.py`: Gemini Interactions API (`client.aio.interactions.create`, `response_format` JSON schema).
- `backend/schema/*.json` + `backend/app/prompts/*.md`: what the models must return. Change both together, and `sign_reader.EMPTY_RECORD`.
- `data/*.json`: all user-facing words (templates, guidance phrases, commands, traffic signs, places).
- `frontend/src/hooks/useOriel.ts`: the single controller (phases, camera, quality loop, auto-capture, speech, hands-free, gestures).
- `frontend/src/lib/*`: device code (camera, burst capture, quality, motion, MediaPipe, recorder, audio).

## Commands (repo root)

```bash
# backend (venv active)
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
python -m pytest backend/tests -q           # must stay green; no keys needed
python scripts/check_setup.py               # live key check
python scripts/run_eval.py --limit 4        # real pipeline on synthetic signs

# frontend
cd frontend && npm run dev                  # :5173, proxies /api to :8000
cd frontend && npm run build                # typecheck + build into frontend/dist (served by :8000)
```

## iPhone Safari rules (easy to break)

- Camera, mic and `DeviceMotionEvent.requestPermission()` must be requested inside the Start tap, before any `await`.
- One `<audio>` element is unlocked on the Start tap and reused for everything.
- Only one camera stream at a time; the front camera (gestures) is used only while waiting for an answer.
- No `MediaRecorder` (records AAC); `recorder.ts` encodes WAV from Web Audio.
- No `ctx.filter` (unsupported); faces are pixelated by drawing through an 8 px canvas.
- No React StrictMode (it opens the camera twice).
- `playsinline` on video; HTTPS required (use `cloudflared tunnel --url http://localhost:8000`).

## Conventions

- Python 3.12, async everywhere, `from __future__ import annotations`. Settings only via `settings.get_settings()`.
- Every new failure path must produce a spoken phrase id from `data/guidance_phrases.json` or a template, never a raw error.
- Add or update tests in `backend/tests/` for any change to verify, guidance, compose or translation.
- TypeScript strict; `npm run build` runs `tsc --noEmit` first.
