/**
 * Phone motion and orientation: is the phone upright, is it steady, is the hand shaking?
 * iPhone requires DeviceMotionEvent.requestPermission() inside a tap (done on the Start screen).
 * Laptops have no sensors: every check then reports "unknown" and never blocks capture.
 */

type PermissionFn = () => Promise<"granted" | "denied">;

export const MOTION = {
  uprightMin: 55,     // beta (front-back tilt) in degrees; ~90 = phone held straight up
  uprightMax: 125,
  steadyAccel: 0.35,  // m/s^2, acceleration without gravity, averaged over 0.6 s
  tremorStd: 0.6,     // m/s^2 jitter while trying to hold still -> suggests hand tremor
};

class MotionTracker {
  beta: number | null = null;
  available = false;
  private samples: { t: number; a: number }[] = [];
  private started = false;

  async requestPermission(): Promise<boolean> {
    const DM = window.DeviceMotionEvent as unknown as { requestPermission?: PermissionFn } | undefined;
    const DO = window.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn } | undefined;
    try {
      if (DM?.requestPermission) {
        const a = await DM.requestPermission();
        const b = DO?.requestPermission ? await DO.requestPermission() : "granted";
        if (a !== "granted" || b !== "granted") return false;
      }
    } catch {
      return false;
    }
    this.start();
    return true;
  }

  private start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener("deviceorientation", (e) => {
      if (e.beta !== null) {
        this.beta = e.beta;
        this.available = true;
      }
    });
    window.addEventListener("devicemotion", (e) => {
      const a = e.acceleration;
      if (!a || a.x === null) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const t = performance.now();
      this.samples.push({ t, a: mag });
      while (this.samples.length && t - this.samples[0].t > 5000) this.samples.shift();
    });
  }

  /** "up" = tilt the phone up (it points at the ground), "down" = it points at the sky. */
  tiltAdvice(): "up" | "down" | null {
    if (this.beta === null) return null;
    if (window.innerWidth > window.innerHeight) return null; // landscape: beta means something else
    const b = Math.abs(this.beta);
    if (b < MOTION.uprightMin) return "up";
    if (b > MOTION.uprightMax) return "down";
    return null;
  }

  private window(ms: number): number[] {
    const now = performance.now();
    return this.samples.filter((s) => now - s.t <= ms).map((s) => s.a);
  }

  /** null when the device has no motion sensor (laptop): treat as steady. */
  isSteady(): boolean | null {
    const w = this.window(600);
    if (w.length < 5) return this.samples.length ? false : null;
    return w.reduce((s, v) => s + v, 0) / w.length < MOTION.steadyAccel;
  }

  /** Standard deviation of acceleration over the last 5 s (hand-tremor signal). */
  jitter(): number | null {
    const w = this.window(5000);
    if (w.length < 30) return null;
    const m = w.reduce((s, v) => s + v, 0) / w.length;
    return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length);
  }
}

export const motion = new MotionTracker();
