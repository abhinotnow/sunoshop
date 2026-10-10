# Defines checkout state changes and rejects actions that are not allowed.
# Exports the checkout states, transition table, and transition function.
# Depends only on Python's standard library; never imports generative AI libraries.

from copy import deepcopy
from collections.abc import Mapping
from difflib import SequenceMatcher
from datetime import date, datetime
import json
from pathlib import Path
import re
import secrets
import unicodedata
from typing import Any, Final


BROWSING = "BROWSING"
CART_REVIEW = "CART_REVIEW"
GUARDED = "GUARDED"
AWAITING_CONFIRM = "AWAITING_CONFIRM"
ORDER_PLACED = "ORDER_PLACED"
MAX_CONFIRM_ATTEMPTS = 3
_CONFIRMATION_THRESHOLD = 0.9

_CONFIRMATION_PHRASES: Final[dict[str, tuple[str, ...]]] = {
    "en": (
        "silver mango shines",
        "quiet river flows",
        "golden leaves fall",
        "bright stars travel",
    ),
    "hi": (
        "नीला कमल खिलता है",
        "चाँदनी रात सुंदर है",
        "नदी धीरे बहती है",
        "सुनहरा फूल मुस्कराता है",
    ),
    "te": (
        "నీలి కమలం వికసిస్తుంది",
        "చంద్రకాంతి రాత్రి అందంగా ఉంది",
        "నది నెమ్మదిగా ప్రవహిస్తుంది",
        "బంగారు పువ్వు నవ్వుతుంది",
    ),
}

STATES: Final = (
    BROWSING,
    CART_REVIEW,
    GUARDED,
    AWAITING_CONFIRM,
    ORDER_PLACED,
)

ALLOWED_TRANSITIONS: Final[dict[str, dict[str, str]]] = {
    BROWSING: {"start": CART_REVIEW},
    CART_REVIEW: {"guard": GUARDED, "cancel": BROWSING},
    GUARDED: {"request_confirmation": AWAITING_CONFIRM, "cancel": BROWSING},
    AWAITING_CONFIRM: {"verified_confirmation": ORDER_PLACED, "cancel": BROWSING},
    ORDER_PLACED: {},
}


def transition(state: str, action: str) -> str:
    """Return the next checkout state or raise ValueError for an illegal move."""
    if state not in ALLOWED_TRANSITIONS:
        raise ValueError(f"unknown checkout state: {state}")
    next_state = ALLOWED_TRANSITIONS[state].get(action)
    if next_state is None:
        raise ValueError(f"action {action!r} is not allowed from {state}")
    return next_state


def create_confirmation_challenge(lang: str) -> dict[str, Any]:
    """Choose a random multiword phrase and return the shared challenge message."""
    language = lang.casefold()
    phrases = _CONFIRMATION_PHRASES.get(language)
    if phrases is None:
        raise ValueError(f"unsupported confirmation language: {lang}")
    return {
        "type": "confirm.challenge",
        "phrase": secrets.choice(phrases),
        "lang": language,
        "attempts_remaining": MAX_CONFIRM_ATTEMPTS,
    }


def _normalize_confirmation(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    letters_and_spaces = (
        character
        if character.isspace() or unicodedata.category(character)[0] in {"L", "M", "N"}
        else " "
        for character in normalized
    )
    return " ".join("".join(letters_and_spaces).split())


def verify_confirmation(
    spoken_text: str,
    expected_phrase: str,
    attempts_remaining: int = MAX_CONFIRM_ATTEMPTS,
) -> dict[str, Any]:
    """Check a spoken challenge phrase, consume one try, and fail closed on exhausted tries."""
    if (
        not isinstance(attempts_remaining, int)
        or isinstance(attempts_remaining, bool)
        or attempts_remaining < 1
        or attempts_remaining > MAX_CONFIRM_ATTEMPTS
    ):
        raise ValueError(f"attempts_remaining must be between 1 and {MAX_CONFIRM_ATTEMPTS}")
    if not isinstance(spoken_text, str) or not isinstance(expected_phrase, str):
        raise ValueError("spoken text and expected phrase must be strings")

    expected = _normalize_confirmation(expected_phrase)
    spoken = _normalize_confirmation(spoken_text)
    expected_words = expected.split()
    spoken_words = spoken.split()
    matched = (
        len(expected_words) >= 3
        and len(spoken_words) == len(expected_words)
        and SequenceMatcher(None, expected, spoken).ratio() >= _CONFIRMATION_THRESHOLD
    )
    return {
        "accepted": matched,
        "attempts_remaining": attempts_remaining - 1,
    }


_OPTIONAL_ADD_ON_NAMES = re.compile(
    r"\b(?:protection|insurance|warranty|priority handling|gift wrap|donation|add[- ]on)\b",
    re.IGNORECASE,
)
_TIMER_FIELDS = ("urgency_timer", "urgency_timers", "countdown", "countdown_text", "urgency_message")


def _is_truthy_flag(item: Mapping[str, Any], names: tuple[str, ...]) -> bool:
    return any(item.get(name) is True for name in names)


def _is_optional_add_on(item: Mapping[str, Any]) -> bool:
    preselected = _is_truthy_flag(
        item,
        ("preselected", "pre_ticked", "prechecked", "selected_by_default"),
    )
    category = " ".join(
        str(item.get(key, "")) for key in ("type", "kind", "category", "name", "title")
    )
    marked_add_on = _is_truthy_flag(item, ("add_on", "is_add_on", "optional_add_on"))
    named_add_on = bool(_OPTIONAL_ADD_ON_NAMES.search(category))
    return preselected and (marked_add_on or named_add_on)


def _fee_amount(item: Mapping[str, Any]) -> int:
    amount = item.get("amount_inr", item.get("total_price_inr"))
    if amount is None:
        unit = item.get("unit_price_inr")
        quantity = item.get("quantity", 1)
        if isinstance(unit, int) and not isinstance(unit, bool) and isinstance(quantity, int) and quantity > 0:
            amount = unit * quantity
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise ValueError("preselected add-ons must have a positive INR amount")
    return amount


def strip_dark_patterns(cart: Mapping[str, Any]) -> dict[str, Any]:
    """Remove preselected optional add-ons and false urgency timers from a cart."""
    if not isinstance(cart, Mapping):
        raise ValueError("cart must be a mapping")
    items = cart.get("items", [])
    if not isinstance(items, (list, tuple)):
        raise ValueError("cart items must be a list")

    safe_cart = deepcopy(dict(cart))
    safe_items = []
    removed_fees = []
    total_inr = 0
    for item in items:
        if not isinstance(item, Mapping):
            raise ValueError("each cart item must be a mapping")
        if _is_optional_add_on(item):
            amount = _fee_amount(item)
            name = str(item.get("name") or item.get("title") or "Optional add-on")
            removed_fees.append({"name": name, "amount_inr": amount})
            continue

        safe_item = deepcopy(dict(item))
        for field in _TIMER_FIELDS:
            safe_item.pop(field, None)
        quantity = safe_item.get("quantity", 1)
        unit_price = safe_item.get("unit_price_inr")
        line_total = safe_item.get("total_price_inr")
        valid_quantity = isinstance(quantity, int) and not isinstance(quantity, bool) and quantity > 0
        valid_unit_price = isinstance(unit_price, int) and not isinstance(unit_price, bool) and unit_price > 0
        if valid_unit_price and valid_quantity:
            line_total = unit_price * quantity
            safe_item["total_price_inr"] = line_total
        elif not (
            isinstance(line_total, int)
            and not isinstance(line_total, bool)
            and line_total > 0
        ):
            raise ValueError("cart items must have a positive INR total")
        total_inr += line_total
        safe_items.append(safe_item)

    safe_cart["items"] = safe_items
    for field in _TIMER_FIELDS:
        safe_cart.pop(field, None)
    safe_cart["total_inr"] = total_inr
    return {"cart": safe_cart, "total_inr": total_inr, "removed_fees": removed_fees}


ORDERS_PATH: Final = Path(__file__).with_name("data") / "orders.json"


def load_orders(path: str | Path = ORDERS_PATH) -> list[dict[str, Any]]:
    """Load local mock orders from JSON; the file is ignored by git."""
    with Path(path).open(encoding="utf-8") as orders_file:
        orders = json.load(orders_file)
    if not isinstance(orders, list) or any(not isinstance(order, dict) for order in orders):
        raise ValueError("orders.json must contain a list of order objects")
    return orders


def track_order(order_id: str, orders: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Return mock tracking status, next step, and estimated date for an order."""
    records = load_orders() if orders is None else orders
    order = next((item for item in records if item.get("order_id") == order_id), None)
    if order is None:
        raise ValueError(f"unknown order: {order_id}")
    tracking = order.get("tracking")
    if not isinstance(tracking, dict) or not all(
        isinstance(tracking.get(key), str) and tracking[key].strip()
        for key in ("status", "next_step", "date")
    ):
        raise ValueError(f"order {order_id} has incomplete tracking data")
    return {"order_id": order_id, **{key: tracking[key] for key in ("status", "next_step", "date")}}


def request_return(
    order_id: str,
    parent_asin: str,
    spoken_reason: str,
    *,
    source_lang: str = "te",
    orders: list[dict[str, Any]] | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Check the return window and translate the customer's reason for the seller."""
    if not isinstance(spoken_reason, str) or not spoken_reason.strip():
        raise ValueError("spoken_reason must be non-empty")
    records = load_orders() if orders is None else orders
    order = next((item for item in records if item.get("order_id") == order_id), None)
    if order is None:
        raise ValueError(f"unknown order: {order_id}")
    item = next(
        (line for line in order.get("items", []) if line.get("parent_asin") == parent_asin),
        None,
    )
    if item is None:
        raise ValueError(f"product {parent_asin} is not in order {order_id}")

    eligible = False
    deadline = None
    delivered_on = order.get("delivered_on")
    window_days = order.get("return_window_days")
    if order.get("status") == "delivered" and isinstance(delivered_on, str):
        try:
            delivery_date = datetime.strptime(delivered_on, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("delivered_on must use YYYY-MM-DD format") from exc
        if not isinstance(window_days, int) or isinstance(window_days, bool) or window_days < 0:
            raise ValueError("return_window_days must be a non-negative integer")
        deadline_date = delivery_date.fromordinal(delivery_date.toordinal() + window_days)
        deadline = deadline_date.isoformat()
        eligible = (today or date.today()) <= deadline_date

    if not eligible:
        return {"eligible": False, "order_id": order_id, "parent_asin": parent_asin,
                "seller_note_en": None, "return_by": deadline}

    from backend import bhashini

    seller_note = bhashini.translate_text(spoken_reason.strip(), source_lang, "en")
    if not seller_note:
        raise RuntimeError("translation returned an empty seller note")
    return {"eligible": True, "order_id": order_id, "parent_asin": parent_asin,
            "seller_note_en": seller_note, "return_by": deadline}
