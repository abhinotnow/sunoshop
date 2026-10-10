/**
 * Camera access and frame capture.
 * iPhone notes: the <video> needs playsInline + muted, the page must be HTTPS, and only one camera
 * can stream at a time (so head gestures use the front camera only when we are not scanning).
 */

export type Facing = "environment" | "user";

/** Longest side of a frame sent to the server. Reader 1 gets a 1600 px copy; the second reader and OCR crop the
 *  sign out of this full frame, so sending more keeps small Telugu and Hindi glyphs readable. */
export const CAPTURE_MAX_SIDE = 2400;

export async function startCamera(video: HTMLVideoElement, facing: Facing): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      // 4K on the rear camera when the phone has it: the server zooms into the sign, so every pixel helps.
      // the front camera also reads signs now, so it gets Full HD (head tracking copes with that fine)
      width: { ideal: facing === "environment" ? 3840 : 1920 },
      height: { ideal: facing === "environment" ? 2160 : 1080 },
    },
  });
  video.setAttribute("playsinline", "true");
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Draw the current video frame onto a canvas, optionally cropped to a 0-1000 box
 * ([ymin, xmin, ymax, xmax], as returned by the reader) for digital zoom.
 */
export function grabFrame(video: HTMLVideoElement, maxSide = 1600, box?: number[] | null): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (box && box.length === 4) {
    const [y0, x0, y1, x1] = box;
    const padX = ((x1 - x0) / 1000) * vw * 0.25;
    const padY = ((y1 - y0) / 1000) * vh * 0.25;
    sx = Math.max(0, (x0 / 1000) * vw - padX);
    sy = Math.max(0, (y0 / 1000) * vh - padY);
    sw = Math.min(vw - sx, ((x1 - x0) / 1000) * vw + 2 * padX);
    sh = Math.min(vh - sy, ((y1 - y0) / 1000) * vh + 2 * padY);
    if (sw < 64 || sh < 64) { sx = 0; sy = 0; sw = vw; sh = vh; }
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
}

/** Load an uploaded photo (gallery or laptop file) into a canvas; the browser applies EXIF rotation. */
export async function fileToCanvas(file: File, maxSide = CAPTURE_MAX_SIDE): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}
