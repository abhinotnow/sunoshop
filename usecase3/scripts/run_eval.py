"""Measure Oriel on labelled signs: is it ever WRONG while sounding SURE?

For every sign in the labels file, the full read pipeline runs on its 3 frames (the same code the app
uses) and the result is compared with the ground truth. It also runs a naive single-frame baseline
(one Gemini read, everything it says is spoken as fact) so you can show judges what verification buys.

Metrics
  wrong-but-confident   a key fact (route, place, platform, arrow, shop name, other text) marked CONFIRMED that is
                        not on the sign. Text is only scored on signs whose labels list "business" or "texts".
                        This is the number that must be zero: it is what misleads a blind user.
  key-fact recall       expected key facts that Oriel confirmed.
  hedged                expected facts Oriel found but marked uncertain ("it looks like ..., please check").
  abstained             signs where Oriel said it could not read / asked for a retake.
  sign-found accuracy   no-sign photos correctly reported as "no sign", and sign photos found.
  latency               end-to-end pipeline time per sign (median and slowest).

Usage (repo root, venv active, backend/.env filled in):
    python scripts/run_eval.py                                   # synthetic set
    python scripts/run_eval.py --labels eval/labels.json         # your real photos
    python scripts/run_eval.py --limit 4 --no-baseline           # quick smoke test
    python scripts/run_eval.py --only shop_002,notice_001 --say  # chosen signs, print what Oriel says
Results are written to eval/results/<labels>-<time>.json.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def same_route(a: str, b: str) -> bool:
    from backend.app.services.text_utils import normalize_route
    return normalize_route(a) == normalize_route(b)


def same_place(a: str, b: str) -> bool:
    from backend.app.services.places import gazetteer
    from backend.app.services.text_utils import fuzzy_eq, normalize_name
    if not a or not b:
        return False
    if normalize_name(a) == normalize_name(b) or fuzzy_eq(a, b):
        return True
    ga, gb = gazetteer().match(a), gazetteer().match(b)
    return bool(ga and gb and ga.en == gb.en)


def facts_from_verified(verified: dict) -> list[dict]:
    """Key facts in a comparable shape: kind, value, status (texts: every script the name was read in)."""
    out = []
    for f in verified.get("fields", []):
        if f["kind"] in ("route", "place", "platform", "arrow", "business", "text", "currency", "traffic_sign") and f.get("value"):
            out.append({"kind": f["kind"], "value": str(f["value"]), "status": f["status"],
                        "alts": list((f.get("texts") or {}).values())})
    return out


def same_text(a: str, b: str) -> bool:
    """Free text and shop names: tolerant of case, punctuation and spelling of romanized names."""
    from rapidfuzz import fuzz
    from backend.app.services.text_utils import normalize_name
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    return max(fuzz.token_set_ratio(na, nb), fuzz.ratio(na, nb)) >= 80


def facts_from_record(rec: dict) -> list[dict]:
    """What a naive app would say from ONE frame: everything, as fact."""
    if not rec.get("sign_found"):
        return []
    out = [{"kind": "route", "value": r.get("value", ""), "status": "confirmed"} for r in rec.get("route_numbers", []) if r.get("value")]
    out += [{"kind": "place", "value": p.get("romanized") or p.get("text", ""), "status": "confirmed"} for p in rec.get("places", [])]
    if rec.get("platform"):
        out.append({"kind": "platform", "value": str(rec["platform"]), "status": "confirmed"})
    out += [{"kind": "arrow", "value": a.get("direction", ""), "status": "confirmed"} for a in rec.get("arrows", []) if a.get("direction")]
    biz = rec.get("business") or {}
    if biz.get("name_romanized") or biz.get("name_text"):
        out.append({"kind": "business", "value": biz.get("name_romanized") or biz["name_text"], "status": "confirmed",
                    "alts": [biz.get("name_text", "")]})
    out += [{"kind": "text", "value": t.get("text", ""), "status": "confirmed"} for t in rec.get("other_text", []) if t.get("text")]
    return out


def matches(fact: dict, expected: dict) -> bool:
    k, v = fact["kind"], fact["value"]
    if k == "route":
        return any(same_route(v, e) for e in expected.get("routes", []))
    if k == "place":
        return any(same_place(v, e) for e in expected.get("places", [])) or any(
            same_text(c, t) for c in [v] + fact.get("alts", []) for t in expected.get("texts", []))
    if k == "currency":
        return str(expected.get("currency", "")) == v
    if k == "traffic_sign":
        return v in expected.get("symbols", [])
    if k == "platform":
        return expected.get("platform") is not None and str(expected["platform"]).strip().lower() == v.strip().lower()
    if k == "arrow":
        return v in expected.get("arrows", [])
    if k in ("business", "text"):
        if not expected.get("business") and not expected.get("texts"):
            return True  # this label does not list the sign's text: not scored
        truth = [expected.get("business", "")] + expected.get("texts", []) + expected.get("places", [])
        return any(same_text(c, t) for c in [v] + fact.get("alts", []) for t in truth if t)
    return False


def counted(fact: dict, expected: dict) -> bool:
    """Shop names, free text, money and pictograms count only on signs whose labels list them."""
    k = fact["kind"]
    if k in ("business", "text"):
        return bool(expected.get("business") or expected.get("texts"))
    if k == "currency":
        return bool(expected.get("currency"))
    if k == "traffic_sign":
        return bool(expected.get("symbols"))
    return True


def score(facts: list[dict], expected: dict, found: bool) -> dict:
    exp_total = (len(expected.get("routes", [])) + len(expected.get("places", [])) + (1 if expected.get("platform") else 0)
                 + len(expected.get("arrows", [])) + (1 if expected.get("business") else 0) + len(expected.get("texts", []))
                 + (1 if expected.get("currency") else 0) + len(expected.get("symbols", [])))
    facts = [f for f in facts if counted(f, expected)]
    confirmed = [f for f in facts if f["status"] == "confirmed"]
    uncertain = [f for f in facts if f["status"] == "uncertain"]
    wrong_conf = [f for f in confirmed if not matches(f, expected)]
    right_conf = [f for f in confirmed if matches(f, expected)]
    hedged_right = [f for f in uncertain if matches(f, expected)]
    return {
        "expected_facts": exp_total,
        "confirmed_right": len(right_conf),
        "wrong_but_confident": len(wrong_conf),
        "wrong_details": [f"{f['kind']}={f['value']}" for f in wrong_conf],
        "hedged_right": len(hedged_right),
        "uncertain_total": len(uncertain),
        "sign_found_ok": expected.get("sign_found") is None or found == bool(expected.get("sign_found")),
    }


async def run_one(sign: dict, lang: str, baseline: bool) -> dict:
    from backend.app.services import images, sign_reader
    from backend.app.services.read_pipeline import run_read

    frames = [(ROOT / p).read_bytes() for p in sign["frames"]]
    t = time.perf_counter()
    result, error = None, None
    async for ev in run_read(frames, lang=lang, mode="standard"):
        if ev["type"] == "result":
            result = ev
        elif ev["type"] == "error":
            error = ev
    ms = (time.perf_counter() - t) * 1000
    row: dict = {"id": sign["id"], "conditions": sign.get("conditions", []), "ms": round(ms)}
    if error or not result:
        row.update({"error": (error or {}).get("message", "no result")})
        return row
    v = result["verified"]
    row["oriel"] = score(facts_from_verified(v), sign["expected"], v.get("sign_found", False))
    row["oriel"]["action"] = result["next_step"]["action"]
    row["oriel"]["said"] = [l.get("text", "") for l in result["speech"].get("key", [])]
    everything = " ".join(l.get("text", "") for l in result["speech"].get("key", []) + result["speech"].get("more", [])).lower()
    hazard_said = " ".join(l.get("text", "") for l in result["speech"].get("key", []) if l.get("text", "").startswith("Careful")).lower()
    exp = sign["expected"]
    if exp.get("scene"):
        row["oriel"]["scene_ok"] = any(k in everything for k in exp["scene"])
    if exp.get("hazards"):
        row["oriel"]["hazard_ok"] = any(k in hazard_said for k in exp["hazards"])

    if baseline:
        try:
            jpeg = images.encode_jpeg(images.fit(images.decode(frames[0]), images.MAX_SIDE_READER))
            rec = await sign_reader.read_frame(jpeg)
            row["baseline"] = score(facts_from_record(rec), sign["expected"], bool(rec.get("sign_found")))
        except Exception as e:  # noqa: BLE001
            row["baseline"] = {"error": str(e)[:120]}
    return row


def summarize(rows: list[dict], key: str) -> dict:
    ok = [r[key] for r in rows if isinstance(r.get(key), dict) and "error" not in r[key]]
    if not ok:
        return {}
    exp = sum(r["expected_facts"] for r in ok)
    return {
        "signs": len(ok),
        "wrong_but_confident": sum(r["wrong_but_confident"] for r in ok),
        "key_fact_recall": round(sum(r["confirmed_right"] for r in ok) / exp, 3) if exp else None,
        "hedged_right": sum(r["hedged_right"] for r in ok),
        "sign_found_accuracy": round(sum(r["sign_found_ok"] for r in ok) / len(ok), 3),
        "abstained": sum(1 for r in ok if r.get("action") in ("reread", "guide", "give_up")),
        "scene_described": f"{sum(1 for r in ok if r.get('scene_ok'))}/{sum(1 for r in ok if 'scene_ok' in r)}",
        "hazard_warned": f"{sum(1 for r in ok if r.get('hazard_ok'))}/{sum(1 for r in ok if 'hazard_ok' in r)}",
    }


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", default="eval/labels_synthetic.json")
    ap.add_argument("--lang", default="en", choices=["te", "hi", "en"], help="output language for the spoken lines")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-baseline", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated sign ids, e.g. shop_001,notice_001")
    ap.add_argument("--say", action="store_true", help="print what Oriel would say for each sign")
    ap.add_argument("--pause", type=float, default=0, help="seconds between signs (free-tier per-minute limits)")
    args = ap.parse_args()

    from backend.app.services import anuvaad
    labels_path = ROOT / args.labels
    signs = json.loads(labels_path.read_text(encoding="utf-8"))["signs"]
    signs = [s for s in signs if all((ROOT / p).exists() for p in s["frames"])]
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        signs = [s for s in signs if s["id"] in wanted]
    if args.limit:
        signs = signs[: args.limit]
    if not signs:
        print("No signs with existing frames in", args.labels)
        return 1
    print(f"Evaluating {len(signs)} signs from {args.labels} (lang={args.lang})\n")
    rows = []
    try:
        for i, s in enumerate(signs):  # one at a time: realistic latency and no rate-limit bursts
            if i and args.pause:
                await asyncio.sleep(args.pause)
            row = await run_one(s, args.lang, not args.no_baseline)
            rows.append(row)
            if "error" in row:
                print(f"  {row['id']:<14} ERROR {row['error'][:90]}")
                continue
            o = row["oriel"]
            b = row.get("baseline", {})
            flag = "  <-- WRONG BUT CONFIDENT" if o["wrong_but_confident"] else ""
            flag += "" if o.get("scene_ok", True) else "  <-- scene not described"
            flag += "" if o.get("hazard_ok", True) else "  <-- hazard missed"
            print(f"  {row['id']:<14} {','.join(row['conditions']):<14} {row['ms']:>6} ms  "
                  f"confirmed {o['confirmed_right']}/{o['expected_facts']}  hedged {o['hedged_right']}  "
                  f"action={o['action']:<8} baseline-wrong={b.get('wrong_but_confident', '-')}{flag}")
            if args.say:
                for line in o["said"]:
                    print(f"      says: {line}")
                if o["wrong_details"]:
                    print(f"      wrong: {o['wrong_details']}")
    finally:
        await anuvaad.client().aclose()

    lat = [r["ms"] for r in rows if "error" not in r]
    summary = {"labels": args.labels, "lang": args.lang, "oriel": summarize(rows, "oriel"),
               "single_frame_baseline": summarize(rows, "baseline"),
               "latency_ms": {"median": round(statistics.median(lat)) if lat else None, "max": max(lat) if lat else None},
               "errors": sum(1 for r in rows if "error" in r)}
    print("\nSummary")
    print(json.dumps(summary, indent=2))
    out_dir = ROOT / "eval" / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{labels_path.stem}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nSaved {out.relative_to(ROOT)}")
    if "synthetic" in labels_path.stem:
        print("Note: synthetic signs. Quote real-photo numbers separately.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
