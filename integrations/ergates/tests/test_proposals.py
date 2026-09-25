"""Tests for ergates.proposals: validate_proposal, payload_hash and retention."""

import json
import time
from datetime import datetime, timedelta, timezone

import pytest

from ergates.proposals import (
    PROPOSAL_EXPIRY,
    PROPOSAL_KIND,
    PROPOSAL_RETENTION_GRACE_SECONDS,
    PROPOSED_STATE,
    ProposalError,
    ProposalJournal,
    parse_expires_at,
    payload_hash,
    validate_proposal,
)


def _iso(moment):
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def _valid_args(**overrides):
    args = {
        "name": "thijs",
        "title": "Thijs",
        "role": "Bookkeeper",
        "description": "Read invoices and prepare reconciliation notes.",
        "template_id": "bookkeeper-readonly",
        "provider": "operator-selected-provider",
        "model": "operator-selected-model",
        "briefing": "Role, boundaries, seed facts and reporting instructions.",
    }
    args.update(overrides)
    return args


def test_validate_proposal_returns_expected_shape():
    proposal = validate_proposal(_valid_args())

    assert proposal["kind"] == PROPOSAL_KIND == "ergates.agent-proposal.v1"
    assert isinstance(proposal["proposal_id"], str) and proposal["proposal_id"]
    assert isinstance(proposal["expires_at"], str) and proposal["expires_at"]
    assert proposal["agent"] == {
        "name": "thijs",
        "title": "Thijs",
        "role": "Bookkeeper",
        "description": "Read invoices and prepare reconciliation notes.",
        "template_id": "bookkeeper-readonly",
        "provider": "operator-selected-provider",
        "model": "operator-selected-model",
    }
    assert proposal["briefing"] == "Role, boundaries, seed facts and reporting instructions."


def test_validate_proposal_rejects_a_bad_name():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(name="Thijs_Bad!"))


def test_validate_proposal_rejects_a_name_starting_with_a_hyphen():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(name="-thijs"))


def test_validate_proposal_rejects_a_single_character_name():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(name="t"))


def test_validate_proposal_accepts_a_name_at_the_length_boundary():
    proposal = validate_proposal(_valid_args(name="a" * 32))
    assert proposal["agent"]["name"] == "a" * 32


def test_validate_proposal_rejects_a_name_over_the_length_boundary():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(name="a" * 33))


def test_validate_proposal_rejects_an_overlong_briefing():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(briefing="x" * 4001))


def test_validate_proposal_accepts_briefing_at_the_length_boundary():
    proposal = validate_proposal(_valid_args(briefing="x" * 4000))
    assert len(proposal["briefing"]) == 4000


def test_validate_proposal_rejects_an_overlong_title():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(title="x" * 61))


def test_validate_proposal_accepts_title_at_the_length_boundary():
    proposal = validate_proposal(_valid_args(title="x" * 60))
    assert len(proposal["agent"]["title"]) == 60


def test_validate_proposal_rejects_an_overlong_role():
    with pytest.raises(ProposalError):
        validate_proposal(_valid_args(role="x" * 41))


def test_validate_proposal_accepts_role_at_the_length_boundary():
    proposal = validate_proposal(_valid_args(role="x" * 40))
    assert len(proposal["agent"]["role"]) == 40


def test_validate_proposal_rejects_missing_required_field():
    args = _valid_args()
    del args["template_id"]
    with pytest.raises(ProposalError):
        validate_proposal(args)


def test_payload_hash_is_stable_across_key_order():
    proposal = validate_proposal(_valid_args())

    # Same content, deliberately re-built with reversed / shuffled key order at
    # every level (top level and the nested "agent" object).
    shuffled = {
        "briefing": proposal["briefing"],
        "agent": {
            "model": proposal["agent"]["model"],
            "provider": proposal["agent"]["provider"],
            "template_id": proposal["agent"]["template_id"],
            "description": proposal["agent"]["description"],
            "role": proposal["agent"]["role"],
            "title": proposal["agent"]["title"],
            "name": proposal["agent"]["name"],
        },
        "expires_at": proposal["expires_at"],
        "proposal_id": proposal["proposal_id"],
        "kind": proposal["kind"],
    }

    assert payload_hash(proposal) == payload_hash(shuffled)
    # Sanity: the two dicts really do have different literal key order.
    assert list(proposal.keys()) != list(shuffled.keys())
    assert list(json.dumps(proposal)) != list(json.dumps(shuffled))


def test_payload_hash_changes_when_content_changes():
    a = validate_proposal(_valid_args())
    b = validate_proposal(_valid_args(role="Analyst"))

    assert payload_hash(a) != payload_hash(b)


def test_payload_hash_is_a_hex_sha256_digest():
    proposal = validate_proposal(_valid_args())

    digest = payload_hash(proposal)

    assert len(digest) == 64
    int(digest, 16)  # raises ValueError if not valid hex


# --- retention (04 section 8; 11 section 4.1) ------------------------------


def test_parse_expires_at_handles_the_z_suffix_this_module_writes():
    proposal = validate_proposal(_valid_args())

    parsed = parse_expires_at(proposal["expires_at"])

    assert parsed is not None
    assert abs(parsed - (time.time() + PROPOSAL_EXPIRY.total_seconds())) < 60


def test_parse_expires_at_returns_none_for_junk_rather_than_raising():
    """One hand-edited record must not stop a retention sweep."""
    assert parse_expires_at(None) is None
    assert parse_expires_at("") is None
    assert parse_expires_at("not a timestamp") is None
    assert parse_expires_at(12345) is None


def test_prune_drops_an_unaccepted_proposal_past_expiry_plus_grace(tmp_path):
    """Without this, every proposal receipt -- including ones nobody ever accepted --
    accumulated under $HERMES_HOME/ergates/proposals forever."""
    journal = ProposalJournal(tmp_path)
    expired_at = datetime.now(timezone.utc) - timedelta(days=3)
    journal.claim("old", {"state": PROPOSED_STATE, "expires_at": _iso(expired_at)})

    removed = journal.prune(time.time())

    assert removed == 1
    assert journal.read("old") is None


def test_prune_keeps_a_proposal_inside_the_grace_window(tmp_path):
    journal = ProposalJournal(tmp_path)
    just_expired = datetime.now(timezone.utc) - timedelta(hours=1)
    journal.claim("recent", {"state": PROPOSED_STATE, "expires_at": _iso(just_expired)})

    assert journal.prune(time.time()) == 0
    assert journal.read("recent") is not None


def test_prune_keeps_a_live_proposal(tmp_path):
    journal = ProposalJournal(tmp_path)
    future = datetime.now(timezone.utc) + PROPOSAL_EXPIRY
    journal.claim("live", {"state": PROPOSED_STATE, "expires_at": _iso(future)})

    assert journal.prune(time.time()) == 0
    assert journal.read("live") is not None


def test_prune_never_drops_an_accepted_receipt(tmp_path):
    """Once a proposal is accepted its receipt is the provisioning record 11 section
    4.1 needs for resume-by-receipt (completed steps, briefing delivery state) --
    not an expiring offer."""
    journal = ProposalJournal(tmp_path)
    long_expired = datetime.now(timezone.utc) - timedelta(days=30)
    journal.claim("accepted", {
        "state": "accepted", "expires_at": _iso(long_expired),
        "completed_steps": ["profile_created", "configured"],
    })

    assert journal.prune(time.time()) == 0
    assert journal.read("accepted") is not None


def test_prune_boundary_is_expiry_plus_the_documented_grace(tmp_path):
    journal = ProposalJournal(tmp_path)
    expires_at = datetime.now(timezone.utc)
    stamp = _iso(expires_at)
    journal.claim("edge", {"state": PROPOSED_STATE, "expires_at": stamp})
    boundary = parse_expires_at(stamp) + PROPOSAL_RETENTION_GRACE_SECONDS

    assert journal.prune(boundary) == 0
    assert journal.prune(boundary + 1) == 1


def test_prune_keeps_a_record_without_an_expiry(tmp_path):
    journal = ProposalJournal(tmp_path)
    journal.claim("no-expiry", {"state": PROPOSED_STATE})

    assert journal.prune(time.time()) == 0
    assert journal.read("no-expiry") is not None
