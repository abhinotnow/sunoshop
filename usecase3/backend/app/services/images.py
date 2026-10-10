"""Image handling: decode (with iPhone EXIF rotation), resize, sharpness, crops."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE_READER = 1600
MAX_SIDE_ARBITER = 2400  # full frame for reader 2: it is read at ultra-high resolution
MIN_SIDE_CROP = 640


def decode(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # photos picked from the iPhone gallery carry EXIF rotation
    return img.convert("RGB")


def encode_jpeg(img: Image.Image, quality: int = 88) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def fit(img: Image.Image, max_side: int) -> Image.Image:
    w, h = img.size
    scale = max_side / max(w, h)
    if scale >= 1:
        return img
    return img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def sharpness(img: Image.Image) -> float:
    """Variance of a 4-neighbour Laplacian on a 480 px grayscale copy (higher = sharper)."""
    g = np.asarray(fit(img, 480).convert("L"), dtype=np.float32)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def brightness(img: Image.Image) -> float:
    return float(np.asarray(fit(img, 320).convert("L"), dtype=np.float32).mean())


def valid_box(box) -> bool:
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return False
    y0, x0, y1, x1 = box
    return 0 <= y0 < y1 <= 1000 and 0 <= x0 < x1 <= 1000


def crop_box(img: Image.Image, box, pad: float = 0.08, min_side: int = MIN_SIDE_CROP) -> Image.Image:
    """Crop a [ymin, xmin, ymax, xmax] 0-1000 box with padding, upscaled so small text is readable."""
    if not valid_box(box):
        return img
    w, h = img.size
    y0, x0, y1, x1 = box
    bw, bh = (x1 - x0) / 1000 * w, (y1 - y0) / 1000 * h
    left = max(0, x0 / 1000 * w - bw * pad)
    top = max(0, y0 / 1000 * h - bh * pad)
    right = min(w, x1 / 1000 * w + bw * pad)
    bottom = min(h, y1 / 1000 * h + bh * pad)
    crop = img.crop((round(left), round(top), round(right), round(bottom)))
    short = min(crop.size)
    if 0 < short < min_side:
        s = min(4.0, min_side / short)
        crop = crop.resize((round(crop.width * s), round(crop.height * s)), Image.LANCZOS)
    return crop
