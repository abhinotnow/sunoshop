"""Text helpers shared by verification, speech and translation. Pure functions, unit-tested."""

from __future__ import annotations

import re
import unicodedata

from rapidfuzz import fuzz

SCRIPT_RANGES = {
    "Telugu": [(0x0C00, 0x0C7F)],
    "Devanagari": [(0x0900, 0x097F), (0xA8E0, 0xA8FF)],
    "Arabic": [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)],
}
LANG_SCRIPT = {"te": "Telugu", "hi": "Devanagari", "en": "Latin", "ur": "Arabic"}
SCRIPT_LANG = {"Telugu": "te", "Devanagari": "hi", "Latin": "en", "Arabic": "ur"}

_NATIVE_DIGITS = {}
for base in (0x0C66, 0x0966, 0x06F0, 0x0660):  # Telugu, Devanagari, Extended Arabic, Arabic-Indic
    for i in range(10):
        _NATIVE_DIGITS[chr(base + i)] = str(i)


def char_script(ch: str) -> str | None:
    """Script of one LETTER (marks count with their block), None for digits/punctuation/space."""
    cp = ord(ch)
    for name, ranges in SCRIPT_RANGES.items():
        if any(a <= cp <= b for a, b in ranges):
            cat = unicodedata.category(ch)
            return name if cat[0] in "LM" else None
    if ch.isascii() and ch.isalpha():
        return "Latin"
    return None


def script_ratio(text: str, script: str) -> float:
    """Share of letters in `text` that belong to `script` (1.0 if the text has no letters)."""
    letters = [s for s in (char_script(c) for c in text) if s]
    if not letters:
        return 1.0
    return sum(1 for s in letters if s == script) / len(letters)


def script_ok(text: str, script: str, threshold: float = 0.9) -> bool:
    if script not in ("Telugu", "Devanagari", "Latin", "Arabic"):
        return True
    return script_ratio(text, script) >= threshold


def dominant_script(text: str) -> str | None:
    counts: dict[str, int] = {}
    for c in text:
        s = char_script(c)
        if s:
            counts[s] = counts.get(s, 0) + 1
    return max(counts, key=counts.get) if counts else None


def digits_to_ascii(text: str) -> str:
    return "".join(_NATIVE_DIGITS.get(c, c) for c in text)


def digit_sequences(text: str) -> list[str]:
    return re.findall(r"\d+", digits_to_ascii(text))


def normalize_route(value: str) -> str:
    """218 / '2 1 8' / '218d' / '2O1' -> '218', '218', '218D', '201'."""
    v = digits_to_ascii(value).upper().replace(" ", "").replace("-", "")
    v = re.sub(r"(?<=\d)O(?=\d)", "0", v)
    v = re.sub(r"(?<=\d)[IL](?=\d)", "1", v)
    return v


ROUTE_TOKEN = re.compile(r"(?<![A-Z0-9])\d{1,3}[A-Z]{0,2}(?:/[A-Z0-9]{1,2})?(?![A-Z0-9])")


def route_tokens(text: str) -> set[str]:
    """Route-like tokens in free OCR text, normalized."""
    t = digits_to_ascii(text).upper()
    t = re.sub(r"(?<=\d)O(?=\d)", "0", t)
    return {normalize_route(m) for m in ROUTE_TOKEN.findall(t)}


def normalize_name(s: str) -> str:
    """Lower case, punctuation to spaces. Keeps vowel signs and viramas (Unicode marks): the regex word class drops
    them and turn శ్రీ లక్ష్మి into 'శ ర లక ష మ'."""
    s = unicodedata.normalize("NFC", s).lower()
    s = "".join(ch if unicodedata.category(ch)[0] in "LMN" or ch.isspace() else " " for ch in s)
    return re.sub(r"\s+", " ", s).strip()


def fuzzy_eq(a: str, b: str, threshold: int = 85) -> bool:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    return max(fuzz.ratio(na, nb), fuzz.token_sort_ratio(na, nb)) >= threshold


def text_in(needle: str, haystack: str, threshold: int = 88) -> bool:
    """Is `needle` (a name or a line of text) written somewhere in `haystack` (e.g. OCR output of the whole sign)?
    Fuzzy, to absorb OCR slips; needles under 4 letters are ignored (too easy to match by chance)."""
    n, h = normalize_name(needle), normalize_name(haystack)
    if len(n.replace(" ", "")) < 4 or not h:
        return False
    return n in h or fuzz.partial_ratio(n, h) >= threshold


# Acronyms that contain vowels (acronyms without vowels, such as HDFC, GHMC, BSNL, TSRTC, MRP, are detected)
ACRONYMS = {"SBI", "ATM", "LIC", "ICICI", "IDBI", "UPI", "EMI", "AC", "TV", "ID", "OK", "LED", "AIIMS", "IKEA",
            "MG", "NH", "SH", "PO", "BHEL", "ECIL", "IIIT", "ISRO", "OPD", "ICU", "ENT"}


def _acronym(word: str) -> bool:
    return word in ACRONYMS or not any(v in word for v in "AEIOU")


def speakable_caps(text: str, sentence: bool = False) -> str:
    """ALL-CAPS English to normal case so an English voice says words instead of spelling letters.
    Names: 'NEW SAGAR TIFFIN CENTRE' -> 'New Sagar Tiffin Centre'. Sentences (sentence=True):
    'PLEASE USE GATE NO. 2' -> 'Please use gate no. 2'. Short all-capital words (SBI, ATM, MRP) stay acronyms;
    text that already has lower-case letters is left alone."""
    letters = [c for c in text if c.isascii() and c.isalpha()]
    if not letters or any(c.islower() for c in letters):
        return text
    out = []
    for i, w in enumerate(text.split(" ")):
        core = "".join(c for c in w if c.isalpha())
        if not core or _acronym(core.upper()):
            out.append(w)
        elif sentence and i > 0:
            out.append(w.lower())
        else:
            out.append(w[:1] + w[1:].lower())
    return " ".join(out)


_KEEP_PUNCT = set(".,?।")


def sanitize_for_tts(text: str) -> str:
    """AnuvaadHub TTS rejects special characters: keep letters, marks, digits, spaces and . , ? ।"""
    out = []
    for ch in text:
        cat = unicodedata.category(ch)
        if cat[0] in "LMN" or ch.isspace() or ch in _KEEP_PUNCT:
            out.append(ch)
        elif ch in "-/:;–—":
            out.append(" ")
    s = re.sub(r"\s+", " ", "".join(out)).strip()
    return re.sub(r"\s+([.,?।])", r"\1", s)


def word_count(text: str) -> int:
    return len(text.split())


def chunk_words(text: str, max_words: int) -> list[str]:
    """Split into chunks of at most max_words, breaking at sentence ends first, then at commas, then anywhere."""
    text = text.strip()
    if not text:
        return []
    if word_count(text) <= max_words:
        return [text]
    sentences = re.split(r"(?<=[.?!।])\s+", text)
    pieces: list[str] = []
    for s in sentences:
        if word_count(s) <= max_words:
            pieces.append(s)
            continue
        for part in re.split(r"(?<=,)\s+", s):
            words = part.split()
            for i in range(0, len(words), max_words):
                pieces.append(" ".join(words[i:i + max_words]))
    chunks: list[str] = []
    cur: list[str] = []
    for p in pieces:
        if cur and word_count(" ".join(cur + [p])) > max_words:
            chunks.append(" ".join(cur))
            cur = []
        cur.append(p)
    if cur:
        chunks.append(" ".join(cur))
    return chunks
