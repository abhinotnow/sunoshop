"""Optional PaddleOCR reader (ENABLE_PADDLEOCR=true). Off by default: it is heavy to install on
Windows, and AnuvaadHub OCR plus the Gemini arbiter already give an independent second reading."""

from __future__ import annotations

from functools import lru_cache

import numpy as np


@lru_cache(maxsize=1)
def _engine():
    from paddleocr import PaddleOCR

    try:
        return PaddleOCR(lang="en", use_doc_orientation_classify=False, use_doc_unwarping=False,
                         use_textline_orientation=False)
    except TypeError:
        return PaddleOCR(lang="en", use_angle_cls=False, show_log=False)


def read_text(img) -> str:
    try:
        engine = _engine()
        arr = np.asarray(img.convert("RGB"))[:, :, ::-1]  # PaddleOCR expects BGR
        if hasattr(engine, "predict"):
            texts = []
            for res in engine.predict(arr):
                try:
                    texts += list(res["rec_texts"])
                except (KeyError, TypeError):
                    texts += list(res.json.get("res", res.json)["rec_texts"])
            return " ".join(texts)
        out = engine.ocr(arr, cls=False)
        return " ".join(line[1][0] for line in (out[0] or []))
    except Exception:  # noqa: BLE001 - optional reader must never break a read
        return ""
