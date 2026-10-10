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
- **Last completed step:** none
- **Next step:** M2-01
- **Works right now:** nothing yet
- **Broken / blocked:** nothing
- **Env needed:** `VITE_USE_MOCK=true` until SYNC-A

### Log (newest first)
_(no entries yet)_

---

## Shared notes (both members)
- Contract changes must be agreed by both and noted here.
- Sync points reached: none
- Proposed SYNC-A decision, not yet agreed: encode request and reply WAV audio as Base64 in `audio_base64`; waiting for Member 2 review.
- Review request: Member 1 reports Member 2 is past M2-10. Member 2 should review the contract draft and update their own progress section during SYNC-A; the current M2-01 entry is stale.

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
