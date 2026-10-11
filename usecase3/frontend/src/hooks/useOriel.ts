/**
 * The Oriel controller: one place that ties camera, quality gate, reading, speech, voice commands,
 * questions, head gestures and condition inference together.
 *
 * Phases:  start -> scan -> reading -> result -> (asking) -> result / scan
 *   scan     rear camera live; the quality gate gives ONE instruction at a time and auto-captures
 *            when the phone is steady and the frame is sharp (zero taps)
 *   reading  burst of frames -> /api/read (streamed live) -> speak key facts -> guidance / re-read
 *   result   key facts on screen and spoken; again / more / spell / simpler / ask / new sign
 *   asking   question by voice (or text) -> /api/ask (ASR -> MT -> AI -> MT -> TTS, streamed live)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api, ApiError } from "../lib/api";
import { audio, type SpeakItem } from "../lib/audio";
import { captureBurst, captureFiles } from "../lib/capture";
import { canvasToJpeg, grabFrame } from "../lib/camera";
import { blurFaces } from "../lib/vision";
import { startCamera, stopStream, type Facing } from "../lib/camera";
import { ConditionInference } from "../lib/conditions";
import { HeadGestureTracker, type HeadGesture, type HeadPose } from "../lib/headGestures";
import { motion } from "../lib/motion";
import { isGoodFrame, measure, QUALITY } from "../lib/quality";
import { MicRecorder, type Recording } from "../lib/recorder";
import { faceDetector } from "../lib/vision";
import { sleep } from "../lib/platform";
import { matchCommand, phraseText, type Command } from "../i18n/content";
import { useSettings } from "../state/settings";
import type { AskResult, BeaconState, Health, Lang, Line, Mode, Phase, PipelineEvent, ReadResult, Stage } from "../types";

export const READ_STAGES = ["quality", "read", "second_reader", "verify", "guidance", "compose", "tts"];
export const ASK_STAGES = ["asr", "translate_in", "ai", "translate_out", "tts"];

export interface Dialog {
  kind: "confirm" | "offer";
  text: string;
  onYes: () => void;
  onNo: () => void;
}

export interface Pipeline {
  kind: "read" | "ask";
  stages: Stage[];
  startedAt: number;
  totalMs?: number;
  error?: string;
}

const freshStages = (ids: string[]): Stage[] => ids.map((id) => ({ id, status: "pending", notes: [] }));

export function useOriel(videoRef: RefObject<HTMLVideoElement | null>) {
  const { settings, update, setMode } = useSettings();
  const S = useRef(settings);
  S.current = settings;

  const [phase, setPhase] = useState<Phase>("start");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [caption, setCaption] = useState("");
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [focusBox, setFocusBox] = useState<number[] | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [health, setHealth] = useState<Health | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [pose, setPose] = useState<HeadPose | null>(null);
  const [lastGesture, setLastGesture] = useState<HeadGesture | null>(null);
  const [faceBlur, setFaceBlur] = useState<"loading" | "on" | "off">("loading");
  const [errorFlash, setErrorFlash] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const busyRef = useRef(false);
  const dialogRef = useRef<Dialog | null>(null);
  dialogRef.current = dialog;
  // A yes/no question pauses watching and reading, so it must never stay open: it expires after 20 s
  // (as "no" for offers), and any other request replaces it.
  useEffect(() => {
    if (!dialog) return;
    const t = setTimeout(() => {
      if (dialogRef.current !== dialog) return;
      if (dialog.kind === "offer") dialog.onNo();
      else setDialog(null);
    }, 20000);
    return () => clearTimeout(t);
  }, [dialog]);
  const resultRef = useRef<ReadResult | null>(null);
  resultRef.current = result;
  const readsUsed = useRef(0);
  const focusRef = useRef<number[] | null>(null);
  focusRef.current = focusBox;
  const bestFrame = useRef<Blob | null>(null);
  const lastSpoken = useRef<SpeakItem[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recorder = useRef(new MicRecorder());
  const discardRecording = useRef(false);
  const lastGuidanceAt = useRef(0);
  const scanSince = useRef(0);
  const goodSince = useRef(0);
  const askStartedAt = useRef(0);
  const emptyReads = useRef(0);        // reads in a row that found no sign
  const autoPaused = useRef(false);    // zero-tap paused until the user taps or says "read" (saves quota)
  const lastReadEnd = useRef(0);
  const lastGlareTip = useRef(0);
  // talking interrupts: the work in progress is held, then continued (same request) or dropped (new request)
  const readAbort = useRef<AbortController | null>(null);
  const holding = useRef(false);                    // a read that finishes now is kept, not spoken
  const heldResult = useRef<ReadResult | null>(null);
  const paused = useRef<{ items: SpeakItem[]; reading: boolean } | null>(null);
  const watchFailures = useRef(0); // quick looks failing in a row: after 2, automatic reading takes over again
  const conditions = useRef(new ConditionInference(() => S.current.mode, () => S.current.offersSeen));

  // ------------------------------------------------------------------ speech

  useEffect(() => audio.onChange((on, text) => {
    setSpeaking(on);
    if (on && text) setCaption(text);
    if (on && recorder.current.active) {
      discardRecording.current = true; // never transcribe Oriel's own voice
      recorder.current.stop();
    }
  }), []);

  useEffect(() => {
    audio.rate = settings.speechRate;
  }, [settings.speechRate]);

  useEffect(() => audio.onBlocked(setAudioBlocked), []);

  /** "Tap to hear": the phone blocked sound; this tap unlocks it and replays the last lines. */
  const tapToHear = useCallback(() => {
    audio.retryAfterTap();
  }, []);

  useEffect(() => {
    if (!speaking) {
      setLevel(0);
      return;
    }
    const id = setInterval(() => setLevel(0.35 + Math.random() * 0.65), 110);
    return () => clearInterval(id);
  }, [speaking]);

  const say = useCallback(async (items: SpeakItem[], opts: { essential?: boolean; interrupt?: boolean } = {}) => {
    // Screen-reader mode: VoiceOver announces captions, Oriel only voices the sign content itself.
    audio.muted = S.current.screenReader && !opts.essential;
    if (!opts.essential) setCaption(items.map((i) => i.text).join(" "));
    await audio.say(items, opts.interrupt ?? true);
  }, []);

  const phraseItem = (id: string): SpeakItem => ({ clipId: id, text: phraseText(id, S.current.outLang), lang: S.current.outLang });
  const sayPhrases = useCallback((ids: string[], interrupt = true) => say(ids.map(phraseItem), { interrupt }), [say]);

  const linesToItems = (lines: Line[], lang: Lang): SpeakItem[] =>
    lines.filter((l) => l.text).map((l) => ({ text: l.text, lang: l.lang_fallback ?? lang, audioUrl: l.audio_url }));

  const sayLines = useCallback(async (lines: Line[], lang: Lang, tail: string[] = []) => {
    const items = [...linesToItems(lines, lang), ...tail.map(phraseItem)];
    lastSpoken.current = items;
    setCaption(lines.map((l) => l.text).join(" "));
    await say(items, { essential: true });
  }, [say]);

  // ------------------------------------------------------------------ camera

  useEffect(() => {
    if (phase === "start") return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    stopStream(streamRef.current);
    startCamera(video, facing)
      .then((stream) => {
        if (cancelled) return stopStream(stream);
        streamRef.current = stream;
        setCameraError(null);
      })
      .catch((e: Error) => {
        setCameraError(e.name === "NotAllowedError" ? "denied" : e.message);
        void sayPhrases(["camera_blocked"]);
      });
    return () => {
      cancelled = true;
    };
  }, [facing, phase === "start"]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopStream(streamRef.current), []);

  // Head gestures need the FRONT camera; iPhones stream one camera at a time, so we only switch to
  // it while a result or a yes/no question is on screen. Laptops simply use their webcam.
  // The reading camera is the user's choice (settings.scanCamera); with the front camera chosen, gestures
  // and reading share one stream and nothing switches.
  const wantsFront = settings.headGestures && (phase === "result" || dialog !== null);
  const scanCamera = settings.scanCamera;
  useEffect(() => {
    if (phase === "start") return;
    setFacing(wantsFront ? "user" : scanCamera);
  }, [wantsFront, phase, scanCamera]);

  // ------------------------------------------------------------------ voice-first start

  const [onboardStep, setOnboardStep] = useState<"idle" | "language" | "mode">("idle");
  const onboarding = useRef(false);
  const taps = useRef<{ count: number; last: number }>({ count: 0, last: 0 });

  /** A tap during the opening conversation: counts as an answer (1, 2 or 3 taps) and cuts the prompt short. */
  const onboardTap = useCallback(() => {
    taps.current = { count: taps.current.count + 1, last: performance.now() };
    audio.stop();
    recorder.current.stop();
  }, []);

  /**
   * Wait for an answer: taps (1, 2 or 3) or speech. Speech is transcribed in each of `langs` and matched against
   * keywords, so "Telugu", "తెలుగు" or "तेलुगु" all work before Oriel knows which language the user speaks.
   */
  const hearChoice = useCallback(async <K extends string>(langs: Lang[], options: Record<K, string[]>,
    byTaps: K[]): Promise<K | null> => {
    const settle = async () => { // let a burst of taps finish (1.2 s after the last one)
      while (performance.now() - taps.current.last < 1200) await sleep(150);
      return byTaps[Math.min(taps.current.count, byTaps.length) - 1] ?? null;
    };
    if (taps.current.count) return settle();
    let rec: Recording | null = null;
    setListening(true);
    try {
      rec = await recorder.current.record({ maxMs: 7000, silenceMs: 1100, noSpeechMs: 6000 });
    } catch {
      rec = null;
    }
    setListening(false);
    if (taps.current.count) return settle();
    if (!rec?.hadSpeech) return null;
    const heard = (await Promise.all(langs.map((l) => api.asr(rec!.wav, l).then((r) => r.text).catch(() => ""))))
      .join(" ").toLowerCase();
    for (const key of Object.keys(options) as K[]) {
      if (options[key].some((w) => heard.includes(w))) return key;
    }
    return null;
  }, []);

  const LANG_WORDS: Record<Lang, string[]> = {
    te: ["telugu", "telegu", "తెలుగు", "तेलुगु", "తెలుగ"],
    hi: ["hindi", "हिंदी", "हिन्दी", "హిందీ", "హింది"],
    en: ["english", "इंग्लिश", "अंग्रेज़ी", "अंग्रेजी", "ఇంగ్లీష్", "ఇంగ్లిష్", "ఆంగ్లం"],
  };
  const MODE_WORDS: Record<Mode, string[]> = {
    hand_motor: ["hand", "shake", "shaking", "tremor", "finger", "हाथ", "काँप", "कांप", "చేతులు", "చేయి", "చెయ్యి", "వణుకు"],
    ageing: ["old", "older", "elder", "senior", "age", "बुज़ुर्ग", "बुजुर्ग", "बूढ़", "बुढ़", "उम्र", "వృద్ధ", "వయసు", "ముసలి", "పెద్దవ"],
    visual: ["see", "sight", "blind", "vision", "eye", "देख", "दिख", "आँख", "आंख", "अंध", "కనిపించ", "చూపు", "కళ్ళు", "కన్ను", "గుడ్డి"],
  };

  /**
   * The first tap on the start screen begins a spoken setup: language (asked in Telugu, Hindi and English),
   * then what help is needed, each answered by voice or by tapping 1, 2 or 3 times. Then Oriel starts.
   * Browsers allow no sound before the first touch, so this tap is also what unlocks audio.
   */
  const onboard = useCallback(async () => {
    if (onboarding.current) return onboardTap();
    onboarding.current = true;
    const unlockP = audio.unlock();           // inside the tap: iPhone audio and the phone voice
    const motionP = motion.requestPermission();
    await Promise.all([unlockP, motionP]);
    const ALL: Lang[] = ["te", "hi", "en"];
    const item = (id: string, l: Lang): SpeakItem => ({ clipId: id, text: phraseText(id, l), lang: l });

    setOnboardStep("language");
    let lang: Lang | null = null;
    for (let attempt = 0; attempt < 2 && !lang; attempt++) {
      taps.current = { count: 0, last: 0 };
      if (attempt) await audio.say(ALL.map((l) => item("onboard_retry", l)));
      if (!taps.current.count) await audio.say(ALL.map((l) => item("choose_language", l)));
      lang = await hearChoice<Lang>(ALL, LANG_WORDS, ["te", "hi", "en"]);
    }
    lang = lang ?? S.current.outLang;
    update({ inLang: lang, outLang: lang });
    await audio.say([item("language_chosen", lang)]);

    setOnboardStep("mode");
    let mode: Mode | null = null;
    for (let attempt = 0; attempt < 2 && !mode; attempt++) {
      taps.current = { count: 0, last: 0 };
      if (attempt) await audio.say([item("onboard_retry", lang)]);
      if (!taps.current.count) await audio.say([item("choose_mode", lang)]);
      mode = await hearChoice<Mode>(lang === "en" ? ["en"] : [lang, "en"], MODE_WORDS, ["visual", "ageing", "hand_motor"]);
    }
    mode = mode ?? "visual";
    setMode(mode);
    await audio.say([item(`mode_set_${mode}`, lang)]);
    setOnboardStep("idle");
    onboarding.current = false;
    await start(true);
  }, [hearChoice, onboardTap, setMode, update]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A sighted helper skips the spoken setup (the language and mode buttons are already chosen). */
  const skipOnboarding = useCallback(() => {
    onboarding.current = false;
    audio.stop();
    recorder.current.stop();
    setOnboardStep("idle");
    void start(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ pipeline events

  const applyStage = useCallback((ev: PipelineEvent) => {
    setPipeline((p) => {
      if (!p || !ev.stage) return p;
      const stages = p.stages.map((s) => {
        if (s.id !== ev.stage) return s;
        const notes = [...s.notes];
        const d = ev.detail ?? {};
        if (ev.status === "progress") {
          notes.push(d.error ? `frame ${Number(d.frame) + 1}: failed` : `frame ${Number(d.frame) + 1}: ${String(d.summary ?? "")}`);
        }
        return { ...s, status: ev.status === "progress" ? "running" : (ev.status ?? s.status), ms: ev.ms ?? s.ms,
          detail: { ...s.detail, ...d }, notes };
      });
      return { ...p, stages };
    });
  }, []);

  const failPipeline = (message: string) =>
    setPipeline((p) => (p ? { ...p, error: message, stages: p.stages.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)) } : p));

  const flashError = () => {
    setErrorFlash(true);
    setTimeout(() => setErrorFlash(false), 2500);
  };

  // ------------------------------------------------------------------ reading

  const offerIfNeeded = useCallback(() => {
    const mode = conditions.current.suggestion();
    if (!mode) return;
    const phrase = { visual: "offer_visual", ageing: "offer_ageing", hand_motor: "offer_hand_motor" }[mode];
    const close = (accept: boolean) => {
      setDialog(null);
      update({ offersSeen: { ...S.current.offersSeen, [mode]: true } });
      if (accept) setMode(mode as Mode);
      void sayPhrases([accept ? "mode_on" : "mode_kept"]);
    };
    setDialog({ kind: "offer", text: phraseText(phrase, S.current.outLang), onYes: () => close(true), onNo: () => close(false) });
    void sayPhrases([phrase]);
  }, [sayPhrases, setMode, update]);

  const handleResult = useCallback(async (res: ReadResult) => {
    setResult(res);
    readsUsed.current = res.reads_used;
    const step = res.next_step;
    const key = res.speech.key;
    const anyConfirmed = key.some((l) => l.status === "confirmed");

    emptyReads.current = res.verified.sign_found ? 0 : emptyReads.current + 1;
    if (step.action === "guide" && emptyReads.current >= 2) {
      // two empty reads in a row: stop auto-reading until the user is ready (every read costs quota and time)
      autoPaused.current = true;
      setFocusBox(null);
      setPhase("scan");
      await sayLines(key, res.lang, ["auto_paused"]); // hazards and what is there, then how to go on
      lastGuidanceAt.current = performance.now();
      return;
    }
    if (step.action === "reread" || step.action === "guide") {
      if (step.action === "guide") conditions.current.noteAimFailure();
      setFocusBox(step.focus_box);
      setPhase("scan");
      scanSince.current = performance.now();
      goodSince.current = 0;
      // reread: what was read so far; no sign: hazards and what is there; then how to move the phone
      await sayLines(step.action === "reread" || !res.verified.sign_found ? key : [], res.lang, step.phrase_ids);
      lastGuidanceAt.current = performance.now();
      return;
    }
    readsUsed.current = 0;
    setFocusBox(null);
    setPhase(key.length ? "result" : "scan");
    const tail = [...step.phrase_ids];
    if (step.action === "done" && res.speech.more.length) tail.push("say_more");
    if (step.action === "done" && S.current.mode === "ageing") tail.push("did_that_help");
    await sayLines(key, res.lang, tail);
    if (!anyConfirmed) conditions.current.noteAimFailure();
    offerIfNeeded();
  }, [offerIfNeeded, sayLines]);

  const runRead = useCallback(async (getFrames: () => Promise<{ frames: Blob[]; best: Blob | null; facesHidden: number }>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPhase("reading");
    audio.stop();
    void sayPhrases(["hold_still"]);
    setPipeline({ kind: "read", stages: freshStages(READ_STAGES), startedAt: performance.now() });
    const ctrl = new AbortController();
    readAbort.current = ctrl;
    try {
      const burst = await getFrames();
      if (ctrl.signal.aborted) throw new ApiError("cancelled", "cancelled");
      if (!burst.frames.length) throw new ApiError("no frames", "no_frames");
      bestFrame.current = burst.best;
      setFaceBlur(burst.facesHidden < 0 ? "off" : "on");
      let gotResult = false;
      await api.read(burst.frames, {
        lang: S.current.outLang,
        mode: S.current.simpleWords ? "simple" : "standard",
        readsUsed: readsUsed.current,
        device: { tilt: S.current.scanCamera === "environment" ? motion.tiltAdvice() : null },
        digitStyle: S.current.englishDigits ? "english" : "native",
      }, (ev) => {
        if (ctrl.signal.aborted) return;
        if (ev.type === "stage") applyStage(ev);
        else if (ev.type === "result") {
          gotResult = true;
          const res = ev as unknown as ReadResult;
          setPipeline((p) => (p ? { ...p, totalMs: res.timings_ms?.total } : p));
          if (holding.current) heldResult.current = res; // the user is talking: decide after they finish
          else void handleResult(res);
        } else if (ev.type === "error") {
          throw new ApiError(ev.message ?? "error", ev.code ?? "server_error");
        }
      }, ctrl.signal);
      if (!gotResult) throw new ApiError("no result", "server_error");
    } catch (e) {
      const err = e as ApiError;
      if (ctrl.signal.aborted) {  // dropped on purpose: the user asked for something else
        failPipeline("cancelled");
        return;
      }
      if (holding.current) {      // never talk over the user
        failPipeline(err.message);
        setPhase(resultRef.current ? "result" : "scan");
        return;
      }
      failPipeline(err.message);
      flashError();
      setPhase(resultRef.current ? "result" : "scan");
      scanSince.current = performance.now();
      const phrase = err.code === "offline" ? "network_offline"
        : err.code === "timeout" || err.code === "network" ? "network_slow" : "service_busy";
      await sayPhrases([phrase]);
      lastGuidanceAt.current = performance.now();
    } finally {
      if (readAbort.current === ctrl) readAbort.current = null;
      busyRef.current = false;
      lastReadEnd.current = performance.now();
      setBusy(false);
    }
  }, [applyStage, handleResult, sayPhrases]);

  const readNow = useCallback((auto = false) => {
    const video = videoRef.current;
    if (!video || phaseRef.current === "start") return;
    if (!auto) {
      autoPaused.current = false;
      emptyReads.current = 0;
    }
    if (phaseRef.current === "result" && facing !== S.current.scanCamera) {
      // coming from gesture mode: back to the reading camera first
      setFacing(S.current.scanCamera);
      setPhase("scan");
      return;
    }
    void runRead(() => captureBurst(video, focusRef.current));
  }, [runRead, facing, videoRef]);

  const readFiles = useCallback((files: File[]) => {
    readsUsed.current = 0;
    setFocusBox(null);
    void runRead(() => captureFiles(files));
  }, [runRead]);

  // ------------------------------------------------------------------ quality gate + zero-tap capture

  useEffect(() => {
    if (phase !== "scan") return;
    scanSince.current = performance.now();
    let jitterAt = 0;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || busyRef.current || audio.isSpeaking || dialogRef.current || facing !== S.current.scanCamera
        || recorder.current.active || holding.current) return;
      const now = performance.now();
      if (now - jitterAt > 5000) {
        conditions.current.noteJitter(motion.jitter());
        jitterAt = now;
      }
      const q = measure(video, video.videoWidth, video.videoHeight);
      if (!q) return;
      const sinceGuidance = now - lastGuidanceAt.current;
      const tilt = facing === "environment" ? motion.tiltAdvice() : null; // phone angle means nothing for the selfie camera
      if (tilt && sinceGuidance > 3500) {
        lastGuidanceAt.current = now;
        conditions.current.noteAimFailure();
        void sayPhrases([tilt === "up" ? "tilt_up" : "tilt_down"]);
        return;
      }
      if (q.brightness < QUALITY.minBrightness && sinceGuidance > 6000) {
        lastGuidanceAt.current = now;
        void sayPhrases(["too_dark"]);
        return;
      }
      if (q.glare > QUALITY.maxGlare && sinceGuidance > 8000 && now - lastGlareTip.current > 30000) {
        lastGuidanceAt.current = now;
        lastGlareTip.current = now; // at most every 30 s: in sunshine it would otherwise repeat
        void sayPhrases(["glare"]); // advice only: the read below still goes ahead when the frame is usable
      }
      if (!S.current.autoCapture || autoPaused.current || now - lastReadEnd.current < 2500) return;
      const steady = motion.isSteady();
      if (isGoodFrame(q) && steady !== false && !tilt) {
        goodSince.current ||= now;
        if (now - goodSince.current > 550) {
          goodSince.current = 0;
          readNow(true);
        }
      } else {
        goodSince.current = 0;
        if (steady === false && sinceGuidance > 5000 && now - scanSince.current > 3000) {
          lastGuidanceAt.current = now;
          void sayPhrases(["hold_still"]);
        }
      }
      if (now - scanSince.current > 14000 && sinceGuidance > 9000) {
        lastGuidanceAt.current = now;
        conditions.current.noteAimFailure();
        void sayPhrases(["no_sign_try"]);
        offerIfNeeded();
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, facing, readNow, sayPhrases, offerIfNeeded, videoRef]);

  // ------------------------------------------------------------------ continuous watch

  /**
   * Keep watching while the person walks: about every 4 s (only when the view changed and the phone is steady),
   * one quick look. New hazards are spoken at once ("Careful, there may be ..."); a new sign that is big enough
   * starts the full verified read, so what a sign says is still only ever spoken after verification.
   * Never while the user talks, Oriel speaks, or a read is running.
   */
  useEffect(() => {
    if (!settings.watchMode || phase === "start") return;
    let cancelled = false;
    const hazards: { text: string; at: number }[] = [];
    const signs: { key: string; at: number }[] = [];
    let lastLook = 0;
    let lastThumb: Uint8ClampedArray | null = null;
    const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9\u0900-\u0c7f]+/).filter(Boolean));
    const sameSign = (a: string, b: string) => {
      const x = words(a), y = words(b);
      const common = [...x].filter((w) => y.has(w)).length;
      return common / Math.max(1, Math.min(x.size, y.size)) >= 0.5;
    };
    const thumb = (video: HTMLVideoElement) => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 24;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return null;
      g.drawImage(video, 0, 0, 32, 24);
      return g.getImageData(0, 0, 32, 24).data;
    };
    const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let d = 0;
      for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]);
      return d / (a.length / 2) > 10; // mean change per channel: the person moved or turned
    };
    const loop = async () => {
      while (!cancelled) {
        await sleep(800);
        const video = videoRef.current;
        const now = performance.now();
        if (!video?.videoWidth || now - lastLook < 4000) continue;
        if (busyRef.current || recorder.current.active || holding.current || dialogRef.current || audio.isSpeaking) continue;
        if (phaseRef.current !== "scan" && phaseRef.current !== "result") continue;
        if (motion.isSteady() === false) continue;
        const th = thumb(video);
        if (th && lastThumb && !changed(th, lastThumb) && now - lastLook < 20000) continue; // same view: save a call
        lastLook = now;
        lastThumb = th;
        const canvas = grabFrame(video, 896);
        if (!canvas) continue;
        await blurFaces(canvas);
        const recent = hazards.filter((h) => now - h.at < 30000).map((h) => h.text);
        let w;
        try {
          w = await api.watch(await canvasToJpeg(canvas, 0.8), S.current.outLang, recent,
            S.current.simpleWords ? "simple" : "standard");
        } catch {
          watchFailures.current += 1; // quiet; after 2 failures automatic reading takes over until a look works
          continue;
        }
        watchFailures.current = 0;
        if (cancelled) return;
        hazards.push(...w.hazards.map((text) => ({ text, at: now })));
        if (busyRef.current || recorder.current.active || holding.current) continue; // the user took over meanwhile
        if (w.lines.length) await sayLines(w.lines, S.current.outLang);
        const [y0, x0, y1, x1] = w.sign_box.length === 4 ? w.sign_box : [0, 0, 0, 0];
        const bigEnough = ((y1 - y0) * (x1 - x0)) / 1_000_000 >= 0.01; // smaller: the full read guides "closer"
        const fresh = !signs.some((s) => now - s.at < 90000 && sameSign(s.key, w.sign_key));
        if (w.sign_visible && bigEnough && fresh && !cancelled && !busyRef.current && !holding.current) {
          signs.push({ key: w.sign_key, at: now });
          if (phaseRef.current === "result") {
            readsUsed.current = 0;
            setFocusBox(null);
            setPhase("scan");
          }
          readNow();
        }
      }
    };
    void loop();
    return () => {
      cancelled = true;
    };
  }, [settings.watchMode, phase === "start", readNow, sayLines, videoRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ result actions

  const again = useCallback(() => {
    conditions.current.noteAgain();
    if (lastSpoken.current.length) void say(lastSpoken.current, { essential: true });
  }, [say]);

  const more = useCallback(() => {
    const r = resultRef.current;
    if (!r) return;
    if (!r.speech.more.length) return void sayPhrases(["nothing_more"]);
    void sayLines(r.speech.more, r.lang);
  }, [sayLines, sayPhrases]);

  const spell = useCallback(() => {
    const r = resultRef.current;
    if (r?.speech.spell.length) void sayLines(r.speech.spell, r.lang);
  }, [sayLines]);

  const recompose = useCallback(async (lang: Lang, mode: "standard" | "simple") => {
    const r = resultRef.current;
    if (!r) return;
    try {
      const out = await api.compose(r.verified, lang, mode, S.current.englishDigits ? "english" : "native");
      const next = { ...r, verified: out.verified, speech: out.speech, lang };
      setResult(next);
      await sayLines(out.speech.key, lang);
    } catch {
      await sayPhrases(["network_slow"]);
    }
  }, [sayLines, sayPhrases]);

  const simpler = useCallback(() => void recompose(S.current.outLang, "simple"), [recompose]);

  const setOutLang = useCallback((lang: Lang) => {
    update({ outLang: lang, inLang: lang }); // speak and listen in the same language (no surprise switches)
    if (resultRef.current) void recompose(lang, S.current.simpleWords ? "simple" : "standard");
  }, [recompose, update]);

  const stop = useCallback(() => {
    audio.stop();
    discardRecording.current = true;
    recorder.current.stop();
  }, []);

  /** Finish the current recording now and SEND it (the "Done" button). */
  const finishListening = useCallback(() => {
    recorder.current.stop();
  }, []);

  const newSign = useCallback(() => {
    audio.stop();
    readsUsed.current = 0;
    autoPaused.current = false;
    emptyReads.current = 0;
    setFocusBox(null);
    setResult(null);
    setAskResult(null);
    setFacing(S.current.scanCamera);
    setPhase("scan");
  }, []);

  /** Choose the camera that reads signs. A zoom box from one camera means nothing on the other, so start fresh. */
  const setScanCamera = useCallback((to: Facing) => {
    audio.stop();
    readsUsed.current = 0;
    setFocusBox(null);
    update({ scanCamera: to });
    if (phaseRef.current === "result") {
      setResult(null);
      setAskResult(null);
      setPhase("scan");
    }
    scanSince.current = performance.now();
    lastGuidanceAt.current = performance.now();
    void sayPhrases([to === "user" ? "camera_front" : "camera_back"]);
  }, [update, sayPhrases]);

  const flipCamera = useCallback(() => {
    setScanCamera(S.current.scanCamera === "user" ? "environment" : "user");
  }, [setScanCamera]);

  const changeRate = useCallback((delta: number) => {
    const rate = Math.max(0.6, Math.min(1.6, Math.round((S.current.speechRate + delta) * 100) / 100));
    update({ speechRate: rate });
    audio.rate = rate;
    again();
  }, [again, update]);

  // ------------------------------------------------------------------ asking (speech-to-speech)

  const askQuestion = useCallback(async (q: { audio?: Blob; text?: string; confirmed?: boolean; asrText?: string }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPhase("asking");
    setPipeline({ kind: "ask", stages: freshStages(ASK_STAGES), startedAt: performance.now() });
    if (q.asrText) applyStage({ type: "stage", stage: "asr", status: "done", detail: { text: q.asrText } });
    let res: AskResult | null = null;
    try {
      await api.ask({
        audio: q.audio, text: q.text, inLang: S.current.inLang, outLang: S.current.outLang,
        context: resultRef.current?.verified ?? null, frame: bestFrame.current, confirmed: q.confirmed,
      }, (ev) => {
        if (ev.type === "stage") applyStage(ev);
        else if (ev.type === "result") res = ev as unknown as AskResult;
        else if (ev.type === "error") throw new ApiError(ev.message ?? "error", ev.code ?? "server_error");
      });
      if (!res) throw new ApiError("no answer", "server_error");
      const answer: AskResult = res;
      setAskResult(answer);
      setPipeline((p) => (p ? { ...p, totalMs: performance.now() - p.startedAt } : p));
      const item: SpeakItem = { text: answer.answer, lang: answer.answer_lang, audioUrl: answer.audio_url };
      lastSpoken.current = [item];
      setPhase(resultRef.current ? "result" : "scan");
      await say([item], { essential: true });
      if (answer.needs_confirmation) {
        setDialog({
          kind: "confirm", text: answer.answer,
          onYes: () => { setDialog(null); void askQuestion({ text: answer.question, confirmed: true }); },
          onNo: () => { setDialog(null); void startAsk(); },
        });
      }
    } catch (e) {
      const err = e as ApiError;
      failPipeline(err.message);
      setPhase(resultRef.current ? "result" : "scan");
      if (err.code === "no_speech") await sayPhrases(["didnt_catch"]);
      else if (err.code === "asr_unavailable") { setCaption(err.message); flashError(); }
      else {
        flashError();
        await sayPhrases([err.code === "offline" ? "network_offline"
          : err.code === "timeout" || err.code === "network" ? "network_slow" : "service_busy"]);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [applyStage, say, sayPhrases]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAsk = useCallback(async () => {
    if (busyRef.current || recorder.current.active) return;
    audio.stop();
    setPhase("asking");
    await sayPhrases(["ask_prompt"]);
    askStartedAt.current = performance.now();
    setListening(true);
    discardRecording.current = false;
    try {
      const rec = await recorder.current.record({
        maxMs: 15000, silenceMs: S.current.mode === "ageing" ? 1600 : 1100, noSpeechMs: S.current.mode === "ageing" ? 12000 : 8000,
      });
      setListening(false);
      if (discardRecording.current) return setPhase(resultRef.current ? "result" : "scan");
      if (!rec.hadSpeech) {
        setPhase(resultRef.current ? "result" : "scan");
        return void sayPhrases(["didnt_catch"]);
      }
      conditions.current.noteReplyDelay(rec.durationMs);
      await askQuestion({ audio: rec.wav });
    } catch {
      setListening(false);
      setPhase(resultRef.current ? "result" : "scan");
      await sayPhrases(["mic_blocked"]);
    }
  }, [askQuestion, sayPhrases]);

  const askText = useCallback((text: string) => {
    if (text.trim()) void askQuestion({ text: text.trim() });
  }, [askQuestion]);

  // ------------------------------------------------------------------ commands (voice, keys, gestures)

  const runCommand = useCallback((cmd: Command) => {
    const d = dialogRef.current;
    if (d && (cmd === "yes" || cmd === "no")) return cmd === "yes" ? d.onYes() : d.onNo();
    switch (cmd) {
      case "read": return phaseRef.current === "result" ? (newSign(), undefined) : readNow();
      case "more": return more();
      case "again": return again();
      case "spell": return spell();
      case "slower": return changeRate(-0.15);
      case "faster": return changeRate(0.15);
      case "simpler": return simpler();
      case "stop": return stop();
      case "settings": return setShowSettings(true);
      case "help": return void sayPhrases(["ask_someone"]);
      case "ask": return void startAsk();
      case "camera": return flipCamera();
      case "front_camera": return setScanCamera("user");
      case "back_camera": return setScanCamera("environment");
      case "continue": return again();
      case "yes": return more();
      case "no": return stop();
    }
  }, [again, changeRate, flipCamera, more, newSign, readNow, sayPhrases, setScanCamera, simpler, spell, startAsk, stop]);

  // ------------------------------------------------------------------ tap anywhere to talk

  /** Carry on with what was going on before the user spoke. */
  const resumeHeld = useCallback(() => {
    const p = paused.current;
    paused.current = null;
    holding.current = false;
    const held = heldResult.current;
    heldResult.current = null;
    if (held) return void handleResult(held);       // the read finished while they talked: say it now
    if (p?.reading && busyRef.current) return;      // still reading: it will speak when it finishes
    if (p?.items.length) void say(p.items, { essential: true });
  }, [handleResult, say]);

  /** Drop what was going on: the user asked for something else. */
  const dropHeld = useCallback(async () => {
    paused.current = null;
    holding.current = false;
    heldResult.current = null;
    readAbort.current?.abort();
    for (let i = 0; busyRef.current && i < 60; i++) await sleep(50); // let the cancelled read finish
  }, []);

  /**
   * The whole screen is the talk button. First tap: Oriel goes quiet and holds its work, then listens.
   * Second tap (or a pause in speech): sends. The same request (or "continue") resumes the held work;
   * anything else drops it and is done instead: a command, or a question about the sign.
   */
  const talk = useCallback(async () => {
    if (phaseRef.current === "start") return;
    if (recorder.current.active) {  // second tap: finished speaking
      recorder.current.stop();
      return;
    }
    const wasReading = busyRef.current && phaseRef.current === "reading";
    if (busyRef.current && !wasReading) return; // an answer is being prepared: wait for it
    paused.current = { items: audio.pause(), reading: wasReading };
    holding.current = true;
    discardRecording.current = false;
    await sayPhrases(["listening"]);
    setListening(true);
    let rec: Recording;
    try {
      rec = await recorder.current.record({
        maxMs: 15000, silenceMs: S.current.mode === "ageing" ? 1600 : 1100,
        noSpeechMs: S.current.mode === "ageing" ? 10000 : 7000,
      });
    } catch {
      setListening(false);
      resumeHeld();
      return void sayPhrases(["mic_blocked"]);
    }
    setListening(false);
    if (discardRecording.current || !rec.hadSpeech || rec.durationMs < 300) return resumeHeld(); // nothing said
    let text = "";
    try {
      text = (await api.asr(rec.wav, S.current.inLang)).text.trim();
    } catch (e) {
      resumeHeld();
      return void sayPhrases([(e as ApiError).code === "offline" ? "network_offline" : "service_busy"]);
    }
    if (!text) {
      await sayPhrases(["didnt_catch"]);
      return resumeHeld();
    }
    setCaption(`“${text}”`);
    const cmd = matchCommand(text, S.current.inLang);
    const p = paused.current;
    const same = cmd === "continue" || (cmd === "read" && !!p?.reading) || (cmd === "again" && !!p?.items.length);
    if (same) return resumeHeld();
    await dropHeld();
    if (dialogRef.current && cmd !== "yes" && cmd !== "no") setDialog(null); // a new request replaces the question
    if (cmd) runCommand(cmd);
    else await askQuestion({ text, asrText: text });
  }, [askQuestion, dropHeld, resumeHeld, runCommand, sayPhrases]);

  const onGesture = useCallback((g: HeadGesture) => {
    setLastGesture(g);
    setTimeout(() => setLastGesture(null), 1500);
    const map: Record<HeadGesture, Command> = { nod: "yes", shake: "no", tilt_right: "again", tilt_left: "read" };
    runCommand(map[g]);
  }, [runCommand]);

  // Hands-free listening between readings: one utterance at a time, never while Oriel speaks.
  useEffect(() => {
    if (!settings.handsFree || phase === "start" || phase === "reading" || phase === "asking") return;
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        if (busyRef.current || audio.isSpeaking || recorder.current.active) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        discardRecording.current = false;
        setListening(true);
        let rec: Recording;
        try {
          rec = await recorder.current.record({ maxMs: 8000, silenceMs: S.current.mode === "ageing" ? 1500 : 900, noSpeechMs: 6000 });
        } catch {
          setListening(false);
          update({ handsFree: false });
          void sayPhrases(["mic_blocked"]);
          return;
        }
        setListening(false);
        if (cancelled || discardRecording.current || !rec.hadSpeech || rec.durationMs < 400) continue;
        try {
          const { text } = await api.asr(rec.wav, S.current.inLang);
          if (cancelled) return;
          if (!text.trim()) {
            await sayPhrases(["didnt_catch"]);
            continue;
          }
          setCaption(`“${text}”`);
          const cmd = matchCommand(text, S.current.inLang);
          if (cmd) runCommand(cmd);
          else if (dialogRef.current) { setDialog(null); await askQuestion({ text, asrText: text }); }
          else await askQuestion({ text, asrText: text });
        } catch (e) {
          if ((e as ApiError).code === "asr_unavailable") {
            update({ handsFree: false });
            setCaption((e as ApiError).message);
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    };
    void loop();
    return () => {
      cancelled = true;
      discardRecording.current = true;
      recorder.current.stop();
      setListening(false);
    };
  }, [settings.handsFree, phase, askQuestion, runCommand, sayPhrases, update]);

  // Head gestures on the front camera
  useEffect(() => {
    if (!settings.headGestures || facing !== "user" || phase === "start") return;
    const video = videoRef.current;
    if (!video) return;
    const tracker = new HeadGestureTracker(onGesture, setPose);
    const t = setTimeout(() => {
      void tracker.start(video).then((ok) => {
        if (!ok) setCaption("Head gestures need an internet connection the first time.");
      });
    }, 600); // let the camera settle after switching
    return () => {
      clearTimeout(t);
      tracker.stop();
      setPose(null);
    };
  }, [settings.headGestures, facing, phase, onGesture, videoRef]);

  // ------------------------------------------------------------------ start, network, health

  const start = useCallback(async (unlocked = false) => {
    // Everything that needs a user gesture on iPhone starts in this tap, before any await
    // (or already happened in the first tap of the spoken setup).
    if (!unlocked) {
      const unlockP = audio.unlock();
      const motionP = motion.requestPermission();
      await Promise.all([motionP, unlockP]);
    }
    setPhase("scan");
    void faceDetector().then((d) => setFaceBlur(d ? "on" : "off"));
    api.health().then(setHealth).catch(() => setHealth(null));
    await sayPhrases(["ready", ...(S.current.tapAnywhere ? ["tap_to_speak"] : []), ...(S.current.watchMode ? ["watch_on"] : [])]);
    if (S.current.headGestures) void sayPhrases(["gestures_on"], false);
  }, [sayPhrases]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => {
      setOnline(false);
      void sayPhrases(["network_offline"]);
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [sayPhrases]);

  const beacon: BeaconState = useMemo(() => {
    if (errorFlash) return "error";
    if (speaking) return "speaking";
    if (busy) return "thinking";
    if (listening) return "listening";
    if (phase === "result" && result) {
      return result.speech.key.some((l) => l.status === "confirmed") ? "success" : "uncertain";
    }
    return "idle";
  }, [errorFlash, speaking, busy, listening, phase, result]);

  return {
    phase, beacon, level, caption, pipeline, result, askResult, dialog, focusBox, cameraError, online, health,
    facing, pose, lastGesture, faceBlur, speaking, listening, busy, showSettings, audioBlocked, tapToHear,
    setShowSettings, start, readNow, readFiles, again, more, spell, simpler, stop, finishListening, newSign, startAsk, askText,
    setOutLang, runCommand, changeRate, flipCamera, setScanCamera, talk,
    onboard, onboardTap, onboardStep, skipOnboarding,
  };
}

export type Oriel = ReturnType<typeof useOriel>;
