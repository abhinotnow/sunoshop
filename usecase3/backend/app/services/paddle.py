"""PaddleOCR reader (ENABLE_PADDLEOCR=true): runs on our own server, no quota, strong on English and digits.

Measured 11 Oct 2026 on a laptop CPU with the PP-OCRv5 mobile models at 960 px: ~1 s per sign, read
127K / KONDAPUR, 218 / SECUNDERABAD, NEW SAGAR / TIFFIN CENTRE exactly. The medium models took ~9.5 s.
oneDNN is switched off: Paddle 3.3 on Windows fails with "ConvertPirAttribute2RuntimeAttribute not support".
Needs ~1 GB RAM: not for Render's free plan.
"""

from __future__ import annotations

import logging
import os
import threading
from functools import lru_cache

import numpy as np

log = logging.getLogger("oriel.paddle")
_lock = threading.Lock()  # the engine is not thread-safe
MAX_SIDE = 960

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


@lru_cache(maxsize=1)
def _engine():
    from paddleocr import PaddleOCR

    try:
        return PaddleOCR(text_detection_model_name="PP-OCRv5_mobile_det", text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                         use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
                         enable_mkldnn=False)
    except TypeError:  # PaddleOCR 2.x
        return PaddleOCR(lang="en", use_angle_cls=False, show_log=False)


def warm_up() -> bool:
    """Load the models once (a few seconds) so the first read does not pay for it."""
    try:
        from PIL import Image
        read_text(Image.new("RGB", (64, 64), "white"), raise_errors=True)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("PaddleOCR could not start: %s", e)
        return False


def read_text(img, raise_errors: bool = False) -> str:
    try:
        w, h = img.size
        if max(w, h) > MAX_SIDE:
            s = MAX_SIDE / max(w, h)
            img = img.resize((round(w * s), round(h * s)))
        arr = np.asarray(img.convert("RGB"))[:, :, ::-1]  # PaddleOCR expects BGR
        with _lock:
            engine = _engine()
            if hasattr(engine, "predict"):
                texts: list[str] = []
                for res in engine.predict(arr):
                    try:
                        texts += list(res["rec_texts"])
                    except (KeyError, TypeError):
                        texts += list(res.json.get("res", res.json)["rec_texts"])
                return " ".join(texts)
            out = engine.ocr(arr, cls=False)
            return " ".join(line[1][0] for line in (out[0] or []))
    except Exception as e:  # noqa: BLE001 - an optional reader must never break a read
        if raise_errors:
            raise
        log.warning("PaddleOCR failed: %s", str(e)[:200])
        return ""
