import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { load, save } from "../lib/storage";
import type { Facing } from "../lib/camera";
import { isIOS } from "../lib/platform";
import type { Lang, Mode } from "../types";

export interface Settings {
  inLang: Lang;          // language the user speaks
  outLang: Lang;         // language Oriel answers in (may differ: "speak one, hear another")
  mode: Mode;
  speechRate: number;    // 0.6 - 1.6
  textScale: number;     // 1 - 1.8
  autoCapture: boolean;  // zero-tap capture when the phone is steady and the frame is sharp
  handsFree: boolean;    // listen for voice commands between readings
  headGestures: boolean; // MediaPipe head gestures on the front camera
  simpleWords: boolean;  // "explain simpler" by default
  highContrast: boolean;
  showPipeline: boolean;
  screenReader: boolean; // VoiceOver users: Oriel's own voice only reads signs, captions go to VoiceOver
  englishDigits: boolean;
  scanCamera: Facing;    // which camera reads signs: rear (default) or front (selfie, laptop webcam)
  tapAnywhere: boolean;
  watchMode: boolean;    // optional: also warn about obstacles between readings (off by default: uses quota)
  offersSeen: Partial<Record<Mode, boolean>>;
}

export const DEFAULTS: Settings = {
  inLang: "te",
  outLang: "te",
  mode: "visual",
  speechRate: 1,
  textScale: 1,
  autoCapture: true,
  // iPhone: an always-open microphone sends Oriel's voice to the quiet earpiece, so hands-free starts off there
  handsFree: !isIOS,
  headGestures: false,
  simpleWords: false,
  highContrast: false,
  showPipeline: true,
  screenReader: false,
  englishDigits: false,
  scanCamera: "environment",
  tapAnywhere: true,
  watchMode: false,
  offersSeen: {},
};

/** What changes when a mode is chosen. The user can still change any single setting afterwards. */
export const MODE_PRESETS: Record<Mode, Partial<Settings>> = {
  visual: { autoCapture: true, handsFree: !isIOS, speechRate: 1, textScale: 1, simpleWords: false },
  ageing: { autoCapture: false, handsFree: !isIOS, speechRate: 0.85, textScale: 1.4, simpleWords: true },
  hand_motor: { autoCapture: true, handsFree: !isIOS, speechRate: 1, textScale: 1.2, headGestures: true },
};

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  setMode: (mode: Mode) => void;
}

const SettingsContext = createContext<Ctx | null>(null);
const KEY = "oriel.settings.v1";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => load(KEY, DEFAULTS));

  useEffect(() => save(KEY, settings), [settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--scale", String(settings.textScale));
    root.dataset.contrast = settings.highContrast ? "high" : "normal";
    root.lang = settings.outLang;
  }, [settings.textScale, settings.highContrast, settings.outLang]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const setMode = useCallback((mode: Mode) => setSettings((s) => ({ ...s, ...MODE_PRESETS[mode], mode })), []);

  const value = useMemo(() => ({ settings, update, setMode }), [settings, update, setMode]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
