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
import { startCamera, stopStream, type Facing } from "../lib/camera";
import { ConditionInference } from "../lib/conditions";
import { HeadGestureTracker, type HeadGesture, type HeadPose } from "../lib/headGestures";
import { motion } from "../lib/motion";
import { isGoodFrame, measure, QUALITY } from "../lib/quality";
import { MicRecorder, type Recording } from "../lib/recorder";
import { faceDetector } from "../lib/vision";
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

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const busyRef = useRef(false);
  const dialogRef = useRef<Dialog | null>(null);
  dialogRef.current = dialog;
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

    if (step.action === "reread" || step.action === "guide") {
      if (step.action === "guide") conditions.current.noteAimFailure();
      setFocusBox(step.focus_box);
      setPhase("scan");
      scanSince.current = performance.now();
      goodSince.current = 0;
      await sayLines(step.action === "reread" ? key : [], res.lang, step.phrase_ids);
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
    try {
      const burst = await getFrames();
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
        if (ev.type === "stage") applyStage(ev);
        else if (ev.type === "result") {
          gotResult = true;
          const res = ev as unknown as ReadResult;
          setPipeline((p) => (p ? { ...p, totalMs: res.timings_ms?.total } : p));
          void handleResult(res);
        } else if (ev.type === "error") {
          throw new ApiError(ev.message ?? "error", ev.code ?? "server_error");
        }
      });
      if (!gotResult) throw new ApiError("no result", "server_error");
    } catch (e) {
      const err = e as ApiError;
      failPipeline(err.message);
      flashError();
      setPhase(resultRef.current ? "result" : "scan");
      scanSince.current = performance.now();
      await sayPhrases([err.code === "offline" ? "network_offline" : "network_slow"]);
      lastGuidanceAt.current = performance.now();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [applyStage, handleResult, sayPhrases]);

  const readNow = useCallback(() => {
    const video = videoRef.current;
    if (!video || phaseRef.current === "start") return;
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
      if (!video || busyRef.current || audio.isSpeaking || dialogRef.current || facing !== S.current.scanCamera) return;
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
      if (q.glare > QUALITY.maxGlare && sinceGuidance > 6000) {
        lastGuidanceAt.current = now;
        void sayPhrases(["glare"]);
        return;
      }
      if (!S.current.autoCapture) return;
      const steady = motion.isSteady();
      if (isGoodFrame(q) && steady !== false && !tilt) {
        goodSince.current ||= now;
        if (now - goodSince.current > 550) {
          goodSince.current = 0;
          readNow();
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
    update({ outLang: lang });
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
      else { flashError(); await sayPhrases([err.code === "offline" ? "network_offline" : "network_slow"]); }
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
      case "yes": return more();
      case "no": return stop();
    }
  }, [again, changeRate, flipCamera, more, newSign, readNow, sayPhrases, setScanCamera, simpler, spell, startAsk, stop]);

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
          else if (dialogRef.current) await sayPhrases(["say_yes_no"]);
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

  const start = useCallback(async () => {
    // Everything that needs a user gesture on iPhone starts in this tap, before any await.
    const motionP = motion.requestPermission();
    const unlockP = audio.unlock();
    await Promise.all([motionP, unlockP]);
    setPhase("scan");
    void faceDetector().then((d) => setFaceBlur(d ? "on" : "off"));
    api.health().then(setHealth).catch(() => setHealth(null));
    await sayPhrases(["ready"]);
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
    facing, pose, lastGesture, faceBlur, speaking, listening, busy, showSettings,
    setShowSettings, start, readNow, readFiles, again, more, spell, simpler, stop, finishListening, newSign, startAsk, askText,
    setOutLang, runCommand, changeRate, flipCamera, setScanCamera,
  };
}

export type Oriel = ReturnType<typeof useOriel>;
