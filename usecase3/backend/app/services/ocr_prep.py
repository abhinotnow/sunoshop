"""Prepare sign crops for AnuvaadHub OCR, which wants dark text on a WHITE background.

Street signs are often white text on green or blue, and some mix panels (a yellow route box with
black digits beside a green panel with white text). A single threshold cannot fix mixed panels, so
the read pipeline OCRs TIGHT crops: each route number on its own (Gemini gives a box per route
number), plus the whole sign for names. Inside a tight crop one background colour dominates, so a
global rule works: binarize with Otsu, and invert when most pixels are dark.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps

MAX_BYTES = 4_500_000  # AnuvaadHub limit is 5 MB


def otsu_threshold(gray: np.ndarray) -> int:
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = gray.size
    sum_all = np.dot(np.arange(256), hist)
    w_b = sum_b = 0.0
    best_t, best_var = 127, -1.0
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b, m_f = sum_b / w_b, (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best_var:
            best_var, best_t = var, t
    return best_t


def to_white_background(img: Image.Image) -> Image.Image:
    gray = ImageOps.autocontrast(img.convert("L"), cutoff=1)
    arr = np.asarray(gray, dtype=np.uint8)
    white = arr > otsu_threshold(arr)
    h, w = white.shape
    centre = white[h // 5: h - h // 5, w // 5: w - w // 5]   # judge the sign, not the sky around it
    if centre.mean() < 0.5:          # mostly dark: light text on a dark sign -> invert
        white = ~white
    out = Image.fromarray(white.astype(np.uint8) * 255, mode="L")
    return ImageOps.expand(out, border=24, fill=255)


def prepare_for_ocr(crop: Image.Image) -> bytes:
    img = to_white_background(crop)
    if max(img.size) > 2400:
        img.thumbnail((2400, 2400))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    if len(data) > MAX_BYTES:
        img.thumbnail((1400, 1400))
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
    return data
