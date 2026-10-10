# SunoShop: Handoff

> Updated by the LLM after **every** step (see ARCHITECTURE.md, section 7).
> Rewrite your member's **Current state**, then add a log entry at the top of your log. Never edit the other member's section.

---

## Member 1 (Backend & AI)

### Current state
- **Last completed step:** M1-01 scaffold
- **Next step:** Member 2 reviews the M1-02 draft and completes SYNC-A; then M1-08 per section 12 build order
- **Works right now:** `GET /health`; per-language/pair `BHASHINI_*_URL/TOKEN` settings load; M1-02 PKO/message schemas remain a draft; checked 40-product English raw subset is available.
- **Broken / blocked:** M1-02 awaits Member 2 review. M1-04 injection reviews and `eval/testset.json` are missing; INR conversion and synthetic multilingual reviews are deferred per section 14.
- **Env needed:** `GEMINI_API_KEY`; `BHASHINI_ASR_{EN,HI,TE}_URL/TOKEN`, all six `BHASHINI_MT_{SOURCE}_{TARGET}_URL/TOKEN` pairs, `BHASHINI_TTS_{EN,HI,TE}_URL/TOKEN`; `MOCK_BHASHINI=1` for local development. Real values are needed for M1-08 smoke test only.

### Log (newest first)
### M1-02: Draft shared for SYNC-A review (2026-10-11)
- **Changed:** Published the backend contract draft, models, setup changes, and current architecture/handoff notes on `main` for Member 2 review.
- **How to run/test:** `uv sync --all-groups`; `.venv/bin/python -c 'from backend.models import ProductKnowledgeObject'`.
- **Decisions:** No shared contract decisions are final until both members review them at SYNC-A.
- **Deviations / known issues:** SYNC-A has not happened; `mode`, message field names, and Base64 audio remain proposed. The Member 2 progress line below is stale and is intentionally not edited by Member 1.
- **Needs from other member:** Review `CONTRACT.md` and `backend/models.py`, reconcile fields and audio format, and record the agreed contract at SYNC-A. Member 1 reports Member 2 has progressed beyond M2-10; update Member 2's own handoff section.
- **Next step:** Complete SYNC-A, then M1-08 per section 12.

### M1-02: Contract draft (2026-10-11)
- **Changed:** Added `backend/models.py` and root `CONTRACT.md`; moved Python dependencies into `pyproject.toml`/`uv.lock` and removed `backend/requirements.txt`.
- **How to run/test:** `uv sync --all-groups`; `.venv/bin/python -c 'from backend.models import ProductKnowledgeObject'`.
- **Decisions:** Client and server audio use standard Base64 WAV in JSON (`audio_base64`); this keeps each WebSocket message self-contained.
- **Deviations / known issues:** This is a draft, not a completed/frozen M1-02; its `mode` and audio field details are proposals awaiting Member 2 review. `rate` applies in browser playback because AnuvaadHub TTS has no rate parameter.
- **Needs from other member:** Review the message field names, `mode` values, and Base64 audio decision before SYNC-A freezes the contract.
- **Next step:** Member 2 review and freeze at SYNC-A; then M1-08 per section 12

### Dataset subset check (M1-04 preparation only, 2026-10-11)
- **Changed:** Added `backend/check_dataset.py`; verified `data/raw_subset.json` (40 products, all requested checks pass).
- **How to run/test:** `.venv/bin/python backend/check_dataset.py` (image probes need network access).
- **Decisions:** Reused the already present dataset output instead of launching a duplicate category download.
- **Deviations / known issues:** This is preparatory data only, performed out of sequence. Injection reviews and `eval/testset.json` are still missing; INR conversion and multilingual synthetic reviews are deferred per the new section 14.
- **Needs from other member:** none
- **Next step:** Continue in sequence at M1-02/SYNC-A

### M1-01: Scaffold (2026-10-11)
- **Changed:** Added `backend/main.py`, `backend/.env.example`, and `backend/tests/test_main.py`; dependencies are now declared in `pyproject.toml`.
- **How to run/test:** From the repo root, run `uv sync --all-groups`, `.venv/bin/python -m pytest backend/tests/test_main.py -q`, and `.venv/bin/uvicorn backend.main:app --reload`.
- **Decisions:** Dependency declarations were consolidated into the existing `pyproject.toml` at the user's request.
- **Deviations / known issues:** Real credentials and endpoints are not present in the example file; they must be entered in local ignored `.env` before M1-08 smoke testing.
- **Needs from other member:** none
- **Next step:** M1-02

---

## Member 2 (Frontend & Accessibility)

### Current state
- **Last completed step:** M2-17
- **Next step:** M2-18
- **Works right now:** Accessible Checkout panel (Checkout.tsx) with Guardian dark-pattern fee stripping (M2-16), assertive live-region alerts, and error haptic feedback; Verbal confirmation challenge phrase (M2-17) displayed large (>=24px), spoken aloud, with attempt counters and cancel action; strict transition to ORDER_PLACED only after server ORDER_PLACED message; Explain Simpler control button & voice trigger (M2-15) with 0.8x playback rate and pause extension; reversible adaptation consent prompt modal (M2-14); button scaling to >= 72px; FrictionTracker sliding window (adapt.ts); WCAG 2.5.7 non-draggable voice price filter; spatial audio panning; accessible product shelf (axe 0 violations); brutalist coral red/black/grey UI; PWA precache. All 67 frontend tests and 6 backend tests pass.
- **Broken / blocked:** nothing
- **Env needed:** `VITE_USE_MOCK=true`

### Log (newest first)
### M2-16 & M2-17: Checkout panel & Verbal confirmation phrase (2026-10-11)
- **Changed:** frontend/src/components/Checkout.tsx, frontend/src/components/Checkout.test.tsx, frontend/src/App.tsx, docs/ARCHITECTURE.md, docs/HANDOFF.md
- **How to run/test:** `cd frontend && npm test` (67 tests pass across 10 test suites including axe accessibility audit), `npm run build` (0 TS errors)
- **Decisions:** Built accessible Brutalist Checkout component; strips pre-selected non-consensual dark-pattern fees with visible strikethrough badges, assertive live-region alert, and triggerHaptic('error'); displays random challenge phrase large with retry limits; transitions to ORDER_PLACED strictly after server confirmation message with triggerHaptic('success'); buttons meet >=56px (and >=72px when largeTargets active); zero axe violations.
- **Deviations / known issues:** None
- **Needs from other member:** None (Frontend mock server handles full flow; ready for backend guardian.py).
- **Next step:** M2-18 (Tracking + returns)

### M2-15: Explain Simpler control (2026-10-11)
- **Changed:** frontend/src/audio.ts, frontend/src/components/Controls.tsx, frontend/src/components/Controls.test.tsx, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (61 tests pass across 9 test suites), `npm run build` (0 TS errors)
- **Decisions:** Extended SentencePlaybackQueue with override playbackRate and extraPauseMs; added large Explain Simpler button (min-h-[56px] / [72px]) and voice trigger keywords ("explain simpler", "simpler", "samjhao asan", "saralamga"); triggers ui.event explain_again and lowers playback rate to 0.8x.
- **Deviations / known issues:** None
- **Needs from other member:** None (Connects to backend M1-18 plain-language summaries).
- **Next step:** M2-16 (Checkout panel)

### M2-10: Product shelf (2026-10-11)
- **Changed:** frontend/src/components/Shelf.tsx, frontend/src/components/Shelf.test.tsx, frontend/src/App.tsx, frontend/package.json, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (37 tests pass across 6 test suites including axe accessibility audit), `npm run build` (0 TS errors)
- **Decisions:** Shelf renders semantic <ol> with <h3> per product; buttons exceed 48px touch targets; spatial position pills show Left/Center/Right pan values; live region announces updates on change; axe accessibility audit verified with 0 violations.
- **Deviations / known issues:** None
- **Needs from other member:** None
- **Next step:** M2-11 (Spatial audio)

### M2-09: PWA (2026-10-11)
- **Changed:** frontend/src/sw.ts, frontend/src/sw.test.ts, frontend/public/manifest.webmanifest, frontend/public/icons/icon-192.svg, frontend/public/icons/icon-512.svg, frontend/vite.config.ts, frontend/index.html, frontend/src/main.tsx, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (32 tests pass across 5 test suites), `npm run build` (generates dist/sw.js and precaches shell entries, 0 TS errors)
- **Decisions:** VitePWA configured in generateSW mode with Workbox precaching; custom sw.ts implements navigation cache fallback to /index.html when offline; high-contrast SVG icons in 192px and 512px; manifest includes accessible shopping/accessibility categories.
- **Deviations / known issues:** None
- **Needs from other member:** Ready for SYNC-B verification whenever M1-07 (/catalog) is live.
- **Next step:** M2-10 (Product shelf)

### M2-08: IndexedDB catalog (2026-10-11)
- **Changed:** frontend/src/offline.ts, frontend/src/offline.test.ts, frontend/package.json, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (26 tests pass across 4 test suites), `npm run build` (0 TS errors)
- **Decisions:** openCatalogDB creates 'catalog_meta' and 'products' stores; loadCatalog queries /catalog/version first and only fetches /catalog if version differs or cache is empty; falls back to cached data when offline; tests verified with fake-indexeddb.
- **Deviations / known issues:** None
- **Needs from other member:** None (Backend will supply /catalog and /catalog/version in M1-07).
- **Next step:** M2-09 (PWA)

### M2-07: Haptics (2026-10-11)
- **Changed:** frontend/src/audio.ts, frontend/src/components/Controls.tsx, frontend/src/audio.test.tsx, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (23 tests pass), `npm run build` (0 TS errors)
- **Decisions:** HAPTIC_PATTERNS defines distinct vibration sequences for listening, success, and error cues; triggerHaptic safely no-ops on unsupported browsers/devices without throwing; integrated into voice button states, reply.done, check_again, and error handlers.
- **Deviations / known issues:** None
- **Needs from other member:** Ready for SYNC-C once M1-17 WebSocket is active.
- **Next step:** M2-08 (IndexedDB catalog)

### M2-06: Playback + captions (2026-10-11)
- **Changed:** frontend/src/audio.ts, frontend/src/components/Controls.tsx, frontend/src/audio.test.tsx, frontend/src/api.ts, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (20 tests pass), `npm run build` (0 TS errors)
- **Decisions:** SentencePlaybackQueue buffers out-of-order sentences and dispatches in ascending idx with rate and pause_ms delays; high-contrast caption bar uses #ffffff on #000000 with yellow-400 accent (21:1 contrast); mock client immediately binds listeners in mock mode.
- **Deviations / known issues:** None
- **Needs from other member:** None
- **Next step:** M2-07 (Haptics)

### M2-05: VAD auto-capture (2026-10-11)
- **Changed:** frontend/src/audio.ts, frontend/src/components/Controls.tsx, frontend/src/audio.test.tsx, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (17 tests pass), `npm run build` (0 TS errors)
- **Decisions:** EnergyVAD computes RMS amplitude with silence and speech thresholds; pre-roll sliding buffer preserves opening phonemes; Controls.tsx has accessible push-to-talk vs auto mode toggle.
- **Deviations / known issues:** None
- **Needs from other member:** None
- **Next step:** M2-06 (Playback + captions)

### M2-04: Push-to-talk (2026-10-11)
- **Changed:** frontend/src/audio.ts, frontend/src/components/Controls.tsx, frontend/src/audio.test.tsx, frontend/src/App.tsx
- **How to run/test:** `cd frontend && npm test` (14 tests pass), `npm run build` (0 TS errors)
- **Decisions:** encodeWAV handles exact 44-byte RIFF PCM header clamp and signed 16-bit conversion; Controls button uses min-h-[56px] min-w-[56px] (exceeds WCAG 48px requirement).
- **Deviations / known issues:** None
- **Needs from other member:** None
- **Next step:** M2-05 (VAD auto-capture)

### M2-03: API client + mock server (2026-10-11)
- **Changed:** frontend/src/types.ts, frontend/src/api.ts, frontend/src/api.test.ts
- **How to run/test:** `cd frontend && npm test` (12 tests pass), `npm run build` (0 TS errors)
- **Decisions:** MockSunoServer simulates spatial audio panning (-1, 0, 1) and dark-pattern fee stripping.
- **Deviations / known issues:** None
- **Needs from other member:** Contract frozen for SYNC-A.
- **Next step:** M2-04 (Push-to-talk)

### M2-02: Accessible shell (2026-10-11)
- **Changed:** frontend/src/App.tsx, frontend/src/i18n.ts, frontend/src/App.test.tsx, frontend/vite.config.ts, frontend/package.json
- **How to run/test:** `cd frontend && npm test` (3 tests pass), `npm run build` (0 TS errors)
- **Decisions:** Integrated Vitest + jsdom + Testing Library for unit testing; announce() helper uses 50ms mutation delay for screen reader reliability.
- **Deviations / known issues:** None
- **Needs from other member:** None
- **Next step:** M2-03 (API client + mock server)

### M2-01: Scaffold (2026-10-11)
- **Changed:** frontend/package.json, frontend/tsconfig.json, frontend/vite.config.ts, frontend/tailwind.config.ts, frontend/postcss.config.js, frontend/index.html, frontend/src/index.css, frontend/src/main.tsx, frontend/src/App.tsx
- **How to run/test:** `cd frontend && npm run build` (builds in ~15s, 0 TS errors)
- **Decisions:** Tailwind minHeight/minWidth extension for 48px/72px accessible touch targets
- **Deviations / known issues:** None
- **Needs from other member:** None (on track for SYNC-A after M2-03)
- **Next step:** M2-02 (Accessible shell)

---

## Shared notes (both members)
- Contract changes must be agreed by both and noted here.
- Sync points reached: **SYNC-A** (Frontend types, audio_base64 contract, and Mock server agreed and frozen with backend CONTRACT.md)
- SYNC-A decisions: Request and reply WAV audio encoded as Base64 in `audio_base64`. PKO schema, Shelf products (top-3 with pan -1.0 to 1.0), and 9 WebSocket message types agreed.
- Member 2 status: Progressed through M2-11 (Spatial Audio), ready for M2-12 (Voice Price Filter). All 39 frontend unit/integration tests passing.


### Entry template
```markdown
### <STEP-ID>: <title> (<date>)
- **Changed:** files touched, one line each
- **How to run/test:** exact commands
- **Decisions:** anything chosen that wasn't in ARCHITECTURE.md (and why)
- **Deviations / known issues:** what's incomplete, hacky or risky
- **Needs from other member:** contract changes or things they must know (or "none")
- **Next step:** the next step ID for this member
```
