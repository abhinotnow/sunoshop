# Oriel: zero-tap city-sign reading in Telugu, Hindi and English

Megathon 2026 · IIIT Hyderabad · Accessible AI for All · Use Case 3 (city signage)

Oriel lets a blind, low-vision, older or hand-impaired person hold up a phone and **hear what a sign says in their language**: bus boards, bus stops, metro and platform signs, direction boards, street names, traffic and pedestrian signals, shop boards and ads. It then guides them ("the sign is cut off on the left, move a little left") and answers spoken questions ("which bus goes to Koti?") through the full Bhashini (AnuvaadHub) speech-to-speech chain.

**Core idea: verify, then speak.** A sign reader that is wrong while sounding sure can put a blind person on the wrong bus or into traffic. Oriel reads every sign at least twice, in independent ways, and only says "the sign says ..." when the readings agree. Everything else is said as "it looks like ..., please check", or Oriel asks for a better photo and explains how to take one.


## Beyond signs: everything in front of the camera

When there is no sign, Oriel still helps:
- **What is in front**: a one- or two-sentence description ("two people leading three bulls along the road"), spoken as "Here is what I can see", never as a confirmed fact.
- **Hazards first**: steps, kerbs, poles, vehicles, animals, drains: "Careful, there may be ... Check with your cane." A hazard line is always spoken, even after a sign. Any sentence claiming a way is clear or safe is removed (`verify._UNSAFE_CLAIM`).
- **Labels and papers**: medicine strips, packets, menus, documents: "The label says: Parafix 650. It also says: 650 mg, Exp 08/2027".
- **Money**: "This is a 500 rupee note" only when both frames and a second reader or OCR read the same value; otherwise "It looks like ..., please check".

Tested on real photos (Wikimedia Commons, `eval/labels_web.json`, licences in `eval/photos/web/CREDITS.json`): 0 wrong-but-confident, scene described 10/10, hazards warned 6/6, median 9.2 s on the free Gemini tier.

---

## Contents

1. [Run it on a Windows laptop](#1-run-it-on-a-windows-laptop)
2. [Open it on the iPhone](#2-open-it-on-the-iphone)
3. [Demo script for judges](#3-demo-script-for-judges)
4. [Methodology](#4-methodology)
5. [The READ pipeline](#5-the-read-pipeline)
6. [The ASK pipeline (Bhashini speech to speech)](#6-the-ask-pipeline-bhashini-speech-to-speech)
7. [Verification rules](#7-verification-rules)
8. [Repositioning guidance](#8-repositioning-guidance)
9. [What Oriel says, and how translation is kept safe](#9-what-oriel-says-and-how-translation-is-kept-safe)
10. [Accessibility: modes, input gaps and output gaps](#10-accessibility-modes-input-gaps-and-output-gaps)
11. [Head gestures with MediaPipe (478 landmarks)](#11-head-gestures-with-mediapipe-478-landmarks)
12. [All parameters](#12-all-parameters)
13. [Edge cases and what Oriel does](#13-edge-cases-and-what-oriel-does)
14. [Privacy and safety](#14-privacy-and-safety)
15. [Why there is no Supabase](#15-why-there-is-no-supabase)
16. [Code guide, file by file](#16-code-guide-file-by-file)
17. [API reference](#17-api-reference)
18. [Tests and evaluation](#18-tests-and-evaluation)
19. [Configuration reference](#19-configuration-reference)
20. [Troubleshooting](#20-troubleshooting)
21. [Limitations (be honest with judges)](#21-limitations-be-honest-with-judges)

---

## 1. Run it on a Windows laptop

You need **Python 3.12** and **Node.js 22 LTS** (Vite 8 needs Node 20.19+ or 22.12+). All commands below are for **Command Prompt (cmd)**, run from the project folder (the folder that contains `backend`, `frontend`, `data`, `scripts`).

### 1.1 One-time setup

```bat
:: 0) go to the unzipped project folder (change the path to yours)
cd C:\Users\prath\oriel

:: 1) create the Python 3.12 virtual environment IN the project folder
::    with uv:
uv venv --python 3.12 .venv
::    or without uv:
::    py -3.12 -m venv .venv

:: 2) activate it (your prompt will start with (.venv))
.venv\Scripts\activate

:: 3) install the backend packages
uv pip install -r backend\requirements.txt
::    or:  python -m pip install -r backend\requirements.txt

:: 4) build the frontend (one time, and again after any frontend change)
cd frontend
npm install
npm run build
cd ..
```

The zip already contains a built frontend (`frontend\dist`), so step 4 can wait if Node is not installed yet. Rebuild after any change under `frontend\src`.

If `uv` is "not recognized" in cmd: `set Path=%USERPROFILE%\.local\bin;%Path%` and try again (that only lasts for this window).

### 1.2 Keys

- **Gemini**: `backend\.env` already contains `GEMINI_API_KEY=...`. To use another key, edit that line. Never put keys in the frontend.
- **AnuvaadHub (Bhashini)**: the PDF describes the API format but does not contain tokens. Each model on the AnuvaadHub dashboard has its **own** `api_endpoint` and `access-token`. Open `backend\config\anuvaad.json` and paste them per model:

```json
"mt":  { "en-te": {"endpoint": "https://...", "token": "..."}, "te-en": {...}, "en-hi": {...}, "hi-en": {...} },
"asr": { "te": {...}, "hi": {...}, "en": {...} },
"tts": { "te": {...}, "hi": {...}, "en": {...} },
"ocr": { "te": {...}, "hi": {...}, "en": {...} }
```

Leave a model blank if you do not have it. Oriel degrades gracefully (Telugu to Hindi pivots through English, missing TTS uses the phone's voice, missing OCR means the second Gemini reader is the only cross-check). Both `backend\.env` and `backend\config\anuvaad.json` are in `.gitignore`.

### 1.3 Check that every key works

```bat
python scripts\check_setup.py
```

It tests the Python version, packages, files, Node, then makes one tiny live call to each Gemini model and each configured AnuvaadHub model, and tells you exactly what to fix. If AnuvaadHub fails with a certificate error, set `ANUVAAD_VERIFY_TLS=false` in `backend\.env` (their own sample code turns certificate checks off).

If a Gemini model name is rejected for your key, change `GEMINI_READER_MODEL` / `GEMINI_ARBITER_MODEL` / `GEMINI_ASK_MODEL` in `backend\.env` to a model your key lists on ai.google.dev.

### 1.4 Start

```bat
.venv\Scripts\activate
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in Chrome or Edge on the laptop. The laptop webcam works for testing; the upload button lets you test with the photos in `eval\photos\synthetic` and `eval\print`.

### 1.5 Optional: pre-record the guidance voice

```bat
python scripts\generate_guidance_audio.py
```

Records every guidance phrase ("hold still", "move closer") with AnuvaadHub TTS into `frontend\public\audio\guidance`, so instructions play instantly with no network round trip. Have a native speaker check the Telugu and Hindi phrases in `data\guidance_phrases.json` first (they are marked DRAFT).

### 1.6 Developer mode (hot reload)

Two terminals:

```bat
:: terminal 1 (repo root, venv active)
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
:: terminal 2
cd frontend
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` to port 8000.

---

## 2. Open it on the iPhone

Safari only allows the camera, microphone and motion sensors on **HTTPS**. The easiest way is a free Cloudflare quick tunnel to the laptop:

```bat
winget install --id Cloudflare.cloudflared
:: new cmd window, while uvicorn is running:
cloudflared tunnel --url http://localhost:8000
```

It prints a `https://something.trycloudflare.com` address. Open it in **Safari** on the iPhone (the tunnel works on any network, so the phone does not need to be on the laptop's Wi-Fi). ngrok works the same way (`ngrok http 8000`).

On the iPhone:

1. Tap **Start**. Allow **Camera**, **Microphone** and **Motion & Orientation** when asked. All three prompts must come from that tap; that is why there is a Start screen.
2. Turn the ring/silent switch to ring, or audio may be muted.
3. Optional: Share → **Add to Home Screen** for full-screen use.
4. If Telugu speech falls back to the phone voice and nothing is heard: Settings → Accessibility → Spoken Content → Voices → add a Telugu/Hindi voice. With AnuvaadHub TTS configured, this is not needed.
5. If you denied a permission: Settings → Safari → Camera / Microphone → Allow, then reload.

---

## 3. Demo script for judges

1. Show `eval/print/bus_001.png` on a laptop screen or print it. Point the phone at it **without tapping**: Oriel guides ("tilt up", "hold still"), captures automatically and says "The sign says: bus two one eight, to Secunderabad" in the chosen language.
2. Open the **Pipeline** panel: each stage (quality, reader 1 on 3 frames, independent reader 2 + OCR, verify, guidance, compose, TTS) lights up live with timings.
3. Point at `bus_002` (blurry) or `bus_005` (cut off): Oriel says "it looks like ..., please check" or "the sign is cut off on the right, move a little right", and reads again. **This is the core claim: it never sounds sure when it is not.**
4. Tap **Ask** (or say "ask" in hands-free mode) and say in Telugu "ee bus Koti ki veltunda?". The panel shows ASR → MT → AI → MT → TTS, and the answer comes back in Telugu.
5. Turn on **head gestures** in Settings, nod for yes, shake for no, tilt the head right for "again".
6. Switch to ageing mode: larger text, slower speech, one fact per screen, simpler words.

---

## 4. Methodology

### The problem with "just ask a vision model"

A single vision-model read of a single photo is right most of the time, but when it is wrong it is wrong **confidently**, with no signal to the user. For a blind traveller that is worse than no answer. Typical failure modes on Indian street signs: `218` read as `21B`, a Telugu destination romanized wrongly, an arrow assigned to the wrong line, a pedestrian signal read in the middle of changing, a shop's hours read without knowing the time now.

### Verify-then-guide

1. **Capture several frames, not one.** The phone grabs a burst of 6 frames over about a second and keeps the 3 sharpest. Hand tremor and glare change between frames; real text does not.
2. **Read every frame independently** (reader 1, Gemini 3.5 Flash-Lite, structured JSON with a per-item legibility rating and a bounding box).
3. **Read again in a different way** (reader 2): a separate read of the sharpest frame at **ultra-high image resolution** (reader 1 gets a 1600 px copy at normal resolution), with its own prompt and without being shown reader 1's answer (avoids anchoring). By default it starts at the same time as reader 1, on the full frame (`ARBITER_PARALLEL=true`); set it to `false` to have it wait for reader 1's sign box and read a **zoomed crop** instead (better for far, small signs, about 4 s slower). In parallel, AnuvaadHub **OCR** reads tight crops of the route numbers, converted to black-on-white (the OCR expects a white background). PaddleOCR can be added as a third reader.
4. **Verify**: each fact gets a status from fixed, inspectable rules (section 7):
   - `confirmed`: frames agree **and** an independent reader agrees → spoken as "The sign says ...".
   - `uncertain`: read, but a check failed → "It looks like ..., please check".
   - `unreadable`: something is there but cannot be read → not spoken as a fact; Oriel guides and reads again.
5. **Guide**: if the key fact is not confirmed, Oriel works out **why** (sign too far, cut off, off-centre, glare, dark, blur, phone pointing at the ground, several signs) from the sign's bounding box and the phone's own sensors, says **one** short instruction, zooms in on the sign, and reads again (max 3 reads, then "please ask someone nearby").
6. **Speak from templates**: key facts (route, destination, platform, arrow, signal state) are put into fixed, reviewed sentences in Telugu, Hindi or English. They are never machine-translated, so translation cannot change a bus number.

### Why several readers instead of one bigger one

Agreement between readers that fail differently is much stronger evidence than one reader's self-reported confidence. Flash-Lite is fast and cheap enough to read all 3 frames in parallel. Reader 2 sees the text at much higher resolution: on the synthetic glare sign, Flash-Lite at normal resolution read కోటి (wrong letter) and at ultra-high resolution read కోఠి (correct). Reader 2 can be a different model (`GEMINI_ARBITER_MODEL`). We measured the full Flash models on 11 Oct 2026: 3.7 and 3.8 Flash timed out (over 25 s) and 3.6 Flash took 7–10 s with no gain in accuracy, so both readers currently use Flash-Lite and the independence comes from different input and prompt. The OCR reader is a completely different technology, so its errors are uncorrelated with both.

Measured on the 16 synthetic signs (`scripts/run_eval.py`, 11 Oct 2026): 0 facts wrong but spoken as confirmed, median 8.4 s per read. A naive app that speaks one Gemini read as fact was wrong-but-confident on 5 of 16 signs.

---

## 5. The READ pipeline

```
 iPhone (on device)                                   Server (FastAPI, streamed as SSE)
 ───────────────────                                  ────────────────────────────────────────────
 camera preview
  │ every 250 ms: sharpness, brightness, glare, tilt
  │ → "tilt up" / "hold still" / "too dark"
  │ good for 550 ms → auto-capture (zero tap)
  ▼
 burst: 6 frames / ~1 s, keep 3 sharpest
 MediaPipe FaceDetector → pixelate faces
 JPEG ≤1600 px ──────────── POST /api/read ──────────▶ quality      sharpness + brightness per frame
                                                        │
                                                        ▼
                                                       read         reader 1 = Gemini 3.5 Flash-Lite
                                                        │           on all 3 frames in parallel
                                                        │           → SignRecord JSON per frame
                                                        ▼
                                                       second_reader (in parallel)
                                                        │  reader 2 = Gemini 3.8 Flash on a zoomed
                                                        │             crop of the consensus box
                                                        │  OCR      = AnuvaadHub OCR on white-bg
                                                        │             crops of the route numbers
                                                        │  (+ PaddleOCR if enabled)
                                                        ▼
                                                       verify       rules → confirmed / uncertain /
                                                        │           unreadable for each fact
                                                        ▼
                                                       guidance     done | reread | guide | give_up
                                                        │           + 1–2 instruction phrase ids
                                                        ▼
                                                       compose      templates in te / hi / en
                                                        │           names in the user's script
                                                        │           (sign → known places → MT → Latin)
                                                        ▼
                                                       tts          AnuvaadHub TTS (cached)
 ◀───────────── stage events + result ─────────────────┘
 speak key lines, show captions + badges,
 follow the guidance (re-aim, zoom, read again)
```

Each stage is sent to the phone as soon as it finishes (`text/event-stream`), so the Pipeline panel shows it live, with model names and timings. The last event is the result: `{verified, speech, next_step, reads_used, timings_ms}`.

## 6. The ASK pipeline (Bhashini speech to speech)

```
 voice (te / hi / en)
   │  16 kHz mono WAV recorded on the phone (no MediaRecorder: iPhone records AAC, ASR wants WAV)
   ▼
 asr            AnuvaadHub ASR in the input language          → "ఈ బస్ కోటి కి వెళ్తుందా"
   ▼
 translate_in   AnuvaadHub MT input → English                  → "Does this bus go to Koti?"
   ▼
 ai             Gemini 3.8 Flash answers ONLY from the verified sign facts (+ photo), with rules:
                no outside knowledge, never "safe to cross", "probably" for opening hours,
                ≤ 40 words, out-of-scope for medical/legal/financial, misheard → yes/no question
   ▼
 translate_out  English → output language; route numbers and place names are replaced by
                placeholders before MT and restored after, then numbers are checked
   ▼
 tts            AnuvaadHub TTS in the output language
```

If a step is missing: no ASR model → the user can type; no direct MT pair → pivot through English → Gemini translation fallback (shown as such in the panel); no TTS → phone voice. If the question looks misheard, Oriel asks "Did you ask which bus goes to Koti?" and waits for yes/no (voice, nod/shake, or buttons).

---

## 7. Verification rules

Implemented in `backend/app/services/verify.py`. `n` = number of frames (1–3); "need" = 2 when n ≥ 2, else 1.

| Fact | Confirmed when | Otherwise |
|---|---|---|
| Sign present | ≥ need frames say a sign is there | "no sign" → guidance |
| Route number | ≥ 2 frames read it as **clear** **and** reader 2 or OCR contains it; with no second reader configured, all 3 frames must agree. A candidate that is a prefix of a longer agreed number (`21` vs `218`) is dropped | reader 2 disagrees → `uncertain`; route seen but no agreement → `unreadable` |
| Place / destination | ≥ 2 frames clear, text is in the claimed script (≥ 90 % of letters), and it matches the Hyderabad known-places list **or** reader 2 agrees. A single-frame read needs reader 2 | `uncertain` |
| Platform | frames agree **and** reader 2 or OCR agrees | `uncertain` |
| Arrow | ≥ 2 frames agree on direction (and which line it belongs to) | single frame → `uncertain` |
| Traffic sign | sign code agrees across frames; a speed-limit value must also be confirmed by reader 2 / OCR | `uncertain` |
| Pedestrian signal | **every** frame shows the same state **and** reader 2 agrees | mixed or flashing → "changing"; anything else → "I can't tell, ask someone" |
| Shop name | frames agree **and** an independent reader read the same name: reader 2's shop name (in English **or** the original script), reader 2's text lines, or the OCR output. Every word of the name inside reader 2's longer name counts (`NEW SAGAR` in `NEW SAGAR TIFFIN CENTRE`). With no second reader configured, all 3 frames must agree | `uncertain` |
| Shop category, table description | always `uncertain` (interpretation, not text) | |
| Other text (notices, nameplates, banners) | majority of frames, clear, in the claimed script, not already covered by a field above, max 10 lines. Several frames agreeing confirms it; a **single photo** needs reader 2's text lines or the OCR to contain the same line | `uncertain` |
| Image issues (cut-off sides, glare, dark, blur) | majority of frames | |

The **key fact** depends on the sign type (route for bus boards, state for signals, name for shops, ...). Oriel is "done" only when the key fact is confirmed.

## 8. Repositioning guidance

`backend/app/services/guidance.py` (server, from what the readers saw) + `frontend/src/hooks/useOriel.ts` (phone, live, before capture). Box coordinates are 0–1000 of the frame.

| Situation | Detected by | Oriel says |
|---|---|---|
| Phone pointing at ground / sky | motion sensor, beta outside 55°–125° | "Tilt the phone up a little" / "down" |
| Shaking | sharpness below threshold, accelerometer | "Hold still" |
| Too dark | mean brightness < 45 | "It is too dark to read here" |
| Glare | > 8 % near-white pixels, or reader reports glare | "There is glare on the sign. Tilt the phone slightly" |
| Nothing found for 14 s | live scan | "I can't see a sign yet. Hold the phone at chest height and turn slowly" |
| Sign far away | box area < 6 % of frame | "The sign is far away. Move a little closer if it is safe" + digital zoom on the sign |
| Sign cut off on one side | majority of frames report that side | "The sign is cut off on the left. Move the phone a little left" |
| Sign too close | box > 85 % and cut on 2+ sides | "The sign is too close. Step back a little" |
| Sign off-centre | box centre > 22 % from the middle | "The sign is to your left. Move the phone a little left" |
| Several signs | sign_count > 1 | "I can see more than one sign. I will read the biggest one" |
| Key fact not confirmed, no visible reason | | "Hold still, zooming in" (crop to the sign) and read again |
| Still not confirmed after 3 reads | | "Please ask someone nearby" |

At most **one or two** instructions are spoken at a time, phone-side problems first (tilting matters more than centring).

## 9. What Oriel says, and how translation is kept safe

- **Templates** (`data/speech_templates.json`): e.g. `says_route_to` = "The sign says: bus {route}, to {place}." and its "simple" variant "Bus {route}. It goes to {place}." Every template exists in te, hi and en.
- **Route numbers are read digit by digit** ("two one eight", "రెండు ఒకటి ఎనిమిది"), with letters named in the user's script. Many Telugu speakers say bus numbers in English digits, so "English digits" is a setting.
- **Names in the user's script**: if the sign has the name in Telugu, that exact text is used; otherwise the known-places list (57 metro stations with official Telugu names + more); otherwise MT of the name; otherwise the Latin name.
- **Free text only** (shop category, advert product, other words) is machine-translated, through `safe_translate.py`:
  1. Every number and protected name is replaced by a placeholder token (`90001`, `90002`, ...).
  2. The sentence is translated.
  3. Placeholders are restored (numbers in the target script's digits where needed).
  4. Every number in the source must still be present in the output; otherwise the translation is rejected and the line is spoken in English with a note.
- **Hours**: "The board shows timings 9 AM to 10 PM. So it is probably open now." Computed in Asia/Kolkata time, handles closing after midnight, and always says "probably".
- **Signals**: walk is said as "appears to show the walking figure. Still, listen to the traffic before you cross". Oriel never says it is safe to cross.

---

## 10. Accessibility: modes, input gaps and output gaps

### Modes (chosen at start, or offered when Oriel notices the need; it never switches silently)

| Mode | For | Defaults |
|---|---|---|
| **Visual** (blind / low vision) | the mandatory user group | auto-capture, hands-free voice, guidance spoken, captions for low vision |
| **Ageing** | older users | tap to capture, slower speech (0.85×), text 1.4×, simpler words, one fact per screen |
| **Hand-motor** | tremor, limited hand use | auto-capture, hands-free, head gestures, text 1.2×, big targets (56 px) |

Oriel offers a mode when it notices: phone jitter while holding still (hand-motor), repeated failed aiming (visual), 2+ "again" requests or slow replies (ageing). It asks "Would you like ...? Say yes or no".

### Input gaps (getting the request in) → how Oriel closes them

| Gap | Solution |
|---|---|
| Can't see where to aim | live tilt/centre/distance guidance by voice; auto-capture when the frame is good |
| Can't press the button accurately | zero-tap capture; the whole bottom dock is a 3D beacon button; keyboard shortcuts on laptop |
| Can't hold still | 6-frame burst, sharpest 3 kept; digital zoom on the sign |
| Can't use hands at all | hands-free voice commands ("read", "again", "slower", "spell") and head gestures (nod/shake/tilt) |
| Speaks Telugu or Hindi, not English | AnuvaadHub ASR in te/hi/en; commands recognised in all three |
| Recognition error | misheard questions come back as a yes/no confirmation |
| Noisy street | adaptive voice detector learns the noise floor before speech |

### Output gaps (getting the answer out) → how Oriel closes them

| Gap | Solution |
|---|---|
| Can't read the screen | everything is spoken; VoiceOver-friendly captions (`aria-live`); a VoiceOver mode where Oriel's voice only reads signs |
| Needs it slower or simpler | "slower" / "faster" (0.6×–1.6×), "simpler" re-composes with simple templates |
| Missed a word | "again", "spell" (spells the route and name letter by letter) |
| Low vision | text size up to 1.8×, high-contrast black/yellow theme, large badges |
| Not sure if it is right | every line has a status badge (confirmed / please check); spoken wording differs too |
| Tables (timetables) | described in words, marked "please check" |
| Language | output in te / hi / en, independent of input language |
| Weak network | guidance clips cached on the phone; retries with backoff; offline message |

### Mapping to the hackathon requirements

| Slide requirement | Where |
|---|---|
| Bhashini speech to speech, shown live | ASK pipeline, Pipeline panel |
| Explain simpler | "simpler" command / button, simple templates |
| Real headings and lists | semantic HTML (`h1`/`h2`, `ul`), landmarks, skip link |
| Tables described in words | `table_description` → "There is a table on the sign ..." |
| Captions | live captions of every spoken line |
| Adjustable text and speech speed | Settings + voice commands |
| English + two Indian languages, input and output | te / hi / en everywhere |
| Graceful failure: confirm or repeat on misrecognition and network drops | yes/no confirmation, "didn't catch that", network messages, retries |
| Out of scope: medical, legal, financial | ASK prompt marks `out_of_scope`, polite refusal |
| No special hardware | any phone browser |

## 11. Head gestures with MediaPipe (478 landmarks)

`frontend/src/lib/headGestures.ts`. Uses the MediaPipe Face Landmarker (478-point face mesh) on the **front** camera.

- Landmarks used: **1** (nose tip), **33** (right eye outer corner), **263** (left eye outer corner).
- `yaw` = horizontal offset of the nose from the eye midpoint ÷ eye distance; `pitch` = vertical offset ÷ eye distance; `roll` = angle of the eye line in degrees. All relative to a slowly updated neutral pose, so any posture works.
- Gestures: **nod** = yes, **shake** = no, **tilt right** = again, **tilt left** = read a new sign.

iPhone allows only one camera at a time, so gestures run on the front camera only when Oriel is waiting for an answer (result screen or a yes/no question); the reading camera is used while scanning.

**Reading camera.** Signs can be read with the back camera (default) or the front camera: the flip button in the camera view, the `C` key, Settings › Camera that reads signs, or by voice ("switch camera", "front camera", "back camera" in te / hi / en). The choice is remembered. The front-camera preview is mirrored for the user, but the frames sent to the server are not, so text reads the right way round; phone-tilt advice is turned off for the front camera. With the front camera chosen, head gestures and reading share one stream.

---

## 12. All parameters

### Phone (frontend)

| Parameter | Value | File |
|---|---|---|
| Quality check interval | 250 ms | `hooks/useOriel.ts` |
| Good frames needed before auto-capture | 550 ms | `hooks/useOriel.ts` |
| "No sign yet" hint after | 14 s scanning (and ≥ 9 s since last hint) | `hooks/useOriel.ts` |
| `QUALITY.minSharpness` | 55 (Laplacian variance on a 240 px frame) | `lib/quality.ts` |
| `QUALITY.minBrightness` | 45 / 255 | `lib/quality.ts` |
| `QUALITY.maxGlare` | 0.08 (share of near-white pixels) | `lib/quality.ts` |
| `MOTION.uprightMin` / `uprightMax` | 55° / 125° (beta; landscape ignored) | `lib/motion.ts` |
| `MOTION.steadyAccel` | 0.35 m/s² | `lib/motion.ts` |
| `MOTION.tremorStd` | 0.6 m/s² (suggests hand-motor mode) | `lib/motion.ts` |
| Burst | 6 shots, 160 ms apart, keep 3 sharpest, max side 1600 px | `lib/capture.ts` |
| Face pixelation | detector confidence 0.4, box +25 %, 8 px blocks | `lib/vision.ts` |
| `GESTURE.nodRange` / `shakeRange` | 0.10 / 0.14 (× eye distance) | `lib/headGestures.ts` |
| `GESTURE.crossRange` | 0.6 (other axis must stay smaller) | `lib/headGestures.ts` |
| `GESTURE.tiltDegrees` / `tiltHoldMs` | 14° / 500 ms | `lib/headGestures.ts` |
| `GESTURE.windowMs` / `cooldownMs` | 1200 / 1200 ms | `lib/headGestures.ts` |
| Recorder | 16 kHz mono WAV, max 15 s, stop after 900 ms silence, give up after 7 s without speech, threshold max(0.015, 3 × noise floor) | `lib/recorder.ts` |
| Speech rate | 0.6× – 1.6× | `state/settings.tsx` |
| Text scale | 1× – 1.8× | `state/settings.tsx` |
| Touch targets | ≥ 56 px | `styles/tokens.css` |

### Server (backend)

| Parameter | Value | File / env |
|---|---|---|
| Reader 1 | `gemini-3.5-flash-lite` | `GEMINI_READER_MODEL` |
| Reader 2 (arbiter) | `gemini-3.5-flash-lite` | `GEMINI_ARBITER_MODEL` |
| Ask | `gemini-3.6-flash` | `GEMINI_ASK_MODEL` |
| Reader 2 timing | in parallel with reader 1 on the full sharpest frame (`false`: zoomed crop after reader 1) | `ARBITER_PARALLEL` |
| Image resolution | reader 1 `high`, reader 2 `ultra_high` | `GEMINI_IMAGE_RESOLUTION`, `GEMINI_ARBITER_IMAGE_RESOLUTION` |
| Thinking level | reader 1 / ask `minimal`, reader 2 `low` (dropped automatically if a model does not support it) | `GEMINI_THINKING_LEVEL`, `GEMINI_ARBITER_THINKING_LEVEL` |
| Gemini timeout / retries | 12 s / 2 retries, backoff 0.8 s × 2ⁿ on 429, 5xx, timeouts | `GEMINI_TIMEOUT_S`, `services/gemini.py` |
| Frame sent by the phone | longest side 2400 px, JPEG 0.92, rear camera asked for 4K | `lib/camera.ts` (`CAPTURE_MAX_SIDE`) |
| Max frames per read | 3 | `MAX_FRAMES` |
| Max reads per sign | 3 | `MAX_READS_PER_SIGN` |
| Script check | ≥ 90 % of letters in the claimed script | `services/text_utils.py` |
| Fuzzy name match | rapidfuzz ≥ 85 (agreement), ≥ 90 (known places) | `services/text_utils.py`, `services/places.py` |
| Guidance: far / too close / off-centre | area < 0.06 / area > 0.85 + 2 cut sides / centre offset > 0.22 | `services/guidance.py` |
| Key lines spoken | max 3 (rest under "more") | `services/compose.py` |
| AnuvaadHub MT chunk | ≤ 45 words (limit 50) | `services/anuvaad.py` |
| AnuvaadHub TTS chunk | ≤ 28 words (limit 30), special characters removed | `services/anuvaad.py` |
| AnuvaadHub ASR / OCR size | < 4.9 MB | `services/anuvaad.py` |
| OCR preparation | Otsu threshold, polarity from the centre region, 24 px white border, PNG | `services/ocr_prep.py` |
| Time zone (shop hours) | Asia/Kolkata | `TIMEZONE` |

---

## 13. Edge cases and what Oriel does

| # | Case | Behaviour |
|---|---|---|
| 1 | No sign in view | live hint after 14 s; after a read: "can't see a sign yet ..."; after 3 reads: "I couldn't find a readable sign. Please ask someone nearby" |
| 2 | Sign far / small | "move a little closer if it is safe" + crop/zoom on the sign box for the next read |
| 3 | Sign cut off | side-specific instruction; if the key fact was still confirmed, it is spoken and the rest is noted |
| 4 | Sign too close | "step back a little" |
| 5 | Phone at the ground / sky | tilt instruction before anything else |
| 6 | Landscape orientation | tilt advice switched off (angles are not meaningful) |
| 7 | Blur / tremor | sharpest of 6 frames; "hold still"; offer hand-motor mode after repeated jitter |
| 8 | Dark | "too dark to read here"; no guess |
| 9 | Glare | "tilt the phone slightly"; glare frames lose the vote |
| 10 | Several signs | says so, reads the biggest/central one |
| 11 | Frames disagree on the route (`218` vs `21B`) | not confirmed → "looks like ..., please check" or re-read with zoom |
| 12 | Reader 2 disagrees with reader 1 | `uncertain`, never confirmed |
| 13 | Prefix confusion (`21` vs `218`) | shorter candidate dropped |
| 14 | Route visible but unreadable | "I can read Secunderabad but not the bus number" |
| 15 | Destination only in Telugu | Telugu text kept exactly for Telugu output; known-places list for Hindi/English |
| 16 | Unknown place, no MT | Latin name, read as is |
| 17 | Wrong script returned by the model | script check fails → `uncertain` |
| 18 | Pedestrian signal walk | "appears to show the walking figure. Still, listen to the traffic" (only if all frames + reader 2 agree) |
| 19 | Signal changing / flashing / mixed | "seems to be changing. Wait for the next walk signal" |
| 20 | Signal unclear | "I can't tell ... ask someone before crossing" |
| 21 | Don't walk | always spoken, even if uncertain (the safe direction) |
| 22 | Speed limit | value must be confirmed by a second reader |
| 23 | Shop with hours | "probably open/closed now", IST, past-midnight closing handled |
| 24 | Shop shutter down / "closed" board | says so |
| 25 | Advertisement | "This is an advertisement for {brand}"; offers marked please check |
| 26 | Timetable / table | described in words, marked please check |
| 27 | Emergency exit / warning signs | traffic-sign list with safety notes |
| 28 | Translation changes a number | rejected; English line spoken instead |
| 29 | MT pair missing (te→hi) | pivot through English; then Gemini fallback, labelled in the panel |
| 30 | TTS missing / fails | phone voice; captions always shown |
| 31 | iPhone has no Telugu voice | captions + instruction to add a voice; AnuvaadHub TTS avoids this |
| 32 | ASR hears nothing | "Sorry, I didn't catch that. Please say it again" |
| 33 | ASR mishears | AI returns a yes/no confirmation instead of guessing |
| 34 | User says a command inside a question ("what") | commands match only the whole utterance or a ≤ 3-word phrase starting with it |
| 35 | Question not answered by the sign | says so, suggests asking someone |
| 36 | Medical / legal / financial question | out of scope, politely |
| 37 | Network slow | "network is slow, still trying"; 2 retries with backoff |
| 38 | Offline | "no internet connection, I will try again"; cached guidance still plays |
| 39 | Gemini quota / outage | retries, then "I can't read signs right now" (no fake answer) |
| 40 | Camera or mic denied | spoken + on-screen instructions to allow it |
| 41 | iPhone audio locked | unlocked by the Start tap; one reused audio element |
| 42 | iPhone opens camera twice | React StrictMode removed |
| 43 | Faces in the photo | pixelated on the phone before upload; if the detector fails the UI says so |
| 44 | VoiceOver running | VoiceOver mode: captions go to VoiceOver, Oriel only speaks sign content |
| 45 | Reduced motion | 3D beacon replaced by a static orb |
| 46 | Wrong-but-confident risk on rare signs | eval script counts this separately; it must stay 0 |

## 14. Privacy and safety

- **No storage of images or voice.** Frames and recordings live in memory for the request only. Only synthesized TTS audio of sign text is cached (`backend/.cache/audio`).
- **Faces blurred on the phone** before anything is uploaded.
- **Preferences stay on the phone** (`localStorage`); no accounts.
- **Keys only on the server** (`backend/.env`, `backend/config/anuvaad.json`), both git-ignored. The Gemini key was shared in chat during development: rotate it after the event at aistudio.google.com/apikey.
- **No navigation claims beyond the sign**: no invented routes, distances or "safe to cross".

## 15. Why there is no Supabase

We evaluated Supabase (Postgres + auth + storage + edge functions) for the backend and chose not to use it:

1. **The pipeline needs Python** (image processing, OCR preparation, async fan-out to Gemini and AnuvaadHub). Supabase Edge Functions run Deno/TypeScript, so a Python server would still be needed.
2. **The privacy promise is "we store nothing"**: no photos, no voice, no accounts. A database would add a place where personal data could leak, with no benefit to the user.
3. **Preferences are per device** and fit in `localStorage`.
4. **Latency**: an extra hop to a hosted database adds time to every read with nothing gained.

If the project grows (shared, crowd-verified sign database, real-time bus data), Supabase would be a good fit for **that** data, not for user data.

---

## 16. Code guide, file by file

```
oriel/
├─ backend/
│  ├─ .env                      keys and settings (git-ignored)      .env.example: template
│  ├─ config/anuvaad.json       AnuvaadHub endpoint + token per model (git-ignored)
│  ├─ requirements.txt          backend packages      requirements-ocr.txt: optional PaddleOCR
│  ├─ schema/                   JSON schemas Gemini must answer in
│  │   sign_record.schema.json  reader 1: everything on a sign, with legibility + boxes
│  │   arbiter.schema.json      reader 2: routes, places, platform, signal, shop name (English + original script), text lines, legible flag
│  │   ask.schema.json          answer_en, needs_confirmation, out_of_scope, protected_terms
│  ├─ app/
│  │   main.py                  FastAPI app, routers under /api, serves frontend/dist + /audio
│  │   settings.py              all settings from .env, paths
│  │   content.py               cached loaders for data/*.json, schemas, prompts
│  │   prompts/                 read_sign.md, arbiter.md, ask.md (the model instructions)
│  │   routers/
│  │     read.py                POST /api/read → SSE stream of the READ pipeline
│  │     ask.py                 POST /api/ask  → SSE stream of the ASK pipeline
│  │     speech.py              /api/speak, /api/asr, /api/translate, /api/compose, /api/audio/{id}.wav
│  │     health.py              GET /api/health: what is configured
│  │     common.py              SSE helper
│  │   services/
│  │     read_pipeline.py       orchestrates the READ pipeline (section 5)
│  │     ask_pipeline.py        orchestrates the ASK pipeline (section 6)
│  │     gemini.py              Gemini Interactions API: structured JSON, retries, timeouts
│  │     sign_reader.py         reader 1 (per frame) and reader 2 (full frame or zoomed crop), record normalisation
│  │     verify.py              verification rules (section 7), consensus box, key fact
│  │     guidance.py            repositioning plan (section 8)
│  │     compose.py             spoken sentences from templates; more / spell lines
│  │     safe_translate.py      placeholder-protected MT with number checks
│  │     speech.py              TTS with cache and fallback; names in the user's script
│  │     anuvaad.py             AnuvaadHub client: MT (chunk, pivot), ASR, TTS (chunk + join WAV), OCR
│  │     ocr_prep.py            black-on-white conversion for OCR (Otsu + centre polarity)
│  │     images.py              decode (EXIF), resize, sharpness, brightness, crop by box
│  │     hours.py               opening-hours parsing, "probably open", times in te/hi/en
│  │     places.py              Hyderabad known-places list (exact + fuzzy match)
│  │     text_utils.py          script check, digits, route normalisation, fuzzy match, TTS cleanup
│  │     audio_store.py         TTS audio cache
│  │     paddle.py              optional PaddleOCR third reader
│  └─ tests/                    pytest: verify, guidance, compose, translation, hours, AnuvaadHub, API
├─ data/                        content, editable without touching code
│  speech_templates.json        sentences for key facts (te/hi/en, + simple variants), digit/letter names
│  guidance_phrases.json        ~45 short instructions (te/hi/en)
│  voice_commands.json          read, again, more, spell, slower, faster, simpler, yes, no, stop, ask, ...
│  traffic_signs.json           34 Indian traffic/road signs with names and safety notes
│  hyderabad_places.json        94 places (57 metro stations with official Telugu names)
├─ frontend/
│  ├─ index.html                iOS meta tags, fonts (Inter, Noto Sans Telugu/Devanagari)
│  ├─ public/                   icons, manifest, service worker (sw.js), audio/guidance/ clips
│  └─ src/
│     main.tsx                  entry (no StrictMode: it opens the iPhone camera twice)
│     App.tsx                   layout + keyboard shortcuts (Space read, A ask, M more, S spell, Q stop)
│     hooks/useOriel.ts         THE controller: phases, camera, quality loop, auto-capture, reading,
│                               guidance, speech queue, hands-free loop, gestures, dialogs, offline
│     state/settings.tsx        settings + mode presets, saved on the device
│     lib/
│       api.ts                  fetch with timeout + retry, SSE parser, typed API calls
│       audio.ts                one audio engine: clips → server TTS → phone voice, iOS unlock
│       recorder.ts             mic → 16 kHz WAV with voice-activity detection
│       camera.ts               camera start/stop, frame grab with focus crop
│       capture.ts              6-frame burst, sharpest 3, face blur
│       quality.ts              sharpness / brightness / glare on the phone
│       motion.ts               tilt and tremor from the motion sensors
│       vision.ts               MediaPipe face detector (blur) + face landmarker (lazy loaded)
│       headGestures.ts         nod / shake / tilt from 478 landmarks
│       conditions.ts           notices when another mode would help
│       platform.ts, storage.ts helpers
│     i18n/ui.ts                UI strings in te/hi/en      i18n/content.ts: shared data JSON, command matching
│     components/
│       Beacon3D.tsx            three.js shader orb: colour/motion shows the state (scan, read, speak, listen)
│       StartScreen.tsx         language + mode choice; the tap that unlocks camera, mic, motion, audio
│       CameraStage.tsx         preview, sign box and focus box overlays
│       ControlDock.tsx         beacon button (read), upload, ask / stop
│       ResultPanel.tsx         spoken lines with status badges, more / spell / simpler, evidence
│       PipelinePanel.tsx       live stages with model names and timings
│       AskPanel.tsx            voice or typed questions, transcript in both languages
│       SettingsSheet.tsx       languages, speed, text size, contrast, gestures, system status
│       DialogCard.tsx          yes/no questions (buttons, voice, nod/shake)
│       GestureHud.tsx, Captions.tsx, TopBar.tsx, Icons.tsx
│     styles/                   tokens.css (themes), base.css, layout.css (2 columns ≥ 960 px), components.css
├─ scripts/
│  check_setup.py               verifies packages, files and every key with live calls
│  generate_guidance_audio.py   pre-records guidance phrases with AnuvaadHub TTS
│  run_eval.py                  measures wrong-but-confident, recall, abstentions, latency vs a 1-frame baseline
│  make_synthetic_signs.py      makes the synthetic test signs
└─ eval/
   photos/synthetic/            16 signs × 3 frames (clear, blurry, glare, far, cut off, dark, tilted, ...)
   print/                       clean signs to show on a screen for the live demo
   labels_synthetic.json        ground truth      labels_template.json: format for real photos
```

### How a read flows through the code

1. `useOriel.ts` quality loop sees good frames for 550 ms → `capture.captureBurst()` → `api.read()`.
2. `routers/read.py` → `read_pipeline.run_read()`, which yields stage events.
3. `sign_reader.read_frame()` × 3 → `gemini.generate_json()` with `prompts/read_sign.md` + `schema/sign_record.schema.json`.
4. `sign_reader.arbiter_read()` (started before step 3 when `ARBITER_PARALLEL=true`, else on `verify.consensus_box()` → `images.crop_box()`) and `anuvaad.ocr()` on `ocr_prep.prepare_for_ocr()` crops.
5. `verify.verify()` → `guidance.next_step()` → `speech.fill_names()` → `compose.compose()` → `speech.finalize()` (safe translation) → `speech.attach_audio()`.
6. Back on the phone, `useOriel.handleResult()` speaks the key lines or follows `next_step` (speak instruction, set focus box, read again).

### Where to change things

| To change | Edit |
|---|---|
| What Oriel says for a fact | `data/speech_templates.json` |
| A guidance instruction | `data/guidance_phrases.json` (then re-run `generate_guidance_audio.py --force`) |
| Voice command words | `data/voice_commands.json` |
| When something counts as confirmed | `backend/app/services/verify.py` (+ tests in `backend/tests/test_verify.py`) |
| Repositioning thresholds | `backend/app/services/guidance.py`, `frontend/src/lib/quality.ts`, `motion.ts` |
| What the reader extracts | `backend/schema/sign_record.schema.json` + `prompts/read_sign.md` + `sign_reader.EMPTY_RECORD` |
| Models | `backend/.env` |
| Colours, sizes | `frontend/src/styles/tokens.css` |

## 17. API reference

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | configured models, AnuvaadHub status, known places |
| POST | `/api/read` | form: `frames` (1–3 JPEG), `lang`, `mode`, `reads_used`, `device` (JSON, e.g. `{"tilt":"up"}`), `digit_style` | SSE: `stage` events, then `result` or `error` |
| POST | `/api/ask` | form: `audio` (WAV) or `text`, `in_lang`, `out_lang`, `context` (verified JSON), `frame` (JPEG, optional), `confirmed` | SSE: `stage` events (asr, translate_in, ai, translate_out, tts), then `result` or `error` |
| POST | `/api/speak` | JSON `{text, lang}` | `{audio_url, provider}` |
| POST | `/api/asr` | form `audio`, `lang` | `{text}` |
| POST | `/api/translate` | JSON `{text, src, tgt}` | `{text, path}` |
| POST | `/api/compose` | JSON `{verified, lang, mode, digit_style}` | speech lines (re-compose without re-reading) |
| GET | `/api/audio/{id}.wav` | | cached TTS audio |

Interactive docs: http://localhost:8000/docs

## 18. Tests and evaluation

```bat
.venv\Scripts\activate
python -m pytest backend\tests -q
```

56 tests cover verification rules, guidance, composition, safe translation, hours, the AnuvaadHub client (mocked HTTP) and the API (with fake readers). They need no keys.

```bat
python scripts\run_eval.py                              :: synthetic signs
python scripts\run_eval.py --labels eval\labels.json    :: your real photos
```

`run_eval.py` runs the real pipeline on each labelled sign and a naive one-frame baseline, and reports **wrong-but-confident** (must be 0), key-fact recall, hedged answers, abstentions, sign-found accuracy and latency. Results go to `eval/results/`.

**Real photos**: take 3 photos per sign from slightly different positions, put them in `eval/photos/real/`, copy `eval/labels_template.json` to `eval/labels.json` and add one entry per sign. Report synthetic and real results separately.

## 19. Configuration reference

`backend/.env`:

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | | required |
| `GEMINI_READER_MODEL` | `gemini-3.5-flash-lite` | reader 1 |
| `GEMINI_ARBITER_MODEL` | `gemini-3.5-flash-lite` | reader 2 |
| `GEMINI_ASK_MODEL` | `gemini-3.6-flash` | answers questions |
| `GEMINI_THINKING_LEVEL` | `minimal` | reader 1 and ask; lower = faster |
| `GEMINI_ARBITER_THINKING_LEVEL` | `low` | reader 2 |
| `GEMINI_IMAGE_RESOLUTION` | `high` | image detail for reader 1 and ask (`low`, `medium`, `high`, `ultra_high`) |
| `GEMINI_ARBITER_IMAGE_RESOLUTION` | `ultra_high` | image detail for reader 2 |
| `ARBITER_PARALLEL` | `true` | reader 2 on the full frame at the same time as reader 1; `false` = zoomed crop afterwards |
| `GEMINI_TIMEOUT_S` | 12 | per call; a hung call is retried rather than waited out |
| `ANUVAAD_CONFIG` | `backend/config/anuvaad.json` | model endpoints + tokens |
| `ANUVAAD_VERIFY_TLS` | `true` | set `false` on certificate errors |
| `ANUVAAD_TIMEOUT_S` | 30 | per call |
| `TTS_GENDER` | `female` | AnuvaadHub voice |
| `ENABLE_PADDLEOCR` | `false` | third reader (needs `requirements-ocr.txt`) |
| `MAX_FRAMES` / `MAX_READS_PER_SIGN` | 3 / 3 | |
| `TIMEZONE` | `Asia/Kolkata` | for "probably open" |
| `CORS_ORIGINS` | `*` | |

## 20. Troubleshooting

| Problem | Fix |
|---|---|
| `uv` not recognized | `set Path=%USERPROFILE%\.local\bin;%Path%`, or use `py -3.12 -m venv .venv` |
| `py -3.12` not found | install Python 3.12 from python.org (tick "Add to PATH") |
| `.venv\Scripts\activate` not found | you are not in the project folder; `cd` to the folder with `backend` in it |
| PowerShell says scripts are disabled | use cmd, or run `.venv\Scripts\Activate.ps1` after `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `ModuleNotFoundError: backend` | run uvicorn from the project root, not from `backend` |
| `npm run build` fails on Node version | install Node 22 LTS |
| Page at :8000 says "not found" | build the frontend (`npm run build`), restart uvicorn |
| iPhone: camera does not start | must be HTTPS (use the tunnel); Settings → Safari → Camera → Allow |
| iPhone: no sound | ring switch on, volume up, tap Start again |
| "reader unavailable" | Gemini key or model name; run `python scripts\check_setup.py` |
| AnuvaadHub TLS error | `ANUVAAD_VERIFY_TLS=false` |
| AnuvaadHub 401/403 | token copied wrong, or for a different model |
| Telugu shows boxes | fonts load from Google Fonts; needs internet once |
| Head gestures do nothing | turn them on in Settings; face the front camera with light on your face |

## 21. Limitations (be honest with judges)

- Telugu and Hindi sentences in `data/` are drafts and need review by native speakers.
- The synthetic test set uses invented route/destination pairs. Real-photo numbers must be measured separately.
- Gemini models change; the model names in `.env` were checked on 10 Oct 2026. If "Gemini 3.5 Flash" (non-Lite) becomes available to your key, it can be set as the reader.
- Oriel reads what a sign says. It does not know live bus positions, and it does not give turn-by-turn navigation beyond what signs show.
- Pedestrian signal reading is a hint, never a crossing decision.
