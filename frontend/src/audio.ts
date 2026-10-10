// Audio recording, VAD auto-capture, WAV encoding, ordered playback, haptics, and spatial audio panners
// Exports encodeWAV, calculateRMS, EnergyVAD, AudioRecorder, SentencePlaybackQueue, calculateContrastRatio, convertBlobToBase64, triggerHaptic, playSpatialShelf, HAPTIC_PATTERNS, AudioMode, VADOptions, HapticType, SpatialProductItem
// Depends on browser Web Audio API, browser SpeechSynthesis API, types.ts

import { ReplySentenceMessage } from './types';

export type AudioMode = 'push-to-talk' | 'auto';

export interface VADOptions {
  speechThreshold?: number;     // RMS threshold to trigger speech (default: 0.015)
  silenceThreshold?: number;    // RMS threshold below which is silence (default: 0.010)
  silenceDurationMs?: number;   // Continuous silence duration to auto-stop in ms (default: 1200)
  minSpeechDurationMs?: number; // Minimum speech duration required before silence stop in ms (default: 300)
  sampleRate?: number;          // Audio sample rate (default: 16000)
}

export interface StartRecordingOptions {
  mode?: AudioMode;
  vadOptions?: VADOptions;
  onAutoStop?: (wavBlob: Blob) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (wavBlob: Blob) => void;
}

export function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

export class EnergyVAD {
  private speechThreshold: number;
  private silenceThreshold: number;
  private silenceDurationMs: number;
  private minSpeechDurationMs: number;
  private sampleRate: number;

  private isSpeaking: boolean = false;
  private speechSamplesCount: number = 0;
  private silenceSamplesCount: number = 0;

  constructor(options: VADOptions = {}) {
    this.speechThreshold = options.speechThreshold ?? 0.015;
    this.silenceThreshold = options.silenceThreshold ?? 0.010;
    this.silenceDurationMs = options.silenceDurationMs ?? 1200;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 300;
    this.sampleRate = options.sampleRate ?? 16000;
  }

  public reset(): void {
    this.isSpeaking = false;
    this.speechSamplesCount = 0;
    this.silenceSamplesCount = 0;
  }

  public processChunk(samples: Float32Array): {
    rms: number;
    speechStarted: boolean;
    speechEnded: boolean;
    isSpeaking: boolean;
  } {
    const rms = calculateRMS(samples);
    let speechStarted = false;
    let speechEnded = false;

    if (!this.isSpeaking) {
      if (rms >= this.speechThreshold) {
        this.isSpeaking = true;
        this.speechSamplesCount = samples.length;
        this.silenceSamplesCount = 0;
        speechStarted = true;
      }
    } else {
      this.speechSamplesCount += samples.length;
      if (rms < this.silenceThreshold) {
        this.silenceSamplesCount += samples.length;
        const silenceMs = (this.silenceSamplesCount / this.sampleRate) * 1000;
        const speechMs = (this.speechSamplesCount / this.sampleRate) * 1000;

        if (silenceMs >= this.silenceDurationMs && speechMs >= this.minSpeechDurationMs) {
          this.isSpeaking = false;
          speechEnded = true;
        }
      } else {
        // Reset silence counter if speech energy resumes
        this.silenceSamplesCount = 0;
      }
    }

    return {
      rms,
      speechStarted,
      speechEnded,
      isSpeaking: this.isSpeaking,
    };
  }

  public get speaking(): boolean {
    return this.isSpeaking;
  }
}

export function encodeWAV(samples: Float32Array, sampleRate: number = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // Helper writing ASCII strings into DataView
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  /* RIFF identifier */
  writeString(0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type & format */
  writeString(8, 'WAVE');
  /* format chunk identifier */
  writeString(12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM = 1) */
  view.setUint16(20, 1, true);
  /* channel count (mono = 1) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sampleRate * 1 channel * 2 bytes) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (1 channel * 2 bytes) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}

export async function convertBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private recordedSamples: Float32Array[] = [];
  private preRollChunks: Float32Array[] = [];
  private isRecording: boolean = false;
  private timeoutId: any = null;
  private currentMode: AudioMode = 'push-to-talk';
  private vad: EnergyVAD = new EnergyVAD();

  public async start(
    optionsOrCb?: ((wavBlob: Blob) => void) | StartRecordingOptions
  ): Promise<void> {
    if (this.isRecording) return;
    this.recordedSamples = [];
    this.preRollChunks = [];

    let options: StartRecordingOptions = {};
    if (typeof optionsOrCb === 'function') {
      options = { onAutoStop: optionsOrCb };
    } else if (optionsOrCb) {
      options = optionsOrCb;
    }

    this.currentMode = options.mode || 'push-to-talk';
    this.vad = new EnergyVAD(options.vadOptions);
    this.vad.reset();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.mediaStream = stream;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass({ sampleRate: 16000 });

    const source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const chunkCopy = new Float32Array(inputData);

      if (this.currentMode === 'auto') {
        const vadResult = this.vad.processChunk(chunkCopy);

        if (vadResult.speechStarted) {
          for (const preChunk of this.preRollChunks) {
            this.recordedSamples.push(preChunk);
          }
          this.preRollChunks = [];
          this.recordedSamples.push(chunkCopy);
          options.onSpeechStart?.();
        } else if (vadResult.isSpeaking) {
          this.recordedSamples.push(chunkCopy);
        } else {
          this.preRollChunks.push(chunkCopy);
          if (this.preRollChunks.length > 2) {
            this.preRollChunks.shift();
          }
        }

        if (vadResult.speechEnded) {
          this.stop().then((wavBlob) => {
            if (wavBlob) {
              options.onSpeechEnd?.(wavBlob);
              options.onAutoStop?.(wavBlob);
            }
          });
        }
      } else {
        this.recordedSamples.push(chunkCopy);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.isRecording = true;

    // Strict 20-second timeout cap as specified in CONTRACT and M2-04
    this.timeoutId = setTimeout(async () => {
      if (this.isRecording) {
        const wavBlob = await this.stop();
        if (options.onAutoStop && wavBlob) {
          options.onAutoStop(wavBlob);
        }
      }
    }, 20000);
  }

  public async stop(): Promise<Blob | null> {
    if (!this.isRecording) return null;
    this.isRecording = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    const totalLength = this.recordedSamples.reduce((acc, curr) => acc + curr.length, 0);
    if (totalLength === 0) {
      return null;
    }

    const mergedSamples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.recordedSamples) {
      mergedSamples.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBuffer = encodeWAV(mergedSamples, 16000);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  public get recording(): boolean {
    return this.isRecording;
  }

  public get mode(): AudioMode {
    return this.currentMode;
  }
}

// Ordered Sentence Playback Queue with Rate and Pause Support
export interface SentencePlaybackOptions {
  playHandler?: (sentence: ReplySentenceMessage) => Promise<void>;
  onSentenceStart?: (sentence: ReplySentenceMessage) => void;
  onSentenceEnd?: (sentence: ReplySentenceMessage) => void;
  onQueueEmpty?: () => void;
}

export class SentencePlaybackQueue {
  private buffer: Map<number, ReplySentenceMessage> = new Map();
  private nextExpectedIdx: number = 0;
  private isProcessing: boolean = false;
  private currentSentence: ReplySentenceMessage | null = null;
  private playHandler?: (sentence: ReplySentenceMessage) => Promise<void>;
  private onSentenceStart?: (sentence: ReplySentenceMessage) => void;
  private onSentenceEnd?: (sentence: ReplySentenceMessage) => void;
  private onQueueEmpty?: () => void;

  constructor(options: SentencePlaybackOptions = {}) {
    this.playHandler = options.playHandler;
    this.onSentenceStart = options.onSentenceStart;
    this.onSentenceEnd = options.onSentenceEnd;
    this.onQueueEmpty = options.onQueueEmpty;
  }

  public enqueue(sentence: ReplySentenceMessage): void {
    this.buffer.set(sentence.idx, sentence);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.buffer.has(this.nextExpectedIdx)) {
      const sentence = this.buffer.get(this.nextExpectedIdx)!;
      this.buffer.delete(this.nextExpectedIdx);
      this.currentSentence = sentence;

      this.onSentenceStart?.(sentence);

      if (this.playHandler) {
        await this.playHandler(sentence);
      } else {
        await this.defaultPlaySentence(sentence);
      }

      this.onSentenceEnd?.(sentence);

      const pause = sentence.pause_ms ?? 100;
      if (pause > 0) {
        await new Promise((resolve) => setTimeout(resolve, pause));
      }

      this.nextExpectedIdx++;
      this.currentSentence = null;
    }

    this.isProcessing = false;
    if (this.buffer.size === 0) {
      this.onQueueEmpty?.();
    }
  }

  private defaultPlaySentence(sentence: ReplySentenceMessage): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        setTimeout(resolve, 50);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sentence.text);
      if (sentence.rate) {
        utterance.rate = sentence.rate;
      }
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  public reset(): void {
    this.buffer.clear();
    this.nextExpectedIdx = 0;
    this.isProcessing = false;
    this.currentSentence = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  public get current(): ReplySentenceMessage | null {
    return this.currentSentence;
  }

  public get pendingCount(): number {
    return this.buffer.size;
  }

  public get isPlaying(): boolean {
    return this.isProcessing;
  }
}

// WCAG Contrast Ratio Calculation Helper
export function getRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export function calculateContrastRatio(color1Hex: string, color2Hex: string): number {
  const l1 = getRelativeLuminance(parseHexColor(color1Hex));
  const l2 = getRelativeLuminance(parseHexColor(color2Hex));
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Haptic feedback patterns for blind/low-vision tactile cues
export type HapticType = 'listening' | 'success' | 'error';

export const HAPTIC_PATTERNS: Record<HapticType, number | number[]> = {
  listening: 40,
  success: [50, 60, 50],
  error: [150, 80, 150, 80, 200],
};

export function triggerHaptic(type: HapticType): boolean {
  if (
    typeof navigator !== 'undefined' &&
    'vibrate' in navigator &&
    typeof navigator.vibrate === 'function'
  ) {
    try {
      return navigator.vibrate(HAPTIC_PATTERNS[type]);
    } catch {
      return false;
    }
  }
  return false;
}

// Spatial audio shelf playback through StereoPannerNode at pan -1 / 0 / +1 with sequential mono fallback
export interface SpatialProductItem {
  id: string;
  title: string;
  pan: number; // -1 (left), 0 (center), +1 (right)
  audio?: string;
}

export interface SpatialPlaybackOptions {
  audioContext?: AudioContext;
  durationPerItemMs?: number;
  onItemStart?: (item: SpatialProductItem, index: number, pan: number) => void;
  onItemEnd?: (item: SpatialProductItem, index: number) => void;
}

export interface SpatialPlaybackResult {
  pannersUsed: number[];
  fallbackUsed: boolean;
}

export async function playSpatialShelf(
  products: SpatialProductItem[],
  options: SpatialPlaybackOptions = {}
): Promise<SpatialPlaybackResult> {
  const top3 = products.slice(0, 3);
  if (top3.length === 0) {
    return { pannersUsed: [], fallbackUsed: false };
  }

  const durationMs = options.durationPerItemMs ?? 150;
  let audioContext = options.audioContext;
  let isCreatedCtx = false;

  if (!audioContext && typeof window !== 'undefined') {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      try {
        audioContext = new AudioCtx();
        isCreatedCtx = true;
      } catch {
        audioContext = undefined;
      }
    }
  }

  const supportsStereoPanner =
    !!audioContext &&
    typeof audioContext.createStereoPanner === 'function';

  const supports3DPanner =
    !!audioContext &&
    typeof audioContext.createPanner === 'function';

  // Sequential mono fallback if Web Audio panner is not supported
  if (!audioContext || (!supportsStereoPanner && !supports3DPanner)) {
    for (let i = 0; i < top3.length; i++) {
      const item = top3[i];
      options.onItemStart?.(item, i, 0);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      options.onItemEnd?.(item, i);
    }
    return { pannersUsed: top3.map(() => 0), fallbackUsed: true };
  }

  const pannersUsed: number[] = [];

  try {
    for (let i = 0; i < top3.length; i++) {
      const item = top3[i];
      const targetPan = item.pan !== undefined ? item.pan : (i === 0 ? -1 : i === 1 ? 0 : 1);

      options.onItemStart?.(item, i, targetPan);

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440 + i * 110, audioContext.currentTime);

      gain.gain.setValueAtTime(0.15, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + durationMs / 1000);

      if (supportsStereoPanner) {
        const panner = audioContext.createStereoPanner();
        panner.pan.value = targetPan;
        pannersUsed.push(panner.pan.value);

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(audioContext.destination);
      } else {
        const panner3d = audioContext.createPanner();
        panner3d.panningModel = 'equalpower';
        if (panner3d.positionX) {
          panner3d.positionX.setValueAtTime(targetPan, audioContext.currentTime);
          panner3d.positionY.setValueAtTime(0, audioContext.currentTime);
          panner3d.positionZ.setValueAtTime(1 - Math.abs(targetPan), audioContext.currentTime);
        } else {
          panner3d.setPosition(targetPan, 0, 1 - Math.abs(targetPan));
        }
        pannersUsed.push(targetPan);

        osc.connect(gain);
        gain.connect(panner3d);
        panner3d.connect(audioContext.destination);
      }

      if (typeof osc.start === 'function') {
        osc.start();
        if (typeof osc.stop === 'function') {
          osc.stop(audioContext.currentTime + durationMs / 1000);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, durationMs));
      options.onItemEnd?.(item, i);
    }

    if (isCreatedCtx && audioContext.close) {
      await audioContext.close();
    }

    return { pannersUsed, fallbackUsed: false };
  } catch (err) {
    console.warn('Spatial audio error, falling back to sequential mono:', err);
    for (let i = 0; i < top3.length; i++) {
      const item = top3[i];
      options.onItemStart?.(item, i, 0);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      options.onItemEnd?.(item, i);
    }
    return { pannersUsed: top3.map(() => 0), fallbackUsed: true };
  }
}


