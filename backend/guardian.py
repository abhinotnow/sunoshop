# Defines checkout state changes and rejects actions that are not allowed.
# Exports the checkout states, transition table, and transition function.
# Depends only on Python's standard library; never imports generative AI libraries.

from typing import Final


BROWSING = "BROWSING"
CART_REVIEW = "CART_REVIEW"
GUARDED = "GUARDED"
AWAITING_CONFIRM = "AWAITING_CONFIRM"
ORDER_PLACED = "ORDER_PLACED"

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
