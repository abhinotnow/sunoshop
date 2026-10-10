from datetime import datetime
from zoneinfo import ZoneInfo

from backend.app.services.compose import compose, route_words
from backend.app.services.verify import Evidence, verify

from .conftest import SECUNDERABAD, place, rec, route


def arb(**kw):
    base = {"legible": True, "route_numbers": [], "places": [], "platform": None, "business_name_romanized": "",
            "symbols": [], "speed_limit_value": "", "pedestrian_signal_state": "none"}
    base.update(kw)
    return base


def test_route_words():
    assert route_words("218", "en") == "two one eight"
    assert route_words("10H", "hi") == "एक शून्य एच"
    assert route_words("218", "te") == "రెండు ఒకటి ఎనిమిది"
    assert route_words("218", "te", "english") == "two one eight"


def test_confirmed_route_and_place_in_three_languages(bus_218):
    v = verify(bus_218, Evidence(arbiter=arb(route_numbers=["218"]), arbiter_ran=True))
    assert compose(v, "en")["key"][0]["text"] == "The sign says: bus two one eight, to Secunderabad."
    te = compose(v, "te")["key"][0]
    assert te["status"] == "confirmed" and "సికింద్రాబాద్" in te["text"] and "రెండు ఒకటి ఎనిమిది" in te["text"]


def test_uncertain_route_uses_looks_like(bus_218):
    v = verify(bus_218, Evidence(arbiter=arb(route_numbers=["213"]), arbiter_ran=True))
    line = compose(v, "en")["key"][0]
    assert line["status"] == "uncertain" and "looks like" in line["text"] and "please check" in line["text"]


def test_glare_case_says_cannot_read_number():
    frames = [rec(route_numbers=[route("5", "unreadable")], places=[place("KOTI", "Latin", "Koti")]) for _ in range(3)]
    v = verify(frames, Evidence(arbiter=arb(places=[{"text": "KOTI", "romanized": "Koti"}]), arbiter_ran=True))
    assert compose(v, "en")["key"][0]["text"] == "I can read Koti but not the bus number."


def test_simple_mode(bus_218):
    v = verify(bus_218, Evidence(arbiter=arb(route_numbers=["213"]), arbiter_ran=True))
    assert "Please ask someone" in compose(v, "en", mode="simple")["key"][0]["text"]


def test_unconfirmed_walk_signal_is_never_spoken_as_walk():
    sig = rec(sign_category="pedestrian_signal", pedestrian_signal={"state": "walk", "countdown": None})
    v = verify([sig, sig], Evidence(arbiter=arb(pedestrian_signal_state="dont_walk"), arbiter_ran=True))
    text = compose(v, "en")["key"][0]["text"]
    assert "walking figure" not in text and "ask someone" in text


def test_shop_hours_and_open_state():
    biz = {"name_text": "SRI SAI MEDICALS", "name_script": "Latin", "name_romanized": "Sri Sai Medicals",
           "category_en": "pharmacy", "hours_text": "", "open_time": "09:00", "close_time": "22:00", "open_hint": "none"}
    v = verify([rec(sign_category="shop", business=biz)] * 3,
               Evidence(arbiter=arb(business_name_romanized="Sri Sai Medicals"), arbiter_ran=True))
    late = datetime(2026, 10, 11, 23, 30, tzinfo=ZoneInfo("Asia/Kolkata"))
    speech = compose(v, "en", now=late)
    texts = [ln["text"] for ln in speech["key"] + speech["more"]]
    assert "The board says: Sri Sai Medicals." in texts
    assert "The board shows timings 9 AM to 10 PM." in texts
    assert "So it is probably closed now." in texts
    hi = compose(v, "hi", now=late)
    assert any(ln.get("pending") for ln in hi["key"])  # category needs translation in Hindi


def test_traffic_sign_with_safety_note():
    v = verify([rec(sign_category="traffic_sign", symbols=[{"code": "pedestrian_crossing", "value": "", "legibility": "clear"}])] * 3,
               Evidence())
    texts = [ln["text"] for ln in compose(v, "en")["key"]]
    assert texts[0] == "This is a pedestrian crossing sign."
    assert "listen" in texts[1]


def test_no_sign():
    v = verify([rec(sign_found=False)] * 3, Evidence())
    assert compose(v, "en")["empty"] is True


def test_notice_lines_are_read_together_in_the_users_language():
    lines = [("NOTICE", "Latin"), ("PLEASE USE GATE NO. 2", "Latin"), ("कृपया गेट नंबर 2 का उपयोग करें", "Devanagari")]
    frames = [rec(sign_category="information", languages_present=["en", "hi"],
                  other_text=[{"text": t, "script": s, "legibility": "clear"} for t, s in lines])] * 3
    v = verify(frames, Evidence(arbiter=arb(text_lines=[t for t, _ in lines]), arbiter_ran=True))
    en = compose(v, "en")
    assert en["key"][0]["text"] == "The sign says: Notice. Please use gate no. 2."
    assert en["key"][0]["status"] == "confirmed"
    hi = compose(v, "hi")
    assert hi["key"][0]["text"] == "बोर्ड पर लिखा है: कृपया गेट नंबर 2 का उपयोग करें।"


def test_shop_text_stays_under_more():
    biz = {"name_text": "GUPTA SWEETS", "name_script": "Latin", "name_romanized": "Gupta Sweets", "category_en": "",
           "hours_text": "", "open_time": "", "close_time": "", "open_hint": "none"}
    frames = [rec(sign_category="shop", business=biz,
                  other_text=[{"text": "PURE GHEE", "script": "Latin", "legibility": "clear"}])] * 3
    v = verify(frames, Evidence(arbiter=arb(business_name_romanized="GUPTA SWEETS"), arbiter_ran=True))
    out = compose(v, "en")
    assert out["key"][0]["text"] == "The board says: Gupta Sweets."
    assert any("Pure ghee" in l.get("text", "") for l in out["more"])
