"""Tests for ergates.tool: propose_handler, the approval-attention hooks and register().

propose_handler and the two approval hooks are the load-bearing glue described
in 11 section 4.1-4.2 ("never creates a profile", "records the proposal as
'proposed'", "writes a pending attention event ... and publishes to ntfy when
configured").
"""

import json
import logging
import sqlite3
import sys
import threading
import time
from pathlib import Path

import pytest
import yaml

from conftest import raw_bytes, rows
from ergates import tool
from ergates.attention import AttentionService
from ergates.delivery import DeliveryWorker, NtfySettings
from ergates.paths import store_path
from ergates.proposals import ProposalService, payload_hash, validate_proposal
from ergates.store import ControlStore, StoreError
from ergates.tool import (
    _resolve_profile,
    completed_platforms,
    on_approval_request,
    on_approval_response,
    on_turn_completed,
    propose_handler,
)

_THREAD_TIMEOUT = 5.0
SETTINGS = NtfySettings(server="https://ntfy.example.internal", topic="hermes-alerts", token="tok",
                        connection_id="conn-1")


def _join(thread):
    """Wait for the background push thread (never longer than a watchdog)."""
    if thread is not None:
        thread.join(timeout=_THREAD_TIMEOUT)
        assert not thread.is_alive(), "push thread did not finish"
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


@pytest.fixture
def attention(store):
    return AttentionService(store)


def _worker(store, publish):
    return DeliveryWorker(store, publish, SETTINGS)


# --- the propose tool ---------------------------------------------------------


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


def _drop_the_receipts_table(store):
    with store.transaction() as conn:
        conn.execute("DROP TABLE proposal_steps")
        conn.execute("DROP TABLE proposal_receipts")


@pytest.mark.parametrize(
    ("break_the_store", "error_class"),
    [(lambda store: store.close(), StoreError), (_drop_the_receipts_table, sqlite3.OperationalError)],
    ids=["closed-store", "missing-table"],
)
def test_propose_handler_returns_an_error_payload_when_the_store_fails(proposals, store, caplog, break_the_store,
                                                                       error_class):
    """The Hermes tool contract: a handler always returns a JSON string. The
    error names the exception class only; its message can carry a file path."""
    break_the_store(store)

    with caplog.at_level(logging.WARNING, logger="ergates.tool"):
        result = propose_handler(_valid_args(), service=proposals)

    assert json.loads(result) == {"error": f"the proposal could not be recorded ({error_class.__name__})"}
    assert error_class.__name__ in caplog.text
    assert "proposal_receipts" not in result + caplog.text
    assert "closed" not in result + caplog.text


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


# --- the approval hooks -----------------------------------------------------


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


def test_on_approval_request_records_a_pending_event_with_its_push(attention, store):
    on_approval_request(attention, command="rm -rf /tmp/x", description="Delete a temp directory",
                        session_key="session-1", surface="cli", profile="thijs")

    event = rows(store, "attention_events")[0]
    assert (event["state"], event["session_id"], event["profile"], event["surface"]) == (
        "pending", "session-1", "thijs", "cli")
    assert rows(store, "attention_outbox")[0]["state"] == "due"


def test_on_approval_request_publishes_when_ntfy_is_configured(attention, store):
    published = []

    thread = on_approval_request(
        attention, worker=_worker(store, published.append), command="rm -rf /tmp/x",
        session_key="session-1", surface="cli", profile="thijs",
    )
    _join(thread)

    assert len(published) == 1
    assert published[0]["body"] == "You have a new request"
    assert published[0]["headers"]["Click"] == "ergates://chat/session-1?connection=conn-1&profile=thijs"
    assert rows(store, "attention_outbox")[0]["state"] == "sent"


def test_on_approval_request_without_ntfy_still_records_the_event(attention, store):
    assert on_approval_request(attention, command="rm -rf /tmp/x", session_key="session-1") is None

    assert len(rows(store, "attention_events")) == 1


def test_on_approval_request_never_stores_the_raw_command_or_description(attention, store):
    on_approval_request(attention, command="rm -rf /tmp/secret-project",
                        description="Delete the secret project directory", session_key="session-1")

    assert b"secret-project" not in raw_bytes(store)
    assert b"Delete the secret" not in raw_bytes(store)


def test_a_failed_first_push_stays_due_for_the_next_flush(attention, store):
    def failing_publish(spec):
        raise RuntimeError("connection refused")

    _join(on_approval_request(attention, worker=_worker(store, failing_publish), command="rm -rf /tmp/x",
                              session_key="session-1"))

    outbox = rows(store, "attention_outbox")[0]
    assert (outbox["state"], outbox["attempts"], outbox["last_error"]) == ("due", 1, "RuntimeError")
    assert rows(store, "attention_events")[0]["state"] == "pending"


def test_on_approval_request_returns_before_a_slow_publisher_completes(attention, store):
    """`pre_approval_request` is NOT in Hermes's _HOOK_TIMEOUT_BOUNDED_HOOKS
    (plugins_dispatch.py: "Hooks not listed below run synchronously to
    completion") and on the gateway path it fires BEFORE notify_cb reaches the
    app (approval_gateway_wait.py), so anything slow here delays the in-app
    approval card itself. The store write stays synchronous; the network call
    must not."""
    entered = threading.Event()
    release = threading.Event()

    def blocking_publish(spec):
        entered.set()
        assert release.wait(timeout=_THREAD_TIMEOUT), "publisher was never released"

    started = time.monotonic()
    thread = on_approval_request(attention, worker=_worker(store, blocking_publish), command="rm -rf /tmp/x",
                                 session_key="session-1")
    elapsed = time.monotonic() - started

    assert entered.wait(timeout=_THREAD_TIMEOUT)
    assert thread is not None and thread.is_alive()
    assert elapsed < 1.0
    # The event and its push were committed before the hook returned, so the
    # next flush sends the push even if this process dies now.
    assert rows(store, "attention_events")[0]["state"] == "pending"
    assert rows(store, "attention_outbox")[0]["state"] == "due"

    release.set()
    _join(thread)


def test_a_push_thread_that_hits_a_store_error_only_logs(attention, store, caplog):
    class BrokenWorker:
        def deliver(self, event_id):
            raise OSError("disk full")

    _join(on_approval_request(attention, worker=BrokenWorker(), command="cmd", session_key="session-1"))

    assert "OSError" in caplog.text


def test_duplicate_hook_calls_record_and_push_nothing(attention, store):
    """A coalesced follower (approval_gateway_wait.py) or the smart guardian
    pre-check (approval_smart.py) is not a new prompt for the operator."""
    published = []
    worker = _worker(store, published.append)

    assert on_approval_request(attention, worker=worker, command="cmd", session_key="s1",
                               surface="gateway", coalesced=True) is None
    assert on_approval_request(attention, worker=worker, command="cmd", session_key="s1", surface="smart") is None

    assert rows(store, "attention_events") == []
    assert published == []


def test_on_approval_response_resolves_the_matching_pending_event(attention, store):
    on_approval_request(attention, command="rm -rf /tmp/x", session_key="session-1", surface="gateway")

    on_approval_response(attention, choice="once", decided_by="user", command="rm -rf /tmp/x",
                         session_key="session-1", surface="gateway")

    event = rows(store, "attention_events")[0]
    assert (event["state"], event["choice"]) == ("resolved", "once")
    assert event["resolved_at"] is not None
    assert rows(store, "attention_outbox")[0]["state"] == "cancelled"


def test_on_approval_response_ignores_a_coalesced_follower_response(attention, store):
    """A follower's post hook must not close out the leader's still-open request."""
    on_approval_request(attention, command="cmd", session_key="session-1", surface="gateway")

    assert on_approval_response(attention, choice="session", command="cmd", session_key="session-1",
                                surface="gateway", coalesced=True) is None
    assert rows(store, "attention_events")[0]["state"] == "pending"


# --- finished turns (decision D9) --------------------------------------------


def test_completed_platforms_default_to_routines_only():
    assert completed_platforms(None) == frozenset({"cron"})
    assert completed_platforms(["cron", " telegram "]) == frozenset({"cron", "telegram"})
    assert completed_platforms([]) == frozenset()
    assert completed_platforms("cron") == frozenset({"cron"})
    assert completed_platforms(["cron", 7]) == frozenset({"cron"})


def test_a_finished_routine_turn_is_pushed_without_its_text(attention, store):
    """post_llm_call carries the user message and the reply; neither is stored."""
    published = []

    _join(on_turn_completed(
        attention, worker=_worker(store, published.append), profile="thijs", platforms=frozenset({"cron"}),
        session_id="cron-session-1", platform="cron", task_id="t", turn_id="u", model="m",
        user_message="Summarize the secret ledger", assistant_response="The secret ledger says",
        conversation_history=[{"role": "user", "content": "Summarize the secret ledger"}],
    ))

    assert published[0]["headers"]["Title"] == "A routine finished"
    assert published[0]["headers"]["Click"] == "ergates://chat/cron-session-1?connection=conn-1&profile=thijs"
    assert b"secret ledger" not in raw_bytes(store)


def test_a_finished_turn_on_another_platform_writes_nothing(attention, store):
    assert on_turn_completed(attention, worker=None, profile="thijs", platforms=frozenset({"cron"}),
                             session_id="s", platform="cli") is None
    assert rows(store, "attention_events") == []


# --- register(): one store under the Hermes root ----------------------------


class _RecordingCtx:
    """The parts of Hermes's PluginContext that register() uses."""

    profile_name = "thijs"

    def __init__(self, config=None):
        self.config = config or {}
        self.tools = {}
        self.hooks = {}

    def get_config(self, key, default=None):
        return self.config.get(key, default)

    def register_tool(self, *, name, toolset, schema, handler, description, emoji):
        self.tools[name] = handler

    def register_hook(self, name, callback):
        self.hooks[name] = callback


@pytest.fixture
def profile_process(tmp_path, monkeypatch):
    """A Hermes process of the named profile `thijs`, outside a Hermes runtime."""
    monkeypatch.setitem(sys.modules, "hermes_constants", None)
    profile_home = tmp_path / "profiles" / "thijs"
    profile_home.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(profile_home))
    return profile_home


def test_bug8_register_opens_the_store_under_the_hermes_root_not_the_profile_home(tmp_path, profile_process):
    """Roadmap bug 8: register() put its journals under $HERMES_HOME, which is the
    profile's own home in a named profile. Every profile now shares one store."""
    ctx = _RecordingCtx()

    tool.register(ctx)
    ctx.tools["ergates_propose_agent"](_valid_args(), session_id="s-1")
    ctx.hooks["pre_approval_request"](command="cmd", session_key="s-1", surface="gateway")

    assert (tmp_path / "ergates" / "control.sqlite3").exists()
    assert list(profile_process.iterdir()) == []


def test_register_wires_the_tool_and_every_hook_end_to_end(tmp_path, profile_process, monkeypatch):
    published = []
    monkeypatch.setattr(tool, "send_ntfy", published.append)
    ctx = _RecordingCtx({"ntfy.server": "https://ntfy.example.internal", "ntfy.topic": "alerts",
                         "ntfy.connection_id": "conn-1"})
    tool.register(ctx)

    proposal = json.loads(ctx.tools["ergates_propose_agent"](_valid_args(), session_id="s-1"))
    ctx.hooks["pre_approval_request"](command="cmd", session_key="s-1", surface="gateway",
                                      description="ignored", pattern_keys=["p"])
    deadline = time.monotonic() + _THREAD_TIMEOUT
    while not published and time.monotonic() < deadline:
        time.sleep(0.01)
    ctx.hooks["post_approval_response"](command="cmd", session_key="s-1", surface="gateway", choice="once",
                                        decided_by="user")
    ctx.hooks["post_llm_call"](session_id="cron-1", platform="cron", user_message="hi", assistant_response="done")
    ctx.hooks["post_llm_call"](session_id="chat-1", platform="cli", user_message="hi", assistant_response="done")

    store = ControlStore(store_path(tmp_path))
    assert rows(store, "proposal_receipts")[0]["id"] == proposal["proposal_id"]
    events = {row["kind"]: row for row in rows(store, "attention_events")}
    assert set(events) == {"approval", "completion"}
    assert events["approval"]["state"] == "resolved"
    assert events["completion"]["session_id"] == "cron-1"
    assert published[0]["headers"]["Click"] == "ergates://chat/s-1?connection=conn-1&profile=thijs"


def test_plugin_yaml_declares_exactly_what_register_registers(profile_process):
    """`hermes plugins doctor` fails on an undeclared hook; this is the same check in the suite."""
    manifest = yaml.safe_load((Path(__file__).resolve().parents[1] / "plugin.yaml").read_text(encoding="utf-8"))
    ctx = _RecordingCtx()

    tool.register(ctx)

    assert sorted(manifest["provides_tools"]) == sorted(ctx.tools)
    assert sorted(manifest["provides_hooks"]) == sorted(ctx.hooks)


def test_register_reads_the_completed_platforms_setting(tmp_path, profile_process):
    ctx = _RecordingCtx({"attention.completed_platforms": ["cli"]})
    tool.register(ctx)

    ctx.hooks["post_llm_call"](session_id="cron-1", platform="cron")
    ctx.hooks["post_llm_call"](session_id="chat-1", platform="cli")

    store = ControlStore(store_path(tmp_path))
    assert [row["session_id"] for row in rows(store, "attention_events")] == ["chat-1"]
