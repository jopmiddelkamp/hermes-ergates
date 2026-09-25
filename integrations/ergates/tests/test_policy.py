"""Tests for ergates.policy: the pre_tool_call gate (roadmap contract C6)."""

import logging

import pytest

from ergates.policy import (
    BLOCK_RAW_CRON,
    BLOCK_SETUP,
    BLOCK_UNVERIFIED,
    decide,
    guarded,
)

OPEN = {"admitted": True, "granted_toolsets": None, "tool_toolset": None}


def test_rule_1_a_profile_still_being_set_up_is_blocked_for_every_tool():
    for tool_name in ("terminal", "memory", "ergates_propose_agent", "cronjob_manage"):
        assert decide(tool_name, {}, **{**OPEN, "admitted": False}) == {"action": "block", "message": BLOCK_SETUP}


@pytest.mark.parametrize("action", ["create", "CREATE", " Create "])
def test_rule_2_a_raw_cron_create_is_blocked(action):
    assert decide("cronjob_manage", {"action": action}, **OPEN) == {"action": "block", "message": BLOCK_RAW_CRON}


@pytest.mark.parametrize(("tool_name", "args"), [
    ("cronjob_manage", {"action": "list"}),
    ("cronjob_manage", {"action": "remove", "job_id": "j"}),
    ("cronjob_manage", {}),
    ("ergates_create_reminder", {"schedule": "0 9 * * *", "prompt": "p"}),
    ("terminal", {"action": "create"}),
])
def test_rule_4_every_other_call_runs(tool_name, args):
    assert decide(tool_name, args, **OPEN) is None


def test_rule_1_comes_before_rule_2():
    assert decide("cronjob_manage", {"action": "create"}, **{**OPEN, "admitted": False})["message"] == BLOCK_SETUP


def test_rule_3_is_not_applied_yet():
    """Plan 5 adds revoked toolsets; until then a toolset outside the grant runs."""
    assert decide("terminal", {}, admitted=True, granted_toolsets=frozenset({"web"}), tool_toolset="terminal") is None


def test_review_focus_3_a_gate_that_raises_blocks_the_tool(caplog):
    """Hermes runs the tool when a pre_tool_call callback raises (it fails OPEN), so
    the gate must turn its own failure into a block."""

    @guarded
    def broken(tool_name, args):
        raise RuntimeError(f"store unreadable while checking {args['secret']}")

    with caplog.at_level(logging.WARNING):
        result = broken("terminal", {"secret": "rm -rf /srv/data"})

    assert result == {"action": "block", "message": BLOCK_UNVERIFIED}
    assert "RuntimeError" in caplog.text
    assert "rm -rf" not in caplog.text


def test_guarded_passes_a_result_through_and_keeps_the_name():
    @guarded
    def gate(tool_name, args):
        return decide(tool_name, args, **OPEN)

    assert gate("cronjob_manage", {"action": "create"})["message"] == BLOCK_RAW_CRON
    assert gate("terminal", {}) is None
    assert gate.__name__ == "gate"


def test_non_dict_arguments_are_a_block_not_a_crash():
    @guarded
    def gate(tool_name, args):
        return decide(tool_name, args, **OPEN)

    assert gate("cronjob_manage", None) == {"action": "block", "message": BLOCK_UNVERIFIED}
