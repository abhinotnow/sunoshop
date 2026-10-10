/**
 * On-device quality gate (no network, no AI): runs on a 240 px copy of the preview several times a
 * second. Decides whether a frame is worth sending and which instruction to give first.
 */

export interface FrameQuality {
  sharpness: number;  // variance of the Laplacian (higher = sharper)
  brightness: number; // mean luminance 0-255
  glare: number;      // share of nearly white pixels
}

// Starting thresholds, tuned on the synthetic set. Adjust after testing real photos (README: Parameters).
export const QUALITY = {
  minSharpness: 55,
  minBrightness: 45,
  maxGlare: 0.08,
};

const work = document.createElement("canvas");

export function measure(source: CanvasImageSource, srcW: number, srcH: number): FrameQuality | null {
  if (!srcW || !srcH) return null;
  const w = 240;
  const h = Math.max(1, Math.round((srcH / srcW) * w));
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  let sum = 0;
  let bright = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = y;
    sum += y;
    if (y >= 250) bright++;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = lapSum / n;
  return { sharpness: lapSq / n - mean * mean, brightness: sum / (w * h), glare: bright / (w * h) };
}

export function isGoodFrame(q: FrameQuality): boolean {
  return q.sharpness >= QUALITY.minSharpness && q.brightness >= QUALITY.minBrightness && q.glare <= QUALITY.maxGlare;
}
