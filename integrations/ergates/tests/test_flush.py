"""Tests for ergates.flush: the periodic retry/retention entry point.

Nothing in Hermes drives ``flush_retries`` or any ``prune`` -- the approval
hooks fire only on an approval event -- so this module is what the deployment
schedules (see ``deploy/README.md``). No network: every test injects its own
publisher.
"""

import json
import time

import pytest

from ergates.attention import AttentionJournal, PENDING_MAX_AGE_SECONDS, RETENTION_SECONDS
from ergates.flush import (
    flush_once,
    journal_root,
    load_settings,
    main,
    profile_home,
    settings_from_config,
)
from conftest import rows
from ergates.proposals import PROPOSED_STATE, ProposalJournal
from ergates.reminders import REMINDER_MAX_IDLE_SECONDS, ReminderService


SETTINGS = {"server": "https://ntfy.example.internal", "topic": "ergates-alerts", "token": "tok"}


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


# --- profile/journal path resolution ---------------------------------------


def test_profile_home_is_the_hermes_root_for_the_default_profile(tmp_path):
    """hermes_cli/profiles.py's get_profile_dir at the pin: the default profile's
    home IS the Hermes root; only a named profile sits under profiles/."""
    assert profile_home(tmp_path) == tmp_path
    assert profile_home(tmp_path, "default") == tmp_path
    assert profile_home(tmp_path, "  Default ".strip().lower()) == tmp_path


def test_profile_home_of_a_named_profile(tmp_path):
    assert profile_home(tmp_path, "thijs") == tmp_path / "profiles" / "thijs"


def test_journal_root_matches_the_directory_register_uses(tmp_path):
    assert journal_root(tmp_path) == tmp_path / "ergates"


# --- settings resolution (no secrets on the command line) -------------------


def test_settings_come_from_the_plugin_entry_in_the_profile_config():
    settings = settings_from_config(_config(server="https://x", topic="t", token="tok"))

    assert settings == {"server": "https://x", "topic": "t", "token": "tok"}


def test_settings_are_empty_when_the_plugin_is_not_configured():
    assert settings_from_config({}) == {}
    assert settings_from_config({"plugins": {}}) == {}
    assert settings_from_config(_config()) == {}


def test_settings_tolerate_a_config_of_the_wrong_shape():
    """A maintenance sweep must not die on a config typo."""
    assert settings_from_config({"plugins": {"entries": {"ergates": "oops"}}}) == {}
    assert settings_from_config({"plugins": "oops"}) == {}
    assert settings_from_config(_config(server="", topic=None, token=7)) == {}


def test_load_settings_returns_empty_when_there_is_no_config_file(tmp_path):
    assert load_settings(tmp_path) == {}


def test_load_settings_reads_the_profile_config(tmp_path):
    _write_config(tmp_path)

    assert load_settings(tmp_path) == SETTINGS


# --- the retry pass ---------------------------------------------------------


def test_flush_once_republishes_a_due_retry(tmp_path):
    journal = AttentionJournal(journal_root(tmp_path))
    now = time.time()
    journal.claim("evt-1", {
        "state": "pending", "session_key": "s1", "connection_id": "c1", "profile": "thijs",
        "created_at": now, "next_retry": now - 1, "attempts": 1,
    })
    published = []

    counts = flush_once(tmp_path, SETTINGS, now=now, publish=published.append)

    assert counts["retried"] == 1
    assert len(published) == 1
    assert published[0]["url"] == "https://ntfy.example.internal/ergates-alerts"
    assert journal.read("evt-1")["delivery"] == "sent"


def test_flush_once_skips_the_retry_pass_when_push_is_not_configured(tmp_path):
    journal = AttentionJournal(journal_root(tmp_path))
    now = time.time()
    journal.claim("evt-1", {
        "state": "pending", "created_at": now, "next_retry": now - 1, "attempts": 1,
    })
    published = []

    counts = flush_once(tmp_path, {}, now=now, publish=published.append)

    assert counts["retried"] == 0
    assert published == []
    assert journal.read("evt-1") is not None  # still pending, still retryable later


def test_flush_once_never_retries_an_expired_approval(tmp_path):
    journal = AttentionJournal(journal_root(tmp_path))
    created = 1_000_000.0
    journal.claim("expired", {
        "state": "pending", "created_at": created, "next_retry": created + 30, "attempts": 1,
    })
    published = []

    counts = flush_once(
        tmp_path, SETTINGS, now=created + PENDING_MAX_AGE_SECONDS + 1, publish=published.append,
    )

    assert counts["retried"] == 0
    assert published == []
    # Expired, not deleted: it keeps its seven-day audit window.
    assert counts["expired_notifications"] == 1
    assert counts["pruned_notifications"] == 0
    assert journal.read("expired")["state"] == "expired"


# --- the retention pass -----------------------------------------------------


def test_flush_once_prunes_all_three_journals(tmp_path, store, cron):
    """Every journal here has a prune and nothing called any of them, so agent
    briefings, reminder receipts and delivery metadata accumulated forever
    (04 section 8)."""
    root = journal_root(tmp_path)
    now = time.time()
    AttentionJournal(root).claim("gave-up", {
        "state": "failed", "delivery": "gave_up", "resolved_at": now - RETENTION_SECONDS - 60,
    })
    ProposalJournal(root).claim("expired-proposal", {
        "state": PROPOSED_STATE, "expires_at": "2020-01-01T00:00:00Z",
    })
    idle_since = now - REMINDER_MAX_IDLE_SECONDS - 60
    ReminderService(store, cron, clock=lambda: idle_since).create("thijs", "0 9 * * *", "UTC", "Check invoices.")

    counts = flush_once(tmp_path, {}, now=now)

    assert counts["pruned_notifications"] == 1
    assert counts["pruned_proposals"] == 1
    assert counts["pruned_reminders"] == 1
    assert AttentionJournal(root).list() == []
    assert ProposalJournal(root).list() == []
    assert rows(store, "reminder_receipts") == []


def test_flush_once_drops_a_reminder_receipt_whose_job_is_gone(tmp_path, store, cron):
    outcome = ReminderService(store, cron).create("thijs", "0 9 * * *", "UTC", "Check invoices.")
    cron.delete_job(outcome.receipt["job_id"])

    counts = flush_once(tmp_path, {}, cron=cron)

    assert counts["pruned_reminders"] == 1
    assert rows(store, "reminder_receipts") == []


def test_flush_once_on_an_untouched_home_is_a_no_op(tmp_path):
    counts = flush_once(tmp_path, {})

    assert counts == {
        "retried": 0, "expired_notifications": 0,
        "pruned_notifications": 0, "pruned_proposals": 0, "pruned_reminders": 0,
    }


# --- the command line -------------------------------------------------------


def test_main_reports_counts_and_never_prints_a_secret(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_config(tmp_path)
    AttentionJournal(journal_root(tmp_path)).claim("gave-up", {
        "state": "failed", "resolved_at": time.time() - RETENTION_SECONDS - 60,
    })

    exit_code = main(["--profile", "default"])

    out = capsys.readouterr().out
    assert exit_code == 0
    assert "pruned_notifications=1" in out
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


def test_records_on_disk_never_carry_content_after_a_flush(tmp_path):
    """Belt and braces over the retention rules: whatever survives a sweep must
    still be free of prompts, commands and briefings."""
    root = journal_root(tmp_path)
    AttentionJournal(root).claim("evt", {
        "state": "pending", "created_at": time.time(), "command_hash": "a" * 64,
    })
    flush_once(tmp_path, {})

    for path in (root / "notifications").glob("*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        assert "command" not in record
        assert "description" not in record
