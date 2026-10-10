# SunoShop: Architecture & Build Plan

**Team Hunters · Megathon 2026 · Use Case 2 (eCommerce) · English / Hindi / Telugu**

SunoShop is a voice-first proxy that sits between a blind, elderly or motor-impaired shopper and an eCommerce catalog. It speaks only facts verified against offline-built **Product Knowledge Objects (PKOs)**, blocks checkout dark patterns with plain rules, and falls back to offline mode when the network fails.

This file is built so an **LLM can implement one step at a time** and **two people can work in parallel**. The code stays simple: few files, plain functions, no clever abstractions.

---

## 1. Rules for the LLM (paste at the start of every session)

1. Read this file and `HANDOFF.md`. Then do **only the one step ID you are given**.
2. Touch **only the files listed** in that step. If another file needs changing, stop and say so.
3. **Keep it simple:** plain functions, no classes unless truly needed, no abstract base classes, no config systems, no "future-proofing". A new teammate should understand a file in 5 minutes.
4. Every code file starts with a 3-line comment: what it does, what it exports, what it depends on.
5. If a file passes ~300 lines, **don't split it yourself**. Tell the humans in `HANDOFF.md`.
6. Write the test listed in **Done when**, run it, and make it pass. Run the whole test suite before finishing. Never break an earlier step.
7. **No LLM calls inside `backend/guardian.py`**, ever. Generative AI cannot change checkout state.
8. Don't change `CONTRACT.md` unless the step says so.
9. **Last thing you do, always:** update `HANDOFF.md` (format in section 7), tick the step in section 8, propose the commit message `step(<ID>): <title>`, then **stop**. Do not start the next step.

### Prompt template

```
Project: SunoShop. Read ARCHITECTURE.md and HANDOFF.md.
Implement step <ID> only, following the rules in section 1.
Finish by updating HANDOFF.md. Do not continue to the next step.
```

---

## 2. Team split

| | **Member 1: Backend & AI** | **Member 2: Frontend & Accessibility** |
|---|---|---|
| Owns | `backend/`, `eval/` | `frontend/` |
| Works on | Data pipeline, Bhashini, grounding, checkout rules | Voice UI, audio, offline mode, a11y testing |
| Steps | `M1-01` … `M1-27` | `M2-01` … `M2-25` |

**Never block each other:** Member 2 builds a mock server inside `frontend/src/api.ts` (step `M2-03`), so the whole UI works without the backend. At each **SYNC** point, Member 2 sets `VITE_USE_MOCK=false` and tests against the real backend.

---

## 3. Codebase structure (the whole thing)

```
sunoshop/
├── ARCHITECTURE.md        this file
├── HANDOFF.md             updated by the LLM after EVERY step
├── CONTRACT.md            PKO shape + WebSocket messages (both sides follow it)
├── README.md              how to run
├── .env.example
│
├── backend/               [Member 1]  Python / FastAPI
│   ├── main.py            app, /health, /catalog, /ws endpoint
│   ├── models.py          PKO and message models (pydantic)
│   ├── ingest.py          OFFLINE: normalize, alt-text, sanitize reviews, embed
│   ├── bhashini.py        ASR, translate, TTS, 2.5 s circuit breaker, mock mode
│   ├── pipeline.py        mask, route, retrieve, answer, simplify, shelf
│   ├── guardian.py        checkout state machine, dark patterns, orders (NO LLM)
│   ├── data/              products.json (raw) · catalog.json (built) · orders.json
│   ├── tests/             test_<file>.py, one per backend file
│   └── requirements.txt
│
├── frontend/              [Member 2]  React + Vite + TypeScript + Tailwind
│   ├── package.json · vite.config.ts · tailwind.config.ts
│   ├── public/            manifest.webmanifest, icons
│   └── src/
│       ├── main.tsx · App.tsx     entry + page layout
│       ├── types.ts               mirrors CONTRACT.md
│       ├── api.ts                 WebSocket client + built-in mock server
│       ├── audio.ts               record, VAD, playback, spatial audio, haptics, speechSynthesis
│       ├── offline.ts             IndexedDB cache, online/offline signal, local answers
│       ├── adapt.ts               friction tracker + consented UI adaptations
│       ├── i18n.ts                en / hi / te strings
│       ├── sw.ts                  service worker
│       └── components/
│           ├── Controls.tsx       push-to-talk, captions, language, offline banner, adapt prompt
│           ├── Shelf.tsx          product list + price voice filter
│           ├── Checkout.tsx       cart, removed fees, confirmation phrase
│           └── Orders.tsx         tracking + returns
│   └── tests/                     unit tests + e2e (Playwright + axe)
│
└── eval/                  [Member 1, Member 2 adds user-test notes]
    ├── testset.json       30-40 products' queries + ~15 labelled injection reviews
    ├── run_eval.py        metrics + baselines
    └── results.md
```

**That's ~15 code files in total.** If you can't find something, it's in the file named after what it does.

---

## 4. How it works (one paragraph per stage)

**Offline (`ingest.py`).** Products from `data/products.json` are normalized (INR, mAh, GB). Gemini Flash Vision writes alt-text for photos. Reviews are untrusted, so a **quarantined LLM with no tools** turns them into a structured pros/cons digest (ABSA) and ignores any embedded instructions. Reviews are chunked by aspect (battery, camera…) and embedded. Output: `data/catalog.json`.

**Live loop (`bhashini.py` + `pipeline.py`).** Audio → ASR → plausibility check ("Check Again" if bad) → mask prices/model names as `[PROD_A]`, `[PRICE_1]` → translate to English → **rule-based router** handles simple commands (repeat, slower, simpler, track order) with no LLM → otherwise retrieve exact specs + review chunks → Gemini Flash-Lite answers **only from those** → grounding check rejects anything not in the PKO → split into ≤25-word sentences → translate back → unmask → TTS.

**Guardian (`guardian.py`).** A finite state machine: `BROWSING → CART_REVIEW → GUARDED → AWAITING_CONFIRM → ORDER_PLACED`. It strips pre-ticked add-ons and fake urgency timers, and only completes when the user speaks a random confirmation phrase.

**Frontend.** Semantic HTML + live regions so it works under TalkBack/NVDA. Top-3 results are played with left→right spatial audio, with captions and vibration. It watches for friction (timeouts, "explain again", tap-misses) and *offers* adaptations, applying them only with consent. When Bhashini times out (>2.5 s) or the network drops, it switches to the IndexedDB catalog and the browser's `speechSynthesis`.

---

## 5. Contract (summary; full version lives in `CONTRACT.md`)

**PKO:** `id, title, brand, category, price_inr, specs{}, alt_texts{en,hi,te}, size_chart[], review_digest{pros[], cons[], claims_checked[]}, review_chunks[]`

| Direction | `type` | Key fields |
|---|---|---|
| C→S | `session.start` | `lang`, `mode`, `rate` |
| C→S | `audio.utterance` | WAV 16 kHz mono, ≤20 s |
| C→S | `ui.event` | `kind`: `tap_miss` / `asr_timeout` / `explain_again` |
| C→S | `checkout.action` | `start` / `confirm_audio` / `cancel` |
| S→C | `asr.result` / `check_again` | `text`, `plausible` / `reason` |
| S→C | `reply.sentence` | `idx`, `text`, `audio`, `pause_ms`, `rate` |
| S→C | `reply.done` | `grounded` |
| S→C | `shelf.results` | up to 3 products with `pan` (-1…1) and alt-text |
| S→C | `checkout.state` | `state`, `cart`, `removed_fees[]` |
| S→C | `confirm.challenge` | `phrase` |
| S→C | `adapt.offer` | `adaptation`, `reason` |
| S→C | `error` | `code`, `fallback`: `retry` / `offline` |

---

## 6. Steps

**Step format:** *Depends · Files · Do (one change) · Done when.*
Both members start with their scaffold step. Sync points are marked **→ SYNC**.

### Member 1: Backend & AI

**M1-01 Scaffold.** *Files:* `main.py`, `requirements.txt`, `.env.example`, `tests/test_main.py`. *Do:* FastAPI app with `GET /health`; env vars loaded (`GEMINI_API_KEY`, `BHASHINI_*`, `MOCK_BHASHINI`). *Done when:* `/health` returns `{"status":"ok"}`; test passes.

**M1-02 Contract.** *Depends:* M1-01. *Files:* `models.py`, `CONTRACT.md`. *Do:* pydantic models for the PKO and every message in section 5; write them into `CONTRACT.md`. *Done when:* sample PKO validates, bad one is rejected. **→ SYNC-A (Member 2 reviews and freezes).**

**M1-03 Seed data + normalize.** *Depends:* M1-02. *Files:* `data/products.json`, `ingest.py`. *Do:* 3 hand-written raw products and a `normalize()` that turns them into PKOs (INR, mAh, GB). *Done when:* tests for "₹14,999", "15k", "5 Ah" pass.

**M1-04 Full test catalog (data only).** *Depends:* M1-03. *Files:* `data/products.json`, `eval/testset.json`. *Do:* grow to 30-40 electronics/clothing products with Telugu, Hindi, English and code-mixed reviews; plant ~15 prompt-injection reviews and label each in the testset. *Done when:* all products validate; testset lists every injection id.

**M1-05 Alt-text.** *Depends:* M1-03. *Files:* `ingest.py`. *Do:* Gemini Flash Vision makes en/hi/te alt-text per image, cached by image hash. *Done when:* fixture test passes; second run makes zero API calls.

**M1-06 Review sanitizer.** *Depends:* M1-04. *Files:* `ingest.py`. *Do:* quarantined LLM (no tools, no app context) returns JSON pros/cons/claims only; free text is rejected. *Done when:* all 15 injections are flagged and cause no action.

**M1-07 Embed + build catalog.** *Depends:* M1-05, M1-06. *Files:* `ingest.py`, `main.py`. *Do:* chunk reviews by aspect, embed, write `data/catalog.json`; add `GET /catalog` and `GET /catalog/version`. *Done when:* both endpoints return valid data. **→ SYNC-B**

**M1-08 Bhashini: client + ASR.** *Depends:* M1-01. *Files:* `bhashini.py`. *Do:* auth and ASR (wav bytes + language → text); `MOCK_BHASHINI=1` returns canned replies. Check the current ULCA docs for request shapes, don't guess. *Done when:* mock test passes.

**M1-09 Bhashini: translate.** *Depends:* M1-08. *Files:* `bhashini.py`. *Do:* translate between en/hi/te both ways. *Done when:* mock test passes.

**M1-10 Bhashini: TTS.** *Depends:* M1-08. *Files:* `bhashini.py`. *Do:* text + language + `rate` → audio bytes. *Done when:* `rate` is passed through (test).

**M1-11 Circuit breaker.** *Depends:* M1-09, M1-10. *Files:* `bhashini.py`. *Do:* any call over 2.5 s counts as a failure; after N failures the breaker opens and the caller gets `fallback: "offline"`. *Done when:* a simulated slow call opens it.

**M1-12 Masking.** *Depends:* M1-02. *Files:* `pipeline.py`. *Do:* `mask(text)` / `unmask(text, map)` for prices, numbers, brand/model names. *Done when:* round trip over 20 en/hi/te strings loses zero entities, even if surrounding text is scrambled.

**M1-13 Router.** *Depends:* M1-02. *Files:* `pipeline.py`. *Do:* `route(text)` maps `repeat / slower / simpler / track_order / checkout / cancel` to intents with no LLM and no network; anything else → `"rag"`. *Done when:* table-driven tests incl. paraphrases.

**M1-14 Retrieval.** *Depends:* M1-07. *Files:* `pipeline.py`. *Do:* exact spec lookup plus top-k review chunks by cosine similarity. *Done when:* "battery of p_001" returns the spec and chunks.

**M1-15 Grounded answer.** *Depends:* M1-14. *Files:* `pipeline.py`. *Do:* Gemini Flash-Lite answers from retrieved context only; a `check_grounded()` rejects any number or claim not in that context and falls back to "I don't have that information." *Done when:* asking for a spec that doesn't exist never invents a value.

**M1-16 Chunker + plausibility.** *Depends:* M1-15, M1-08. *Files:* `pipeline.py`. *Do:* split replies into sentences ≤25 words; flag empty/gibberish ASR text as implausible. *Done when:* no sentence exceeds 25 words (test); silence is flagged.

**M1-17 Orchestrator + WebSocket.** *Depends:* M1-09..M1-16. *Files:* `pipeline.py`, `main.py`. *Do:* `handle_utterance()` runs the full loop and `/ws` streams `reply.sentence` events. *Done when:* in mock mode, Telugu "battery ela undi" → grounded Telugu sentences with entities intact. **→ SYNC-C**

**M1-18 Explain Simpler.** *Depends:* M1-17. *Files:* `pipeline.py`. *Do:* on `simpler`, re-render the last answer with shorter sentences, simpler words, lower `rate`, longer `pause_ms`. *Done when:* `textstat` grade drops on 10 samples.

**M1-19 Claim-vs-Experience.** *Depends:* M1-14. *Files:* `pipeline.py`. *Do:* compare spec claims with the review digest → supported / contradicted / mixed. *Done when:* "2-day battery" with bad battery reviews → contradicted.

**M1-20 Shelf search + price filter.** *Depends:* M1-14. *Files:* `pipeline.py`. *Do:* rank top 3; parse "under 15000" in en/hi/te; emit `shelf.results` with `pan`. *Done when:* the filter is correct and alt-text is included.

**M1-21 Checkout state machine.** *Depends:* M1-02. *Files:* `guardian.py`. *Do:* states and an explicit allowed-transition table. *Done when:* illegal moves raise; a test confirms `guardian.py` imports no LLM library.

**M1-22 Dark-pattern stripper.** *Depends:* M1-21. *Files:* `guardian.py`. *Do:* remove pre-ticked add-ons and false-urgency timers; return `removed_fees[]`. *Done when:* fixture carts end with the correct total.

**M1-23 Verbal confirmation.** *Depends:* M1-21. *Files:* `guardian.py`. *Do:* random multi-word phrase per language; strict fuzzy match; limited retries. *Done when:* the right phrase passes; random speech, a different phrase and an LLM-forged "confirm" all fail.

**M1-24 Orders + returns.** *Depends:* M1-09. *Files:* `guardian.py`, `data/orders.json`. *Do:* mock tracking (status → next step → date); returns check eligibility and translate the spoken reason into an English seller note. *Done when:* Telugu reason → English note. **→ SYNC-D**

**M1-25 Failure ladder.** *Depends:* M1-11, M1-16. *Files:* `main.py`, `pipeline.py`. *Do:* send `check_again`, `error{retry}` or `error{offline}` for implausible ASR, slow Bhashini, Bhashini down. *Done when:* each case emits the right message. **→ SYNC-E**

**M1-26 Eval harness + baselines.** *Depends:* M1-17. *Files:* `eval/run_eval.py`. *Do:* hallucination rate, injection actions, entity survival, checkout false-accepts; baseline of a plain chatbot read through Bhashini. *Done when:* one command writes `eval/results.md`.

**M1-27 Final safety run.** *Depends:* M1-26. *Files:* `eval/results.md`. *Do:* run all injections and the adversarial grounding set. *Done when:* hallucination = 0 and injection actions = 0, or failures are documented and fixed.

*Optional stretch (only if ahead):* size-chart OCR → `size_chart` in `ingest.py`; live-site adapter that reads schema.org JSON-LD.

### Member 2: Frontend & Accessibility

**M2-01 Scaffold.** *Files:* `package.json`, `vite.config.ts`, `tailwind.config.ts`, `main.tsx`, `App.tsx`. *Do:* Vite + React 18 + TS + Tailwind with a placeholder page. *Done when:* `npm run build` has zero TS errors.

**M2-02 Accessible shell.** *Depends:* M2-01. *Files:* `App.tsx`, `i18n.ts`. *Do:* landmarks (`header/main/nav`), skip link, an `announce()` live-region helper, en/hi/te labels, language switcher that sets `<html lang>`. *Done when:* tests: `announce()` updates the live region; switching language changes labels.

**M2-03 API client + mock server.** *Depends:* M2-02, CONTRACT. *Files:* `types.ts`, `api.ts`. *Do:* typed WebSocket client; when `VITE_USE_MOCK=true`, an in-file fake that answers every message type with canned data. *Done when:* a test per message type. **→ SYNC-A**

**M2-04 Push-to-talk.** *Depends:* M2-03. *Files:* `audio.ts`, `components/Controls.tsx`. *Do:* big single-tap button; records mono 16 kHz WAV, 20 s cap; sends `audio.utterance`. *Done when:* WAV header test; button ≥48 px with an accessible name.

**M2-05 VAD auto-capture.** *Depends:* M2-04. *Files:* `audio.ts`. *Do:* energy-based voice detection with an auto / push-to-talk toggle. *Done when:* synthetic audio starts on speech, stops on silence.

**M2-06 Playback + captions.** *Depends:* M2-03. *Files:* `audio.ts`, `components/Controls.tsx`. *Do:* play `reply.sentence` in `idx` order with `pause_ms` and `rate`; high-contrast caption bar synced to speech. *Done when:* out-of-order arrival still plays in order; contrast ≥7:1.

**M2-07 Haptics.** *Depends:* M2-03. *Files:* `audio.ts`. *Do:* distinct vibration patterns for success, error, listening; no-op if unsupported. *Done when:* test with a stubbed `navigator.vibrate`. **→ SYNC-C (with M1-17)**

**M2-08 IndexedDB catalog.** *Depends:* M2-03. *Files:* `offline.ts`. *Do:* cache `/catalog`; refetch only when `/catalog/version` changes. *Done when:* second load makes no fetch (fake-indexeddb test).

**M2-09 PWA.** *Depends:* M2-08. *Files:* `sw.ts`, `public/manifest.webmanifest`, `vite.config.ts`. *Do:* Workbox precache of the app shell; installable. *Done when:* the shell loads offline. **→ SYNC-B (with M1-07)**

**M2-10 Product shelf.** *Depends:* M2-06. *Files:* `components/Shelf.tsx`. *Do:* semantic list with headings and labelled buttons; announces results via live region without duplicating the native screen reader. *Done when:* axe shows zero violations.

**M2-11 Spatial audio.** *Depends:* M2-10. *Files:* `audio.ts`. *Do:* play the top-3 names through `PannerNode` at pan -1 / 0 / +1; sequential mono fallback. *Done when:* test asserts three panners with the right pan values.

**M2-12 Voice price filter.** *Depends:* M2-10, M1-20. *Files:* `components/Shelf.tsx`. *Do:* "under fifteen thousand" voice flow replaces any slider, confirms aloud, plus large ± buttons. *Done when:* the app has no drag interaction (WCAG 2.5.7).

**M2-13 Friction tracker.** *Depends:* M2-03. *Files:* `adapt.ts`. *Do:* count ASR timeouts, "explain again", tap-misses in a sliding window; emit a *suggestion*, never change the UI itself. *Done when:* threshold tests pass.

**M2-14 Adaptation prompt.** *Depends:* M2-13. *Files:* `adapt.ts`, `components/Controls.tsx`. *Do:* ask aloud and visually; enlarge tap targets (≥72 px) or slow speech only after consent; always reversible. *Done when:* declining changes nothing.

**M2-15 Explain Simpler control.** *Depends:* M2-06, M1-18. *Files:* `components/Controls.tsx`. *Do:* large "Explain Simpler" button plus voice trigger; applies server `rate` and `pause_ms`. *Done when:* pressing it lowers playback rate.

**M2-16 Checkout panel.** *Depends:* M2-03, M1-22. *Files:* `components/Checkout.tsx`. *Do:* show cart; visibly mark removed fees; announce assertively; haptic alert. *Done when:* a removed fee appears in UI, live region and vibration call.

**M2-17 Confirmation phrase.** *Depends:* M2-16, M1-23. *Files:* `components/Checkout.tsx`. *Do:* speak and show the phrase large; record the repeat; show retries and cancel. *Done when:* the UI reaches "placed" only after server `ORDER_PLACED`.

**M2-18 Tracking + returns.** *Depends:* M2-17, M1-24. *Files:* `components/Orders.tsx`. *Do:* voice/tap flows. *Done when:* returns work against mock and real backend. **→ SYNC-D**

**M2-19 Offline signal.** *Depends:* M2-09. *Files:* `offline.ts`. *Do:* one `isOffline` combining `navigator.onLine`, server `error{offline}`, and a client 2.5 s timeout. *Done when:* each trigger flips it.

**M2-20 Offline answers.** *Depends:* M2-08, M2-19. *Files:* `offline.ts`. *Do:* local router + keyword search + spec lookup over IndexedDB; templated answers only. *Done when:* with network off, "battery of Redmi" returns the stored spec.

**M2-21 Offline speech + banner.** *Depends:* M2-20. *Files:* `audio.ts`, `components/Controls.tsx`. *Do:* switch to `speechSynthesis`; persistent offline banner; announce the switch. *Done when:* a Playwright offline test shows the fallback within 1 s. **→ SYNC-E**

**M2-22 Automated a11y tests.** *Depends:* M2-21. *Files:* `tests/e2e/*`. *Do:* Playwright + `@axe-core/playwright` on every screen and adaptation mode. *Done when:* zero serious/critical violations.

**M2-23 Metrics logging.** *Depends:* M2-06. *Files:* `api.ts`. *Do:* log time-to-information and words-listened-before-action per task, exportable as JSON. *Done when:* a scripted task produces a record.

**M2-24 Real-user validation.** *Depends:* M2-22. *Files:* `eval/results.md`. *Do:* run the shared tasks with TalkBack and NVDA, ideally with one blind/low-vision tester; compare against the raw eCommerce DOM. *Done when:* results table filled in.

**M2-25 Demo mode.** *Depends:* all. *Files:* `App.tsx`, `README.md`. *Do:* a rehearsed 3-minute path: search → spatial shelf → claim-vs-experience → Explain Simpler → injection ignored → fee stripped → verbal checkout → pull network → offline fallback. *Done when:* it runs twice without help.

### Sync points

| Sync | When | Both do |
|---|---|---|
| **A** | M1-02 + M2-03 | Freeze `CONTRACT.md`; mock server matches it |
| **B** | M1-07 + M2-09 | Frontend loads the real `/catalog` |
| **C** | M1-17 + M2-07 | Real WebSocket: one spoken question → spoken answer |
| **D** | M1-24 + M2-18 | Full checkout + returns on the real guardian |
| **E** | M1-25 + M2-21 | Kill the network; check the whole failure ladder |

---

## 7. HANDOFF.md (mandatory after every step)

`HANDOFF.md` lives at the repo root. It has a **Current state** block (rewritten each time) and two **logs** (one per member, newest entry at the top) so nobody's edits collide. After every step the LLM must:

1. Rewrite the member's **Current state** block.
2. Add one log entry using this exact template:

```markdown
### <STEP-ID>: <title> (<date>)
- **Changed:** files touched, one line each
- **How to run/test:** exact commands
- **Decisions:** anything chosen that wasn't in ARCHITECTURE.md (and why)
- **Deviations / known issues:** what's incomplete, hacky or risky
- **Needs from other member:** contract changes or things they must know (or "none")
- **Next step:** the next step ID for this member
```

Keep each entry under ~15 lines. A fresh LLM session (or a teammate) must be able to read `HANDOFF.md` and continue without any other context.

---

## 8. Progress checklist

**Member 1:** `M1-01` `M1-02` `M1-03` `M1-04` `M1-05` `M1-06` `M1-07` `M1-08` `M1-09` `M1-10` `M1-11` `M1-12` `M1-13` `M1-14` `M1-15` `M1-16` `M1-17` `M1-18` `M1-19` `M1-20` `M1-21` `M1-22` `M1-23` `M1-24` `M1-25` `M1-26` `M1-27`
*(replace with ✅ as you finish each)*

**Member 2:** `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `✅` `M2-16` `M2-17` `M2-18` `M2-19` `M2-20` `M2-21` `M2-22` `M2-23` `M2-24` `M2-25`

**Syncs:** `✅ A` `B` `C` `D` `E`

---

## 9. If time runs short

1. **Must have:** M1-01…17 and M2-01…07 → a spoken, grounded answer end to end.
2. **Score boosters:** shelf + spatial audio, Explain Simpler, claim-vs-experience, guardian + verbal checkout.
3. **Reliability (10%):** failure ladder + offline mode.
4. **Proof:** eval harness and real-user test.
5. **Cut first:** optional stretch items, then hearing-impairment extras beyond captions and haptics.

## 10. Stated limitations (for the final deck)

Catalog is a cached snapshot, not live-scraped · checkout and tracking are simulated · no medical or financial advice · condition inference is rule-based and always asks consent.

## 11. API addendum (AnuvaadHub, overrides ULCA mentions in M1-08..M1-11)
- Each model has its own endpoint + token: POST <endpoint>, header `access-token`. No language
  parameter, so config is per task+language/pair in .env, e.g. BHASHINI_MT_EN_HI_URL / _TOKEN.
- MT: JSON {"input_text"} -> data.output_text. Max 50 words.
- ASR: multipart `audio_file` (WAV, <5MB, ~20 s) -> data.recognized_text.
- TTS: JSON {"text","gender"} -> data.s3_url. Max 30 words, NO special characters. No rate param.
- OCR: multipart `file` (jpg/png <5MB, white background) -> data.decoded_text.
- Treat any response with status != "success" as a failure for the circuit breaker.
- `rate` is applied by the client (playbackRate); backend only passes it through in reply.sentence.
- Backend downloads the TTS wav from s3_url, caches it by text hash, and sends it as the
  reply.sentence `audio` field (decide base64 vs URL in CONTRACT.md at M1-02).
- Before TTS: unmask placeholders, convert currency/digits to words, strip brackets and symbols.
- Breaker timeout is a starting value: measure real latency in M1-08 before fixing it.
- MOCK_BHASHINI=1 must return the same response shapes as the real API.

## 12. Change notes (agreed with the team, override earlier text)

1. API: follow section 11 (AnuvaadHub). No language param; per task+language endpoints in .env;
   TTS has no rate (client applies it); TTS returns s3_url (backend downloads, caches, sends audio).
2. M1-05 changed: Gemini writes ENGLISH alt-text only. Hindi/Telugu alt-text come from Bhashini MT
   at ingest (each description under 50 words), cached by image hash. M1-05 now depends on M1-09.
   Ingest needs real Bhashini keys; its test runs in MOCK_BHASHINI=1.
3. Ingest is an OFFLINE script run once by a developer (not per user). Add `if __name__ == "__main__":`
   so `python backend/ingest.py` rebuilds data/catalog.json. It never runs on a user's query.
4. One language per session. `session.start.lang` is set from a start-screen picker (three large
   labelled buttons). No mid-session switching and no language detection for now.
   Do not build a "script check" for wrong-language ASR (per-language endpoints always return their own script).
5. M1-04 dataset: use McAuley Lab Amazon Reviews 2023. Join meta and review files on parent_asin.
   Pick ~30-40 products (electronics, phones, a few clothing items) with price and 30+ reviews;
   stream the files, don't download a whole category. Prices are USD: convert to INR with ONE fixed
   declared rate and round. Hindi/Telugu/code-mixed reviews and the ~15 injection reviews are SYNTHETIC
   and must be labelled synthetic in the data. M1-04 may add ONE script: backend/prepare_dataset.py.
6. Before TTS: unmask placeholders, convert currency and digits to words per language, strip symbols.
   Test TTS with digits early; if a language mispronounces them, write a small number-to-words helper.
7. Build order for M1: M1-01, M1-02 (freeze contract fast), then M1-08 with a real smoke test
   (record latency), then continue. Set the circuit-breaker timeout after measuring.
8. Add .gitignore (.env, __pycache__, node_modules, data/orders.json) by hand. Never commit tokens.

## 13. Dataset notation and download (overrides earlier field names)
- Use McAuley Lab Amazon Reviews 2023 field names verbatim in models.py, catalog.json and CONTRACT.md.
  Product: parent_asin (= product id), title, price, features, description, images, store,
  average_rating, rating_number, categories, details. Review: rating, title, text, timestamp,
  verified_purchase, helpful_vote, user_id, parent_asin.
- Our added fields: price_inr, alt_text{en,hi,te}, review_digest{pros,cons}, size_chart;
  on every review: synthetic (bool) and lang ("en"|"hi"|"te"|"hi-en"). Never rename dataset fields.
- Wherever ARCHITECTURE.md earlier used other names (id, name, rating...), rename to the above in M1-02.
- M1-04 produces backend/prepare_dataset.py: streams raw .jsonl over HTTP (requests, stream=True),
  NEVER downloads a whole category, NEVER uses load_dataset(trust_remote_code). One category,
  first N_REVIEWS reviews, products with >=30 reviews, a valid float price and large images,
  keep 40 products x 30 reviews -> data/raw_subset.json. ingest.py reads this file.
- price_inr = round(price_usd * RATE); RATE is one constant in prepare_dataset.py, declared in README.
- Synthetic reviews (hi, te, hi-en) and the injection reviews are written by us and flagged synthetic=true.
  Real reviews keep synthetic=false and original English text.

## 14. Current dataset scope and secret handling

### Dataset status
- `data/raw_subset.json` currently contains 40 real English products/reviews and passed the subset checks.
- The prompt-injection review set and its labelled `eval/testset.json` are still missing. Add about 15
  labelled injection reviews and verify they cause no action before calling M1-04 complete.
- For now, do not block on INR normalization or synthetic Hindi/Telugu/code-mixed reviews. Keep the
  raw source `price` in USD and current real reviews marked `synthetic=false`, `lang="en"`.
- Treat INR conversion and synthetic multilingual review generation as deferred follow-up work. Record
  when they are resumed; do not claim those fields/data exist until implemented and checked.

### Secrets and per-model credentials
- Keep real credentials only in a developer-local `.env`, which `.gitignore` excludes. Copy names from
  `backend/.env.example`; that example contains blank values only. Never commit `.env`, paste tokens in
  chat, put them in source code, or print them in logs/test output.
- AnuvaadHub credentials are per task and language/direction. Use `BHASHINI_ASR_<LANG>_URL/TOKEN`,
  `BHASHINI_MT_<SOURCE>_<TARGET>_URL/TOKEN`, and `BHASHINI_TTS_<LANG>_URL/TOKEN`; OCR uses
  `BHASHINI_OCR_URL/TOKEN`. Store the URL and token together under the matching name in local `.env`.
- For deployed environments, use the platform's secret manager/environment secret facility, not a
  checked-in file. Restrict access to the backend runtime and rotate any credential that is exposed.
- Exact AnuvaadHub endpoints and tokens are needed for the real M1-08 ASR smoke test. Until then,
  `MOCK_BHASHINI=1` allows development without credentials. Obtain values from AnuvaadHub and enter
  them directly into local `.env`; do not send the values in messages or source files.
- Cite Hou et al. 2024 (arXiv:2403.03952) in README. State that dataset terms are unverified.
