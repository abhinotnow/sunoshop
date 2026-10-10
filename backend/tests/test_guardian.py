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
