# Tests the checkout transition table and guardian's dependency boundary.
# Exports state-path, cancellation, rejection, and import-safety tests.
# Depends on pytest, Python's AST parser, and backend.guardian.

import ast
from pathlib import Path

import pytest

from backend import guardian


def test_checkout_follows_the_allowed_path_to_order_placed():
    state = guardian.BROWSING
    for action, expected in (
        ("start", guardian.CART_REVIEW),
        ("guard", guardian.GUARDED),
        ("request_confirmation", guardian.AWAITING_CONFIRM),
        ("verified_confirmation", guardian.ORDER_PLACED),
    ):
        state = guardian.transition(state, action)
        assert state == expected


def test_cancel_returns_each_active_checkout_state_to_browsing():
    for state in (guardian.CART_REVIEW, guardian.GUARDED, guardian.AWAITING_CONFIRM):
        assert guardian.transition(state, "cancel") == guardian.BROWSING


def test_illegal_actions_and_unknown_states_raise_value_error():
    for state, action in (
        (guardian.BROWSING, "verified_confirmation"),
        (guardian.CART_REVIEW, "verified_confirmation"),
        (guardian.ORDER_PLACED, "cancel"),
        ("NOT_A_STATE", "start"),
    ):
        with pytest.raises(ValueError):
            guardian.transition(state, action)


def test_guardian_imports_no_generative_ai_library():
    source_path = Path(guardian.__file__)
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    imported_roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_roots.add(node.module.split(".")[0])

    assert imported_roots.isdisjoint({"anthropic", "google", "openai", "transformers"})


def test_strip_dark_patterns_removes_preticked_fees_and_recomputes_total():
    cart = {
        "items": [
            {
                "parent_asin": "p_001", "title": "Demo phone", "quantity": 1,
                "unit_price_inr": 3499, "total_price_inr": 9999,
            },
            {
                "name": "Pre-selected shipping protection", "add_on": True,
                "pre_ticked": True, "amount_inr": 49,
            },
            {
                "name": "Priority handling fee", "kind": "fee",
                "selected_by_default": True, "amount_inr": 29,
            },
            {
                "parent_asin": "p_002", "title": "User-selected gift", "quantity": 2,
                "unit_price_inr": 50, "total_price_inr": 100,
            },
        ],
        "total_inr": 10177,
        "urgency_timer": "Offer expires in 02:00",
        "urgency_timers": ["Only 2 left at this price"],
    }

    result = guardian.strip_dark_patterns(cart)

    assert result["total_inr"] == 3599
    assert result["cart"]["total_inr"] == 3599
    assert [item["title"] for item in result["cart"]["items"]] == ["Demo phone", "User-selected gift"]
    assert result["removed_fees"] == [
        {"name": "Pre-selected shipping protection", "amount_inr": 49},
        {"name": "Priority handling fee", "amount_inr": 29},
    ]
    assert "urgency_timer" not in result["cart"]
    assert "urgency_timers" not in result["cart"]
    assert cart["total_inr"] == 10177  # The source cart was not mutated.


def test_strip_dark_patterns_keeps_addons_the_user_selected():
    cart = {
        "items": [
            {
                "name": "Shipping protection", "add_on": True, "preselected": False,
                "quantity": 1, "unit_price_inr": 49,
            }
        ]
    }

    result = guardian.strip_dark_patterns(cart)

    assert len(result["cart"]["items"]) == 1
    assert result["removed_fees"] == []
    assert result["total_inr"] == 49


def test_strip_dark_patterns_rejects_preticked_fee_without_amount():
    cart = {"items": [{"name": "Warranty", "preselected": True, "add_on": True}]}

    with pytest.raises(ValueError, match="positive INR amount"):
        guardian.strip_dark_patterns(cart)


def test_strip_dark_patterns_rejects_cart_lines_with_invalid_totals():
    with pytest.raises(ValueError, match="positive INR total"):
        guardian.strip_dark_patterns({"items": [{"title": "Demo phone", "total_price_inr": -1}]})


@pytest.mark.parametrize("lang", ("en", "hi", "te"))
def test_confirmation_challenge_uses_a_random_multword_phrase_for_each_language(monkeypatch, lang):
    monkeypatch.setattr(guardian.secrets, "choice", lambda phrases: phrases[0])

    challenge = guardian.create_confirmation_challenge(lang)

    assert challenge["type"] == "confirm.challenge"
    assert challenge["lang"] == lang
    assert len(challenge["phrase"].split()) >= 3
    assert challenge["attempts_remaining"] == guardian.MAX_CONFIRM_ATTEMPTS


def test_confirmation_accepts_exact_or_strict_fuzzy_phrase_and_consumes_attempt():
    exact = guardian.verify_confirmation("Quiet river flows!", "quiet river flows", 3)
    slight_asr_error = guardian.verify_confirmation("quiet river flow", "quiet river flows", 3)

    assert exact == {"accepted": True, "attempts_remaining": 2}
    assert slight_asr_error == {"accepted": True, "attempts_remaining": 2}
    assert guardian.transition(guardian.AWAITING_CONFIRM, "verified_confirmation") == guardian.ORDER_PLACED


def test_confirmation_rejects_random_speech_generic_confirm_and_extra_words():
    phrase = "silver mango shines"
    for spoken in ("the weather is lovely", "confirm", "I confirm silver mango shines"):
        result = guardian.verify_confirmation(spoken, phrase, 3)
        assert result == {"accepted": False, "attempts_remaining": 2}


def test_confirmation_retries_are_limited_and_exhausted_tries_raise():
    remaining = guardian.MAX_CONFIRM_ATTEMPTS
    for expected_remaining in (2, 1, 0):
        result = guardian.verify_confirmation("no", "golden leaves fall", remaining)
        assert result["accepted"] is False
        assert result["attempts_remaining"] == expected_remaining
        remaining = result["attempts_remaining"]

    with pytest.raises(ValueError, match="attempts_remaining"):
        guardian.verify_confirmation("golden leaves fall", "golden leaves fall", remaining)


def test_confirmation_challenge_rejects_unsupported_language():
    with pytest.raises(ValueError, match="unsupported confirmation language"):
        guardian.create_confirmation_challenge("fr")


def test_track_order_returns_status_next_step_and_date():
    orders = [{
        "order_id": "o-1",
        "tracking": {"status": "Shipped", "next_step": "Out for delivery", "date": "2026-10-13"},
    }]

    assert guardian.track_order("o-1", orders) == {
        "order_id": "o-1", "status": "Shipped", "next_step": "Out for delivery", "date": "2026-10-13"
    }


def test_return_eligibility_translates_telugu_reason_into_english_note(monkeypatch):
    order = {
        "order_id": "o-1", "status": "delivered", "delivered_on": "2026-10-01",
        "return_window_days": 30, "items": [{"parent_asin": "p-1"}],
    }
    calls = []

    def translate(text, source, target):
        calls.append((text, source, target))
        return "The product arrived damaged."

    monkeypatch.setattr("backend.bhashini.translate_text", translate)
    result = guardian.request_return(
        "o-1", "p-1", "ఉత్పత్తి దెబ్బతిన్నది", orders=[order], today=guardian.date(2026, 10, 11)
    )

    assert result == {
        "eligible": True, "order_id": "o-1", "parent_asin": "p-1",
        "seller_note_en": "The product arrived damaged.", "return_by": "2026-10-31",
    }
    assert calls == [("ఉత్పత్తి దెబ్బతిన్నది", "te", "en")]


def test_return_rejects_item_not_in_order_and_skips_translation_when_ineligible(monkeypatch):
    order = {
        "order_id": "o-1", "status": "delivered", "delivered_on": "2026-08-01",
        "return_window_days": 7, "items": [{"parent_asin": "p-1"}],
    }
    monkeypatch.setattr(
        "backend.bhashini.translate_text",
        lambda *args, **kwargs: pytest.fail("ineligible return must not call translation"),
    )

    with pytest.raises(ValueError, match="not in order"):
        guardian.request_return("o-1", "p-2", "reason", orders=[order])
    result = guardian.request_return(
        "o-1", "p-1", "reason", orders=[order], today=guardian.date(2026, 10, 11)
    )
    assert result["eligible"] is False
    assert result["seller_note_en"] is None
    assert result["return_by"] == "2026-08-08"


def test_order_lookup_rejects_unknown_order():
    with pytest.raises(ValueError, match="unknown order"):
        guardian.track_order("missing", [])
