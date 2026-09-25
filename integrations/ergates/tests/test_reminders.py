"""Tests for ergates.reminders: idempotent reminder creation on the control store."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from conftest import raw_bytes, rows
from ergates import reminders
from ergates.paths import store_path
from ergates.reminders import (
    IN_FLIGHT_SECONDS,
    REMINDER_MAX_IDLE_SECONDS,
    ReminderError,
    ReminderOutcome,
    ReminderService,
    UnavailableCron,
    idempotency_key,
    prompt_hash,
    routine_name,
)
from ergates.store import ControlStore

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
WORKER = Path(__file__).resolve().with_name("reminder_race_worker.py")

PROFILE = "thijs"
SCHEDULE = "0 9 * * *"
TIMEZONE = "Europe/Amsterdam"
PROMPT = "Check invoices and summarize overdue reminders."
ARGS = (PROFILE, SCHEDULE, TIMEZONE, PROMPT)


@pytest.fixture
def service(store, cron, clock) -> ReminderService:
    return ReminderService(store, cron, clock=clock)


def _state(store, receipt_id: str) -> dict:
    return next(row for row in rows(store, "reminder_receipts") if row["id"] == receipt_id)


# --- the idempotency key and the job name ----------------------------------


def test_idempotency_key_is_deterministic_and_ignores_incidental_whitespace():
    a = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert a == idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    assert a == idempotency_key(f"  {PROFILE} ", f" {SCHEDULE}  ", TIMEZONE, f"  {PROMPT}  ")
    assert len(a) == 64


def test_idempotency_key_separates_prompt_profile_and_timezone():
    """Hermes 0.21.2 cannot schedule per-job timezones, but two requests that differ
    only in zone are still two requests: one of them must not silently vanish."""
    base = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert base != idempotency_key(PROFILE, SCHEDULE, TIMEZONE, "Another prompt.")
    assert base != idempotency_key("nora", SCHEDULE, TIMEZONE, PROMPT)
    assert base != idempotency_key(PROFILE, SCHEDULE, "America/New_York", PROMPT)


def test_the_job_name_is_unique_per_receipt_and_never_carries_the_prompt():
    """docs/06 section 6: routine names start with `[bot:<profile>] `. The tag makes
    the name unique per receipt, which is what reconciliation searches for."""
    named = routine_name(PROFILE, "Invoice sweep", "outbox-1")
    default = routine_name(PROFILE, None, "outbox-1")

    assert named.startswith("[bot:thijs] Invoice sweep · ")
    assert default.startswith("[bot:thijs] reminder · ")
    assert routine_name(PROFILE, "Invoice sweep", "outbox-2") != named
    assert routine_name(PROFILE, "Invoice sweep", "outbox-1") == named
    assert PROMPT not in default


# --- creating ---------------------------------------------------------------


def test_create_calls_cron_once_with_the_profile_out_of_band(service, cron):
    outcome = service.create(*ARGS, label="Invoice sweep")

    assert outcome.status == "created"
    assert cron.create_calls == [{
        "profile": PROFILE, "schedule": SCHEDULE, "prompt": PROMPT,
        "name": routine_name(PROFILE, "Invoice sweep", outcome.receipt["id"]),
    }]


def test_the_receipt_has_exactly_the_c1_keys(service):
    outcome = service.create(*ARGS, request_id="outbox-42")

    assert isinstance(outcome, ReminderOutcome)
    assert outcome.receipt == {
        "id": "outbox-42",
        "request_id": "outbox-42",
        "profile": PROFILE,
        "state": "created",
        "job_id": "job-1",
        "timezone_advisory": TIMEZONE,
        "payload_hash": idempotency_key(*ARGS),
    }


def test_without_a_request_id_the_receipt_id_is_the_payload_hash(service):
    outcome = service.create(*ARGS)

    assert outcome.receipt["id"] == idempotency_key(*ARGS)
    assert outcome.receipt["request_id"] is None


def test_the_store_holds_the_prompt_hash_never_the_prompt(service, store):
    """docs/11 section 4.3 and docs/04 section 8: the receipt keeps hashes only."""
    outcome = service.create(*ARGS)

    assert _state(store, outcome.receipt["id"])["prompt_hash"] == prompt_hash(PROMPT)
    assert PROMPT.encode("utf-8") not in raw_bytes(store)


def test_the_same_request_twice_creates_one_job(service, cron):
    first = service.create(*ARGS)
    second = service.create(*ARGS)

    assert (first.status, second.status) == ("created", "existing")
    assert first.receipt == second.receipt
    assert len(cron.create_calls) == 1


def test_the_same_request_id_with_a_different_payload_conflicts_and_creates_nothing(service, cron, store):
    """docs/11 section 4.3: "retries with a different payload must fail"."""
    first = service.create(*ARGS, request_id="outbox-42")

    conflict = service.create(PROFILE, SCHEDULE, TIMEZONE, "An edited prompt", request_id="outbox-42")

    assert conflict.status == "conflict"
    assert conflict.receipt == first.receipt
    assert len(cron.create_calls) == 1
    assert _state(store, "outbox-42")["version"] == 2


def test_two_request_ids_for_the_same_payload_are_two_reminders(service, cron):
    service.create(*ARGS, request_id="outbox-1")
    service.create(*ARGS, request_id="outbox-2")

    assert len(cron.create_calls) == 2


@pytest.mark.parametrize("request_id", ["../escape", "", "a b", "x" * 129, 42])
def test_an_unusable_request_id_is_invalid_and_writes_nothing(service, cron, store, request_id):
    with pytest.raises(ReminderError) as caught:
        service.create(*ARGS, request_id=request_id)

    assert caught.value.code == "invalid"
    assert rows(store, "reminder_receipts") == []
    assert cron.create_calls == []


@pytest.mark.parametrize("field", ["profile", "schedule", "prompt"])
def test_an_empty_field_is_invalid(service, field):
    values = dict(zip(("profile", "schedule", "timezone", "prompt"), ARGS), **{field: "  "})

    with pytest.raises(ReminderError, match=field):
        service.create(values["profile"], values["schedule"], values["timezone"], values["prompt"])


def test_a_profile_that_is_not_a_hermes_profile_name_is_invalid(service):
    with pytest.raises(ReminderError, match="profile"):
        service.create("Not A Profile!", SCHEDULE, TIMEZONE, PROMPT)


def test_a_non_string_timezone_or_label_is_invalid(service):
    with pytest.raises(ReminderError, match="timezone"):
        service.create(PROFILE, SCHEDULE, None, PROMPT)
    with pytest.raises(ReminderError, match="label"):
        service.create(*ARGS, label=7)


def test_an_invalid_request_never_names_the_prompt(service):
    with pytest.raises(ReminderError) as caught:
        service.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="../escape")

    assert PROMPT not in str(caught.value)


def test_reminder_error_carries_its_code():
    assert ReminderError("gone", code="unknown_profile").code == "unknown_profile"
    assert ReminderError("bad").code == "invalid"


# --- native deletion and failed lookups ------------------------------------


def test_a_natively_deleted_job_is_created_again_once(service, cron):
    """docs/11 section 4.3 keeps delete on native cron, so a receipt can outlive its job."""
    first = service.create(*ARGS)
    cron.delete_job(first.receipt["job_id"])

    second = service.create(*ARGS)

    assert second.status == "created"
    assert second.receipt["id"] == first.receipt["id"]
    assert second.receipt["job_id"] == "job-2"
    assert len(cron.create_calls) == 2


def test_a_failing_lookup_keeps_the_receipt_instead_of_duplicating(service, cron):
    """"Could not tell" is never "gone"."""
    first = service.create(*ARGS)
    cron.fail_lookup = True

    second = service.create(*ARGS)

    assert second.status == "existing"
    assert second.receipt == first.receipt
    assert len(cron.create_calls) == 1


# --- failed creates are uncertain, never raised and never repeated blindly --


def test_a_failed_create_is_reported_uncertain_not_raised(service, cron, store):
    cron.fail_create = "before"

    outcome = service.create(*ARGS)

    assert outcome.status == "uncertain"
    assert outcome.receipt["state"] == "uncertain"
    assert outcome.receipt["job_id"] is None


def test_a_create_that_returns_no_job_id_is_uncertain(store, clock):
    class NoIdCron:
        def create_job(self, profile, *, schedule, prompt, name):
            return {"ok": True}

    outcome = ReminderService(store, NoIdCron(), clock=clock).create(*ARGS)

    assert outcome.status == "uncertain"


def test_bug3_an_uncertain_receipt_reconciles_to_the_job_that_was_created(service, cron, store):
    """Roadmap bug 3: an `uncertain` receipt was returned unchanged forever, even
    when its job existed. The next request now finds the job by its unique name."""
    cron.fail_create = "after"
    lost = service.create(*ARGS)
    cron.fail_create = None

    again = service.create(*ARGS)

    assert lost.status == "uncertain"
    assert again.status == "existing"
    assert again.receipt["state"] == "created"
    assert again.receipt["job_id"] == "job-1"
    assert len(cron.create_calls) == 1


def test_bug3_an_uncertain_receipt_with_no_matching_job_is_created_once(service, cron):
    cron.fail_create = "before"
    service.create(*ARGS)
    cron.fail_create = None

    again = service.create(*ARGS)
    third = service.create(*ARGS)

    assert again.status == "created"
    assert third.status == "existing"
    assert len(cron.create_calls) == 2
    assert len(cron.jobs) == 1


def test_bug3_several_jobs_with_the_receipt_name_leave_it_uncertain(service, cron):
    """Two jobs carry the name: the service cannot tell which is its own, so it
    creates nothing and says so."""
    cron.fail_create = "before"
    lost = service.create(*ARGS)
    cron.fail_create = None
    name = routine_name(PROFILE, None, lost.receipt["id"])
    cron.add_job(PROFILE, name)
    cron.add_job(PROFILE, name)

    again = service.create(*ARGS)

    assert again.status == "uncertain"
    assert len(cron.create_calls) == 1


def test_bug3_an_unreachable_cron_leaves_an_uncertain_receipt_uncertain(service, cron):
    cron.fail_create = "after"
    service.create(*ARGS)
    cron.fail_create = None
    cron.fail_find = True

    again = service.create(*ARGS)

    assert again.status == "uncertain"
    assert len(cron.create_calls) == 1


def test_bug3_a_creating_receipt_left_by_a_dead_creator_is_reconciled(service, cron, store, clock, monkeypatch):
    """A creator that died inside create_job leaves `creating` behind. For
    IN_FLIGHT_SECONDS it is presumed alive (the request waits, then answers
    uncertain); after that the next request reconciles it by name."""
    monkeypatch.setattr(reminders, "IN_FLIGHT_WAIT_SECONDS", 0.05)

    class Died(BaseException):
        """The process dies: nothing after create_job runs."""

    def die():
        raise Died()

    cron.on_create = die
    with pytest.raises(Died):
        service.create(*ARGS)
    assert _state(store, idempotency_key(*ARGS))["state"] == "creating"

    in_flight = service.create(*ARGS)
    clock.advance(IN_FLIGHT_SECONDS + 1)
    reconciled = service.create(*ARGS)

    assert in_flight.status == "uncertain"
    assert in_flight.receipt["state"] == "creating"
    assert reconciled.status == "created"
    assert len(cron.jobs) == 1


# --- concurrency: identical requests at once, bug 1 -------------------------


def test_two_identical_requests_at_the_same_moment_create_one_job_and_share_one_receipt(store, cron):
    """A double tap plus a network retry. The second request waits
    for the first creator instead of creating again."""
    service = ReminderService(store, cron)
    barrier = threading.Barrier(2)
    outcomes: list[ReminderOutcome] = []
    cron.on_create = lambda: time.sleep(0.2)

    def request() -> None:
        barrier.wait()
        outcomes.append(service.create(*ARGS, request_id="outbox-7"))

    threads = [threading.Thread(target=request) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(cron.create_calls) == 1
    assert sorted(outcome.status for outcome in outcomes) == ["created", "existing"]
    assert outcomes[0].receipt == outcomes[1].receipt
    assert outcomes[0].receipt["job_id"] == "job-1"


def test_two_processes_with_the_same_request_create_one_job(tmp_path):
    """The same race across processes: the gateway and `hermes serve` share one store file."""
    store_file = store_path(tmp_path)
    ControlStore(store_file).close()
    cron_file = tmp_path / "cron.jsonl"
    go = tmp_path / "go"
    env = {**os.environ, "PYTHONPATH": str(PACKAGE_ROOT)}
    workers = [
        subprocess.Popen(
            [sys.executable, str(WORKER), str(store_file), str(cron_file), str(go)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )
        for _ in range(2)
    ]
    time.sleep(0.3)
    go.touch()
    results = [worker.communicate(timeout=60) for worker in workers]

    assert [worker.returncode for worker in workers] == [0, 0], results
    outcomes = [json.loads(out) for out, _err in results]
    assert len(cron_file.read_text(encoding="utf-8").splitlines()) == 1
    assert sorted(outcome["status"] for outcome in outcomes) == ["created", "existing"]
    assert outcomes[0]["receipt"] == outcomes[1]["receipt"]


def test_bug1_two_requests_that_both_see_the_job_gone_recreate_it_once(service, cron):
    """Roadmap bug 1: both retries saw the natively deleted job as gone, and the
    slower one deleted the receipt the faster one had just re-created, then
    created a second job. The version check now stops the slower one."""
    first = service.create(*ARGS)
    cron.delete_job(first.receipt["job_id"])
    entered, release = threading.Event(), threading.Event()
    cron.on_get = lambda: (entered.set(), release.wait(timeout=5))
    slow_outcome: list[ReminderOutcome] = []
    slow = threading.Thread(target=lambda: slow_outcome.append(service.create(*ARGS)))
    slow.start()
    assert entered.wait(timeout=5)

    fast = service.create(*ARGS)
    release.set()
    slow.join()

    assert fast.status == "created"
    assert slow_outcome[0].status == "existing"
    assert slow_outcome[0].receipt == fast.receipt
    assert len(cron.jobs) == 1
    assert len(cron.create_calls) == 2


def test_a_receipt_that_changes_during_create_job_is_not_overwritten(service, cron, store, clock):
    """If another request took the receipt over while create_job ran (the creator
    looked dead), the slow creator reports the current receipt and writes nothing."""

    def take_over():
        with store.transaction() as conn:
            conn.execute("UPDATE reminder_receipts SET version = version + 1, state = 'uncertain'")

    cron.on_create = take_over

    outcome = service.create(*ARGS)

    assert outcome.status == "uncertain"
    assert _state(store, outcome.receipt["id"])["job_id"] is None


def test_a_receipt_that_keeps_changing_is_reported_uncertain(service, cron, store, monkeypatch):
    monkeypatch.setattr(reminders, "IN_FLIGHT_WAIT_SECONDS", 0.05)
    service.create(*ARGS)

    def churn():
        with store.transaction() as conn:
            conn.execute("UPDATE reminder_receipts SET version = version + 1")

    cron.get_job = lambda profile, job_id: (churn(), None)[1]

    outcome = service.create(*ARGS)

    assert outcome.status == "uncertain"


# --- retention --------------------------------------------------------------


def test_prune_drops_a_receipt_whose_job_is_gone(service, cron, store, clock):
    outcome = service.create(*ARGS)
    cron.delete_job(outcome.receipt["job_id"])

    assert service.prune(clock()) == 1
    assert rows(store, "reminder_receipts") == []


def test_prune_keeps_a_receipt_whose_job_exists(service, store, clock):
    service.create(*ARGS)

    assert service.prune(clock()) == 0
    assert len(rows(store, "reminder_receipts")) == 1


def test_prune_keeps_a_receipt_when_the_lookup_fails(service, cron, clock):
    service.create(*ARGS)
    cron.fail_lookup = True

    assert service.prune(clock()) == 0


def test_prune_keeps_a_fresh_uncertain_receipt(service, cron, clock):
    """An uncertain receipt has no job to look up; only the idle rule removes it."""
    cron.fail_create = "before"
    service.create(*ARGS)

    assert service.prune(clock()) == 0


def test_prune_drops_receipts_idle_for_thirty_days_in_any_state(service, cron, store, clock):
    service.create(*ARGS, request_id="created-one")
    cron.fail_create = "before"
    service.create(*ARGS, request_id="uncertain-one")
    clock.advance(REMINDER_MAX_IDLE_SECONDS + 1)

    assert service.prune(clock()) == 2
    assert rows(store, "reminder_receipts") == []


def test_an_idempotent_hit_restarts_the_idle_clock(service, store, clock):
    service.create(*ARGS)
    clock.advance(REMINDER_MAX_IDLE_SECONDS - 60)
    service.create(*ARGS)
    clock.advance(120)

    assert service.prune(clock()) == 0


def test_prune_with_an_unavailable_cron_applies_only_the_idle_rule(service, store, cron, clock):
    """A process without cron access (today's `python -m ergates.flush`) applies only the idle rule."""
    outcome = service.create(*ARGS)
    cron.delete_job(outcome.receipt["job_id"])
    blind = ReminderService(store, UnavailableCron(), clock=clock)

    assert blind.prune(clock()) == 0
    clock.advance(REMINDER_MAX_IDLE_SECONDS + 1)
    assert blind.prune(clock()) == 1


def test_bug2_prune_keeps_a_receipt_claimed_again_after_its_snapshot(service, cron, store, clock):
    """Roadmap bug 2: prune looked the job up outside any lock, then deleted the
    receipt without checking it again, so it deleted the receipt a concurrent
    request had just re-created. It now deletes only the version it inspected."""
    first = service.create(*ARGS)
    cron.delete_job(first.receipt["job_id"])
    cron.on_get = lambda: service.create(*ARGS)

    removed = service.prune(clock())
    after = service.create(*ARGS)

    assert removed == 0
    assert after.status == "existing"
    assert after.receipt["job_id"] == "job-2"
    assert len(cron.jobs) == 1


def test_unavailable_cron_raises_for_every_call():
    cron = UnavailableCron()

    for call in (
        lambda: cron.create_job(PROFILE, schedule=SCHEDULE, prompt=PROMPT, name="x"),
        lambda: cron.get_job(PROFILE, "job-1"),
        lambda: cron.find_job_ids_by_name(PROFILE, "x"),
    ):
        with pytest.raises(reminders.CronUnavailable):
            call()
