"""Turn the real photos in eval/photos/web/ (Wikimedia Commons, licences in CREDITS.json) into a labelled set.

Each photo becomes 2 frames like a hand-held phone burst: the full photo, and a slightly shifted, slightly
blurred crop. Labels were written by looking at each photo. Writes eval/labels_web.json.

    python scripts/make_web_set.py
    python scripts/run_eval.py --labels eval/labels_web.json --say
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "eval" / "photos" / "web"
OUT = SRC / "frames"

# id: (sign_type, expected). scene / hazard keywords: at least one must appear in what Oriel says.
SET = {
    "web_bus_tsrtc": ("traffic_sign", {"symbols": ["no_entry"], "texts": [
        "TSRTC Bus Point Wave Rock", "HCU Depot", "No entry", "Private vehicles are not allowed at point",
        "If parked fine may be imposed upto 1000", "under section TSMV at 1988 u/s 189/c",
        "Strictly traffic police instructions", "HCU Depot DMI"], "places": ["Wave Rock"],
        "scene": ["bus", "sign", "board"]}),
    "web_busstop_tarnaka": ("traffic_sign", {"symbols": ["no_parking"], "texts": ["No parking", "TSRTC", "Tarnaka",
        "T.S.R.T.C", "ZEE5"], "places": ["Tarnaka"], "scene": ["road", "bus", "shelter", "sign"]}),
    "web_busstop_jubilee": ("scene", {"sign_found": None, "texts": ["Jubilee Bus Station", "TSRTC"],
        "places": ["Jubilee Bus Station"], "scene": ["auto", "rickshaw", "motor", "scooter", "bike", "building", "road"],
        "hazards": ["motor", "scooter", "bike", "auto", "vehicle", "rickshaw", "traffic"]}),
    "web_busstop_streets": ("scene", {"sign_found": None, "texts": ["Horn please OK", "STOP", "Manhattan"],
        "scene": ["bus", "people", "crowd", "flyover", "road"],
        "hazards": ["bus", "vehicle", "people", "crowd", "auto", "traffic"]}),
    "web_metro_gates": ("direction", {"places": ["Bawarchi Restaurant", "Sandhya 70mm", "JBS Parade Ground"],
        "texts": ["Bawarchi Restaurant / Sandhya 70mm", "B", "1", "about mobile data"], "arrows": ["up_left", "up"],
        "scene": ["stair", "sign", "metro", "exit"], "hazards": ["stair", "step"]}),
    "web_note_2000": ("currency", {"currency": "2000", "texts": ["Reserve Bank of India", "Specimen", "2000",
        "Guaranteed by the Central Government", "Mahatma Gandhi",
        "भारतीय रिज़र्व बैंक", "दो हज़ार रुपये", "केंद्रीय सरकार द्वारा प्रत्याभूत", "0AA 000000"], "scene": ["note", "rupee", "currency", "gandhi"]}),
    "web_steps": ("scene", {"sign_found": None, "scene": ["step", "stair", "mosque", "gate", "building"],
        "hazards": ["step", "stair"]}),
    "web_street_charminar": ("scene", {"sign_found": None, "texts": ["HITEX", "HITEX Hyderabad"], "places": ["HITEX"],
        "scene": ["arch", "gate", "road", "crane", "vehicle", "tree"],
        "hazards": ["crane", "vehicle", "truck", "machine"]}),
    "web_street_hyd": ("scene", {"sign_found": None, "texts": ["11-02-2017 10:39", "BAR"],
        "scene": ["cow", "bull", "cattle", "ox", "oxen", "animal", "road"],
        "hazards": ["cow", "bull", "cattle", "ox", "animal"]}),
    "web_streetsign": ("direction", {"places": ["NTR Garden", "Secretariat", "Khairatabad", "Sachivalayam"], "arrows": ["up"],
        "scene": ["sign", "board", "tree"]}),
}


def frames(img: Image.Image) -> list[Image.Image]:
    img = img.convert("RGB")
    w, h = img.size
    b = img.crop((int(w * 0.03), int(h * 0.02), int(w * 0.98), int(h * 0.99))).filter(ImageFilter.GaussianBlur(0.8))
    return [img, b]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    signs = []
    for sid, (kind, exp) in SET.items():
        src = SRC / f"{sid}.jpg"
        if not src.exists():
            continue
        paths = []
        for letter, fr in zip("ab", frames(Image.open(src))):
            fr.thumbnail((1600, 1600))
            p = OUT / f"{sid}_{letter}.jpg"
            fr.save(p, quality=88)
            paths.append(str(p.relative_to(ROOT)).replace("\\", "/"))
        signs.append({"id": sid, "frames": paths, "location": "web (Wikimedia Commons)", "synthetic": False,
                      "sign_type": kind, "conditions": ["real_photo"], "languages_on_sign": [],
                      "expected": {"sign_found": exp.get("sign_found", True), "routes": [], "places": exp.get("places", []),
                                   "platform": None, "arrows": exp.get("arrows", []), "business": exp.get("business", ""),
                                   "texts": exp.get("texts", []), "symbols": exp.get("symbols", []),
                                   "currency": exp.get("currency", ""), "scene": exp.get("scene", []),
                                   "hazards": exp.get("hazards", [])},
                      "notes": ""})
    (ROOT / "eval" / "labels_web.json").write_text(json.dumps({"_about": "Real photos from Wikimedia Commons, labelled by "
        "hand. Licences: eval/photos/web/CREDITS.json.", "signs": signs}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(len(signs), "photos ->", ROOT / "eval" / "labels_web.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
