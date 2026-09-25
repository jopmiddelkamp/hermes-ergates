"""Tests for ergates.flush: the periodic delivery and retention entry point.

Nothing in Hermes runs a timer for this plugin, so this module is what the
deployment schedules (see ``deploy/README.md``). No network: every test
injects its own publisher.
"""

import time

import pytest

from conftest import raw_bytes, rows
from ergates.attention import APPROVAL_TTL_SECONDS, RETENTION_SECONDS, AttentionService
from ergates.flush import flush_once, load_settings, main, profile_home, settings_from_config
from ergates.proposals import ProposalService, validate_proposal
from ergates.reminders import REMINDER_MAX_IDLE_SECONDS, ReminderService

SETTINGS = {"server": "https://ntfy.example.internal", "topic": "ergates-alerts", "token": "tok",
            "connection_id": "conn-1"}


def _config(**ntfy):
    return {"plugins": {"entries": {"ergates": {"settings": {"ntfy": ntfy}}}}}


def _write_config(home, **ntfy):
    """Write a profile config.yaml shaped exactly like the one the runbook edits."""
    settings = ntfy or SETTINGS
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        "plugins:\n"
        "  entries:\n"
        "    ergates:\n"
        "      settings:\n"
        "        ntfy:\n"
        + "".join(f"          {key}: {value}\n" for key, value in settings.items()),
        encoding="utf-8",
    )


def _approval(store, now, command="rm -rf /tmp/x"):
    return AttentionService(store, clock=lambda: now).approval_requested(
        session_key="s1", pattern_key="p1", command=command, surface="gateway", profile="thijs",
    )


# --- profile path resolution ------------------------------------------------


def test_profile_home_is_the_hermes_root_for_the_default_profile(tmp_path):
    """hermes_cli/profiles.py's get_profile_dir at the pin: the default profile's
    home IS the Hermes root; only a named profile sits under profiles/."""
    assert profile_home(tmp_path) == tmp_path
    assert profile_home(tmp_path, "default") == tmp_path
    assert profile_home(tmp_path, " Default ") == tmp_path


def test_profile_home_of_a_named_profile(tmp_path):
    assert profile_home(tmp_path, "thijs") == tmp_path / "profiles" / "thijs"


# --- settings resolution (no secrets on the command line) -------------------


def test_settings_come_from_the_plugin_entry_in_the_profile_config():
    settings = settings_from_config(_config(server="https://x", topic="t", token="tok", connection_id="c"))

    assert settings == {"server": "https://x", "topic": "t", "token": "tok", "connection_id": "c"}


def test_settings_are_empty_when_the_plugin_is_not_configured():
    assert settings_from_config({}) == {}
    assert settings_from_config({"plugins": {}}) == {}
    assert settings_from_config(_config()) == {}


def test_settings_tolerate_a_config_of_the_wrong_shape():
    """A maintenance sweep must not die on a config typo."""
    assert settings_from_config({"plugins": {"entries": {"ergates": "oops"}}}) == {}
    assert settings_from_config({"plugins": "oops"}) == {}
    assert settings_from_config(_config(server="", topic=None, token=7)) == {}
    assert settings_from_config({"plugins": {"entries": {"ergates": {"settings": {"ntfy": "oops"}}}}}) == {}


def test_load_settings_returns_empty_when_there_is_no_config_file(tmp_path):
    assert load_settings(tmp_path) == {}


def test_load_settings_reads_the_profile_config(tmp_path):
    _write_config(tmp_path)

    assert load_settings(tmp_path) == SETTINGS


# --- the delivery pass --------------------------------------------------------


def test_flush_once_sends_a_due_push_with_its_own_routing(tmp_path, store):
    now = time.time()
    event_id = _approval(store, now)
    published = []

    counts = flush_once(tmp_path, SETTINGS, now=now, publish=published.append)

    assert counts["retried"] == 1
    assert published[0]["url"] == "https://ntfy.example.internal/ergates-alerts"
    assert published[0]["headers"]["Click"] == "ergates://chat/s1?connection=conn-1&profile=thijs"
    assert rows(store, "attention_outbox")[0]["state"] == "sent"
    assert rows(store, "attention_outbox")[0]["event_id"] == event_id


def test_flush_once_skips_the_delivery_pass_when_push_is_not_configured(tmp_path, store):
    now = time.time()
    _approval(store, now)
    published = []

    counts = flush_once(tmp_path, {}, now=now, publish=published.append)

    assert counts["retried"] == 0
    assert published == []
    assert rows(store, "attention_outbox")[0]["state"] == "due"   # still due for a later flush


def test_flush_once_never_pushes_an_expired_approval(tmp_path, store):
    created = time.time()
    _approval(store, created)
    published = []

    counts = flush_once(tmp_path, SETTINGS, now=created + APPROVAL_TTL_SECONDS, publish=published.append)

    assert (counts["retried"], counts["expired_notifications"], counts["pruned_notifications"]) == (0, 1, 0)
    assert published == []
    assert rows(store, "attention_events")[0]["state"] == "expired"   # kept for its seven-day audit window
    assert rows(store, "attention_outbox")[0]["state"] == "cancelled"


# --- the retention pass -----------------------------------------------------


def test_flush_once_prunes_events_proposals_and_reminders(tmp_path, store, cron):
    """Each service has a prune and nothing inside Hermes calls it (04 section 8)."""
    now = time.time()
    old = now - RETENTION_SECONDS - APPROVAL_TTL_SECONDS - 60
    _approval(store, old)
    proposal = validate_proposal({
        "name": "thijs", "title": "Thijs", "role": "Bookkeeper", "template_id": "bookkeeper-readonly",
        "provider": "p", "model": "m", "briefing": "Role and boundaries.",
    })
    proposal["expires_at"] = "2020-01-01T00:00:00Z"
    ProposalService(store).record(proposal)
    idle_since = now - REMINDER_MAX_IDLE_SECONDS - 60
    ReminderService(store, cron, clock=lambda: idle_since).create("thijs", "0 9 * * *", "UTC", "Check invoices.")

    counts = flush_once(tmp_path, {}, now=now)

    assert counts == {"retried": 0, "expired_notifications": 1, "pruned_notifications": 1,
                      "pruned_proposals": 1, "pruned_reminders": 1}
    for table in ("attention_events", "attention_outbox", "proposal_receipts", "reminder_receipts"):
        assert rows(store, table) == []


def test_flush_once_drops_a_reminder_receipt_whose_job_is_gone(tmp_path, store, cron):
    outcome = ReminderService(store, cron).create("thijs", "0 9 * * *", "UTC", "Check invoices.")
    cron.delete_job(outcome.receipt["job_id"])

    counts = flush_once(tmp_path, {}, cron=cron)

    assert counts["pruned_reminders"] == 1
    assert rows(store, "reminder_receipts") == []


def test_flush_once_on_an_untouched_root_is_a_no_op(tmp_path):
    counts = flush_once(tmp_path, {})

    assert counts == {
        "retried": 0, "expired_notifications": 0,
        "pruned_notifications": 0, "pruned_proposals": 0, "pruned_reminders": 0,
    }


def test_the_store_never_carries_content_after_a_flush(tmp_path, store):
    """Belt and braces over the retention rules: whatever survives a sweep must
    still be free of commands and prompts."""
    _approval(store, time.time(), command="rm -rf /srv/secret-project")

    flush_once(tmp_path, {})

    assert b"secret-project" not in raw_bytes(store)


# --- the command line -------------------------------------------------------


def test_main_reports_counts_and_never_prints_a_secret(tmp_path, capsys, monkeypatch, store):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_config(tmp_path)
    _approval(store, time.time() - RETENTION_SECONDS - APPROVAL_TTL_SECONDS - 60)

    exit_code = main(["--profile", "default"])

    out = capsys.readouterr().out
    assert exit_code == 0
    assert "expired_notifications=1 pruned_notifications=1" in out
    assert SETTINGS["token"] not in out


def test_main_fails_cleanly_on_a_missing_hermes_home(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "nope"))

    assert main([]) == 2
    assert "no Hermes home" in capsys.readouterr().err


def test_main_takes_no_credential_arguments():
    """The whole point of reading config.yaml: a token must never reach a process
    listing (04 section 6). argparse rejects anything token-shaped."""
    with pytest.raises(SystemExit):
        main(["--token", "secret"])
