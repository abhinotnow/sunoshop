"""Translation that cannot silently change route numbers or place names.

Strategy (each step only if the previous one fails):
 1. Placeholders: protected terms become numeric tokens (90001, 90002...), the text is translated by
    AnuvaadHub MT, every token must come back, then each token is replaced by the term already
    rendered in the target script.
 2. Plain MT, accepted only if every number in the source appears unchanged in the output.
 3. Raise UnsafeTranslation; the caller decides (Gemini fallback or English).
"""

from __future__ import annotations

import re

from .anuvaad import AnuvaadClient
from .text_utils import digit_sequences

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


async def translate_protected(mt: AnuvaadClient, text: str, src: str, tgt: str,
                              renderings: dict[str, str] | None = None) -> tuple[str, str]:
    """renderings: {term as written in `text`: how to say it in `tgt`}. Returns (text, path)."""
    if src == tgt or not text.strip():
        return text, "same-language"
    renderings = renderings or {}
    protected, mapping = protect(text, list(renderings))
    if mapping:
        out = await mt.translate(protected, src, tgt)
        restored = restore(out, mapping, renderings)
        if restored is not None and numbers_preserved(protected, out, ignore=set(mapping)):
            return restored, "mt+placeholders"
    out = await mt.translate(text, src, tgt)
    if numbers_preserved(text, out):
        return out, "mt"
    raise UnsafeTranslation("translation changed or dropped a number")
