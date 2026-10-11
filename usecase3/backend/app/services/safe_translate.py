"""Translation that cannot silently change route numbers or place names.

Strategy (each step only if the previous one fails):
 1. Placeholders: protected terms become numeric tokens (90001, 90002...), the text is translated by
    AnuvaadHub MT, every token must come back, then each token is replaced by the term already
    rendered in the target script.
 2. Plain MT, accepted only if every number in the source appears unchanged in the output.
 3. AnuvaadHub down or unsafe: the same two steps with Gemini as the translator (GEMINI_TRANSLATE_FALLBACK),
    so the user keeps hearing their own language instead of a sudden English line.
 4. Raise; the caller falls back to English.
"""

from __future__ import annotations

import re

import logging

from ..settings import get_settings
from .anuvaad import AnuvaadClient
from .text_utils import digit_sequences

log = logging.getLogger("oriel.translate")
LANG_NAME = {"te": "Telugu", "hi": "Hindi", "en": "English"}
_SCHEMA = {"type": "object", "properties": {"translation": {"type": "string"}}, "required": ["translation"]}

TOKEN_BASE = 90001
_NATIVE = {str(i): f"{i}{chr(0x0C66 + i)}{chr(0x0966 + i)}" for i in range(10)}


class UnsafeTranslation(RuntimeError):
    pass


def _token_regex(token: str) -> re.Pattern:
    """Match the token in ASCII, Telugu or Devanagari digits, allowing thousands separators."""
    parts = [f"[{_NATIVE[d]}]" for d in token]
    return re.compile(r"[,\s]?".join(parts))


def protect(text: str, terms: list[str]) -> tuple[str, dict[str, str]]:
    mapping: dict[str, str] = {}
    out = text
    for k, term in enumerate(sorted({t for t in terms if t and t.strip()}, key=len, reverse=True)):
        token = str(TOKEN_BASE + k)
        pattern = re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE)
        if pattern.search(out):
            out = pattern.sub(token, out)
            mapping[token] = term
    return out, mapping


def restore(translated: str, mapping: dict[str, str], renderings: dict[str, str]) -> str | None:
    out = translated
    for token, term in mapping.items():
        rx = _token_regex(token)
        if not rx.search(out):
            return None
        out = rx.sub(renderings.get(term, term), out)
    return out


def numbers_preserved(source: str, translated: str, ignore: set[str] | None = None) -> bool:
    ignore = ignore or set()
    want = [d for d in digit_sequences(source) if d not in ignore]
    have = set(digit_sequences(translated))
    return all(d in have for d in want)


async def gemini_translate(text: str, src: str, tgt: str) -> str:
    """Second translator, used only when AnuvaadHub fails. Same safety checks are applied by the caller."""
    from . import gemini  # late import: keeps this module light for tests

    s = get_settings()
    prompt = (f"Translate this {LANG_NAME[src]} text into natural, simple spoken {LANG_NAME[tgt]} for a blind "
              f"listener. Keep every number, and every 5-digit code such as 90001, exactly as it is. "
              f"Return only the translation.\n\nTEXT: {text}")
    out = await gemini.generate_json((s.reader_models or (s.reader_model,))[0], prompt, _SCHEMA,
                                     thinking_level="minimal", retries=1)
    return str(out.get("translation", "")).strip()


async def _two_steps(translate, text: str, renderings: dict[str, str], label: str) -> tuple[str, str]:
    protected, mapping = protect(text, list(renderings))
    if mapping:
        out = await translate(protected)
        restored = restore(out, mapping, renderings)
        if restored is not None and numbers_preserved(protected, out, ignore=set(mapping)):
            return restored, f"{label}+placeholders"
    out = await translate(text)
    if out and numbers_preserved(text, out):
        return out, label
    raise UnsafeTranslation("translation changed or dropped a number")


async def translate_protected(mt: AnuvaadClient, text: str, src: str, tgt: str,
                              renderings: dict[str, str] | None = None) -> tuple[str, str]:
    """renderings: {term as written in `text`: how to say it in `tgt`}. Returns (text, path)."""
    if src == tgt or not text.strip():
        return text, "same-language"
    renderings = renderings or {}
    try:
        return await _two_steps(lambda t: mt.translate(t, src, tgt), text, renderings, "mt")
    except Exception as first:  # noqa: BLE001 - AnuvaadHub down, timing out or unsafe: try Gemini
        if not get_settings().gemini_translate_fallback or src not in LANG_NAME or tgt not in LANG_NAME:
            raise
        try:
            out, path = await _two_steps(lambda t: gemini_translate(t, src, tgt), text, renderings, "gemini")
            log.info("translated %s->%s with Gemini (AnuvaadHub: %s)", src, tgt, str(first)[:80])
            return out, path
        except Exception as second:  # noqa: BLE001
            log.warning("translation %s->%s failed twice: %s / %s", src, tgt, str(first)[:80], str(second)[:80])
            raise first
