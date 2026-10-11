"""Repositioning: what should the user do next, and should Oriel read again?

Combines what the reader saw (sign box, cut-off sides, glare, darkness, several signs) with the
phone's own checks (tilt, blur, brightness) and the number of reads so far. Returns ONE ordered
plan; the app speaks at most two short instructions at a time.
"""

from __future__ import annotations

from .verify import key_confirmed, key_kind

SIDE_PHRASE = {"left": "move_left", "right": "move_right", "top": "move_up", "bottom": "move_down"}

# Thresholds (box coordinates are 0-1000). Tuned on the synthetic set; adjust with real photos.
TOO_SMALL_AREA = 0.06      # sign covers < 6% of the frame -> far away
TOO_BIG_AREA = 0.85        # sign covers > 85% and is cut on 2+ sides -> too close
OFF_CENTRE = 0.22          # centre more than 22% of the frame away from the middle -> aim


def box_geometry(box: list[int]) -> dict | None:
    if not box or len(box) != 4:
        return None
    y0, x0, y1, x1 = box
    return {"area": (y1 - y0) * (x1 - x0) / 1_000_000, "dx": ((x0 + x1) / 2 - 500) / 1000,
            "dy": ((y0 + y1) / 2 - 500) / 1000, "w": (x1 - x0) / 1000, "h": (y1 - y0) / 1000}


def next_step(verified: dict, reads_used: int, max_reads: int = 3, device: dict | None = None) -> dict:
    """reads_used counts reads INCLUDING the one just made."""
    device = device or {}
    can_reread = reads_used < max_reads
    phrases: list[str] = []
    focus: list[int] | None = None

    # Phone-side problems first: they make every other instruction pointless.
    tilt = device.get("tilt")  # "up" | "down" | None, from the phone's orientation sensor
    if tilt == "up":
        phrases.append("tilt_up")
    elif tilt == "down":
        phrases.append("tilt_down")

    scene = verified.get("scene") or {}
    if not verified.get("sign_found") and (scene.get("description") or scene.get("hazards")):
        return _plan("done", phrases, None, "nothing to read: described what is in front")
    if not verified.get("sign_found"):
        if can_reread:
            return _plan("guide", phrases + ["no_sign_try"], None, "no sign found yet")
        return _plan("give_up", ["no_sign", "ask_someone"], None, "no sign after several tries")

    issues = verified.get("issues", {})
    quality = set(issues.get("quality", []))
    cut = issues.get("cut_off_sides", [])
    geo = box_geometry(verified.get("box", []))
    confirmed = key_confirmed(verified)

    if issues.get("sign_count", 0) > 1 or "multiple_signs" in quality:
        phrases.append("several_signs")
    if len(cut) >= 2 and geo and geo["area"] > TOO_BIG_AREA:
        phrases.append("step_back")
    elif cut:
        phrases.append(SIDE_PHRASE[cut[0]])
    elif geo and geo["area"] < TOO_SMALL_AREA:
        phrases.append("move_closer")
        focus = verified.get("box")
    elif geo and abs(geo["dx"]) > OFF_CENTRE:
        phrases.append("aim_left" if geo["dx"] < 0 else "aim_right")
    elif geo and abs(geo["dy"]) > OFF_CENTRE:
        phrases.append("aim_up" if geo["dy"] < 0 else "aim_down")

    if "glare" in quality:
        phrases.append("glare")
    if "dark" in quality:
        phrases.append("too_dark")
    if "blur" in quality and not confirmed:
        phrases.append("hold_still")

    if confirmed and not cut:
        return _plan("done", phrases[:1] if "several_signs" in phrases else [], None, "key fact confirmed")
    if confirmed and cut:
        return _plan("done", phrases[:2], None, "key fact confirmed; the rest of the sign is cut off")
    if can_reread:
        if not phrases:
            phrases.append("zooming_in")
            focus = verified.get("box") or None
        return _plan("reread", phrases[:2], focus, f"{key_kind(verified) or 'sign'} not confirmed yet")
    return _plan("give_up", ["ask_someone"], None, "could not confirm the key fact after several reads")


def _plan(action: str, phrase_ids: list[str], focus_box, reason: str) -> dict:
    seen, ordered = set(), []
    for p in phrase_ids:
        if p not in seen:
            seen.add(p)
            ordered.append(p)
    return {"action": action, "phrase_ids": ordered, "focus_box": focus_box, "reason": reason}
