"""Add SYNTHETIC shop boards, nameplates and notices to the test set (things that are not transit signs).

The boards are drawn as HTML in headless Chrome (correct Telugu and Devanagari shaping with Noto fonts,
which Pillow cannot do without libraqm), then placed in phone-like scenes with the same background,
blur and tilt as scripts/make_synthetic_signs.py. Labels are merged into eval/labels_synthetic.json.

Usage (repo root, venv active, Google Chrome or Edge installed):
    python scripts/make_text_signs.py
"""

from __future__ import annotations

import io
import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from make_synthetic_signs import LABELS, OUT_FRAMES, OUT_PRINT, background, camera, place_sign  # noqa: E402

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "chromium", "chromium-browser",
]

FONTS = ("https://fonts.googleapis.com/css2?family=Noto+Sans:wght@600;800&family=Noto+Sans+Telugu:wght@600;800"
         "&family=Noto+Sans+Devanagari:wght@600;800&display=block")

# id, width x height (px), board HTML, scene condition, expected, languages, note
BOARDS = [
    ("shop_002", (1600, 420),
     '<div class="b" style="background:#0f5132;color:#fff">'
     '<div class="te" style="font-size:150px">శ్రీ లక్ష్మి జనరల్ స్టోర్స్</div></div>',
     "clear", {"business": "Sri Lakshmi General Stores"}, ["te"],
     "Telugu only: the romanized name may be spelled several ways (Sri/Shri, Lakshmi/Laxmi)"),
    ("shop_003", (1600, 480),
     '<div class="b" style="background:#111827;color:#facc15">'
     '<div class="en" style="font-size:140px;letter-spacing:4px">NEW SAGAR</div>'
     '<div class="en" style="font-size:80px;color:#fff">TIFFIN CENTRE</div></div>',
     "tilted", {"business": "New Sagar Tiffin Centre"}, ["en"], "English only, tilted"),
    ("shop_004", (1500, 520),
     '<div class="b" style="background:#fff7ed;color:#9a3412;border:14px solid #9a3412">'
     '<div class="hi" style="font-size:140px">गुप्ता स्वीट्स</div>'
     '<div class="en" style="font-size:90px">GUPTA SWEETS</div>'
     '<div class="en" style="font-size:52px;color:#431407">Open 7 AM - 10 PM</div></div>',
     "far", {"business": "Gupta Sweets"}, ["hi", "en"], "Hindi + English shop, far away, with opening hours"),
    ("nameplate_001", (1700, 460),
     '<div class="b" style="background:#1e3a8a;color:#fff">'
     '<div class="te" style="font-size:96px">జిల్లా పరిషత్ ఉన్నత పాఠశాల</div>'
     '<div class="en" style="font-size:84px">ZILLA PARISHAD HIGH SCHOOL</div></div>',
     "clear", {"texts": ["Zilla Parishad High School", "జిల్లా పరిషత్ ఉన్నత పాఠశాల"]}, ["te", "en"],
     "building nameplate: free text, not a place or a shop"),
    ("notice_001", (1400, 700),
     '<div class="b" style="background:#fefce8;color:#111;border:16px solid #ca8a04">'
     '<div class="en" style="font-size:96px;color:#b91c1c">NOTICE</div>'
     '<div class="en" style="font-size:78px">PLEASE USE GATE NO. 2</div>'
     '<div class="hi" style="font-size:78px">कृपया गेट नंबर 2 का उपयोग करें</div></div>',
     "clear", {"texts": ["Notice", "Please use gate no. 2", "कृपया गेट नंबर 2 का उपयोग करें"]}, ["en", "hi"],
     "notice board: the instruction must be read out"),
    ("product_001", (1500, 560),
     '<div class="b" style="background:linear-gradient(90deg,#d1d5db,#f3f4f6 40%,#cbd5e1);color:#0f172a;border-radius:8px">'
     '<div class="en" style="font-size:120px;color:#b91c1c">PARAFIX 650</div>'
     '<div class="en" style="font-size:62px">Paracetamol Tablets IP 650 mg</div>'
     '<div class="en" style="font-size:50px">EXP 08/2027 &nbsp; MRP Rs 30.50</div></div>',
     "clear", {"business": "Parafix 650", "texts": ["Paracetamol Tablets IP 650 mg", "EXP 08/2027", "MRP Rs 30.50",
                                                    "EXP 08/2027 MRP Rs 30.50"]}, ["en"],
     "medicine strip (invented brand): name, strength and expiry must be read"),
    ("product_002", (1100, 1300),
     '<div class="b" style="background:#1d4ed8;color:#fff;border-radius:60px">'
     '<div class="en" style="font-size:120px">SUNRISE</div>'
     '<div class="en" style="font-size:84px;color:#fde68a">TONED MILK</div>'
     '<div class="te" style="font-size:80px">టోన్డ్ పాలు</div>'
     '<div class="en" style="font-size:70px">500 ml</div>'
     '<div class="en" style="font-size:52px">MRP Rs 28 &middot; Use by 12/10/2026</div></div>',
     "clear", {"business": "Sunrise Toned Milk", "texts": ["Toned milk", "టోన్డ్ పాలు", "500 ml", "MRP Rs 28",
                                                           "Use by 12/10/2026", "MRP Rs 28 · Use by 12/10/2026", "Sunrise"]},
     ["en", "te"], "milk packet (invented brand): what it is, size and use-by date"),
]

PAGE = """<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{fonts}">
<style>html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:#000}}
.b{{box-sizing:border-box;width:{w}px;height:{h}px;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:6px;border-radius:18px;text-align:center;line-height:1.15}}
.te{{font-family:'Noto Sans Telugu';font-weight:800}} .hi{{font-family:'Noto Sans Devanagari';font-weight:800}}
.en{{font-family:'Noto Sans';font-weight:800}}</style></head><body>{body}</body></html>"""


def browser() -> str:
    for b in BROWSERS:
        if Path(b).exists() or shutil.which(b):
            return b
    raise SystemExit("Chrome or Edge is needed to draw the boards.")


def render(html: str, size: tuple[int, int], tmp: Path) -> Image.Image:
    page, shot = tmp / "board.html", tmp / "board.png"
    page.write_text(html, encoding="utf-8")
    subprocess.run([browser(), "--headless=new", "--hide-scrollbars", f"--window-size={size[0]},{size[1]}",
                    "--virtual-time-budget=4000", f"--user-data-dir={tmp / 'profile'}",
                    f"--screenshot={shot}", page.as_uri()], check=True, capture_output=True, timeout=90)
    return Image.open(io.BytesIO(shot.read_bytes())).convert("RGB").crop((0, 0, *size))


def frames_for(sign: Image.Image, cond: str, rng: random.Random) -> list[Image.Image]:
    out = []
    bg = rng.choice(["wall", "sky"])
    for _ in range(3):
        sc = background(rng, bg)
        width = 0.24 if cond == "far" else rng.uniform(0.7, 0.8)
        angle = 13 + rng.uniform(-2, 2) if cond == "tilted" else rng.uniform(-2.5, 2.5)
        place_sign(sc, sign, width, 0.5 + rng.uniform(-0.03, 0.03), 0.4 + rng.uniform(-0.03, 0.03), angle, pole=False)
        out.append(camera(sc.convert("RGB"), rng, blur=rng.uniform(0.2, 0.8)))
    return out


def main() -> int:
    rng = random.Random(20261011)
    data = json.loads(LABELS.read_text(encoding="utf-8"))
    ids = {b[0] for b in BOARDS}
    data["signs"] = [s for s in data["signs"] if s["id"] not in ids]
    OUT_FRAMES.mkdir(parents=True, exist_ok=True)
    OUT_PRINT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for sid, (w, h), body, cond, expected, langs, note in BOARDS:
            sign = render(PAGE.format(fonts=FONTS, w=w, h=h, body=body), (w, h), tmp)
            sign.save(OUT_PRINT / f"{sid}.png")
            paths = []
            for letter, fr in zip("abc", frames_for(sign, cond, rng)):
                p = OUT_FRAMES / f"{sid}_{letter}.jpg"
                fr.save(p, quality=85)
                paths.append(str(p.relative_to(ROOT)).replace("\\", "/"))
            data["signs"].append({
                "id": sid, "frames": paths, "location": "synthetic", "synthetic": True,
                "sign_type": ("product" if sid.startswith("product") else "shop") if "business" in expected else "information",
                "conditions": [cond],
                "languages_on_sign": langs,
                "expected": {"sign_found": True, "routes": [], "places": [], "platform": None, "arrows": [],
                             "business": expected.get("business", ""), "texts": expected.get("texts", [])},
                "notes": note,
            })
            print(f"ok  {sid:14} {cond}")
    LABELS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"labels -> {LABELS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
