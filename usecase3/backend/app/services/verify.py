"""Verify-then-speak: turn several independent readings into facts with a status.

Inputs
  frames    SignRecords from reader 1 (Gemini Flash-Lite), one per frame (1-3)
  evidence  reader 2 = a separate ultra-high-resolution read of the sharpest frame or a zoomed crop (the "arbiter"), plus OCR text
            (AnuvaadHub OCR on a white-background crop, optionally PaddleOCR)

Output statuses
  confirmed   enough frames agree AND an independent check agrees -> may be spoken as "the sign says"
  uncertain   read, but a check failed -> spoken as "it looks like ..., please check"
  unreadable  something is there but could not be read -> not spoken as a fact

Every rule is documented in README.md, section "Verification rules".
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from statistics import median

from .places import Gazetteer, gazetteer
from .text_utils import (SCRIPT_LANG, digit_sequences, fuzzy_eq, normalize_name, normalize_route,
                         route_tokens, script_ok, text_in)

CONFIRMED, UNCERTAIN, UNREADABLE = "confirmed", "uncertain", "unreadable"

TRANSIT = {"bus_route_board", "bus_stop", "metro_rail"}


@dataclass
class Evidence:
    arbiter: dict | None = None        # None = arbiter failed or was not run
    arbiter_ran: bool = False
    ocr_text: str = ""
    ocr_ran: bool = False
    notes: list[str] = field(default_factory=list)

    @property
    def arb(self) -> dict | None:
        if self.arbiter and self.arbiter.get("legible", True):
            return self.arbiter
        return None

    @property
    def any_second_reader(self) -> bool:
        return self.arb is not None or (self.ocr_ran and bool(self.ocr_text.strip()))


def _need(n: int) -> int:
    return 2 if n >= 2 else 1


def _votes_str(v: int, n: int) -> str:
    return f"{v}/{n}"


def consensus_box(frames: list[dict]) -> list[int]:
    boxes = [f.get("main_sign_box") for f in frames if f.get("sign_found")]
    boxes = [b for b in boxes if isinstance(b, list) and len(b) == 4 and b[0] < b[2] and b[1] < b[3]]
    if not boxes:
        return []
    return [int(median(b[i] for b in boxes)) for i in range(4)]


def _majority(values: list[str], need: int) -> list[str]:
    c = Counter(values)
    return [v for v, k in c.most_common() if k >= need]


# ---------------------------------------------------------------- routes

def _routes(frames, n, need, ev: Evidence) -> list[dict]:
    cands: dict[str, dict] = {}
    seen_unreadable = 0
    for i, f in enumerate(frames):
        for r in f.get("route_numbers", []):
            v = normalize_route(r.get("value", ""))
            if not v or r.get("legibility") == "unreadable":
                seen_unreadable += 1
                continue
            c = cands.setdefault(v, {"votes": set(), "clear": set()})
            c["votes"].add(i)
            if r.get("legibility") == "clear":
                c["clear"].add(i)

    arb = ev.arb
    arb_routes = {normalize_route(x) for x in (arb or {}).get("route_numbers", []) if x}
    ocr_routes = route_tokens(ev.ocr_text) if ev.ocr_ran else set()

    fields: list[dict] = []
    ordered = sorted(cands.items(), key=lambda kv: (-len(kv[1]["votes"]), -len(kv[0])))
    for v, c in ordered:
        votes, clear = len(c["votes"]), len(c["clear"])
        # drop a partial read that is a prefix of a stronger candidate ("21" vs "218")
        if any(o != v and o.startswith(v) and len(cands[o]["votes"]) >= votes for o in cands):
            continue
        if votes < need:
            continue
        agree = v in arb_routes or v in ocr_routes
        disagree = arb is not None and bool(arb_routes) and not agree
        checks = {"frames": _votes_str(votes, n), "clear": _votes_str(clear, n),
                  "arbiter": "agree" if v in arb_routes else ("disagree" if disagree else "n/a" if arb is None else "silent"),
                  "ocr": "agree" if v in ocr_routes else ("ran" if ev.ocr_ran else "n/a")}
        if clear >= need and agree:
            status, reason = CONFIRMED, "frames agree and an independent reader agrees"
        elif clear >= need and not ev.any_second_reader and n >= 3 and votes == n:
            status, reason = CONFIRMED, "all 3 frames agree; second reader unavailable"
        elif disagree:
            status, reason = UNCERTAIN, "the second reader read something different"
        elif clear < need:
            status, reason = UNCERTAIN, "only partly legible"
        else:
            status, reason = UNCERTAIN, "no independent reader confirmed it"
        fields.append({"kind": "route", "value": v, "status": status, "votes": checks["frames"],
                       "checks": checks, "reason": reason})

    if not fields and (cands or seen_unreadable):
        fields.append({"kind": "route", "value": "", "status": UNREADABLE, "votes": _votes_str(0, n),
                       "checks": {}, "reason": "a route number is visible but could not be read consistently"})
    return fields


# ---------------------------------------------------------------- places

def _cluster(items: list[tuple[int, dict]], key) -> list[list[tuple[int, dict]]]:
    clusters: list[list[tuple[int, dict]]] = []
    for i, it in items:
        k = key(it)
        if not normalize_name(k):
            continue
        for cl in clusters:
            if fuzzy_eq(key(cl[0][1]), k):
                cl.append((i, it))
                break
        else:
            clusters.append([(i, it)])
    return clusters


def _texts_by_lang(members: list[dict], text_key="text", script_key="script") -> dict[str, str]:
    by: dict[str, Counter] = defaultdict(Counter)
    for m in members:
        lang = SCRIPT_LANG.get(m.get(script_key, ""))
        t = (m.get(text_key) or "").strip()
        if lang and t:
            by[lang][t] += 1
    return {lang: c.most_common(1)[0][0] for lang, c in by.items()}


def _places(frames, n, need, ev: Evidence, gaz: Gazetteer) -> list[dict]:
    items = [(i, p) for i, f in enumerate(frames) for p in f.get("places", [])]
    arb_places = (ev.arb or {}).get("places", [])
    out = []
    for cl in _cluster(items, key=lambda p: p.get("romanized") or p.get("text", "")):
        members = [p for _, p in cl]
        votes = len({i for i, _ in cl})
        clear = len({i for i, p in cl if p.get("legibility") == "clear"})
        if votes < need:
            continue
        roman = Counter(p.get("romanized", "").strip() for p in members if p.get("romanized")).most_common(1)
        rep = roman[0][0] if roman else members[0].get("text", "")
        texts = _texts_by_lang(members)
        scripts_ok = all(script_ok(p.get("text", ""), p.get("script", "Other")) for p in members)
        place = gaz.match(rep, *texts.values())
        arb_ok = any(fuzzy_eq(rep, ap.get("romanized", "")) or any(fuzzy_eq(t, ap.get("text", "")) for t in texts.values())
                     for ap in arb_places)
        if place and "en" not in texts:
            texts.setdefault("en", place.en)
        checks = {"frames": _votes_str(votes, n), "clear": _votes_str(clear, n), "script": scripts_ok,
                  "known_place": bool(place), "arbiter": "agree" if arb_ok else ("n/a" if ev.arb is None else "silent")}
        if n == 1:
            ok = clear >= 1 and scripts_ok and arb_ok
        else:
            ok = clear >= need and scripts_ok and (bool(place) or arb_ok)
        if ok:
            status, reason = CONFIRMED, "frames agree, script checks out, and it is a known place or a second reader agrees"
        elif not scripts_ok:
            status, reason = UNCERTAIN, "the letters do not match the script the sign uses"
        elif clear < need:
            status, reason = UNCERTAIN, "only partly legible"
        else:
            status, reason = UNCERTAIN, "not in the known-place list and not confirmed by a second reader"
        role = Counter(p.get("role", "other") for p in members).most_common(1)[0][0]
        out.append({"kind": "place", "role": role, "value": place.en if place else rep, "texts": texts,
                    "place_id": place.id if place else None, "status": status, "votes": checks["frames"],
                    "checks": checks, "reason": reason})
    rank = {CONFIRMED: 0, UNCERTAIN: 1}
    role_rank = {"destination": 0, "station": 1, "street": 2, "area": 3, "landmark": 4, "via": 5, "other": 6}
    return sorted(out, key=lambda f: (rank.get(f["status"], 2), role_rank.get(f["role"], 9)))


# ---------------------------------------------------------------- platform, arrows, symbols, signal

def _platform(frames, n, need, ev: Evidence) -> list[dict]:
    vals = [str(f.get("platform") or "").upper().replace("PLATFORM", "").replace("PF", "").strip()
            for f in frames]
    c = Counter(v for v in vals if v)
    if not c:
        return []
    v, votes = c.most_common(1)[0]
    if votes < need:
        return []
    arb_p = str((ev.arb or {}).get("platform") or "").upper().replace("PLATFORM", "").strip()
    agree = arb_p == v or (ev.ocr_ran and v in digit_sequences(ev.ocr_text))
    ok = agree or (not ev.any_second_reader and n >= 3 and votes == n)
    return [{"kind": "platform", "value": v, "status": CONFIRMED if ok else UNCERTAIN, "votes": _votes_str(votes, n),
             "checks": {"arbiter": "agree" if arb_p == v else "n/a"}, "reason": "" if ok else "not double-checked"}]


def _arrows(frames, n, need, places: list[dict]) -> list[dict]:
    per_dir: dict[str, dict] = {}
    for i, f in enumerate(frames):
        for a in f.get("arrows", []):
            d = a.get("direction")
            if not d or a.get("legibility") == "unreadable":
                continue
            e = per_dir.setdefault(d, {"votes": set(), "applies": Counter()})
            e["votes"].add(i)
            if a.get("applies_to"):
                e["applies"][a["applies_to"]] += 1
    out = []
    for d, e in per_dir.items():
        votes = len(e["votes"])
        if votes < need:
            continue
        applies_raw = e["applies"].most_common(1)[0][0] if e["applies"] else ""
        target = next((p for p in places if applies_raw and (fuzzy_eq(p["value"], applies_raw)
                       or any(fuzzy_eq(t, applies_raw) for t in p["texts"].values()))), None)
        status = CONFIRMED if n >= 2 else UNCERTAIN  # a single photo cannot double-check an arrow
        out.append({"kind": "arrow", "value": d, "applies_to": target["value"] if target else applies_raw,
                    "place_ref": target["value"] if target else None, "status": status,
                    "votes": _votes_str(votes, n), "checks": {}, "reason": "" if status == CONFIRMED else "single photo"})
    return out


def _symbols(frames, n, need, ev: Evidence) -> list[dict]:
    per: dict[str, dict] = {}
    for i, f in enumerate(frames):
        for s in f.get("symbols", []):
            code = s.get("code")
            if not code or s.get("legibility") == "unreadable":
                continue
            e = per.setdefault(code, {"votes": set(), "clear": set(), "values": Counter()})
            e["votes"].add(i)
            if s.get("legibility") == "clear":
                e["clear"].add(i)
            if s.get("value"):
                e["values"][digit_sequences(s["value"])[0] if digit_sequences(s["value"]) else s["value"]] += 1
    arb = ev.arb or {}
    arb_codes = set(arb.get("symbols", []))
    out = []
    for code, e in per.items():
        votes, clear = len(e["votes"]), len(e["clear"])
        if votes < need:
            continue
        value, vvotes = (e["values"].most_common(1)[0] if e["values"] else ("", 0))
        code_ok = clear >= need and (n >= 2 or code in arb_codes)
        if code == "speed_limit":
            arb_v = digit_sequences(arb.get("speed_limit_value", "") or "")
            value_ok = bool(value) and vvotes >= need and (
                (arb_v and arb_v[0] == value) or (ev.ocr_ran and value in digit_sequences(ev.ocr_text))
                or (not ev.any_second_reader and n >= 3 and vvotes == n))
            code_ok = code_ok and value_ok
        out.append({"kind": "traffic_sign", "value": code, "number": value, "status": CONFIRMED if code_ok else UNCERTAIN,
                    "votes": _votes_str(votes, n), "checks": {"arbiter": "agree" if code in arb_codes else "n/a"},
                    "reason": "" if code_ok else "not double-checked"})
    return out


def _signal(frames, n, need, ev: Evidence) -> list[dict]:
    states = [f.get("pedestrian_signal", {}).get("state", "none") for f in frames]
    seen = [s for s in states if s and s != "none"]
    if not seen:
        return []
    arb_state = (ev.arb or {}).get("pedestrian_signal_state", "none") if ev.arb else None
    distinct = set(seen)
    countdowns = Counter(str(f.get("pedestrian_signal", {}).get("countdown") or "") for f in frames)
    countdowns.pop("", None)
    if len(seen) < need:
        value, status = "unclear", UNCERTAIN
    elif len(distinct) > 1 or "flashing" in distinct:
        value, status = "changing", UNCERTAIN
    else:
        value = seen[0]
        arb_ok = arb_state in (None, value)  # None: arbiter unavailable
        status = CONFIRMED if (len(seen) == n and n >= 2 and arb_ok) else UNCERTAIN
    cd = ""
    if countdowns:
        v, k = countdowns.most_common(1)[0]
        cd = v if k >= need else ""
    return [{"kind": "pedestrian_signal", "value": value, "countdown": cd, "status": status,
             "votes": _votes_str(len(seen), n), "checks": {"arbiter": arb_state or "n/a"},
             "reason": "signal readings must agree in every frame" if status != CONFIRMED else ""}]


# ---------------------------------------------------------------- shops, ads, free text

def _second_reader_saw(candidates: list[str], ev: Evidence) -> str:
    """Which independent reader also read one of these strings: 'arbiter', 'ocr' or '' (none).

    The arbiter must have written it as a shop name, a place or a line of text (fuzzy, any script);
    OCR must contain it (fuzzy substring of the whole OCR output, at least 4 letters)."""
    cands = [c for c in candidates if c and normalize_name(c)]
    arb = ev.arb or {}
    arb_strings = ([arb.get("business_name_romanized", ""), arb.get("business_name_text", "")]
                   + list(arb.get("text_lines", []) or [])
                   + [x for p in arb.get("places", []) for x in (p.get("text", ""), p.get("romanized", ""))])
    # the same name, or every word of it inside what the arbiter read ("NEW SAGAR" in "NEW SAGAR TIFFIN CENTRE")
    if any(fuzzy_eq(c, a) or text_in(c, a, 95) for c in cands for a in arb_strings if a):
        return "arbiter"
    if ev.ocr_ran and any(text_in(c, ev.ocr_text) for c in cands):
        return "ocr"
    return ""


def _business(frames, n, need, ev: Evidence) -> list[dict]:
    items = [(i, f["business"]) for i, f in enumerate(frames)
             if f.get("business", {}).get("name_text") or f.get("business", {}).get("name_romanized")]
    out: list[dict] = []
    if items:
        clusters = _cluster(items, key=lambda b: b.get("name_romanized") or b.get("name_text", ""))
        best = max(clusters, key=lambda cl: len({i for i, _ in cl}))
        members = [b for _, b in best]
        votes = len({i for i, _ in best})
        if votes >= need:
            rep = Counter(b.get("name_romanized") or b.get("name_text") for b in members).most_common(1)[0][0]
            texts = _texts_by_lang(members, "name_text", "name_script")
            texts.setdefault("en", rep)
            # independent check on the name in any script it was read in (romanized spellings vary a lot)
            seen_by = _second_reader_saw([rep, *texts.values()], ev)
            ok = bool(seen_by) or (n >= 3 and votes == n and ev.arb is None)
            out.append({"kind": "business", "value": rep, "texts": texts, "status": CONFIRMED if ok else UNCERTAIN,
                        "votes": _votes_str(votes, n), "checks": {"second_reader": seen_by or "n/a"},
                        "reason": "" if ok else "shop name not double-checked"})
    biz = [f.get("business", {}) for f in frames]
    cats = Counter(b.get("category_en", "").strip().lower() for b in biz if b.get("category_en"))
    if cats:
        cat, k = cats.most_common(1)[0]
        if k >= need:
            out.append({"kind": "business_category", "value": cat, "status": UNCERTAIN, "votes": _votes_str(k, n),
                        "checks": {}, "reason": "a description, never a certainty"})
    hours = Counter((b.get("open_time", ""), b.get("close_time", "")) for b in biz if b.get("open_time") and b.get("close_time"))
    if hours:
        (o, c), k = hours.most_common(1)[0]
        text = next((b.get("hours_text") for b in biz if b.get("hours_text")), "")
        out.append({"kind": "hours", "open": o, "close": c, "value": text or f"{o}-{c}",
                    "status": CONFIRMED if k >= need else UNCERTAIN, "votes": _votes_str(k, n), "checks": {}, "reason": ""})
    hints = Counter(b.get("open_hint", "none") for b in biz if b.get("open_hint") not in (None, "", "none"))
    if hints:
        h, k = hints.most_common(1)[0]
        if k >= need:
            out.append({"kind": "open_hint", "value": h, "status": CONFIRMED, "votes": _votes_str(k, n),
                        "checks": {}, "reason": ""})
    return out


def _advert(frames, n, need) -> list[dict]:
    ads = [f.get("advertisement", {}) for f in frames]
    brands = Counter(a.get("brand", "").strip() for a in ads if a.get("brand"))
    products = Counter(a.get("product_en", "").strip() for a in ads if a.get("product_en"))
    if not brands and not products:
        return []
    brand, k = brands.most_common(1)[0] if brands else ("", 0)
    product = products.most_common(1)[0][0] if products else ""
    return [{"kind": "advertisement", "value": brand, "product": product, "texts": {"en": brand} if brand else {},
             "status": CONFIRMED if brand and k >= need and n >= 2 else UNCERTAIN, "votes": _votes_str(k, n),
             "checks": {}, "reason": ""}]


def _free_text(frames, n, need, exclude: list[str], ev: Evidence | None = None) -> list[dict]:
    ev = ev or Evidence()
    items = [(i, t) for i, f in enumerate(frames) for t in f.get("other_text", [])]
    out = []
    for cl in _cluster(items, key=lambda t: t.get("text", "")):
        members = [t for _, t in cl]
        votes = len({i for i, _ in cl})
        if votes < need:
            continue
        text = Counter(t.get("text", "").strip() for t in members).most_common(1)[0][0]
        if any(fuzzy_eq(text, e, 88) for e in exclude if e):
            continue
        script = Counter(t.get("script", "Other") for t in members).most_common(1)[0][0]
        clear = len({i for i, t in cl if t.get("legibility") == "clear"})
        seen_by = _second_reader_saw([text], ev)
        # several frames agreeing, or (single photo) an independent reader that read the same line
        ok = clear >= need and script_ok(text, script) and (n >= 2 or bool(seen_by))
        out.append({"kind": "text", "value": text, "lang": SCRIPT_LANG.get(script, "en"),
                    "status": CONFIRMED if ok else UNCERTAIN, "votes": _votes_str(votes, n),
                    "checks": {"second_reader": seen_by or "n/a"}, "reason": "" if ok else "not double-checked"})
    return out[:10]


# ---------------------------------------------------------------- money and the scene around the sign

def _currency(frames, n, need, ev: Evidence) -> list[dict]:
    """A rupee note: frames agree on the value AND reader 2 or OCR read the same digits (a mistake costs money)."""
    votes: Counter = Counter()
    clear: Counter = Counter()
    for f in frames:
        seen = set()
        for c in f.get("currency", []):
            v = (digit_sequences(str(c.get("value", ""))) or [""])[0]
            if not v or c.get("legibility") == "unreadable" or v in seen:
                continue
            seen.add(v)
            votes[v] += 1
            if c.get("legibility") == "clear":
                clear[v] += 1
    arb_vals = {(digit_sequences(str(x)) or [""])[0] for x in (ev.arb or {}).get("currency_values", [])}
    out = []
    for v, k in votes.most_common(3):
        if k < need:
            continue
        agree = v in arb_vals or (ev.ocr_ran and v in digit_sequences(ev.ocr_text))
        ok = clear[v] >= need and agree
        out.append({"kind": "currency", "value": v, "status": CONFIRMED if ok else UNCERTAIN, "votes": _votes_str(k, n),
                    "checks": {"second_reader": "agree" if agree else "n/a"},
                    "reason": "" if ok else "the value was not double-checked"})
    return out


# Never repeat a claim that a way is clear or safe: Oriel only describes, the user decides (CLAUDE.md rule 3).
_UNSAFE_CLAIM = re.compile(r"\b(safe|safely|clear (?:to|of|path|road|way)|path is clear|road is clear|way is clear|"
                           r"no (?:traffic|cars|vehicles|obstacles)|nothing in (?:the|your) way|you can (?:walk|cross|go))\b",
                           re.IGNORECASE)


def _clean_sentences(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(p for p in parts if p and not _UNSAFE_CLAIM.search(p)).strip()


def scene_of(frames: list[dict]) -> dict:
    """What is in front of the camera: a description (never 'confirmed', it is an interpretation) and hazards.
    Hazards seen in ANY frame are kept: warning about a possible obstacle is the safe side."""
    descs = [_clean_sentences((f.get("scene") or {}).get("description_en", "")) for f in frames]
    descs = [d for d in descs if d]
    # Hazards: the fullest list from one frame (frames word the same hazard differently; merging them made
    # run-on sentences). Short phrases, lower case so they read as one sentence.
    lists = []
    for f in frames:
        items = []
        for h in (f.get("scene") or {}).get("hazards_en", []) or []:
            h = _clean_sentences(str(h)).strip().rstrip(".")
            if h and len(h.split()) <= 12 and not any(fuzzy_eq(h, x, 70) for x in items):
                items.append(h[0].lower() + h[1:] if h[:2] != h[:2].upper() else h)
        lists.append(items)
    hazards = max(lists, key=len) if lists else []
    return {"description": max(descs, key=len) if descs else "", "hazards": hazards[:2]}


# ---------------------------------------------------------------- main

def verify(frames: list[dict], ev: Evidence | None = None, gaz: Gazetteer | None = None) -> dict:
    ev = ev or Evidence()
    gaz = gaz or gazetteer()
    n = len(frames)
    need = _need(n)
    sign_frames = [f for f in frames if f.get("sign_found")]
    sign_votes = len(sign_frames)

    cut = _majority([s for f in frames for s in set(f.get("cut_off_sides", []))], need)
    quality = _majority([q for f in frames for q in set(f.get("quality_issues", []))], need)
    issues = {"cut_off_sides": cut, "quality": quality,
              "sign_count": int(median([f.get("sign_count", 0) for f in sign_frames])) if sign_frames else 0,
              "unclear_parts": sorted({u for f in frames for u in f.get("unclear_parts", [])})[:6]}

    base = {"frames": n, "votes": _votes_str(sign_votes, n), "issues": issues,
            "second_reader": {"arbiter": "ran" if ev.arbiter_ran else "not run",
                              "arbiter_legible": ev.arb is not None, "ocr": "ran" if ev.ocr_ran else "not run"},
            "notes": ev.notes}
    base["scene"] = scene_of(frames)
    if sign_votes < need:
        return {**base, "sign_found": False, "category": "none", "box": [], "languages": [], "fields": []}

    category = Counter(f.get("sign_category", "other") for f in sign_frames).most_common(1)[0][0]
    languages = _majority([l for f in sign_frames for l in set(f.get("languages_present", []))], need)
    places = _places(sign_frames, n, need, ev, gaz)
    fields = (_routes(sign_frames, n, need, ev) + places + _platform(sign_frames, n, need, ev)
              + _arrows(sign_frames, n, need, places) + _symbols(sign_frames, n, need, ev)
              + _signal(sign_frames, n, need, ev) + _business(sign_frames, n, need, ev)
              + _advert(sign_frames, n, need) + _currency(sign_frames, n, need, ev))
    known_values = [f.get("value", "") for f in fields] + [t for f in fields for t in f.get("texts", {}).values()]
    fields += _free_text(sign_frames, n, need, known_values, ev)
    table = next((f.get("table_description") for f in sign_frames if f.get("table_description")), "")
    if table:
        fields.append({"kind": "table", "value": table, "lang": "en", "status": UNCERTAIN, "votes": "",
                       "checks": {}, "reason": "description of a table"})
    return {**base, "sign_found": True, "category": category, "box": consensus_box(sign_frames),
            "languages": languages, "fields": fields}


def key_kind(verified: dict) -> str | None:
    """Which field answers 'what does this sign mean?' for this category."""
    cat = verified.get("category")
    kinds = {f["kind"] for f in verified.get("fields", [])}
    if cat in TRANSIT and "route" in kinds:
        return "route"
    for kind, cats in (("currency", {"currency"}), ("pedestrian_signal", {"pedestrian_signal"}),
                       ("traffic_sign", {"traffic_sign", "emergency_exit", "warning"}),
                       ("business", {"shop"}), ("advertisement", {"advertisement"})):
        if cat in cats and kind in kinds:
            return kind
    for kind in ("route", "place", "currency", "pedestrian_signal", "traffic_sign", "business", "advertisement", "text"):
        if kind in kinds:
            return kind
    return None


def key_confirmed(verified: dict) -> bool:
    k = key_kind(verified)
    return bool(k) and any(f["kind"] == k and f["status"] == CONFIRMED for f in verified.get("fields", []))
