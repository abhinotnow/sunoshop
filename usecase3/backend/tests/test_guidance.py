from backend.app.services.guidance import next_step
from backend.app.services.verify import Evidence, verify

from .conftest import SECUNDERABAD, rec, route


def v_of(frames, ev=None):
    return verify(frames, ev or Evidence())


def test_confirmed_is_done(bus_218):
    step = next_step(v_of(bus_218), reads_used=1)
    assert step["action"] == "done" and step["phrase_ids"] == []


def test_cut_off_right_asks_to_move_right_and_reread():
    frames = [rec(route_numbers=[route("219", "partial")], places=SECUNDERABAD, cut_off_sides=["right"]) for _ in range(3)]
    step = next_step(v_of(frames), reads_used=1)
    assert step["action"] == "reread" and step["phrase_ids"][0] == "move_right"


def test_far_sign_zooms():
    frames = [rec(route_numbers=[route("127K", "partial")], main_sign_box=[300, 420, 380, 560]) for _ in range(3)]
    step = next_step(v_of(frames), reads_used=1)
    assert step["phrase_ids"][0] == "move_closer" and step["focus_box"] == [300, 420, 380, 560]


def test_off_centre_aims():
    frames = [rec(route_numbers=[route("218", "partial")], main_sign_box=[300, 0, 700, 300]) for _ in range(3)]
    assert next_step(v_of(frames), reads_used=1)["phrase_ids"][0] == "aim_left"


def test_no_sign_then_give_up():
    frames = [rec(sign_found=False)] * 3
    assert next_step(v_of(frames), reads_used=1)["action"] == "guide"
    final = next_step(v_of(frames), reads_used=3)
    assert final["action"] == "give_up" and "ask_someone" in final["phrase_ids"]


def test_phone_tilt_comes_first():
    frames = [rec(sign_found=False)] * 3
    assert next_step(v_of(frames), reads_used=1, device={"tilt": "up"})["phrase_ids"][0] == "tilt_up"


def test_unconfirmed_after_max_reads_gives_up():
    frames = [rec(route_numbers=[route("218", "partial")])] * 3
    assert next_step(v_of(frames), reads_used=3)["action"] == "give_up"
