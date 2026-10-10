# SunoShop: Handoff

> Updated by the LLM after **every** step (see ARCHITECTURE.md, section 7).
> Rewrite your member's **Current state**, then add a log entry at the top of your log. Never edit the other member's section.

---

## Member 1 (Backend & AI)

### Current state
- **Last completed step:** none
- **Next step:** M1-01
- **Works right now:** nothing yet
- **Broken / blocked:** nothing
- **Env needed:** `GEMINI_API_KEY`, `BHASHINI_*`, `MOCK_BHASHINI=1` for local dev

### Log (newest first)
_(no entries yet)_

---

## Member 2 (Frontend & Accessibility)

### Current state
- **Last completed step:** M2-11
- **Next step:** M2-12
- **Works right now:** Spatial audio panning via playSpatialShelf() using StereoPannerNode with exact pan values (-1.0 Left, 0.0 Center, +1.0 Right) and sequential mono fallback; Accessible Product Shelf with axe zero violations; Brutalist Coral Red design system; PWA app shell precache; IndexedDB catalog cache. All 39 tests pass.
- **Broken / blocked:** nothing
- **Env needed:** `VITE_USE_MOCK=true`

### Log (newest first)
### M2-11: Spatial audio (2026-10-11)
- **Changed:** frontend/src/audio.ts, frontend/src/audio.test.tsx, frontend/src/components/Shelf.tsx, docs/ARCHITECTURE.md
- **How to run/test:** `cd frontend && npm test` (39 tests pass across 6 test suites), `npm run build` (0 TS errors)
- **Decisions:** playSpatialShelf connects sine chime oscillators through gain nodes to StereoPannerNode at target pan values (-1, 0, +1); gracefully falls back to sequential mono when StereoPannerNode is unavailable; Shelf component exposes Spatial Audio preview button.
- **Deviations / known issues:** None
- **Needs from other member:** None (Backend shelf search emits spatial pan values in M1-20).
- **Next step:** M2-12 (Voice price filter)

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
- Sync points reached: **SYNC-A** (Frontend types and Mock server frozen matching Contract)

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
