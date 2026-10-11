/**
 * Burst capture: grab ~6 frames over ~1 second, keep the 3 sharpest, hide faces, encode JPEG.
 * Several frames let the server check that readings AGREE; picking the sharpest fights hand tremor.
 */
import { CAPTURE_MAX_SIDE, canvasToJpeg, fileToCanvas, grabFrame } from "./camera";
import { measure } from "./quality";
import { blurFaces } from "./vision";
import { sleep } from "./platform";

export interface Burst {
  frames: Blob[];
  best: Blob | null;
  facesHidden: number; // -1 when the face detector is unavailable
}

export async function captureBurst(video: HTMLVideoElement, focusBox: number[] | null, shots = 4, gapMs = 120): Promise<Burst> {
  const grabbed: { canvas: HTMLCanvasElement; sharp: number }[] = [];
  for (let i = 0; i < shots; i++) {
    const c = grabFrame(video, CAPTURE_MAX_SIDE, focusBox);
    if (c) {
      const q = measure(c, c.width, c.height);
      grabbed.push({ canvas: c, sharp: q?.sharpness ?? 0 });
    }
    if (i < shots - 1) await sleep(gapMs);
  }
  grabbed.sort((a, b) => b.sharp - a.sharp);
  return finish(grabbed.slice(0, 2).map((g) => g.canvas)); // the server reads 2 frames (2 different models)
}

export async function captureFiles(files: File[]): Promise<Burst> {
  const canvases = await Promise.all(files.slice(0, 2).map((f) => fileToCanvas(f)));
  return finish(canvases);
}

async function finish(canvases: HTMLCanvasElement[]): Promise<Burst> {
  let facesHidden = 0;
  for (const c of canvases) {
    const n = await blurFaces(c);
    facesHidden = n < 0 ? -1 : facesHidden < 0 ? -1 : facesHidden + n;
  }
  const frames = await Promise.all(canvases.map((c) => canvasToJpeg(c)));
  return { frames, best: frames[0] ?? null, facesHidden };
}
