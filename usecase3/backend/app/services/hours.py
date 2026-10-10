"""Shop timings: parse HH:MM, decide 'probably open', and say the timings in te/hi/en."""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from ..content import templates
from ..settings import get_settings

_HHMM = re.compile(r"^(\d{1,2}):(\d{2})$")


def parse(hhmm: str) -> int | None:
    m = _HHMM.match((hhmm or "").strip())
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2))
    if h == 24 and mm == 0:
        return 24 * 60
    if not (0 <= h < 24 and 0 <= mm < 60):
        return None
    return h * 60 + mm


def now_minutes(now: datetime | None = None) -> int:
    now = now or datetime.now(ZoneInfo(get_settings().timezone))
    return now.hour * 60 + now.minute


def probably_open(open_t: str, close_t: str, now: datetime | None = None) -> bool | None:
    o, c = parse(open_t), parse(close_t)
    if o is None or c is None:
        return None
    t = now_minutes(now)
    if o == c or (o == 0 and c >= 23 * 60 + 59):
        return True  # open all day
    if o < c:
        return o <= t < c
    return t >= o or t < c  # closes after midnight


def say_time(hhmm: str, lang: str) -> str:
    words = templates()["hours_words"][lang]
    m = parse(hhmm)
    if m is None:
        return hhmm
    h, mm = divmod(m % (24 * 60), 60)
    if h == 12 and mm == 0:
        return words["noon"]
    if h == 0 and mm == 0:
        return words["midnight"]
    h12 = h % 12 or 12
    shown = f"{h12}" if mm == 0 else f"{h12}:{mm:02d}"
    if 5 <= h <= 11:
        period = "morning"
    elif 12 <= h <= 15:
        period = "afternoon"
    elif 16 <= h <= 19:
        period = "evening"
    elif h >= 20:
        period = "night"
    else:
        period = "night_am"
    return words[period].replace("{h}", shown)


def say_range(open_t: str, close_t: str, lang: str) -> str:
    words = templates()["hours_words"][lang]
    o, c = parse(open_t), parse(close_t)
    if o is not None and c is not None and (o == c or (o == 0 and c >= 23 * 60 + 59)):
        return words["all_day"]
    return words["range"].replace("{from}", say_time(open_t, lang)).replace("{to}", say_time(close_t, lang))
