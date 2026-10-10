/**
 * MediaPipe on the device:
 *  - FaceDetector: blurs (pixelates) faces in every frame BEFORE it leaves the phone (privacy).
 *  - FaceLandmarker (478 landmarks): head gestures for hands-free yes / no / again / new sign.
 * Models load lazily from Google's CDN the first time they are needed. If loading fails, Oriel keeps
 * working: frames are sent without blurring (the UI says so) and gestures stay off.
 */
import type { FaceDetector, FaceLandmarker } from "@mediapipe/tasks-vision";
import { isIOS } from "./platform";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const DETECTOR_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// iPhone Safari's WebGL path is unreliable for MediaPipe; CPU is fast enough for one face.
const DELEGATE = isIOS ? "CPU" : "GPU";

// Loaded on first use so the app starts fast on phones (MediaPipe is the largest dependency).
const mp = () => import("@mediapipe/tasks-vision");
type Fileset = Awaited<ReturnType<Awaited<ReturnType<typeof mp>>["FilesetResolver"]["forVisionTasks"]>>;
let filesetPromise: Promise<Fileset> | null = null;
const fileset = () => (filesetPromise ??= mp().then((m) => m.FilesetResolver.forVisionTasks(WASM)));

let detectorPromise: Promise<FaceDetector | null> | null = null;
export function faceDetector(): Promise<FaceDetector | null> {
  detectorPromise ??= Promise.all([mp(), fileset()])
    .then(([m, fs]) => m.FaceDetector.createFromOptions(fs, {
      baseOptions: { modelAssetPath: DETECTOR_MODEL, delegate: DELEGATE },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.4,
    }))
    .catch(() => null);
  return detectorPromise;
}

let landmarkerPromise: Promise<FaceLandmarker | null> | null = null;
export function faceLandmarker(): Promise<FaceLandmarker | null> {
  landmarkerPromise ??= Promise.all([mp(), fileset()])
    .then(([m, fs]) => m.FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: LANDMARKER_MODEL, delegate: DELEGATE },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }))
    .catch(() => null);
  return landmarkerPromise;
}

/** Pixelate every detected face in place. Returns how many faces were hidden, or -1 if unavailable. */
export async function blurFaces(canvas: HTMLCanvasElement): Promise<number> {
  const det = await faceDetector();
  if (!det) return -1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return -1;
  let faces = 0;
  try {
    const result = det.detect(canvas);
    for (const d of result.detections) {
      const b = d.boundingBox;
      if (!b) continue;
      const pad = 0.25;
      const x = Math.max(0, Math.floor(b.originX - b.width * pad));
      const y = Math.max(0, Math.floor(b.originY - b.height * pad));
      const w = Math.min(canvas.width - x, Math.ceil(b.width * (1 + 2 * pad)));
      const h = Math.min(canvas.height - y, Math.ceil(b.height * (1 + 2 * pad)));
      if (w <= 0 || h <= 0) continue;
      // Pixelate: shrink to 8 px and scale back without smoothing (works on Safari, unlike ctx.filter)
      const tiny = document.createElement("canvas");
      tiny.width = 8;
      tiny.height = Math.max(1, Math.round((8 * h) / w));
      tiny.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, tiny.width, tiny.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
      faces++;
    }
  } catch {
    return -1;
  }
  return faces;
}
