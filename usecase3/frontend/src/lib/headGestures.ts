/**
 * Head gestures from MediaPipe's 478 face landmarks (front camera).
 *
 * Signals (all relative to a slowly updated neutral pose, so any sitting position works):
 *   yaw   = horizontal offset of the nose tip from the midpoint between the eyes, / eye distance
 *   pitch = vertical offset of the nose tip from the eye line, / eye distance
 *   roll  = angle of the line through the outer eye corners, in degrees
 * Gestures:
 *   nod        pitch swings > 0.10 with 2+ direction changes within 1.2 s (yaw stays small)
 *   shake      yaw swings > 0.14 with 2+ direction changes within 1.2 s (pitch stays small)
 *   tilt_left / tilt_right   roll held beyond 14 degrees for 0.5 s
 * A 1.2 s cooldown follows every gesture so one movement never fires twice.
 */
import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { faceLandmarker } from "./vision";

export type HeadGesture = "nod" | "shake" | "tilt_left" | "tilt_right";

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
  face: boolean;
}

export const GESTURE = {
  nodRange: 0.10,
  shakeRange: 0.14,
  crossRange: 0.6,   // the other axis must stay below this fraction of the main one
  tiltDegrees: 14,
  tiltHoldMs: 500,
  windowMs: 1200,
  cooldownMs: 1200,
};

// Landmark indices in the 478-point face mesh
const NOSE_TIP = 1;
const RIGHT_EYE_OUTER = 33;  // subject's right eye (image left)
const LEFT_EYE_OUTER = 263;  // subject's left eye (image right)

function pose(l: NormalizedLandmark[]): Omit<HeadPose, "face"> {
  const a = l[RIGHT_EYE_OUTER];
  const b = l[LEFT_EYE_OUTER];
  const n = l[NOSE_TIP];
  const eye = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return {
    yaw: (n.x - mx) / eye,
    pitch: (n.y - my) / eye,
    roll: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

function swings(values: number[]): number {
  let changes = 0;
  let dir = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (Math.abs(d) < 0.008) continue;
    const s = Math.sign(d);
    if (dir && s !== dir) changes++;
    dir = s;
  }
  return changes;
}

export class HeadGestureTracker {
  private lm: FaceLandmarker | null = null;
  private raf = 0;
  private hist: { t: number; yaw: number; pitch: number; roll: number }[] = [];
  private neutral = { yaw: 0, pitch: 0, roll: 0 };
  private neutralReady = false;
  private cooldownUntil = 0;
  private tiltSince = 0;
  private lastVideoTime = -1;

  constructor(private onGesture: (g: HeadGesture) => void, private onPose?: (p: HeadPose) => void) {}

  async start(video: HTMLVideoElement): Promise<boolean> {
    this.lm = await faceLandmarker();
    if (!this.lm) return false;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = video.currentTime;
      try {
        const res = this.lm!.detectForVideo(video, performance.now());
        const face = res.faceLandmarks?.[0];
        if (!face) {
          this.onPose?.({ yaw: 0, pitch: 0, roll: 0, face: false });
          return;
        }
        this.update(pose(face));
      } catch {
        /* skip a bad frame */
      }
    };
    loop();
    return true;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.hist = [];
    this.neutralReady = false;
  }

  private update(p: { yaw: number; pitch: number; roll: number }) {
    const t = performance.now();
    if (!this.neutralReady) {
      this.neutral = { ...p };
      this.neutralReady = true;
    }
    const rel = { yaw: p.yaw - this.neutral.yaw, pitch: p.pitch - this.neutral.pitch, roll: p.roll - this.neutral.roll };
    this.onPose?.({ ...rel, face: true });
    this.hist.push({ t, ...rel });
    while (this.hist.length && t - this.hist[0].t > GESTURE.windowMs) this.hist.shift();

    // Neutral pose drifts slowly toward where the head rests (only while still)
    const still = this.hist.length > 5 && Math.max(...this.hist.map((h) => Math.abs(h.yaw) + Math.abs(h.pitch))) < 0.05;
    if (still) {
      const k = 0.05;
      this.neutral = { yaw: this.neutral.yaw + k * rel.yaw, pitch: this.neutral.pitch + k * rel.pitch, roll: this.neutral.roll + k * rel.roll };
    }
    if (t < this.cooldownUntil || this.hist.length < 6) return;

    const ys = this.hist.map((h) => h.yaw);
    const ps = this.hist.map((h) => h.pitch);
    const yawRange = Math.max(...ys) - Math.min(...ys);
    const pitchRange = Math.max(...ps) - Math.min(...ps);

    if (pitchRange > GESTURE.nodRange && yawRange < pitchRange * GESTURE.crossRange && swings(ps) >= 2) return this.fire("nod", t);
    if (yawRange > GESTURE.shakeRange && pitchRange < yawRange * GESTURE.crossRange && swings(ys) >= 2) return this.fire("shake", t);

    if (Math.abs(rel.roll) > GESTURE.tiltDegrees) {
      this.tiltSince ||= t;
      if (t - this.tiltSince > GESTURE.tiltHoldMs) {
        // Roll is negative when the head tilts toward the user's right shoulder (see header comment).
        return this.fire(rel.roll < 0 ? "tilt_right" : "tilt_left", t);
      }
    } else {
      this.tiltSince = 0;
    }
  }

  private fire(g: HeadGesture, t: number) {
    this.cooldownUntil = t + GESTURE.cooldownMs;
    this.hist = [];
    this.tiltSince = 0;
    this.onGesture(g);
  }
}
