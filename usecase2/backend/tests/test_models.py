# Tests the PKO and client/server WebSocket message models against CONTRACT.md.
# Exports unit tests verifying M1-02 contract models for SYNC-A.
# Depends on pytest, pydantic, and backend.models.

import pytest
from pydantic import ValidationError

from backend.models import (
    AdaptOffer,
    ASRResult,
    AudioUtterance,
    CheckAgain,
    CheckoutAction,
    CheckoutState,
    ClientMessage,
    ConfirmChallenge,
    ErrorMessage,
    ProductKnowledgeObject,
    ReplyDone,
    ReplySentence,
    ServerMessage,
    SessionStart,
    ShelfResults,
    UIEvent,
)


def sample_valid_pko_dict() -> dict:
    return {
        "parent_asin": "B09CBF2XCF",
        "title": "Ergonomic Coffee Scoop",
        "price": 8.99,
        "features": ["Integrated funnel", "High-grade steel"],
        "description": ["Durable scoop for daily coffee brewing."],
        "images": [
            {
                "thumb": "https://example.com/thumb.jpg",
                "large": "https://example.com/large.jpg",
                "variant": "MAIN",
                "hi_res": None,
            }
        ],
        "store": "Coffee Craft",
        "average_rating": 4.5,
        "rating_number": 120,
        "categories": ["Home & Kitchen", "Coffee"],
        "details": {"material": "Stainless Steel"},
        "main_category": "Home & Kitchen",
        "videos": [],
        "bought_together": None,
        "price_inr": 749,
        "image_url": "https://example.com/large.jpg",
        "alt_text": {
            "en": "A stainless steel coffee scoop with measuring markings.",
            "hi": "माप चिह्नों के साथ एक स्टेनलेस स्टील कॉफी स्कूप।",
            "te": "కొలత గుర్తులు కలిగిన స్టెయిన్‌లెస్ స్టీల్ కాఫీ స్కూప్.",
        },
        "review_digest": {
            "pros": ["Accurate dose", "Sturdy grip"],
            "cons": ["Slightly heavy"],
        },
        "size_chart": [],
        "reviews": [
            {
                "rating": 5.0,
                "title": "Excellent quality",
                "text": "Sturdy build, scoop feels premium.",
                "timestamp": 1710000000,
                "verified_purchase": True,
                "helpful_vote": 2,
                "user_id": "U12345",
                "parent_asin": "B09CBF2XCF",
                "synthetic": False,
                "lang": "en",
            }
        ],
        "review_chunks": [
            {
                "aspect": "durability",
                "text": "Sturdy build, scoop feels premium.",
                "embedding": [0.1, 0.2, 0.3],
            }
        ],
    }


def test_valid_pko_validates():
    pko = ProductKnowledgeObject.model_validate(sample_valid_pko_dict())
    assert pko.parent_asin == "B09CBF2XCF"
    assert pko.price_inr == 749
    assert pko.alt_text.en.startswith("A stainless steel")


def test_invalid_pko_rejected_on_negative_price():
    data = sample_valid_pko_dict()
    data["price"] = -5.0
    with pytest.raises(ValidationError):
        ProductKnowledgeObject.model_validate(data)


def test_invalid_pko_rejected_on_missing_alt_text():
    data = sample_valid_pko_dict()
    del data["alt_text"]
    with pytest.raises(ValidationError):
        ProductKnowledgeObject.model_validate(data)


def test_client_messages_validate():
    # 1. session.start
    m1 = SessionStart(type="session.start", lang="hi", mode="auto", rate=1.2)
    assert m1.lang == "hi"

    # 2. audio.utterance
    m2 = AudioUtterance(
        type="audio.utterance",
        audio_base64="UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
        duration_ms=1500,
    )
    assert m2.sample_rate_hz == 16000
    assert m2.channels == 1

    # 3. ui.event
    m3 = UIEvent(type="ui.event", kind="tap_miss")
    assert m3.kind == "tap_miss"

    # 4. checkout.action
    m4 = CheckoutAction(type="checkout.action", action="start")
    assert m4.action == "start"

    # confirm_audio requires audio_base64
    with pytest.raises(ValidationError):
        CheckoutAction(type="checkout.action", action="confirm_audio")


def test_server_messages_validate():
    # 1. asr.result
    s1 = ASRResult(type="asr.result", text="shoe size 9", plausible=True)
    assert s1.plausible is True

    # 2. check_again
    s2 = CheckAgain(type="check_again", reason="Audio too quiet")
    assert s2.reason == "Audio too quiet"

    # 3. reply.sentence
    s3 = ReplySentence(
        type="reply.sentence",
        idx=0,
        text="Here are your options",
        audio_base64="AAAA",
        pause_ms=200,
        rate=1.0,
    )
    assert s3.idx == 0

    # 4. reply.done
    s4 = ReplyDone(type="reply.done", grounded=True)
    assert s4.grounded is True

    # 5. shelf.results
    s5 = ShelfResults(
        type="shelf.results",
        products=[
            {
                "parent_asin": "B123",
                "title": "Shoe A",
                "price_inr": 1999,
                "pan": -1.0,
                "alt_text": "Left shoe",
            }
        ],
    )
    assert len(s5.products) == 1
    assert s5.products[0].pan == -1.0

    # 6. checkout.state
    s6 = CheckoutState(
        type="checkout.state",
        state="GUARDED",
        cart=[
            {
                "parent_asin": "B123",
                "title": "Shoe A",
                "quantity": 1,
                "unit_price_inr": 1999,
                "total_price_inr": 1999,
            }
        ],
        total_inr=1999,
        removed_fees=[{"name": "Sneak fee", "amount_inr": 49}],
    )
    assert s6.state == "GUARDED"

    # 7. confirm.challenge
    s7 = ConfirmChallenge(
        type="confirm.challenge", phrase="Blue Falcon", lang="en", attempts_remaining=3
    )
    assert s7.phrase == "Blue Falcon"

    # 8. adapt.offer
    s8 = AdaptOffer(
        type="adapt.offer", adaptation="larger_targets", reason="Missed taps"
    )
    assert s8.adaptation == "larger_targets"

    # 9. error
    s9 = ErrorMessage(type="error", code="E_NETWORK", fallback="retry")
    assert s9.fallback == "retry"
