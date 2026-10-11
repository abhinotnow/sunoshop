/**
 * Microphone -> 16 kHz mono 16-bit WAV, with a simple voice-activity detector.
 *
 * Why not MediaRecorder: iPhone Safari records AAC/MP4, while AnuvaadHub ASR wants WAV. We capture raw
 * PCM with Web Audio and encode WAV ourselves, which works identically on iPhone, Android and laptops.
 * The microphone is fully released between questions, so iPhone playback stays at normal volume.
 */
import { setAudioSession } from "./audio";

export interface RecordOptions {
  maxMs?: number;          // hard stop (AnuvaadHub ASR limit is ~20 s)
  silenceMs?: number;      // stop after this much silence once speech started
  noSpeechMs?: number;     // give up if nobody speaks
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
}

export interface Recording {
  wav: Blob;
  durationMs: number;
  hadSpeech: boolean;
}

type AnyWindow = Window & { webkitAudioContext?: typeof AudioContext };

export class MicRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private stopFn: (() => void) | null = null;

  get active(): boolean {
    return this.stopFn !== null;
  }

  /** Ask for permission early (inside a tap), then release the mic immediately. */
  static async warmUp(): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  /** Records one utterance. Resolves when the speaker pauses, the time limit hits, or stop() is called. */
  async record(opts: RecordOptions = {}): Promise<Recording> {
    const maxMs = opts.maxMs ?? 15000;
    const silenceMs = opts.silenceMs ?? 900;
    const noSpeechMs = opts.noSpeechMs ?? 7000;

    setAudioSession("play-and-record");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const Ctx = window.AudioContext ?? (window as AnyWindow).webkitAudioContext!;
    this.ctx = new Ctx();
    await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // keep the graph running without echoing the mic to the speaker
    source.connect(proc);
    proc.connect(sink);
    sink.connect(this.ctx.destination);

    const rate = this.ctx.sampleRate;
    const chunks: Float32Array[] = [];
    const started = performance.now();
    let noiseFloor = 0.01;
    let speechStarted = false;
    let lastVoice = 0;

    return new Promise<Recording>((resolve) => {
      const finish = () => {
        if (!this.stopFn) return;
        this.stopFn = null;
        proc.disconnect();
        source.disconnect();
        this.release();
        const pcm = concat(chunks);
        resolve({ wav: encodeWav(downsample(pcm, rate, 16000), 16000), durationMs: performance.now() - started, hadSpeech: speechStarted });
      };
      this.stopFn = finish;

      proc.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        opts.onLevel?.(Math.min(1, rms * 8));
        const now = performance.now();
        const threshold = Math.max(0.015, noiseFloor * 3);
        if (rms > threshold) {
          if (!speechStarted) {
            speechStarted = true;
            opts.onSpeechStart?.();
          }
          lastVoice = now;
        } else if (!speechStarted) {
          noiseFloor = noiseFloor * 0.95 + rms * 0.05; // learn the room noise before speech
        }
        const elapsed = now - started;
        if (elapsed > maxMs) finish();
        else if (speechStarted && now - lastVoice > silenceMs) finish();
        else if (!speechStarted && elapsed > noSpeechMs) finish();
      };
    });
  }

  stop(): void {
    this.stopFn?.();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    setAudioSession("playback"); // back to the loudspeaker as soon as the mic is released
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Average-based downsampling (acts as a simple low-pass filter). */
function downsample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += pcm[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function encodeWav(pcm: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
