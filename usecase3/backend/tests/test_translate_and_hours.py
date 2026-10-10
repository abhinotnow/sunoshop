import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import hours
from backend.app.services.safe_translate import (UnsafeTranslation, numbers_preserved, protect, restore,
                                                 translate_protected)


class FakeMT:
    def __init__(self, fn):
        self.fn = fn

    async def translate(self, text, src, tgt):
        return self.fn(text)


def test_protect_and_restore_with_native_digits():
    text, mapping = protect("Bus 218 goes to Secunderabad.", ["218", "Secunderabad"])
    assert "218" not in text and "Secunderabad" not in text
    token_place = next(t for t, term in mapping.items() if term == "Secunderabad")
    token_route = next(t for t, term in mapping.items() if term == "218")
    # MT returns the tokens in Telugu digits
    tel = lambda s: "".join(chr(0x0C66 + int(c)) for c in s)  # noqa: E731
    out = f"బస్సు {tel(token_route)} {tel(token_place)} కు వెళ్తుంది."
    restored = restore(out, mapping, {"218": "రెండు ఒకటి ఎనిమిది", "Secunderabad": "సికింద్రాబాద్"})
    assert restored == "బస్సు రెండు ఒకటి ఎనిమిది సికింద్రాబాద్ కు వెళ్తుంది."


def test_numbers_preserved():
    assert numbers_preserved("Bus 218", "బస్సు ౨౧౮")
    assert not numbers_preserved("Bus 218", "బస్సు 213")


def test_translate_protected_paths():
    ok = FakeMT(lambda t: t.replace("goes to", "जाती है"))
    out, path = asyncio.run(translate_protected(ok, "Bus 218 goes to Koti", "en", "hi", {"218": "दो एक आठ", "Koti": "कोठी"}))
    assert path == "mt+placeholders" and "दो एक आठ" in out and "कोठी" in out

    drops_tokens = FakeMT(lambda t: "बस 218 कोटी जाती है")  # tokens lost, but number kept in plain pass
    out, path = asyncio.run(translate_protected(drops_tokens, "Bus 218 goes to Koti", "en", "hi", {"Koti": "कोठी"}))
    assert path == "mt"

    breaks_numbers = FakeMT(lambda t: "बस 213")
    with pytest.raises(UnsafeTranslation):
        asyncio.run(translate_protected(breaks_numbers, "Bus 218", "en", "hi"))


def test_hours():
    t = lambda h, m=0: datetime(2026, 10, 11, h, m, tzinfo=ZoneInfo("Asia/Kolkata"))  # noqa: E731
    assert hours.probably_open("09:00", "21:00", t(10)) is True
    assert hours.probably_open("09:00", "21:00", t(22)) is False
    assert hours.probably_open("18:00", "02:00", t(1)) is True  # past midnight
    assert hours.probably_open("bad", "21:00", t(10)) is None
    assert hours.say_range("09:00", "21:30", "en") == "9 AM to 9:30 PM"
    assert hours.say_range("09:00", "21:00", "te") == "ఉదయం 9 నుండి రాత్రి 9 వరకు"
    assert hours.say_range("09:00", "21:00", "hi") == "सुबह 9 बजे से रात 9 बजे तक"
