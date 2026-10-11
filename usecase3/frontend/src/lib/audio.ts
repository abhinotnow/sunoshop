/**
 * One audio engine for everything Oriel says.
 *
 * iPhone rules this respects:
 *  - Audio may only start after a user gesture: unlock() plays a silent clip inside the Start tap,
 *    and the SAME <audio> element is reused afterwards (iOS unlocks per element).
 *  - Speech speed uses playbackRate with preservesPitch, so slower speech does not sound deep.
 * Order of sources for every line: server audio (AnuvaadHub TTS) -> /api/speak -> the phone's own
 * voice (speechSynthesis) -> caption only. Nothing is ever silently skipped.
 */
import { api } from "./api";
import { LANG_NAMES } from "../i18n/ui";
import type { Lang } from "../types";

/** 0.2 s of real silence. (A WAV with zero samples is rejected by Safari, which left the element locked.) */
function silentWavUrl(): string {
  const samples = 1600; // 8 kHz mono 16-bit
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data");
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

/** iOS 17+: "playback" sends sound to the loudspeaker; "play-and-record" (while the mic is open) uses the
 *  quiet earpiece. Oriel switches to play-and-record only while recording. */
export function setAudioSession(type: "playback" | "play-and-record"): void {
  try {
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) nav.audioSession.type = type;
  } catch {
    /* not supported */
  }
}

export interface SpeakItem {
  text: string;
  lang: Lang;
  audioUrl?: string | null;
  clipId?: string; // pre-recorded guidance clip
}

type Listener = (speaking: boolean, text: string) => void;

class AudioEngine {
  private el: HTMLAudioElement;
  private queue: SpeakItem[] = [];
  private playing = false;
  private generation = 0;
  private listeners = new Set<Listener>();
  private clipManifest: Record<string, Partial<Record<Lang, string>>> = {};
  private silent = "";
  private lastItems: SpeakItem[] = [];
  /** true when the phone refused to play sound without a new tap (the UI then shows "Tap to hear") */
  blocked = false;
  private blockedListeners = new Set<(b: boolean) => void>();
  rate = 1;
  muted = false; // screen-reader mode: captions only

  constructor() {
    this.el = new Audio();
    this.el.preload = "auto";
    (this.el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  }

  onBlocked(fn: (b: boolean) => void): () => void {
    this.blockedListeners.add(fn);
    return () => this.blockedListeners.delete(fn);
  }

  private setBlocked(b: boolean) {
    if (this.blocked === b) return;
    this.blocked = b;
    this.blockedListeners.forEach((fn) => fn(b));
  }

  /**
   * Call SYNCHRONOUSLY inside a tap (no await before it). Unlocks the <audio> element and the phone's own
   * voice: iOS only allows speechSynthesis if its first speak() happens in a user gesture.
   */
  unlock(): Promise<void> {
    setAudioSession("playback");
    if (!this.silent) this.silent = silentWavUrl();
    const played = (() => {
      try {
        this.el.muted = false;
        this.el.src = this.silent;
        return this.el.play().then(() => {
          this.setBlocked(false);
        }).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    })();
    try {
      const synth = window.speechSynthesis;
      if (synth) {
        synth.getVoices(); // warm the voice list (Safari loads it lazily)
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        synth.speak(u);
      }
    } catch {
      /* no speech synthesis */
    }
    return played.then(() => this.loadClips());
  }

  /** "Tap to hear": unlock again inside this tap and replay what was being said. */
  retryAfterTap(): void {
    const items = this.lastItems;
    void this.unlock();
    if (items.length) void this.say(items, true);
  }

  private async loadClips(): Promise<void> {
    if (Object.keys(this.clipManifest).length) return;
    try {
      const res = await fetch("/audio/guidance/manifest.json", { cache: "no-cache" });
      if (res.ok) this.clipManifest = await res.json();
    } catch {
      /* no pre-recorded clips yet: lines go through /api/speak */
    }
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(speaking: boolean, text: string) {
    this.listeners.forEach((fn) => fn(speaking, text));
  }

  get isSpeaking(): boolean {
    return this.playing;
  }

  /** Stop everything now and clear the queue. */
  stop(): void {
    this.generation++;
    this.queue = [];
    this.el.pause();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    if (this.playing) {
      this.playing = false;
      this.emit(false, "");
    }
  }

  /** Speak items in order. Resolves when all are done (or when stop() interrupts). */
  async say(items: SpeakItem[], interrupt = true): Promise<void> {
    if (interrupt) this.stop();
    this.lastItems = items;
    this.queue.push(...items.filter((i) => i.text || i.clipId));
    if (this.playing) return this.waitIdle();
    const gen = this.generation;
    this.playing = true;
    while (this.queue.length && gen === this.generation) {
      const item = this.queue.shift()!;
      this.emit(true, item.text);
      await this.playOne(item, gen);
    }
    if (gen === this.generation) {
      this.playing = false;
      this.emit(false, "");
    }
  }

  private waitIdle(): Promise<void> {
    return new Promise((resolve) => {
      const off = this.onChange((speaking) => {
        if (!speaking) {
          off();
          resolve();
        }
      });
    });
  }

  private async playOne(item: SpeakItem, gen: number): Promise<void> {
    if (this.muted) {
      await wait(Math.min(6000, 600 + item.text.length * 55)); // let screen readers announce the caption
      return;
    }
    const clip = item.clipId ? this.clipManifest[item.clipId]?.[item.lang] : undefined;
    let url = clip ?? item.audioUrl ?? null;
    if (!url && item.text) {
      try {
        url = (await api.speak(item.text, item.lang)).audio_url;
      } catch {
        url = null;
      }
    }
    if (gen !== this.generation) return;
    if (url && (await this.playUrl(api.audioUrl(url)))) return;
    if (gen !== this.generation) return;
    await this.speakWithDevice(item.text, item.lang);
  }

  private playUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const el = this.el;
      const done = (ok: boolean) => {
        el.onended = el.onerror = null;
        resolve(ok);
      };
      el.onended = () => done(true);
      el.onerror = () => done(false);
      el.src = url;
      el.playbackRate = this.rate;
      (el as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean }).preservesPitch = true;
      (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      el.play().then(() => this.setBlocked(false)).catch((e: Error) => {
        if (e?.name === "NotAllowedError") this.setBlocked(true);
        done(false);
      });
    });
  }

  /** Fallback: the phone's own voice. iPhones have Hindi and English voices; Telugu varies by device. */
  private speakWithDevice(text: string, lang: Lang): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || !text) {
        setTimeout(resolve, 400);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANG_NAMES[lang].bcp47;
      const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
      if (voice) u.voice = voice;
      u.rate = Math.max(0.5, Math.min(1.6, this.rate));
      const timer = setTimeout(resolve, 15000);
      u.onend = u.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      synth.speak(u);
    });
  }
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const audio = new AudioEngine();
