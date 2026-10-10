from backend.app.services.verify import Evidence, key_confirmed, verify

from .conftest import SECUNDERABAD, place, rec, route


def field(v, kind):
    return [f for f in v["fields"] if f["kind"] == kind]


def arb(**kw):
    base = {"legible": True, "route_numbers": [], "places": [], "platform": None, "business_name_romanized": "",
            "symbols": [], "speed_limit_value": "", "pedestrian_signal_state": "none"}
    base.update(kw)
    return base


def test_all_agree_with_arbiter_is_confirmed(bus_218):
    v = verify(bus_218, Evidence(arbiter=arb(route_numbers=["218"]), arbiter_ran=True))
    assert v["sign_found"] and v["category"] == "bus_route_board"
    r = field(v, "route")[0]
    assert (r["value"], r["status"]) == ("218", "confirmed")
    p = field(v, "place")[0]
    assert p["status"] == "confirmed" and p["place_id"] == "secunderabad"
    assert p["texts"]["te"] == "సికింద్రాబాద్"
    assert key_confirmed(v)


def test_arbiter_disagrees_route_is_uncertain(bus_218):
    v = verify(bus_218, Evidence(arbiter=arb(route_numbers=["213"]), arbiter_ran=True))
    r = field(v, "route")[0]
    assert r["status"] == "uncertain" and "different" in r["reason"]


def test_ocr_can_confirm_route(bus_218):
    v = verify(bus_218, Evidence(arbiter=None, arbiter_ran=True, ocr_text="218 SECUNDERABAD", ocr_ran=True))
    assert field(v, "route")[0]["status"] == "confirmed"


def test_no_second_reader_needs_all_three_frames(bus_218):
    assert field(verify(bus_218, Evidence()), "route")[0]["status"] == "confirmed"
    two_of_three = bus_218[:2] + [rec(route_numbers=[route("213")], places=SECUNDERABAD)]
    assert field(verify(two_of_three, Evidence()), "route")[0]["status"] == "uncertain"


def test_glare_hides_route_gives_unreadable_not_a_guess():
    frames = [rec(route_numbers=[route("5", "unreadable")], places=[place("కోఠి", "Telugu", "Koti"), place("KOTI", "Latin", "Koti")])
              for _ in range(3)]
    v = verify(frames, Evidence(arbiter=arb(places=[{"text": "KOTI", "romanized": "Koti"}]), arbiter_ran=True))
    r = field(v, "route")[0]
    assert r["status"] == "unreadable" and r["value"] == ""
    assert field(v, "place")[0]["status"] == "confirmed"


def test_partial_legibility_never_confirms(bus_218):
    frames = [rec(route_numbers=[route("218", "partial")], places=SECUNDERABAD) for _ in range(3)]
    v = verify(frames, Evidence(arbiter=arb(route_numbers=["218"]), arbiter_ran=True))
    assert field(v, "route")[0]["status"] == "uncertain"


def test_unknown_place_without_second_reader_is_uncertain():
    frames = [rec(places=[place("Nowhereville", "Latin", "Nowhereville", "destination")]) for _ in range(3)]
    v = verify(frames, Evidence())
    assert field(v, "place")[0]["status"] == "uncertain"


def test_wrong_script_is_uncertain():
    frames = [rec(places=[place("Ameerpet", "Telugu", "Ameerpet", "station")]) for _ in range(3)]
    v = verify(frames, Evidence(arbiter=arb(places=[{"text": "Ameerpet", "romanized": "Ameerpet"}]), arbiter_ran=True))
    assert field(v, "place")[0]["status"] == "uncertain"


def test_single_photo_needs_arbiter():
    one = [rec(route_numbers=[route("218")], places=SECUNDERABAD)]
    assert field(verify(one, Evidence()), "route")[0]["status"] == "uncertain"
    v = verify(one, Evidence(arbiter=arb(route_numbers=["218"], places=[{"text": "SECUNDERABAD", "romanized": "Secunderabad"}]), arbiter_ran=True))
    assert field(v, "route")[0]["status"] == "confirmed"
    assert field(v, "place")[0]["status"] == "confirmed"


def test_partial_prefix_candidate_is_dropped():
    frames = [rec(route_numbers=[route("218")]), rec(route_numbers=[route("218")]), rec(route_numbers=[route("21", "partial")])]
    values = [f["value"] for f in field(verify(frames, Evidence()), "route")]
    assert values == ["218"]


def test_no_sign_majority():
    frames = [rec(), rec(sign_found=False), rec(sign_found=False)]
    assert verify(frames, Evidence())["sign_found"] is False


def test_pedestrian_signal_rules():
    def sig(state):
        return rec(sign_category="pedestrian_signal", pedestrian_signal={"state": state, "countdown": None})
    walk = verify([sig("walk")] * 3, Evidence())
    assert field(walk, "pedestrian_signal")[0] == {**field(walk, "pedestrian_signal")[0], "value": "walk", "status": "confirmed"}
    changing = verify([sig("walk"), sig("dont_walk"), sig("walk")], Evidence())
    assert field(changing, "pedestrian_signal")[0]["value"] == "changing"
    arb_disagrees = verify([sig("walk")] * 3, Evidence(arbiter=arb(pedestrian_signal_state="dont_walk"), arbiter_ran=True))
    assert field(arb_disagrees, "pedestrian_signal")[0]["status"] == "uncertain"


def test_speed_limit_needs_value_check():
    def sl(v):
        return rec(sign_category="traffic_sign", symbols=[{"code": "speed_limit", "value": v, "legibility": "clear"}])
    ok = verify([sl("40")] * 3, Evidence(arbiter=arb(symbols=["speed_limit"], speed_limit_value="40"), arbiter_ran=True))
    assert field(ok, "traffic_sign")[0]["status"] == "confirmed"
    bad = verify([sl("40")] * 3, Evidence(arbiter=arb(symbols=["speed_limit"], speed_limit_value="60"), arbiter_ran=True))
    assert field(bad, "traffic_sign")[0]["status"] == "uncertain"


def test_shop_fields():
    biz = {"name_text": "శ్రీ సాయి మెడికల్స్", "name_script": "Telugu", "name_romanized": "Sri Sai Medicals",
           "category_en": "pharmacy", "hours_text": "9 AM - 10 PM", "open_time": "09:00", "close_time": "22:00", "open_hint": "none"}
    v = verify([rec(sign_category="shop", business=biz)] * 3,
               Evidence(arbiter=arb(business_name_romanized="SRI SAI MEDICALS"), arbiter_ran=True))
    kinds = {f["kind"]: f for f in v["fields"]}
    assert kinds["business"]["status"] == "confirmed"
    assert kinds["business_category"]["status"] == "uncertain"
    assert kinds["hours"]["open"] == "09:00"


def test_direction_arrows_pair_with_places():
    frames = [rec(sign_category="direction",
                  places=[place("అమీర్‌పేట", "Telugu", "Ameerpet"), place("Ameerpet", "Latin", "Ameerpet")],
                  arrows=[{"direction": "left", "applies_to": "Ameerpet", "legibility": "clear"}]) for _ in range(3)]
    v = verify(frames, Evidence())
    a = field(v, "arrow")[0]
    assert a["place_ref"] == "Ameerpet" and a["status"] == "confirmed"


def test_issues_majority():
    frames = [rec(cut_off_sides=["right"], quality_issues=["glare"]), rec(cut_off_sides=["right"]), rec()]
    v = verify(frames, Evidence())
    assert v["issues"]["cut_off_sides"] == ["right"]
    assert v["issues"]["quality"] == []


# ---------------------------------------------------------------- shop names and free text

LAKSHMI = {"name_text": "శ్రీ లక్ష్మి జనరల్ స్టోర్స్", "name_script": "Telugu", "name_romanized": "Sri Lakshmi General Stores",
           "category_en": "general store", "hours_text": "", "open_time": "", "close_time": "", "open_hint": "none"}


def test_shop_name_confirmed_by_arbiter_native_script_despite_other_spelling():
    # the arbiter romanized it differently, but read the same Telugu
    v = verify([rec(sign_category="shop", business=LAKSHMI)] * 3,
               Evidence(arbiter=arb(business_name_romanized="Shree Laxmi Janaral Storss",
                                    business_name_text="శ్రీ లక్ష్మి జనరల్ స్టోర్స్"), arbiter_ran=True))
    assert field(v, "business")[0]["status"] == "confirmed"


def test_shop_name_confirmed_by_ocr():
    v = verify([rec(sign_category="shop", business=LAKSHMI)] * 3,
               Evidence(arbiter=arb(), arbiter_ran=True, ocr_text="I శ్రీ లక్ష్మి జనరల్ స్టోర్స్ -", ocr_ran=True))
    assert field(v, "business")[0]["status"] == "confirmed"
    assert field(v, "business")[0]["checks"]["second_reader"] == "ocr"


def test_shop_name_not_seen_by_any_second_reader_stays_uncertain():
    v = verify([rec(sign_category="shop", business=LAKSHMI)] * 3,
               Evidence(arbiter=arb(business_name_romanized="Gupta Sweets", business_name_text="गुप्ता स्वीट्स"),
                        arbiter_ran=True, ocr_text="OPEN 7 AM", ocr_ran=True))
    assert field(v, "business")[0]["status"] == "uncertain"


def notice(*lines):
    return rec(sign_category="information", languages_present=["en"],
               other_text=[{"text": t, "script": "Latin", "legibility": "clear"} for t in lines])


def test_single_photo_text_needs_an_independent_reader():
    alone = verify([notice("PLEASE USE GATE NO. 2")], Evidence(arbiter=arb(), arbiter_ran=True))
    assert field(alone, "text")[0]["status"] == "uncertain"
    checked = verify([notice("PLEASE USE GATE NO. 2")],
                     Evidence(arbiter=arb(text_lines=["Please use gate no. 2"]), arbiter_ran=True))
    assert field(checked, "text")[0]["status"] == "confirmed"


def test_text_seen_in_a_different_line_does_not_confirm():
    v = verify([notice("PLEASE USE GATE NO. 2")], Evidence(arbiter=arb(text_lines=["NO PARKING"]), arbiter_ran=True,
                                                           ocr_text="NO PARKING", ocr_ran=True))
    assert field(v, "text")[0]["status"] == "uncertain"


def test_partial_shop_name_inside_the_arbiters_full_name_is_confirmed():
    biz = {**LAKSHMI, "name_text": "NEW SAGAR", "name_script": "Latin", "name_romanized": "NEW SAGAR"}
    v = verify([rec(sign_category="shop", business=biz)] * 3,
               Evidence(arbiter=arb(business_name_romanized="NEW SAGAR TIFFIN CENTRE"), arbiter_ran=True))
    assert field(v, "business")[0]["status"] == "confirmed"
