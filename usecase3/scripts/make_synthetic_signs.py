"""Make a SYNTHETIC test set: Hyderabad-style signs, 3 phone-like frames each, with labels.

Use this until you have real photos; replace or extend it with real ones before you
quote numbers to judges. The routes and destinations are invented pairings, not real
TSRTC routes.

Outputs (repo-relative):
    eval/photos/synthetic/<id>_<a|b|c>.jpg   3 frames per sign, 1280x960
    eval/print/<id>.png                       clean sign images to show on a screen or print for the live demo
    eval/labels_synthetic.json                ground truth in the eval/labels_template.json format

Usage (from the repo root):
    python scripts/make_synthetic_signs.py
Fonts (Noto Sans, SIL Open Font License) are downloaded into eval/fonts/ on first run.
"""

from __future__ import annotations

import json
import random
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "eval" / "fonts"
OUT_FRAMES = ROOT / "eval" / "photos" / "synthetic"
OUT_PRINT = ROOT / "eval" / "print"
LABELS = ROOT / "eval" / "labels_synthetic.json"
W, H = 1280, 960

FONTS = {
    "te": ("NotoSansTelugu.ttf", "notosanstelugu/NotoSansTelugu%5Bwdth%2Cwght%5D.ttf"),
    "hi": ("NotoSansDevanagari.ttf", "notosansdevanagari/NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf"),
    "en": ("NotoSans.ttf", "notosans/NotoSans%5Bwdth%2Cwght%5D.ttf"),
}
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/"


def ensure_fonts() -> None:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for name, src in FONTS.values():
        path = FONT_DIR / name
        if not path.exists():
            print(f"downloading {name} ...")
            urllib.request.urlretrieve(FONT_URL + src, path)


_font_cache: dict = {}


def font(lang: str, size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    key = (lang, size, bold)
    if key not in _font_cache:
        f = ImageFont.truetype(str(FONT_DIR / FONTS[lang][0]), size, layout_engine=ImageFont.Layout.RAQM)
        try:
            f.set_variation_by_axes([700 if bold else 400, 100])
        except Exception:
            pass
        _font_cache[key] = f
    return _font_cache[key]


def text_fit(draw, box, text, lang, fill, max_size=140, bold=True, align="center"):
    """Draw text as large as fits in box=(x0,y0,x1,y1). Returns the drawn bbox."""
    x0, y0, x1, y1 = box
    size = max_size
    while size > 10:
        f = font(lang, size, bold)
        l, t, r, b = draw.textbbox((0, 0), text, font=f)
        if r - l <= (x1 - x0) and b - t <= (y1 - y0):
            break
        size -= 4
    f = font(lang, size, bold)
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    tw, th = r - l, b - t
    x = x0 + ((x1 - x0) - tw) / 2 if align == "center" else x0
    y = y0 + ((y1 - y0) - th) / 2
    draw.text((x - l, y - t), text, font=f, fill=fill)
    return (x, y, x + tw, y + th)


def arrow(draw, box, direction, fill):
    """Solid arrow inside box, pointing left/right/up."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if direction in ("left", "right"):
        s = -1 if direction == "left" else 1
        tip = cx + s * w * 0.45
        base = cx - s * w * 0.45
        neck = cx + s * w * 0.05
        pts = [(base, cy - h * 0.12), (neck, cy - h * 0.12), (neck, cy - h * 0.35), (tip, cy),
               (neck, cy + h * 0.35), (neck, cy + h * 0.12), (base, cy + h * 0.12)]
    else:  # up
        tip, base, neck = cy - h * 0.45, cy + h * 0.45, cy - h * 0.05
        pts = [(cx - w * 0.12, base), (cx - w * 0.12, neck), (cx - w * 0.35, neck), (cx, tip),
               (cx + w * 0.35, neck), (cx + w * 0.12, neck), (cx + w * 0.12, base)]
    draw.polygon(pts, fill=fill)


# ---------------- sign designs ----------------

def sign_route_board(route, place):
    img = Image.new("RGB", (1400, 520), "#0B5D3B")
    d = ImageDraw.Draw(img)
    d.rectangle([12, 12, 1388, 508], outline="white", width=6)
    d.rectangle([40, 40, 470, 480], fill="#F6C915")
    route_box = (40, 40, 470, 480)
    text_fit(d, (60, 70, 450, 450), route, "en", "#111111", max_size=260)
    text_fit(d, (510, 50, 1360, 270), place["te"], "te", "white", max_size=150)
    text_fit(d, (510, 290, 1360, 470), place["en"].upper(), "en", "white", max_size=120)
    return img, {"route_box": route_box}


def sign_bus_stop(place):
    img = Image.new("RGB", (1200, 700), "#1F4E9C")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1200, 170], fill="white")
    text_fit(d, (30, 15, 390, 155), "బస్ స్టాప్", "te", "#1F4E9C", max_size=90)
    text_fit(d, (420, 15, 780, 155), "बस स्टॉप", "hi", "#1F4E9C", max_size=90)
    text_fit(d, (810, 15, 1170, 155), "BUS STOP", "en", "#1F4E9C", max_size=90)
    text_fit(d, (40, 190, 1160, 360), place["te"], "te", "white", max_size=150)
    text_fit(d, (40, 370, 1160, 520), place["hi"], "hi", "white", max_size=130)
    text_fit(d, (40, 530, 1160, 680), place["en"].upper(), "en", "white", max_size=120)
    return img, {}


def sign_metro_station(place):
    img = Image.new("RGB", (1500, 620), "#14325C")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1500, 26], fill="#D9262C")
    d.rectangle([0, 594, 1500, 620], fill="#D9262C")
    text_fit(d, (60, 50, 1440, 230), place["te"], "te", "white", max_size=160)
    text_fit(d, (60, 240, 1440, 400), place["en"], "en", "white", max_size=140)
    text_fit(d, (60, 410, 1440, 580), place["hi"], "hi", "white", max_size=140)
    return img, {}


def sign_platform(place, platform, direction):
    img = Image.new("RGB", (1500, 640), "#14325C")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1500, 150], fill="white")
    # one font per script, so mixed-script lines are drawn as separate pieces
    text_fit(d, (40, 15, 720, 135), place["en"], "en", "#14325C", max_size=80)
    text_fit(d, (760, 15, 1460, 135), place["te"], "te", "#14325C", max_size=80)
    arrow(d, (60, 200, 420, 600), direction, "#F6C915")
    text_fit(d, (470, 180, 1460, 330), f"Platform {platform}", "en", "white", max_size=130)
    text_fit(d, (470, 340, 1460, 470), f"ప్లాట్‌ఫారం {platform}", "te", "white", max_size=110)
    text_fit(d, (470, 480, 1460, 620), f"प्लेटफ़ॉर्म {platform}", "hi", "white", max_size=110)
    return img, {}


def sign_direction(rows):
    """rows: list of (direction, place). Arrow on the side it points to."""
    h = 300 * len(rows) + 40
    img = Image.new("RGB", (1500, h), "#0B5D3B")
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 1490, h - 10], outline="white", width=6)
    for i, (direction, place) in enumerate(rows):
        y = 20 + 300 * i
        if i:
            d.line([40, y, 1460, y], fill="white", width=4)
        if direction == "left":
            arrow(d, (50, y + 40, 330, y + 260), "left", "white")
            tx = (370, 1450)
        elif direction == "right":
            arrow(d, (1170, y + 40, 1450, y + 260), "right", "white")
            tx = (50, 1130)
        else:
            arrow(d, (50, y + 30, 330, y + 270), "up", "white")
            tx = (370, 1450)
        text_fit(d, (tx[0], y + 25, tx[1], y + 150), place["te"], "te", "white", max_size=120)
        text_fit(d, (tx[0], y + 160, tx[1], y + 280), place["en"], "en", "white", max_size=110)
    return img, {}


def sign_street(te, en):
    img = Image.new("RGB", (1300, 420), "#1F4E9C")
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 1290, 410], outline="white", width=6)
    text_fit(d, (40, 30, 1260, 210), te, "te", "white", max_size=130)
    text_fit(d, (40, 220, 1260, 390), en, "en", "white", max_size=120)
    return img, {}


def sign_warning():
    img = Image.new("RGB", (1100, 900), "#F6C915")
    d = ImageDraw.Draw(img)
    d.rectangle([14, 14, 1086, 886], outline="#C8102E", width=22)
    d.polygon([(550, 60), (690, 300), (410, 300)], outline="#111111", width=16)
    text_fit(d, (530, 120, 570, 270), "!", "en", "#111111", max_size=150)
    text_fit(d, (60, 320, 1040, 460), "ప్రమాదం", "te", "#C8102E", max_size=130)
    text_fit(d, (60, 460, 1040, 590), "खतरा", "hi", "#C8102E", max_size=120)
    text_fit(d, (60, 590, 1040, 700), "DANGER", "en", "#C8102E", max_size=110)
    text_fit(d, (60, 720, 400, 860), "దూరంగా ఉండండి", "te", "#111111", max_size=56)
    text_fit(d, (420, 720, 700, 860), "दूर रहें", "hi", "#111111", max_size=56)
    text_fit(d, (720, 720, 1040, 860), "KEEP AWAY", "en", "#111111", max_size=56)
    return img, {}


def sign_shop(te, en):
    img = Image.new("RGB", (1600, 420), "#B3122E")
    d = ImageDraw.Draw(img)
    text_fit(d, (40, 20, 1560, 220), te, "te", "#FFE15C", max_size=150)
    text_fit(d, (40, 230, 1560, 400), en, "en", "white", max_size=120)
    return img, {}


# ---------------- scenes and camera effects ----------------

def background(rng: random.Random, kind: str) -> Image.Image:
    nrng = np.random.default_rng(rng.randrange(1 << 30))
    if kind == "sky":
        top = np.array([150, 185, 225]); bottom = np.array([205, 215, 225])
        t = np.linspace(0, 1, H)[:, None, None]
        arr = top * (1 - t) + bottom * t
        arr = np.repeat(arr, W, axis=1)
        arr[int(H * 0.72):] = np.array([110, 105, 95])  # ground / road
    elif kind == "foliage":
        arr = np.zeros((H, W, 3)) + np.array([60, 95, 55])
    else:  # wall
        arr = np.zeros((H, W, 3)) + np.array([196, 184, 160])
    arr = arr + nrng.normal(0, 14, (H, W, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))


def place_sign(scene, sign, width_frac, cx_frac, cy_frac, angle, pole=True):
    sw = int(W * width_frac)
    sh = int(sign.height * sw / sign.width)
    s = sign.resize((sw, sh), Image.LANCZOS).convert("RGBA")
    if angle:
        s = s.rotate(angle, expand=True, resample=Image.BICUBIC)
    x = int(W * cx_frac - s.width / 2)
    y = int(H * cy_frac - s.height / 2)
    if pole:
        d = ImageDraw.Draw(scene)
        px = int(W * cx_frac)
        d.rectangle([px - max(4, sw // 60), y + s.height // 2, px + max(4, sw // 60), H], fill=(85, 85, 90))
    scene.paste(s, (x, y), s)
    return scene


def add_glare(img: Image.Image, box, strength=0.95):
    """Washed-out ellipse over box (sign coordinates) on the clean sign."""
    over = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(over)
    x0, y0, x1, y1 = box
    pad_x, pad_y = (x1 - x0) * 0.15, (y1 - y0) * 0.1
    d.ellipse([x0 - pad_x, y0 - pad_y, x1 + pad_x, y1 + pad_y], fill=int(255 * strength))
    over = over.filter(ImageFilter.GaussianBlur(25))
    white = Image.new("RGB", img.size, (255, 255, 250))
    return Image.composite(white, img, over)


def camera(img: Image.Image, rng: random.Random, blur=0.0, dark=1.0, motion=0) -> Image.Image:
    out = img
    if motion:  # horizontal hand-shake blur: average of shifted copies
        a = np.asarray(out).astype("float32")
        shifts = range(-(motion // 2), motion // 2 + 1)
        a = sum(np.roll(a, s, axis=1) for s in shifts) / len(shifts)
        out = Image.fromarray(np.clip(a, 0, 255).astype("uint8"))
    if blur:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    out = ImageEnhance.Brightness(out).enhance(dark * rng.uniform(0.93, 1.07))
    out = ImageEnhance.Contrast(out).enhance(rng.uniform(0.92, 1.05))
    arr = np.asarray(out).astype("float32")
    noise = 4 + (14 if dark < 0.5 else 0)
    arr += np.random.default_rng(rng.randrange(1 << 30)).normal(0, noise, arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))


# ---------------- the set ----------------

P = {  # te/hi for metro stations follow data/hyderabad_places.json
    "secunderabad": {"en": "Secunderabad", "te": "సికింద్రాబాద్", "hi": "सिकंदराबाद"},
    "mehdipatnam": {"en": "Mehdipatnam", "te": "మెహదీపట్నం", "hi": "मेहदीपटनम"},
    "koti": {"en": "Koti", "te": "కోఠి", "hi": "कोठी"},
    "kondapur": {"en": "Kondapur", "te": "కొండాపూర్", "hi": "कोंडापुर"},
    "lingampally": {"en": "Lingampally", "te": "లింగంపల్లి", "hi": "लिंगमपल्ली"},
    "gachibowli": {"en": "Gachibowli", "te": "గచ్చిబౌలి", "hi": "गच्चीबावली"},
    "ameerpet": {"en": "Ameerpet", "te": "అమీర్‌పేట", "hi": "अमीरपेट"},
    "mgbs": {"en": "MG Bus Station", "te": "ఎం జి బస్ స్టేషన్", "hi": "एमजी बस स्टेशन"},
    "hitec": {"en": "HITEC City", "te": "హైటెక్ సిటీ", "hi": "हाईटेक सिटी"},
}

SET = [
    # id, kind, builder, condition, expected, languages, note
    ("bus_001", "bus_route_board", lambda: sign_route_board("218", P["secunderabad"]), "clear",
     {"routes": ["218"], "places": ["Secunderabad"]}, ["te", "en"], ""),
    ("bus_002", "bus_route_board", lambda: sign_route_board("10H", P["mehdipatnam"]), "blurry",
     {"routes": ["10H"], "places": ["Mehdipatnam"]}, ["te", "en"], "one frame much blurrier than the other two"),
    ("bus_003", "bus_route_board", lambda: sign_route_board("5K", P["koti"]), "glare",
     {"routes": ["5K"], "places": ["Koti"]}, ["te", "en"],
     "glare hides the route number in all frames: correct behaviour is to confirm Koti and NOT state a route"),
    ("bus_004", "bus_route_board", lambda: sign_route_board("127K", P["kondapur"]), "far",
     {"routes": ["127K"], "places": ["Kondapur"]}, ["te", "en"], "sign is small in frame: expect move_closer or a re-read"),
    ("bus_005", "bus_route_board", lambda: sign_route_board("219", P["lingampally"]), "cut_off_right",
     {"routes": ["219"], "places": ["Lingampally"]}, ["te", "en"], "destination partly cut off: expect move_right guidance"),
    ("busstop_001", "bus_stop", lambda: sign_bus_stop(P["gachibowli"]), "clear",
     {"routes": [], "places": ["Gachibowli"]}, ["te", "hi", "en"], ""),
    ("metro_001", "metro", lambda: sign_metro_station(P["ameerpet"]), "clear",
     {"routes": [], "places": ["Ameerpet"]}, ["te", "en", "hi"], "trilingual: no translation needed for any user language"),
    ("platform_001", "metro", lambda: sign_platform(P["mgbs"], "2", "left"), "tilted",
     {"routes": [], "places": ["MG Bus Station"], "platform": "2", "arrows": ["left"]}, ["en", "te", "hi"], ""),
    ("direction_001", "direction", lambda: sign_direction([("left", P["ameerpet"]), ("right", P["secunderabad"])]), "clear",
     {"routes": [], "places": ["Ameerpet", "Secunderabad"], "arrows": ["left", "right"]}, ["te", "en"],
     "two destinations, opposite arrows"),
    ("direction_002", "direction", lambda: sign_direction([("up", P["hitec"])]), "dark",
     {"routes": [], "places": ["HITEC City"], "arrows": ["up"]}, ["te", "en"], "night-time darkness: expect too_dark or uncertain"),
    ("street_001", "street_name", lambda: sign_street("బంజారా హిల్స్ రోడ్ నెం. 1", "BANJARA HILLS ROAD NO. 1"), "clear",
     {"routes": [], "places": ["Banjara Hills Road No. 1"]}, ["te", "en"], ""),
    ("warning_001", "warning", sign_warning, "clear",
     {"routes": [], "places": []}, ["te", "hi", "en"], "free text only: Danger / Keep away"),
    ("shop_001", "shop", lambda: sign_shop("శ్రీ సాయి మెడికల్స్", "SRI SAI MEDICALS"), "clear",
     {"routes": [], "places": []}, ["te", "en"], "shop name is not a place"),
    ("several_001", "bus_route_board", None, "several_signs",
     {"routes": ["218"], "places": ["Secunderabad"]}, ["te", "en"],
     "bus board next to a shop sign: expect several_signs guidance or the bus board as main sign"),
    ("nosign_001", "none", None, "no_sign", {"sign_found": False, "routes": [], "places": []}, [], "plain wall"),
    ("nosign_002", "none", None, "no_sign", {"sign_found": False, "routes": [], "places": []}, [], "sky and road"),
]


def frames_for(sid, builder, cond, rng):
    frames = []
    if cond == "no_sign":
        kind = "wall" if sid.endswith("1") else "sky"
        for _ in range(3):
            frames.append(camera(background(rng, kind), rng, blur=rng.uniform(0, 0.8)))
        return frames, None

    if cond == "several_signs":
        bus, _ = sign_route_board("218", P["secunderabad"])
        shop, _ = sign_shop("శ్రీ సాయి మెడికల్స్", "SRI SAI MEDICALS")
        clean = bus
        for _ in range(3):
            sc = background(rng, "sky")
            place_sign(sc, shop, 0.44, 0.27 + rng.uniform(-0.02, 0.02), 0.32, rng.uniform(-2, 2))
            place_sign(sc, bus, 0.44, 0.74 + rng.uniform(-0.02, 0.02), 0.36, rng.uniform(-2, 2))
            frames.append(camera(sc, rng, blur=rng.uniform(0.2, 0.7)).convert("RGB"))
        return frames, clean

    sign, meta = builder()
    clean = sign.copy()
    if cond == "glare":
        sign = add_glare(sign, meta["route_box"])
    bg_kind = rng.choice(["sky", "wall", "foliage"])
    blurs = {"blurry": [2.0, 6.5, 2.8]}.get(cond, [rng.uniform(0.2, 0.8) for _ in range(3)])
    for i in range(3):
        sc = background(rng, bg_kind)
        width = {"far": 0.22}.get(cond, rng.uniform(0.66, 0.76))
        cx = 0.5 + rng.uniform(-0.03, 0.03)
        if cond == "cut_off_right":
            cx = 0.73 + rng.uniform(-0.01, 0.01)
        angle = rng.uniform(-2.5, 2.5)
        if cond == "tilted":
            angle = 14 + rng.uniform(-2, 2)
        place_sign(sc, sign, width, cx, 0.40 + rng.uniform(-0.03, 0.03), angle)
        dark = 0.28 if cond == "dark" else 1.0
        motion = 9 if (cond == "blurry" and i == 1) else 0
        frames.append(camera(sc.convert("RGB"), rng, blur=blurs[i], dark=dark, motion=motion))
    return frames, clean


def main() -> int:
    ensure_fonts()
    OUT_FRAMES.mkdir(parents=True, exist_ok=True)
    OUT_PRINT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20261010)
    labels = []
    for sid, kind, builder, cond, expected, langs, note in SET:
        frames, clean = frames_for(sid, builder, cond, rng)
        paths = []
        for letter, fr in zip("abc", frames):
            p = OUT_FRAMES / f"{sid}_{letter}.jpg"
            fr.save(p, quality=85)
            paths.append(str(p.relative_to(ROOT)).replace("\\", "/"))
        if clean is not None:
            clean.save(OUT_PRINT / f"{sid}.png")
        labels.append({
            "id": sid,
            "frames": paths,
            "location": "synthetic",
            "synthetic": True,
            "sign_type": kind,
            "conditions": [cond],
            "languages_on_sign": langs,
            "expected": {
                "sign_found": expected.get("sign_found", True),
                "routes": expected.get("routes", []),
                "places": expected.get("places", []),
                "platform": expected.get("platform"),
                "arrows": expected.get("arrows", []),
            },
            "notes": note,
        })
        print(f"ok  {sid:14} {cond}")
    LABELS.write_text(json.dumps({
        "_about": "SYNTHETIC test set made by scripts/make_synthetic_signs.py. Route-destination pairings are invented. "
                  "Report results on this set separately from real photos.",
        "signs": labels,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(labels)} signs, {3 * len(labels)} frames -> {OUT_FRAMES}")
    print(f"clean demo signs -> {OUT_PRINT}\nlabels -> {LABELS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
