"""The Ergates tool gate inside Hermes's own hook dispatcher.

A plugin manager scoped to a profile's home loads the plugin the way that
profile's gateway does, and ``invoke_hook("pre_tool_call", ...)`` is the call
Hermes makes before every tool call. The profile's home is the active Hermes
home during the call, as it is in that profile's process.
"""

from __future__ import annotations

import os
import sys

import pytest

from ergates.hermes_adapter import _profile_home, enable_plugin, plugin_enabled, profile_exists
from ergates.paths import store_path
from ergates.policy import BLOCK_RAW_CRON, BLOCK_REVOKED, BLOCK_SETUP, BLOCK_UNVERIFIED
from ergates.proposals import PROVISION_STEPS, ProposalService, validate_proposal
from ergates.store import ControlStore


@pytest.fixture
def gate(make_profile):
    """``gate(profile, tool_name, args)``: what Hermes's dispatcher collects from pre_tool_call in that profile."""
    from hermes_cli.plugins import PluginManager

    managers = {}

    def ask(profile: str, tool_name: str, args: dict) -> list:
        if profile not in managers:
            home = make_profile(profile)
            enable_plugin(profile)
            managers[profile] = PluginManager(scope_key=str(home))
            managers[profile].discover_and_load()
        with _profile_home(profile):
            return managers[profile].invoke_hook(
                "pre_tool_call", tool_name=tool_name, args=args, task_id="t", session_id="s",
                tool_call_id="c", turn_id="u", api_request_id="a", middleware_trace=[],
            )

    return ask


def test_hermes_collects_the_block_for_a_raw_cron_create_only(gate):
    assert gate("gina", "cronjob_manage", {"action": "create", "prompt": "p"}) == [
        {"action": "block", "message": BLOCK_RAW_CRON}]
    assert gate("gina", "cronjob_manage", {"action": "list"}) == []
    assert gate("gina", "ergates_create_reminder", {"schedule": "0 9 * * *"}) == []


def test_a_profile_is_blocked_while_it_is_provisioned_and_free_once_complete(gate, root):
    proposals = ProposalService(ControlStore(store_path(root)))
    proposal = validate_proposal({"name": "hugo", "title": "Hugo", "role": "Helper", "template_id": "t",
                                  "provider": "p", "model": "m", "briefing": "Seed facts."})
    proposals.record(proposal)
    proposals.accept(proposal["proposal_id"], proposal, profile_exists=lambda name: False)

    assert gate("hugo", "terminal", {}) == [{"action": "block", "message": BLOCK_SETUP}]

    for step in PROVISION_STEPS:
        proposals.record_step(proposal["proposal_id"], step, "done")
    proposals.complete(proposal["proposal_id"], profile_exists=profile_exists, plugin_enabled=plugin_enabled)
    assert gate("hugo", "terminal", {}) == []


def test_hermes_gets_a_block_when_the_gate_check_raises(gate, monkeypatch):
    """Hermes skips a callback that raises and runs the tool (fail open). The
    Ergates callback never raises: a failed check reaches Hermes as a block."""
    gate("ivo", "terminal", {})  # loads the plugin into this profile's manager

    def broken(*args, **kwargs):
        raise RuntimeError("the control store is unreadable")

    copies = [module for name, module in sys.modules.items()
              if name.startswith("hermes_plugins.ergates") and name.endswith(".ergates.policy")]
    assert copies
    for module in copies:
        monkeypatch.setattr(module, "decide", broken)

    assert gate("ivo", "terminal", {}) == [{"action": "block", "message": BLOCK_UNVERIFIED}]


def test_a_failed_profile_lookup_blocks_a_profile_being_provisioned(gate, root, monkeypatch):
    """Hermes's ``profile_name`` answers "default" when its own lookup raises,
    and the default profile is always admitted. Read as given, a profile still
    being set up would run every tool; the gate blocks instead."""
    import hermes_cli.profiles
    from hermes_cli.plugins import PluginContext

    proposals = ProposalService(ControlStore(store_path(root)))
    proposal = validate_proposal({"name": "kees", "title": "Kees", "role": "Helper", "template_id": "t",
                                  "provider": "p", "model": "m", "briefing": "Seed facts."})
    proposals.record(proposal)
    proposals.accept(proposal["proposal_id"], proposal, profile_exists=lambda name: False)
    assert gate("kees", "terminal", {}) == [{"action": "block", "message": BLOCK_SETUP}]

    def lookup_fails():
        raise OSError("the Hermes home cannot be resolved")

    monkeypatch.setattr(hermes_cli.profiles, "get_active_profile_name", lookup_fails)
    with _profile_home("kees"):
        assert PluginContext(manifest=None, manager=None).profile_name == "default"

    assert gate("kees", "terminal", {}) == [{"action": "block", "message": BLOCK_UNVERIFIED}]


@pytest.mark.skipif(getattr(os, "geteuid", lambda: -1)() == 0, reason="root opens a folder without permissions")
def test_hermes_loads_the_gate_and_it_blocks_while_the_store_cannot_open(gate, root, caplog):
    """Hermes drops every registration of a plugin whose register() raises. The
    plugin loads with the gate while the store cannot open, and the gate blocks
    until the store opens again."""
    folder = store_path(root).parent
    ControlStore(store_path(root))  # the store exists; only its folder becomes unreadable
    mode = folder.stat().st_mode
    folder.chmod(0)
    try:
        blocked = gate("olaf", "terminal", {})
    finally:
        folder.chmod(mode)

    assert blocked == [{"action": "block", "message": BLOCK_UNVERIFIED}]
    assert "PermissionError" in caplog.text
    assert str(folder) not in caplog.text
    assert gate("olaf", "terminal", {}) == []


def test_a_push_thread_keeps_the_hermes_home_the_gateway_routed_to(make_profile):
    """A multiplexed gateway serves a profile with a context-local Hermes home;
    the push thread reads that profile's settings under the same home."""
    from hermes_constants import get_hermes_home

    from ergates.tool import _deliver_in_background

    home = make_profile("vera")
    seen = []

    class Probe:
        def deliver(self, event_id: str) -> None:
            seen.append(get_hermes_home())

    with _profile_home("vera"):
        thread = _deliver_in_background(Probe(), "event-1")
    thread.join(timeout=5)

    assert seen == [home]


# --- rule 3: the profile's toolset grant ----------------------------------------------


@pytest.fixture
def configure():
    """``configure(profile, **params)``: Hermes's own ``profiles.configure`` RPC, the call the app makes."""
    from tui_gateway.server import _methods

    def call(profile: str, **params) -> None:
        answer = _methods["profiles.configure"]("contract", {"name": profile, **params})
        assert answer.get("result", {}).get("ok") is True, answer

    return call


def test_rule_3_a_toolset_taken_out_of_the_grant_is_blocked_at_the_next_call(gate, configure):
    """docs/04 section 3: a revoked connector must not stay usable in a running session."""
    assert gate("lena", "terminal", {}) == []  # no toolset pin yet: Hermes alone decides
    configure("lena", enabled_toolsets=["web", "terminal"])
    assert gate("lena", "terminal", {}) == []

    configure("lena", enabled_toolsets=["web"])

    assert gate("lena", "terminal", {}) == [{"action": "block", "message": BLOCK_REVOKED}]
    assert gate("lena", "web_search", {}) == []
    assert gate("lena", "ergates_create_reminder", {"schedule": "0 9 * * *"}) == []
    assert gate("lena", "no_such_tool", {}) == []


def test_rule_3_a_pinned_name_grants_the_toolsets_its_tools_are_registered_under(gate, configure):
    """`browser` bundles `browser_cdp`, which Hermes registers under the toolset `browser-cdp`."""
    gate("wim", "terminal", {})
    configure("wim", enabled_toolsets=["browser"])

    assert gate("wim", "browser_cdp", {}) == []
    assert gate("wim", "browser_navigate", {}) == []
    assert gate("wim", "terminal", {}) == [{"action": "block", "message": BLOCK_REVOKED}]


def test_rule_3_an_mcp_server_the_profile_turned_off_is_blocked(gate, configure):
    from hermes_cli.config import load_config, save_config
    from tools.registry import registry

    from ergates.hermes_adapter import _profile_home

    gate("mira", "terminal", {})
    configure("mira", enabled_toolsets=["web"])
    with _profile_home("mira"):
        config = load_config()
        config["mcp_servers"] = {"notes": {"url": "https://notes.invalid/mcp"}}
        save_config(config)
    registry.register(name="mcp_notes_search", toolset="mcp-notes",
                      schema={"name": "mcp_notes_search", "parameters": {"type": "object", "properties": {}}},
                      handler=lambda args, **kwargs: "{}")
    try:
        assert gate("mira", "mcp_notes_search", {}) == []

        configure("mira", enabled_mcp_servers=[])  # Hermes writes `disabled: true` for the server

        assert gate("mira", "mcp_notes_search", {}) == [{"action": "block", "message": BLOCK_REVOKED}]
    finally:
        registry.deregister("mcp_notes_search")
