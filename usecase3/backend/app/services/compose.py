"""Turn a verified sign into spoken sentences in te / hi / en.

Key facts are built from fixed templates (data/speech_templates.json), never from machine
translation. Only free text (shop category, advert product, other words on the sign) may need
translation; those lines carry a `pending` entry that the pipeline resolves with safe_translate.

Line = {id, kind, status, text, pending?}
  status: confirmed | uncertain | info   (the UI shows a badge per line)
"""

from __future__ import annotations

from datetime import datetime

from ..content import templates, traffic_signs
from . import hours
from .text_utils import speakable_caps
from .verify import CONFIRMED, TRANSIT, UNCERTAIN, UNREADABLE

MAX_KEY_LINES = 3
# categories whose meaning is in their words (rather than a route, a shop name or a pictogram)
TEXT_FIRST = {"information", "warning", "other", "emergency_exit"}


def join_lines(lines: list[str], lang: str) -> str:
    """'NOTICE', 'PLEASE USE GATE NO. 2' -> 'NOTICE. PLEASE USE GATE NO. 2' (the template adds the final stop)."""
    stop = "। " if lang == "hi" else ". "
    parts = [ln.strip().rstrip(".।,;: ") for ln in lines if ln.strip()]
    if lang == "en":
        parts = [speakable_caps(x, sentence=True) for x in parts]  # each line is its own sentence
    return stop.join(p for p in parts if p)


def T(key: str, lang: str, mode: str = "standard") -> str:
    t = templates()["templates"][key]
    if mode == "simple" and "simple" in t and lang in t["simple"]:
        return t["simple"][lang]
    return t.get(lang) or t["en"]


def fill(tpl: str, **slots: str) -> str:
    out = tpl
    for k, v in slots.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def route_words(value: str, lang: str, style: str | None = None) -> str:
    """'218' -> 'two one eight' / 'రెండు ఒకటి ఎనిమిది'. Letters spelled in the user's script."""
    data = templates()
    style = style or data["route_digit_style"]["default"]
    digits = data["digit_words"]["en" if style == "english" else lang]
    letters = data["letter_names"].get(lang, {})
    words = []
    for ch in value:
        if ch.isdigit():
            words.append(digits[int(ch)])
        elif ch.upper() in letters:
            words.append(letters[ch.upper()])
        elif ch.strip():
            words.append(ch)
    return " ".join(words)


def direction_words(direction: str, lang: str) -> str:
    d = templates()["directions"].get(direction, {})
    return d.get(lang) or d.get("en") or direction


def name_of(field: dict, lang: str) -> str:
    """Name in the user's script. English uses the clean value (signs are often ALL CAPS)."""
    if lang == "en":
        return speakable_caps(field.get("value") or (field.get("texts") or {}).get("en", ""))
    return (field.get("texts") or {}).get(lang) or field.get("value", "")


def sign_name(code: str, lang: str) -> str:
    s = traffic_signs()["signs"].get(code) or traffic_signs()["signs"]["other"]
    return s.get(lang) or s["en"]


def sign_note(code: str, lang: str) -> str:
    data = traffic_signs()
    note_key = (data["signs"].get(code) or {}).get("note")
    return data["notes"][note_key].get(lang, "") if note_key else ""


class Builder:
    def __init__(self, lang: str, mode: str, style: str | None):
        self.lang, self.mode, self.style = lang, mode, style
        self.key: list[dict] = []
        self.more: list[dict] = []
        self.spell: list[dict] = []
        self._n = 0

    def line(self, where: str, kind: str, status: str, text: str = "", pending: dict | None = None) -> None:
        self._n += 1
        item = {"id": f"l{self._n}", "kind": kind, "status": status, "text": text}
        if pending:
            item["pending"] = pending
        (self.key if where == "key" and len(self.key) < MAX_KEY_LINES else self.more).append(item)

    def t(self, key: str) -> str:
        return T(key, self.lang, self.mode)

    def route(self, value: str) -> str:
        return route_words(value, self.lang, self.style)

    def text_line(self, where: str, field: dict, kind: str = "text") -> None:
        """Free text: read it directly if it is already in the user's language, else translate it."""
        tpl_key = "says_text" if field["status"] == CONFIRMED else "looks_text"
        src = field.get("lang", "en")
        if src == self.lang:
            value = speakable_caps(field["value"], sentence=True) if src == "en" else field["value"]
            self.line(where, kind, field["status"], fill(self.t(tpl_key), text=value))
        else:
            self.line(where, kind, field["status"], pending={"template": tpl_key, "slot": "text",
                                                               "source": field["value"], "src": src, "mode": self.mode})


def compose(verified: dict, lang: str, mode: str = "standard", style: str | None = None,
            now: datetime | None = None) -> dict:
    b = Builder(lang, mode, style)
    fields = verified.get("fields", [])
    by = lambda k: [f for f in fields if f["kind"] == k]  # noqa: E731

    if not verified.get("sign_found"):
        return {"key": [], "more": [], "spell": [], "empty": True}

    cat = verified.get("category")
    routes, places = by("route"), by("place")
    arrows = by("arrow")
    arrow_for = {a["place_ref"]: a for a in arrows if a.get("place_ref")}
    used_places: set[str] = set()

    # ---- transit: route + destination first
    if routes and (cat in TRANSIT or not places or routes[0]["status"] != UNREADABLE):
        r = routes[0]
        dest = next((p for p in places if p["role"] == "destination"), places[0] if places else None)
        if r["status"] == CONFIRMED and dest and dest["status"] == CONFIRMED:
            b.line("key", "route", CONFIRMED, fill(b.t("says_route_to"), route=b.route(r["value"]), place=name_of(dest, lang)))
            used_places.add(dest["value"])
        elif r["status"] == CONFIRMED:
            b.line("key", "route", CONFIRMED, fill(b.t("says_route"), route=b.route(r["value"])))
        elif r["status"] == UNCERTAIN:
            b.line("key", "route", UNCERTAIN, fill(b.t("looks_route"), route=b.route(r["value"])))
        elif r["status"] == UNREADABLE and dest and dest["status"] == CONFIRMED:
            b.line("key", "route", UNREADABLE, fill(b.t("route_unreadable"), place=name_of(dest, lang)))
            used_places.add(dest["value"])
        for extra in routes[1:]:
            if extra["status"] == CONFIRMED:
                b.line("more", "route", CONFIRMED, fill(b.t("also_route"), route=b.route(extra["value"])))
            elif extra["status"] == UNCERTAIN:
                b.line("more", "route", UNCERTAIN, fill(b.t("looks_route"), route=b.route(extra["value"])))

    # ---- places, with their arrows when the sign pairs them
    for p in places:
        if p["value"] in used_places:
            continue
        a = arrow_for.get(p["value"])
        where = "key" if p is places[0] or cat in ("direction", "metro_rail") else "more"
        if a:
            ok = p["status"] == CONFIRMED and a["status"] == CONFIRMED
            b.line(where, "direction", CONFIRMED if ok else UNCERTAIN,
                   fill(b.t("says_direction" if ok else "looks_direction"), place=name_of(p, lang),
                        direction=direction_words(a["value"], lang)))
        else:
            b.line(where, "place", p["status"],
                   fill(b.t("says_place" if p["status"] == CONFIRMED else "looks_place"), place=name_of(p, lang)))
        used_places.add(p["value"])

    for f in by("platform"):
        b.line("key", "platform", f["status"],
               fill(b.t("says_platform" if f["status"] == CONFIRMED else "looks_platform"), platform=b.route(f["value"])))
    for a in arrows:
        if a.get("place_ref"):
            continue
        b.line("key" if cat in ("direction", "emergency_exit") else "more", "arrow", a["status"],
               fill(b.t("says_arrow" if a["status"] == CONFIRMED else "looks_arrow"), direction=direction_words(a["value"], lang)))

    # ---- pedestrian signals: conservative by design
    for s in by("pedestrian_signal"):
        v, st = s["value"], s["status"]
        if v == "walk" and st == CONFIRMED:
            b.line("key", "signal", CONFIRMED, b.t("signal_walk"))
        elif v == "dont_walk":
            b.line("key", "signal", st, b.t("signal_dont_walk"))   # 'do not cross' is the safe direction
        elif v == "changing":
            b.line("key", "signal", UNCERTAIN, b.t("signal_changing"))
        else:
            b.line("key", "signal", UNCERTAIN, b.t("signal_unclear"))
        if s.get("countdown") and v != "unclear":
            b.line("more", "signal", UNCERTAIN, fill(b.t("signal_countdown"), value=s["countdown"]))

    # ---- traffic and facility pictograms
    for s in by("traffic_sign"):
        if s["value"] == "speed_limit" and s.get("number"):
            if s["status"] == CONFIRMED:
                b.line("key", "traffic_sign", CONFIRMED, fill(b.t("speed_limit"), value=s["number"]))
            else:
                b.line("key", "traffic_sign", UNCERTAIN, fill(b.t("looks_traffic_sign"), sign=sign_name("speed_limit", lang)))
            continue
        tpl = "says_traffic_sign" if s["status"] == CONFIRMED else "looks_traffic_sign"
        b.line("key", "traffic_sign", s["status"], fill(b.t(tpl), sign=sign_name(s["value"], lang)))
        note = sign_note(s["value"], lang)
        if note:
            b.line("key", "safety", "info", note)

    # ---- shops
    for f in by("business"):
        tpl = "shop_name" if f["status"] == CONFIRMED else "looks_shop_name"
        b.line("key", "business", f["status"], fill(b.t(tpl), name=name_of(f, lang)))
    for f in by("business_category"):
        if lang == "en":
            b.line("key", "business", UNCERTAIN, fill(b.t("shop_category"), category=f["value"]))
        else:
            b.line("key", "business", UNCERTAIN, pending={"template": "shop_category", "slot": "category",
                                                            "source": f["value"], "src": "en", "mode": mode})
    for f in by("hours"):
        b.line("more", "hours", f["status"], fill(b.t("shop_hours"), hours=hours.say_range(f["open"], f["close"], lang)))
        is_open = hours.probably_open(f["open"], f["close"], now)
        if is_open is not None:
            b.line("more", "hours", UNCERTAIN, b.t("probably_open" if is_open else "probably_closed"))
    for f in by("open_hint"):
        tpl = {"open_sign": "open_sign", "closed_sign": "closed_sign", "shutter_closed": "shutter_closed"}.get(f["value"])
        if tpl:
            b.line("key", "business", CONFIRMED if tpl != "shutter_closed" else UNCERTAIN, b.t(tpl))

    # ---- advertisements
    for f in by("advertisement"):
        if f.get("value"):
            b.line("key", "advertisement", f["status"], fill(b.t("advertisement"), brand=name_of(f, lang)))
        else:
            b.line("key", "advertisement", UNCERTAIN, b.t("advertisement_unknown"))
        if f.get("product"):
            if lang == "en":
                b.line("more", "advertisement", UNCERTAIN, fill(b.t("advert_product"), text=f["product"]))
            else:
                b.line("more", "advertisement", UNCERTAIN, pending={"template": "advert_product", "slot": "text",
                                                                      "source": f["product"], "src": "en", "mode": mode})

    # ---- remaining words on the sign: on notices, nameplates and banners the words ARE the message, so up to
    # four lines are read together as one sentence, preferring the lines already written in the user's language
    texts = by("text")
    used: set[int] = set()
    if texts and (not b.key or cat in TEXT_FIRST):
        groups: dict[str, list[dict]] = {}
        for f in texts:
            groups.setdefault(f.get("lang", "en"), []).append(f)
        main_lang = lang if lang in groups else max(groups, key=lambda k: len(groups[k]))
        for status in (CONFIRMED, UNCERTAIN):
            sel = [f for f in groups[main_lang] if f["status"] == status][:4]
            if sel:
                b.text_line("key", {"value": join_lines([f["value"] for f in sel], main_lang),
                                    "status": status, "lang": main_lang})
                used.update(id(f) for f in sel)
    for f in texts:
        if id(f) not in used:
            b.text_line("more", f)
    for f in by("table"):
        if lang == "en":
            b.line("more", "table", UNCERTAIN, fill(b.t("table_info"), text=f["value"]))
        else:
            b.line("more", "table", UNCERTAIN, pending={"template": "table_info", "slot": "text",
                                                          "source": f["value"], "src": "en", "mode": mode})

    if not b.key:
        b.line("key", "unclear", UNCERTAIN, b.t("sign_unclear"))

    # ---- spelling help for the key route and place
    if routes and routes[0]["value"]:
        b.spell.append({"id": "s1", "kind": "spell", "status": routes[0]["status"],
                        "text": fill(b.t("route_spelled"), route=b.route(routes[0]["value"]))})
    named = next((f for f in fields if f["kind"] in ("place", "business") and f.get("value")), None)
    if named:
        letters = " ".join(ch for ch in named["value"].upper() if ch.isalnum())
        b.spell.append({"id": "s2", "kind": "spell", "status": named["status"],
                        "text": fill(b.t("spell_letters"), name=name_of(named, lang), letters=letters)})

    return {"key": b.key, "more": b.more, "spell": b.spell, "empty": False}


def pending_lines(speech: dict) -> list[dict]:
    return [ln for part in ("key", "more") for ln in speech.get(part, []) if ln.get("pending")]


def resolve(line: dict, translated: str | None, lang: str) -> None:
    """Fill a pending line with its translated text, or drop to an honest fallback."""
    p = line.pop("pending")
    if translated:
        line["text"] = fill(T(p["template"], lang, p.get("mode", "standard")), **{p["slot"]: translated})
    else:
        line["text"] = fill(T(p["template"], "en", p.get("mode", "standard")), **{p["slot"]: p["source"]})
        line["lang_fallback"] = "en"
