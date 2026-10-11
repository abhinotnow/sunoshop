# SunoShop: Handoff

> Updated by the LLM after **every** step (see ARCHITECTURE.md, section 7).
> Rewrite your member's **Current state**, then add a log entry at the top of your log. Never edit the other member's section.

---

## Member 1 (Backend & AI)

### Current state
- **Last completed step:** M1-26 Eval harness + baselines; M1-05 image alt-text completed out of sequence
- **Next step:** M1-27 Final safety run (open: labelled `eval/testset.json` is missing)
- **Works right now:** `GET /health` and `/ws`; live AnuvaadHub/Gemini API configuration. `backend/ingest.py --max-images 1` generated and translated one dataset image description; cached English/Hindi/Telugu descriptions are merged into catalogs at startup and passed to grounded answers as visual evidence. `eval/run_eval.py --final-safety` reports available local guard checks; `eval/run_customer_simulation.py` made live text API calls against 40 raw dataset products and wrote the actual questions/candidates/guarded responses to `eval/customer_simulation.md`. The injection-bearing review probe produced a grounded product answer without a purchase instruction. Failure ladder and checkout guard tests pass.
- **Broken / blocked:** M1-27 cannot run the full labelled-injection/adversarial set until `eval/testset.json` is created. The live customer sim's supported reusable-filter answers and Samsung/Waterdrop title comparison now pass the grounding guard; the token cap was raised and spelled numerals are checked against evidence numerals. Unknown products with no matching evidence fail closed before Gemini. Telugu MT still mistranslates “reusable” as “recycled,” though dataset evidence led to a correct answer. The full cache is not generated, so only the first main image has alt text locally; full visual availability depends on running `backend/ingest.py`. The current visual QA path uses generated descriptions, not question-time image understanding. Comparison has no dedicated route, and catalog/embeddings remain absent. `backend/pipeline.py` is over 500 lines; human owner decides whether to split. USD-to-INR and synthetic multilingual reviews remain deferred. SYNC-C/D/E and frontend contract reconciliation remain pending.
- **Env needed:** `GEMINI_API_KEY` is configured in ignored `backend/.env`; Gemini live smoke passed with synthetic facts. ASR, all six MT, and all three TTS endpoint/token pairs are present there; their live smoke checks passed. Keep credentials local and use `MOCK_BHASHINI=1` for tests.

### Log (newest first)
### M1-05: Image alt-text generation (2026-10-11)
- **Changed:** Added `backend/ingest.py` to fetch approved Amazon image hosts, submit image bytes to Gemini Vision, translate concise captions EN→HI/TE, and cache by SHA-256. Descriptions are attached per image, merged into catalog records at startup, and made available as grounded visual evidence. Added the optional image alt-text schema field and ignored the local cache.
- **How to run/test:** `.venv/bin/python backend/ingest.py --max-images 1` (live: 1 image, Vision + both translations, cache created); `.venv/bin/python eval/run_customer_simulation.py` (live: image background answered “A white background” from generated caption); `.venv/bin/python -m pytest backend/tests -q` (87 passed); `git diff --check`.
- **Decisions:** Describe only visible content; do not infer material, identity, product functionality, or safety. Full run processes all image records; `--max-images 1` is the smoke option. Cache is local/ignored and content-addressed; the loader merges by source URL.
- **Deviations / known issues:** Only one image was processed live; full dataset batch is not generated. Current runtime answers visual questions from cached alt text and does not perform open-ended vision calls per customer question. The alt-text does not guarantee every scene detail is captured.
- **Needs from other member:** none
- **Next step:** Run the full cache when ready, then ensure M1-07 catalog generation preserves `images[*].alt_text` and product-level main-image `alt_text`.

### M1-27: Grounded-answer debugging and edge-case regression (2026-10-11; incomplete)
- **Changed:** Source `features` are query-matched instead of dumping full feature/description arrays; guard now accepts harmless model framing such as “Based on the provided evidence,” and permits spelled numerals only when the corresponding number appears in evidence. Raised Gemini response cap to 256 tokens for comparisons. Unknown-product requests with empty evidence now return no-information without calling Gemini; vague queries still do not pick arbitrarily among multiple products. Added regression tests and reran the live API scenarios.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (25 passed); `.venv/bin/python -m pytest backend/tests -q` (80 passed); `.venv/bin/python eval/run_customer_simulation.py` (live APIs; reusable filter, Telugu question, comparison, and injection answers accepted; unsupported image, INR, and medical/safety questions fell back); `git diff --check`.
- **Decisions:** The false rejection was caused by the guard treating harmless answer framing (“based,” “provided,” “evidence,” “no,” “titled,” “priced”) and number words like “three” as unsupported; the original answer context already contained the source feature text. Keep unsupported medical/image/INR questions conservative. The language model's answer must still pass local number and evidence vocabulary checks.
- **Deviations / known issues:** Telugu translation still changes “reusable” to “recycled”; answer correctness in this example depends on retrieval evidence and does not resolve MT quality. The lexical guard is not a full semantic entailment verifier. The audio WebSocket contract also carries no selected product id, so multi-item conversational references like “this scoop” need product context from the frontend/session before end-to-end retrieval is reliable. Official `eval/testset.json` and labelled injection reviews remain missing, so M1-27 remains open.
- **Needs from other member:** none
- **Next step:** Rerun all backend tests and complete the labelled injection/adversarial set before closing M1-27.

### M1-27: Available-case final safety + API customer simulation (2026-10-11; incomplete)
- **Changed:** Ran available grounding/checkout probes; added `eval/run_customer_simulation.py` and captured live Gemini candidates, guard decisions, and Telugu-English translation results for product, comparison, image, unsupported-price/safety, and injection questions.
- **How to run/test:** `.venv/bin/python eval/run_eval.py --final-safety`; `.venv/bin/python eval/run_customer_simulation.py` (live); `.venv/bin/python -m pytest backend/tests -q` (76 passed); `.venv/bin/python -m py_compile eval/run_eval.py eval/run_customer_simulation.py`; `git diff --check`.
- **Decisions:** Used the existing 40-product raw dataset directly; did not fabricate the missing labelled M1-04 test set or INR prices.
- **Deviations / known issues:** Full M1-27 remains open: official `eval/testset.json` and its ~15 labelled injection reviews are absent. The live run showed safe fallbacks but also rejected supported paraphrases and a truncated comparison answer; see `eval/customer_simulation.md`.
- **Needs from other member:** none
- **Next step:** Complete the labelled injection/adversarial set, then rerun M1-27.

### M1-26: Eval harness + baselines (2026-10-11)
- **Changed:** Added deterministic grounding/injection/entity/checkout smoke metrics and an opt-in plain Gemini-through-Bhashini baseline; generated `eval/results.md` and updated the architecture checklist.
- **How to run/test:** `.venv/bin/python eval/run_eval.py`; `.venv/bin/python eval/run_eval.py --live-baseline` (live run completed: one Gemini request, Telugu-to-English and English-to-Telugu MT); `git diff --check`.
- **Decisions:** Keep network calls opt-in. The baseline receives no catalog evidence; local control checks use small built-in probes and cannot represent dataset-level rates.
- **Deviations / known issues:** Official `eval/testset.json` and its approximately 15 labelled injection reviews are missing. The baseline asked a clarifying question, so its verifier rejection is not evidence of hallucination; M1-27 still needs the labelled data.
- **Needs from other member:** none
- **Next step:** M1-27 Final safety run, pending the labelled eval set.

### M1-25: Failure ladder (2026-10-11)
- **Changed:** Made pipeline errors distinguish the Bhashini offline circuit from retryable service errors; added a final WebSocket worker boundary that returns safe retry/offline events without exception details. Added WebSocket regression cases and updated the architecture checklist.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_main.py -q` (7 passed); `.venv/bin/python -m pytest backend/tests -q` (76 passed); `git diff --check`.
- **Decisions:** Only `BhashiniOfflineError` maps to `fallback: offline`; other errors request a retry. Implausible recognized speech keeps its existing `check_again` path.
- **Deviations / known issues:** Failures are exercised through mocked service boundaries; live network outage behavior and frontend SYNC-E remain unverified.
- **Needs from other member:** Frontend should treat `fallback: offline` as the offline-switch signal and `fallback: retry` as a retry prompt.
- **Next step:** M1-26 Eval harness + baselines.

### M1-24: Orders + returns (2026-10-11)
- **Changed:** Added local mock order loading, tracking responses, delivered-item return-window checks, and AnuvaadHub translation of eligible spoken return reasons into English seller notes. Added two demo records to ignored `backend/data/orders.json`; added fixture tests and an explicit ignore rule.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_guardian.py -q`; `.venv/bin/python -m pytest backend/tests -q`; `git diff --check`.
- **Decisions:** Only delivered orders with a matching product are checked for return eligibility. The return window is inclusive of the calculated deadline. Ineligible requests do not call translation.
- **Deviations / known issues:** Tracking and orders are mock local data; the ignored JSON file is not shared with teammates. Translation uses configured Telugu-to-English AnuvaadHub MT in live mode and the existing mock MT response in mock mode. SYNC-D remains to be exercised with the frontend.
- **Needs from other member:** none
- **Next step:** M1-25 Failure ladder.

### M1-23: Verbal confirmation (2026-10-11)
- **Changed:** Added random English/Hindi/Telugu confirmation challenges, normalized strict fuzzy matching, and a three-attempt limit; tested correct phrases, transcription variation, random speech, generic confirmation, and exhausted attempts. Updated the architecture checklist.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_guardian.py -q` (15 passed); `.venv/bin/python -m pytest backend/tests -q` (69 passed); `git diff --check`.
- **Decisions:** Use `secrets.choice`; only match phrases with the same word count and at least 0.9 normalized similarity. Decrement attempts for each spoken response.
- **Deviations / known issues:** Challenge generation and verification are not yet wired to WebSocket checkout messages; callers must retain the server challenge and only transition on an accepted match.
- **Needs from other member:** none
- **Next step:** M1-24 Orders + returns.

### M1-22: Dark-pattern stripper (2026-10-11)
- **Changed:** Added `strip_dark_patterns()` to remove explicitly preselected optional add-ons and urgency/countdown fields, return removed fees, and recompute INR totals; added fixture tests. Expanded test scope with user approval and checked the architecture checklist.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_guardian.py -q` (8 passed); `.venv/bin/python -m pytest backend/tests -q` (62 passed); `git diff --check`.
- **Decisions:** Add-ons are removed only when marked preselected and optional (or named as a known add-on); normal user-selected items remain. Invalid priced cart rows fail closed.
- **Deviations / known issues:** Sanitizer is not connected to WebSocket checkout actions yet; M1-23 adds spoken verification, then later work can wire the flow.
- **Needs from other member:** none
- **Next step:** M1-23 Verbal confirmation.

### M1-21: Checkout state machine (2026-10-11)
- **Changed:** Added `backend/guardian.py` with checkout states and an explicit transition table; added tests for legal flow, cancel, illegal moves, and imports. Expanded test scope with user approval.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_guardian.py -q` (4 passed); `.venv/bin/python -m pytest backend/tests -q` (53 passed); `git diff --check`.
- **Decisions:** `start` opens cart review; `guard` and `request_confirmation` are internal transitions for the next checkout steps; only `verified_confirmation` completes `AWAITING_CONFIRM`. Cancel returns active checkout states to browsing.
- **Deviations / known issues:** Checkout state transitions are not yet connected to WebSocket actions; M1-22 and M1-23 add fee stripping and verified verbal confirmation.
- **Needs from other member:** none
- **Next step:** M1-22 Dark-pattern stripper.

### M1-20: Shelf search + price filter (2026-10-11)
- **Changed:** Added multilingual numeric budget parsing, top-three catalog ranking, strict `price_inr` filtering, localized alt text and pan assignment; price-limited utterances emit `shelf.results`. Added parser, ranking, contract-shape, and WebSocket-pipeline tests. Expanded test scope with user approval.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (21 passed); `.venv/bin/python -m pytest backend/tests -q` (49 passed); `git diff --check`.
- **Decisions:** Rank by query-term overlap, then average rating; distribute one result center, two left/right, or three left/center/right. Only explicit `price_inr` values qualify for rupee filtering.
- **Deviations / known issues:** Section 14 defers USD-to-INR conversion and M1-07 has not built `data/catalog.json`; current raw data therefore cannot yet provide populated INR-budget results. Ranking uses simple word overlap and can miss synonyms.
- **Needs from other member:** none
- **Next step:** M1-21 Checkout state machine.

### M1-19: Claim-vs-Experience (2026-10-11)
- **Changed:** Added `compare_claim_experience()` and tests for contradicted, supported, mixed, and no matching evidence. Expanded M1-19 scope to include the regression test with user approval; checked the architecture progress list.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (18 passed); `.venv/bin/python -m pytest backend/tests -q` (46 passed); `git diff --check`.
- **Decisions:** Match claim vocabulary against digest pros/cons. Since the three-status contract has no unknown value, return `mixed` with empty evidence lists when no relevant digest entry matches.
- **Deviations / known issues:** Token overlap is deliberately simple and can miss paraphrases or ambiguous aspects; the verdict is a rule-based signal, not a statistical confidence score.
- **Needs from other member:** none
- **Next step:** M1-20 Shelf search + price filter.

### M1-18: Explain Simpler (2026-10-11)
- **Changed:** Added per-WebSocket prior-answer state and deterministic simpler wording with lower `rate` and longer `pause_ms`; added the `textstat` dev dependency, 10-sample grade check, and WebSocket regression test. Expanded the architecture file list with user approval.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py backend/tests/test_main.py -q` (20 passed); `.venv/bin/python -m pytest backend/tests -q` (44 passed); `git diff --check`.
- **Decisions:** Simplification changes selected vocabulary and breaks conjunction-linked clauses; the original grounded answer is the evidence basis. State is scoped to one WebSocket connection.
- **Deviations / known issues:** Pipeline now exceeds 500 lines; split decision belongs to the human owner. `textstat` requires NLTK's CMU dictionary; on a fresh machine run `.venv/bin/python -m nltk.downloader cmudict` before the grade test.
- **Needs from other member:** none
- **Next step:** M1-19 Claim-vs-Experience.

### M1-17: Orchestrator + WebSocket (2026-10-11)
- **Changed:** Added `handle_utterance()` orchestration in `backend/pipeline.py`; added `/ws` session/audio validation and event streaming in `backend/main.py`; added mock WebSocket tests.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_main.py backend/tests/test_pipeline.py -q` (18 passed); `.venv/bin/python -m pytest backend/tests -q` (42 passed).
- **Decisions:** Load `backend/data/catalog.json` when present; keep the endpoint available with an empty catalog otherwise. TTS input converts numeric values to words and strips unsupported symbols.
- **Deviations / known issues:** WebSocket was exercised with stubbed Bhashini/Gemini functions and a fixture product; live SYNC-C is pending. M1-07 has not built the real catalog or query embeddings. `pipeline.py` is 475 lines; leave any split to the human owner.
- **Needs from other member:** Frontend can connect to `/ws`; reconcile existing `types.ts` differences with `CONTRACT.md` before live integration.
- **Next step:** M1-18 Explain Simpler.

### M1-16: Chunker + plausibility (2026-10-11)
- **Changed:** Added `chunk_sentences()` and `is_plausible_asr()` with tests in `backend/pipeline.py` and `backend/tests/test_pipeline.py`; checked M1-16 in `docs/ARCHITECTURE.md`.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (15 passed); `.venv/bin/python -m pytest backend/tests -q` (40 passed).
- **Decisions:** Sentence splitting recognizes English punctuation and danda; ASR checks are deterministic, language-neutral heuristics and do not perform script/language detection.
- **Deviations / known issues:** Heuristics reject silence, symbol-only text, repeated-character noise, and obvious long ASCII consonant strings, but cannot detect all gibberish. `pipeline.py` is now 327 lines; architecture says leave any split to the human owner.
- **Needs from other member:** none
- **Next step:** M1-17 orchestrator + WebSocket.

### M1-15: Grounded answer (2026-10-11)
- **Changed:** Added Gemini Flash-Lite answer generation and conservative number/claim checks in `backend/pipeline.py`, plus stubbed API and grounding tests in `backend/tests/test_pipeline.py`; updated the M1-15 checklist.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (11 passed); `.venv/bin/python -m pytest backend/tests -q` (36 passed).
- **Decisions:** Use REST `generateContent` with `gemini-3.5-flash-lite`; pass only retrieved product facts/specs/review text, treat evidence as untrusted, and fail closed to "I don't have that information." when grounding fails.
- **Live check:** HTTP 200 and grounded synthetic battery answer returned in 1.36 s; no key or answer text was logged.
- **Deviations / known issues:** Lexical grounding is conservative and may reject valid paraphrases; M1-07 catalog integration is pending.
- **Needs from other member:** none
- **Next step:** M1-16 chunker + plausibility.

### M1-14: Retrieval (2026-10-11)
- **Changed:** Added exact product/detail lookup and cosine-ranked review chunk retrieval in `backend/pipeline.py`, with fixture tests in `backend/tests/test_pipeline.py`; checked M1-14 in `docs/ARCHITECTURE.md`.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (8 passed); `.venv/bin/python -m pytest backend/tests -q` (33 passed).
- **Decisions:** `retrieve()` accepts PKO mappings or model objects and a caller-provided query embedding; a missing embedding returns no review chunks.
- **Deviations / known issues:** M1-07 is still incomplete, so real catalog integration is pending; validated using a PKO-shaped fixture.
- **Needs from other member:** none
- **Next step:** M1-15 grounded answer.

### M1-13: Router (2026-10-11)
- **Changed:** Added `route()` and table-driven paraphrase tests in `backend/pipeline.py` and `backend/tests/test_pipeline.py`; checked M1-13 in `docs/ARCHITECTURE.md`.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (6 passed); `.venv/bin/python -m pytest backend/tests -q` (31 passed).
- **Decisions:** Route English text after translation, as described in the architecture flow; normalize Unicode, case, and punctuation, then match explicit phrases.
- **Deviations / known issues:** Commands must match a listed phrase; other text intentionally falls through to `rag`.
- **Needs from other member:** none
- **Next step:** M1-14 retrieval.

### M1-12: Masking (2026-10-11)
- **Changed:** Added `backend/pipeline.py`, `backend/tests/test_pipeline.py`; checked M1-12 in `docs/ARCHITECTURE.md`.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests/test_pipeline.py -q` (4 passed); `.venv/bin/python -m pytest backend/tests -q` (29 passed).
- **Decisions:** Pass catalog brand/model strings through optional `known_entities`; also detect model-like alphanumeric IDs without a fixed brand list.
- **Deviations / known issues:** Brand names must be supplied by the caller; number words written out in prose are not tokenized.
- **Needs from other member:** none
- **Next step:** M1-13 router.

### M1-11: Bhashini circuit breaker and live API checks (2026-10-11)
- **Changed:** Added a shared breaker; fixed file-relative loading of `backend/.env` in `main.py` and `bhashini.py`; recorded live results in ARCHITECTURE.md.
- **How to run/test:** Backend: `.venv/bin/python -m pytest backend/tests -q` (25 passed); frontend: `cd frontend && npm test` (39 passed).
- **Decisions:** Set a 3 s per-request cap after initial live timings; three consecutive failures open the breaker and return `fallback="offline"`; a fast success resets the failure count.
- **Live API results:** ASR EN/HI/TE passed (2034/900/870 ms); all six MT directions passed (328–457 ms); TTS EN/HI/TE passed (2351/2365/2861 ms end-to-end). No tokens or transcripts were logged.
- **Deviations / known issues:** Initial TTS calls crossed the old 2.5 s limit, so inference and S3 download are timed separately. One Telugu TTS request exceeded 2.5 s; the 3 s cap passed at 2861 ms. Breaker stays open until process restart. `backend/bhashini.py` is 319 lines; architecture guidance says leave splitting to the human owner.
- **Needs from other member:** Reconcile frontend message/product types with `CONTRACT.md` before backend/frontend integration.
- **Next step:** M1-12 masking.

### M1-10: AnuvaadHub TTS (2026-10-11)
- **Changed:** Added `synthesize_speech` to `backend/bhashini.py` and TTS mock, request, cache, and validation checks to `backend/tests/test_bhashini.py`.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests -q` (23 passed); `cd frontend && npm test` (39 passed; dependencies installed from `package-lock.json`).
- **Decisions:** TTS accepts up to 30 words of letters/spaces, posts `text`/`gender`, downloads WAV from `s3_url`, and caches by language, gender, mode, and text hash. Playback rate remains client-side per section 12.
- **Deviations / known issues:** Only mock and stubbed HTTP paths were tested; real TTS credentials are not yet configured. Caller-side number conversion and symbol removal remain for the pipeline step.
- **Needs from other member:** Reconcile frontend message/product types with `CONTRACT.md` before backend/frontend integration.
- **Next step:** M1-11 circuit breaker.

### M1-09: AnuvaadHub translation (2026-10-11)
- **Changed:** Extended `backend/bhashini.py` with all six MT directions and added mock/request tests in `backend/tests/test_bhashini.py`.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests -q` (16 passed).
- **Decisions:** Each direction uses its own `BHASHINI_MT_<SOURCE>_<TARGET>_URL/TOKEN`; requests use `input_text` and reject inputs over 50 words.
- **Deviations / known issues:** Tests use mock responses; real endpoint checks wait until credentials are ready. The M1-08 real smoke is deferred per user instruction.
- **Needs from other member:** Reconcile frontend message/product types with `CONTRACT.md` before backend/frontend integration.
- **Next step:** M1-10 mock TTS.

### M1-08: AnuvaadHub ASR client (2026-10-11)
- **Changed:** Added `backend/bhashini.py` and `backend/tests/test_bhashini.py`; marked M1-08 mock completion in the architecture checklist.
- **How to run/test:** `.venv/bin/python -m pytest backend/tests -q` (7 passed).
- **Decisions:** ASR uses the per-language `access-token` and multipart `audio_file` contract; accepts mono 16 kHz WAV under 5 MB and up to 20 seconds.
- **Deviations / known issues:** Mock ASR passes; the required real API smoke/latency check is pending credentials and a sample WAV. Contract/type mismatch noted above.
- **Needs from other member:** Reconcile frontend message/product types with `CONTRACT.md` before real integration.
- **Next step:** Real AnuvaadHub ASR smoke, then M1-09.

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
- **Works right now:** Accessible shelf, checkout, orders, voice controls, PWA shell, and mock API. App startup connects the WebSocket and sends `session.start`. Local microphone testing is configured for live ASR and shows the recognized transcript. Frontend suite: 82 tests pass; production build succeeds.
- **Broken / blocked:** Live microphone/ASR still needs a spoken browser test. Backend `catalog.json` and `/catalog` endpoints are absent, so product recommendations are not live yet.
- **Env needed:** `VITE_USE_MOCK=false`, `VITE_API_WS_URL=ws://127.0.0.1:8001/ws`, backend `MOCK_BHASHINI=0`, and configured AnuvaadHub credentials for real speech recognition.

### Log (newest first)
### M2-03 follow-up: WebSocket startup and typed demo input (2026-10-11)
- **Changed:** `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/src/api.ts`, `frontend/src/api.test.ts`, and this tracking note; the temporary typed demo was removed in favor of voice-only input.
- **How to run/test:** `cd frontend && npm test` (82 passed); `npm run build` (passed).
- **Decisions:** Connect on app startup and send `session.start` for the selected language. Typed questions are available only in mock mode; responses explicitly identify sample data and `grounded: false`.
- **Deviations / known issues:** No browser session was available for visual interaction. Live WebSocket/AnuvaadHub speech was not exercised; mock audio still uses a fixed transcript. The real catalog endpoint remains unimplemented.
- **Needs from other member:** Backend catalog generation and `/catalog` integration are still needed for product-backed answers.
- **Next step:** M2-18 (tracking + returns)

### Voice input live ASR follow-up (2026-10-11)
- **Changed:** Frontend defaults to real WebSocket mode outside tests; local `.env.local` points to the ASR backend. Mock text question UI removed. All ASR transcripts, including low-confidence results, and service errors are visible in Controls. Backend local config enables AnuvaadHub ASR. The first live audio attempt exposed a missing required `duration_ms`; client now computes WAV duration from its 16 kHz mono PCM payload and sends it. Privacy-safe server logs now show accepted audio metadata and whether ASR returned a transcript, without logging audio or transcript contents.
- **Verification:** Frontend tests: 84 passed. Production build passes. Backend WebSocket/model tests: 13 passed. Local frontend is on port 5174 and live-ASR backend on port 8001 because prior app processes hold 5173/8000.
- **Remaining:** Confirm microphone permission and spoken ASR in the browser. `backend/data/catalog.json` is absent, so live product search still needs catalog ingest.

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
