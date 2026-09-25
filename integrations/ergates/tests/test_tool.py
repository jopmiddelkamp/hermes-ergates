"""Tests for ergates.tool: propose_handler and the approval-attention hooks.

propose_handler and the two approval hooks are the load-bearing
glue described in 11 section 4.1-4.2 ("never creates a profile", "journals with
state 'proposed'", "writes a pending attention event ... and publishes to ntfy
when configured").
"""

import json
import threading
import time

import pytest

from conftest import raw_bytes, rows
from ergates.attention import AttentionJournal, command_hash
from ergates.proposals import ProposalService, payload_hash, validate_proposal
from ergates.tool import (
    _resolve_profile,
    duplicate_hook_call,
    flush_retries,
    on_approval_request,
    on_approval_response,
    propose_handler,
)

_THREAD_TIMEOUT = 5.0


def _join(thread):
    """Wait for the background publish thread (never longer than a watchdog)."""
    if thread is not None:
        thread.join(timeout=_THREAD_TIMEOUT)
        assert not thread.is_alive(), "publish thread did not finish"
    return thread


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


@pytest.fixture
def proposals(store):
    return ProposalService(store)


def test_propose_handler_returns_json_and_records_it_as_proposed(proposals):
    result = propose_handler(_valid_args(), service=proposals)

    proposal = json.loads(result)
    assert "error" not in proposal
    assert proposal["kind"] == "ergates.agent-proposal.v1"
    assert proposals.get(proposal["proposal_id"])["state"] == "proposed"


def test_propose_handler_never_creates_a_profile_only_a_receipt(proposals, store, tmp_path):
    """propose_handler has no access to any profile-creation API at all --
    the only side effect it can have is one proposal receipt."""
    propose_handler(_valid_args(), service=proposals)

    assert [path.name for path in tmp_path.iterdir()] == ["ergates"]
    assert len(rows(store, "proposal_receipts")) == 1
    assert rows(store, "proposal_steps") == []


def test_propose_handler_returns_an_error_payload_for_invalid_input(proposals, store):
    result = propose_handler(_valid_args(name="Bad Name!"), service=proposals)

    payload = json.loads(result)
    assert "error" in payload
    assert rows(store, "proposal_receipts") == []


def test_propose_handler_attaches_the_backend_session_id_never_a_model_supplied_one(proposals, store):
    """source_session_id is backend-owned: it comes only from the handler's own
    session_id/task_id kwargs (how Hermes actually dispatches tool handlers --
    tools/registry.py's dispatch_kwargs), never from a model-supplied `args` field,
    even when a caller tries to smuggle one in."""
    args = _valid_args(source_session_id="model-supplied-fake-session")
    result = propose_handler(
        args, service=proposals, session_id="concierge-session-42", task_id="task-99",
    )

    proposal = json.loads(result)
    assert proposal["source_session_id"] == "concierge-session-42"
    assert rows(store, "proposal_receipts")[0]["source_session_id"] == "concierge-session-42"


def test_propose_handler_falls_back_to_task_id_when_session_id_is_absent(proposals):
    result = propose_handler(_valid_args(), service=proposals, task_id="task-only-77")

    proposal = json.loads(result)
    assert proposal["source_session_id"] == "task-only-77"


def test_propose_handler_source_session_id_is_none_when_hermes_supplies_neither(proposals):
    result = propose_handler(_valid_args(), service=proposals)

    proposal = json.loads(result)
    assert proposal["source_session_id"] is None


def test_the_returned_proposal_is_exactly_what_accept_verifies(proposals):
    """The app sends the tool result back unchanged; its hash must match the receipt."""
    proposal = json.loads(propose_handler(_valid_args(), service=proposals, session_id="s-1"))

    receipt = proposals.accept(proposal["proposal_id"], proposal, profile_exists=lambda name: False)

    assert receipt["state"] == "accepted"


class _CtxWithSessionProfile:
    profile_name = "thijs"

    def get_config(self, key, default=None):
        return default


class _CtxWithoutSessionProfile:
    def get_config(self, key, default=None):
        return "config-default-profile" if key == "ntfy.default_profile" else default


class _CtxWhoseProfileNameRaises:
    @property
    def profile_name(self):
        raise RuntimeError("no active profile in this context")

    def get_config(self, key, default=None):
        return "config-default-profile" if key == "ntfy.default_profile" else default


def test_resolve_profile_prefers_ctx_session_context():
    assert _resolve_profile(_CtxWithSessionProfile()) == "thijs"


def test_resolve_profile_falls_back_to_config_default_profile_when_ctx_has_none():
    assert _resolve_profile(_CtxWithoutSessionProfile()) == "config-default-profile"


def test_resolve_profile_falls_back_when_ctx_profile_name_raises():
    assert _resolve_profile(_CtxWhoseProfileNameRaises()) == "config-default-profile"


def test_on_approval_request_journals_a_pending_event(tmp_path):
    journal = AttentionJournal(tmp_path)

    on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        description="Delete a temp directory",
        session_key="session-1",
        surface="cli",
    )

    records = journal.list()
    assert len(records) == 1
    assert records[0]["state"] == "pending"
    assert records[0]["session_key"] == "session-1"


def test_on_approval_request_publishes_when_ntfy_is_configured(tmp_path):
    journal = AttentionJournal(tmp_path)
    published = []

    thread = on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        description="Delete a temp directory",
        session_key="session-1",
        surface="cli",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        ntfy_token="tok",
        connection_id="conn-1",
        profile="thijs",
        publish=lambda spec: published.append(spec),
    )
    _join(thread)

    assert len(published) == 1
    assert published[0]["body"] == "You have a new request"
    assert "Click" in published[0]["headers"]

    record = journal.list()[0]
    assert record["connection_id"] == "conn-1"
    assert record["profile"] == "thijs"


def test_on_approval_request_skips_publish_when_ntfy_not_configured(tmp_path):
    journal = AttentionJournal(tmp_path)
    published = []

    on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        publish=lambda spec: published.append(spec),
    )

    assert published == []
    assert len(journal.list()) == 1


def test_on_approval_request_never_stores_the_raw_command_or_description(tmp_path):
    """11 section 4.2: the notification record is event id, owning profile/session,
    approval id, state, attempts, next retry, delivery result -- never the command."""
    journal = AttentionJournal(tmp_path)

    on_approval_request(
        journal,
        command="rm -rf /tmp/secret-project",
        description="Delete the secret project directory",
        pattern_key="pattern-1",
        session_key="session-1",
    )

    records = journal.list()
    assert len(records) == 1
    record = records[0]
    assert "command" not in record
    assert "description" not in record
    assert record["command_hash"] == command_hash("rm -rf /tmp/secret-project")
    assert record["pattern_key"] == "pattern-1"
    assert record["attempts"] == 0
    assert record["next_retry"] is None


def test_on_approval_request_tracks_a_failed_publish_attempt(tmp_path):
    journal = AttentionJournal(tmp_path)

    def failing_publish(spec):
        raise RuntimeError("connection refused")

    thread = on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=failing_publish,
    )
    _join(thread)

    record = journal.list()[0]
    assert record["state"] == "pending"  # not resolved -- only the push failed
    assert record["attempts"] == 1
    assert record["next_retry"] is not None
    assert record["delivery"] == "error"


def test_on_approval_response_resolves_the_matching_pending_event(tmp_path):
    journal = AttentionJournal(tmp_path)
    on_approval_request(journal, command="rm -rf /tmp/x", session_key="session-1")

    on_approval_response(
        journal, choice="once", decided_by="user", command="rm -rf /tmp/x", session_key="session-1",
    )

    records = journal.list()
    assert len(records) == 1
    assert records[0]["state"] == "resolved"
    assert records[0]["choice"] == "once"
    assert records[0]["decided_by"] == "user"
    assert records[0]["resolved_at"] is not None


def test_on_approval_response_resolves_the_right_event_when_several_are_pending(tmp_path):
    """Hermes allows several pending approvals in one session; session_key alone is
    not enough to disambiguate -- must correlate on (session_key, pattern_key,
    command_hash) and only touch the matching one."""
    journal = AttentionJournal(tmp_path)
    on_approval_request(journal, command="cmd-a", pattern_key="pattern-a", session_key="session-1")
    on_approval_request(journal, command="cmd-b", pattern_key="pattern-b", session_key="session-1")

    on_approval_response(
        journal, choice="once", decided_by="user",
        command="cmd-b", pattern_key="pattern-b", session_key="session-1",
    )

    by_hash = {r["command_hash"]: r for r in journal.list()}
    assert by_hash[command_hash("cmd-b")]["state"] == "resolved"
    assert by_hash[command_hash("cmd-a")]["state"] == "pending"


def test_on_approval_response_resolves_the_oldest_matching_event(tmp_path):
    """Two requests that share session_key, pattern_key and command (hence the same
    command_hash) -- the OLDEST unresolved match must be the one resolved."""
    journal = AttentionJournal(tmp_path)
    on_approval_request(journal, command="cmd-a", pattern_key="pattern-a", session_key="session-1")
    first_id = journal.list()[0]["id"]
    on_approval_request(journal, command="cmd-a", pattern_key="pattern-a", session_key="session-1")

    on_approval_response(
        journal, choice="once", decided_by="user",
        command="cmd-a", pattern_key="pattern-a", session_key="session-1",
    )

    resolved = [r for r in journal.list() if r["state"] == "resolved"]
    assert len(resolved) == 1
    assert resolved[0]["id"] == first_id


def test_on_approval_response_is_a_no_op_when_nothing_matches(tmp_path):
    journal = AttentionJournal(tmp_path)
    on_approval_request(journal, command="cmd-a", pattern_key="pattern-a", session_key="session-1")

    on_approval_response(
        journal, choice="once", decided_by="user",
        command="a-completely-different-command", pattern_key="pattern-a", session_key="session-1",
    )

    assert journal.list()[0]["state"] == "pending"


def test_on_approval_response_is_a_no_op_when_nothing_is_pending(tmp_path):
    journal = AttentionJournal(tmp_path)

    on_approval_response(journal, choice="once", decided_by="user", session_key="unknown-session")

    assert journal.list() == []


def test_flush_retries_republishes_due_records_and_records_success(tmp_path):
    journal = AttentionJournal(tmp_path)
    _join(on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=lambda spec: (_ for _ in ()).throw(RuntimeError("down")),
    ))
    event_id = journal.list()[0]["id"]
    due_at = journal.read(event_id)["next_retry"]
    published = []

    attempted = flush_retries(
        journal, due_at, lambda spec: published.append(spec),
        ntfy_server="https://ntfy.example.internal", ntfy_topic="hermes-alerts",
    )

    assert attempted == 1
    assert len(published) == 1
    record = journal.read(event_id)
    assert record["delivery"] == "sent"
    assert record["next_retry"] is None
    assert record["attempts"] == 2


def test_flush_retries_skips_records_not_yet_due(tmp_path):
    journal = AttentionJournal(tmp_path)
    journal.claim("not-due", {
        "state": "pending", "session_key": "s1", "next_retry": 1_000_000.0, "attempts": 1,
    })

    attempted = flush_retries(
        journal, 500.0, lambda spec: None, ntfy_server="https://x", ntfy_topic="y",
    )

    assert attempted == 0


def test_flush_retries_builds_each_click_link_from_its_own_records_routing(tmp_path):
    """flush_retries takes no global connection_id/profile at all -- two due records
    belonging to different sessions/connections/profiles must each get a Click
    link built from THEIR OWN stored routing, never one applied to both."""
    journal = AttentionJournal(tmp_path)
    journal.claim("evt-a", {
        "state": "pending", "session_key": "session-a", "connection_id": "conn-a",
        "profile": "thijs", "next_retry": 100.0, "attempts": 1,
    })
    journal.claim("evt-b", {
        "state": "pending", "session_key": "session-b", "connection_id": "conn-b",
        "profile": "nora", "next_retry": 100.0, "attempts": 1,
    })
    published = []

    attempted = flush_retries(
        journal, 150.0, lambda spec: published.append(spec),
        ntfy_server="https://ntfy.example.internal", ntfy_topic="hermes-alerts",
    )

    assert attempted == 2
    clicks = {p["headers"]["Click"] for p in published}
    assert any("session-a" in c and "connection=conn-a" in c and "profile=thijs" in c for c in clicks)
    assert any("session-b" in c and "connection=conn-b" in c and "profile=nora" in c for c in clicks)


# --- item 3: the publish never blocks the approval hook ---------------------


def test_on_approval_request_returns_before_a_slow_publisher_completes(tmp_path):
    """`pre_approval_request` is NOT in Hermes's _HOOK_TIMEOUT_BOUNDED_HOOKS
    (plugins_dispatch.py: "Hooks not listed below run synchronously to
    completion") and on the gateway path it fires BEFORE notify_cb reaches the
    app (approval_gateway_wait.py), so anything slow here delays the in-app
    approval card itself. The journal write stays synchronous; the network call
    must not."""
    journal = AttentionJournal(tmp_path)
    entered = threading.Event()
    release = threading.Event()

    def blocking_publish(spec):
        entered.set()
        assert release.wait(timeout=_THREAD_TIMEOUT), "publisher was never released"

    started = time.monotonic()
    thread = on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=blocking_publish,
    )
    elapsed = time.monotonic() - started

    # The hook returned while the publisher is still inside its call...
    assert entered.wait(timeout=_THREAD_TIMEOUT)
    assert thread is not None and thread.is_alive()
    assert elapsed < 1.0
    # ...and the pending record was already journaled synchronously, so the
    # retry sweep can see it even if this process dies now.
    assert journal.list()[0]["state"] == "pending"

    release.set()
    _join(thread)


def test_the_background_publish_still_records_its_outcome_for_the_retry_sweep(tmp_path):
    journal = AttentionJournal(tmp_path)

    _join(on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=lambda spec: (_ for _ in ()).throw(RuntimeError("down")),
    ))

    record = journal.list()[0]
    assert record["attempts"] == 1
    assert record["delivery"] == "error"
    assert record["next_retry"] is not None


# --- item 7: coalesced followers and the smart surface ----------------------


def test_duplicate_hook_call_flags_coalesced_and_smart_only():
    assert duplicate_hook_call("gateway", True) is True
    assert duplicate_hook_call("smart", None) is True
    assert duplicate_hook_call("gateway", None) is False
    assert duplicate_hook_call("cli", False) is False
    assert duplicate_hook_call(None, None) is False


def test_on_approval_request_ignores_a_coalesced_follower(tmp_path):
    """approval_gateway_wait.py fires pre_approval_request with coalesced=True for a
    follower on an already-pending identical approval: the leader's push already
    went out, and a follower that adopts `once` fires NO post hook, so a record
    here would stay pending forever."""
    journal = AttentionJournal(tmp_path)
    published = []

    thread = on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        surface="gateway",
        coalesced=True,
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=lambda spec: published.append(spec),
    )

    assert thread is None
    assert journal.list() == []
    assert published == []


def test_on_approval_request_ignores_the_smart_guardian_precheck(tmp_path):
    """approval_smart.py fires pre/post with surface="smart" around an aux-LLM
    verdict and only fires post when the verdict decides -- not a request for the
    user's attention, and an undecided verdict would strand a pending record."""
    journal = AttentionJournal(tmp_path)
    published = []

    thread = on_approval_request(
        journal,
        command="rm -rf /tmp/x",
        session_key="session-1",
        surface="smart",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=lambda spec: published.append(spec),
    )

    assert thread is None
    assert journal.list() == []
    assert published == []


def test_one_prompt_with_two_coalesced_followers_produces_one_record_and_one_push(tmp_path):
    journal = AttentionJournal(tmp_path)
    published = []
    kwargs = dict(
        command="rm -rf /tmp/x",
        session_key="session-1",
        surface="gateway",
        ntfy_server="https://ntfy.example.internal",
        ntfy_topic="hermes-alerts",
        publish=lambda spec: published.append(spec),
    )

    _join(on_approval_request(journal, **kwargs))          # the leader
    on_approval_request(journal, coalesced=True, **kwargs)  # follower
    on_approval_request(journal, coalesced=True, **kwargs)  # follower

    assert len(journal.list()) == 1
    assert len(published) == 1


def test_on_approval_request_records_the_surface(tmp_path):
    journal = AttentionJournal(tmp_path)

    on_approval_request(journal, command="cmd", session_key="session-1", surface="gateway")

    assert journal.list()[0]["surface"] == "gateway"


def test_on_approval_response_ignores_a_coalesced_follower_response(tmp_path):
    """A follower's post hook (approval_gateway_wait.py's _finish(..., coalesced=True))
    must not close out the leader's still-open request."""
    journal = AttentionJournal(tmp_path)
    on_approval_request(journal, command="cmd", session_key="session-1", surface="gateway")

    on_approval_response(
        journal, choice="session", decided_by="user",
        command="cmd", session_key="session-1", surface="gateway", coalesced=True,
    )

    assert journal.list()[0]["state"] == "pending"


def test_on_approval_response_correlates_within_the_same_surface(tmp_path):
    journal = AttentionJournal(tmp_path)
    on_approval_request(journal, command="cmd", session_key="session-1", surface="gateway")
    on_approval_request(journal, command="cmd", session_key="session-1", surface="cli")

    on_approval_response(
        journal, choice="once", decided_by="user",
        command="cmd", session_key="session-1", surface="cli",
    )

    by_surface = {r["surface"]: r for r in journal.list()}
    assert by_surface["cli"]["state"] == "resolved"
    assert by_surface["gateway"]["state"] == "pending"


# --- item 5: the proposal receipt is a hash, not the content ---------------


def test_propose_handler_stores_the_proposal_hash_never_the_briefing(proposals, store):
    """11 section 4.1: the receipt is "proposal hash, reserved profile name,
    completed steps, session id and briefing delivery state" -- the hash, not the
    text. The briefing is up to 4,000 characters of user content."""
    briefing = "Seed fact: the IBAN for the payroll account is NL00BANK0123456789."
    description = "Reconcile the payroll ledger every Monday."

    result = propose_handler(
        _valid_args(briefing=briefing, description=description),
        service=proposals, session_id="concierge-session-42",
    )

    proposal = json.loads(result)
    stored = rows(store, "proposal_receipts")[0]
    assert stored["proposal_hash"] == payload_hash(proposal)
    assert stored["reserved_profile_name"] == "thijs"
    assert stored["source_session_id"] == "concierge-session-42"
    on_disk = raw_bytes(store)
    for content in (briefing, description, "Bookkeeper", "Thijs"):
        assert content.encode("utf-8") not in on_disk


def test_extra_proposal_arguments_never_reach_the_proposal_or_the_receipt(proposals, store):
    """proposals.py builds from an allowlist."""
    result = propose_handler(
        _valid_args(mirror_credentials=True, share_auth="concierge", scopes=["*"]),
        service=proposals,
    )

    assert "mirror_credentials" not in result
    assert "share_auth" not in result
    assert b"mirror_credentials" not in raw_bytes(store)
    assert b"share_auth" not in raw_bytes(store)
    assert validate_proposal(_valid_args(mirror_credentials=True)).get("mirror_credentials") is None
