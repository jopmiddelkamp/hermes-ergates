"""Roadmap D3, D4 and C3: the Ergates routes inside Hermes's own dashboard server.

``hermes_cli.web_server`` is imported the way ``hermes serve`` loads it, with
this plugin installed and enabled in the temporary root, so these requests go
through Hermes's real middleware, including its auth.
"""

from __future__ import annotations

import json
import sys

import pytest

from ergates.paths import store_path, templates_dir
from ergates.proposals import ProposalService, validate_proposal
from ergates.store import ControlStore

API = "/api/plugins/ergates"
TEMPLATE = {"template_id": "bookkeeper-readonly", "soul": "You keep the books.",
            "enabled_toolsets": ["file"], "enabled_mcp_servers": []}
ROUTES = [
    ("GET", "/health"),
    ("POST", "/reminders"),
    ("GET", "/proposals/p-1"),
    ("POST", "/proposals/p-1/accept"),
    ("POST", "/proposals/p-1/reject"),
    ("POST", "/proposals/p-1/steps"),
    ("POST", "/profiles/thijs/plugin"),
    ("GET", "/attention/prefs?profile=thijs"),
    ("PUT", "/attention/prefs"),
]


def _module():
    """The router module exactly as Hermes imported it."""
    return sys.modules["hermes_dashboard_plugin_ergates"]


def _reminder(profile, **overrides):
    body = {"profile": profile, "schedule": "0 9 * * *", "timezone": "Europe/Amsterdam",
            "prompt": "Check the unpaid invoices.", "request_id": f"api-{profile}", "label": "Invoices"}
    return {**body, **overrides}


def test_hermes_serve_mounts_the_router_and_health_answers(web, token_headers):
    reply = web.get(f"{API}/health", headers=token_headers)

    assert (reply.status_code, reply.json()) == (200, {"ok": True, "schema_version": 1, "plugin_version": "0.2.0"})


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_rejects_a_request_without_the_session_token(web, root, method, path):
    reply = web.request(method, f"{API}{path}", content=json.dumps(_reminder("thijs")))

    assert (reply.status_code, reply.json()) == (401, {"detail": "Unauthorized"})


def test_a_request_without_the_token_writes_nothing(web, root, make_profile):
    make_profile("otto")

    web.post(f"{API}/reminders", json=_reminder("otto"))

    assert not (root / "profiles" / "otto" / "cron").exists()
    with ControlStore(store_path(root)).read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM reminder_receipts WHERE profile = 'otto'").fetchone()[0] == 0


def test_the_plugin_bundle_is_served_but_never_the_api_source(web):
    assert web.get("/dashboard-plugins/ergates/index.js").status_code == 200
    assert web.get("/dashboard-plugins/ergates/api.py").status_code == 404


def test_a_reminder_through_hermes_serve_creates_one_job_in_the_profile(web, token_headers, make_profile):
    home = make_profile("lotte")

    first = web.post(f"{API}/reminders", json=_reminder("lotte"), headers=token_headers)
    again = web.post(f"{API}/reminders", json=_reminder("lotte"), headers=token_headers)

    assert (first.status_code, again.status_code) == (201, 200)
    receipt = first.json()["receipt"]
    assert again.json()["receipt"] == receipt
    assert receipt["state"] == "created"
    jobs = json.loads((home / "cron" / "jobs.json").read_text(encoding="utf-8"))
    assert [job["id"] for job in jobs["jobs"]] == [receipt["job_id"]]


def test_a_schedule_hermes_refuses_and_malformed_json_are_400(web, token_headers, make_profile):
    home = make_profile("daan")

    refused = web.post(f"{API}/reminders", json=_reminder("daan", schedule="not a schedule"), headers=token_headers)
    malformed = web.post(f"{API}/reminders", content=b"{not json", headers=token_headers)
    unknown = web.post(f"{API}/reminders", json=_reminder("nobody"), headers=token_headers)

    assert (refused.status_code, refused.json()["error"]["code"]) == (400, "invalid")
    assert (malformed.status_code, malformed.json()["error"]["code"]) == (400, "invalid")
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "unknown_profile")
    assert not (home / "cron" / "jobs.json").exists()


def test_d4_provisioning_through_hermes_serve_ends_complete(web, token_headers, root):
    """The app's steps with the server's only step in the middle: the proposal is
    complete only after Hermes itself reports the profile and the plugin."""
    directory = templates_dir(root)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "bookkeeper-readonly.json").write_text(json.dumps(TEMPLATE), encoding="utf-8")
    proposal = validate_proposal({
        "name": "ruben", "title": "Ruben", "role": "Bookkeeper", "template_id": "bookkeeper-readonly",
        "provider": "p", "model": "m", "briefing": "Seed facts.",
    })
    proposal["source_session_id"] = "concierge-1"
    ProposalService(ControlStore(store_path(root))).record(proposal)
    base = f"{API}/proposals/{proposal['proposal_id']}"

    accepted = web.post(f"{base}/accept", json={"proposal": proposal}, headers=token_headers)
    assert (accepted.status_code, accepted.json()["proposal"]["template"]) == (200, TEMPLATE)

    (root / "profiles" / "ruben").mkdir(parents=True)  # what the app's profiles.create does
    assert web.post(f"{base}/steps", json={"step": "profile_created", "status": "done"},
                    headers=token_headers).status_code == 200
    enabled = web.post(f"{API}/profiles/ruben/plugin", headers=token_headers)
    assert (enabled.status_code, enabled.json()) == (200, {"profile": "ruben", "enabled": True})
    for step in ("plugin_enabled", "configured", "bot_chat"):
        assert web.post(f"{base}/steps", json={"step": step, "status": "done"},
                        headers=token_headers).status_code == 200
    done = web.post(f"{base}/steps", json={"step": "briefing", "status": "done"}, headers=token_headers)

    assert (done.status_code, done.json()["proposal"]["state"]) == (200, "complete")
    assert (root / "profiles" / "ruben" / "plugins" / "ergates").is_symlink()


def test_attention_prefs_round_trip(web, token_headers):
    prefs = {"profile": "*", "muted": False, "quiet_start": "22:00", "quiet_end": "07:00"}

    put = web.put(f"{API}/attention/prefs", json=prefs, headers=token_headers)
    got = web.get(f"{API}/attention/prefs", params={"profile": "*"}, headers=token_headers)
    bad = web.get(f"{API}/attention/prefs", params={"profile": "Bad Name"}, headers=token_headers)

    assert (put.status_code, put.json()) == (200, {"prefs": prefs})
    assert (got.status_code, got.json()) == (200, {"prefs": prefs})
    assert (bad.status_code, bad.json()["error"]["code"]) == (400, "invalid")


def test_the_store_is_built_once_per_process(web, token_headers, monkeypatch):
    module = _module()
    built = []

    class CountingStore(ControlStore):
        def __init__(self, *args, **kwargs):
            built.append(1)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(module, "_operations", None)
    monkeypatch.setattr(module, "ControlStore", CountingStore)
    for _ in range(3):
        web.get(f"{API}/health", headers=token_headers)
        web.get(f"{API}/attention/prefs", params={"profile": "*"}, headers=token_headers)

    assert len(built) == 1
    assert module.operations() is module.operations()


def test_a_store_that_cannot_be_opened_is_503_store_unavailable(web, token_headers, monkeypatch, tmp_path):
    module = _module()
    (tmp_path / "ergates").write_text("a file where the store folder should be", encoding="utf-8")
    monkeypatch.setattr(module, "_operations", None)
    monkeypatch.setattr(module, "hermes_root", lambda: tmp_path)

    reply = web.get(f"{API}/health", headers=token_headers)

    assert (reply.status_code, reply.json()["error"]["code"]) == (503, "store_unavailable")
