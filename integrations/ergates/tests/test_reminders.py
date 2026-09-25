"""Tests for ergates.reminders: idempotency, the pinned cron contract, and retention."""

import time

import pytest

from ergates.journal import Journal
from ergates.reminders import (
    REMINDER_MAX_IDLE_SECONDS,
    ReminderCreationError,
    ReminderCreator,
    ReminderJournal,
    idempotency_key,
    prompt_hash,
    routine_name,
)


PROFILE = "thijs"
SCHEDULE = "0 9 * * *"
TIMEZONE = "Europe/Amsterdam"
PROMPT = "Check invoices and summarize overdue reminders."


class _FakeCron:
    """Stands in for Hermes cron: records bodies, hands out ids, supports native delete.

    Mirrors the contract ``ReminderCreator`` documents -- ``create_job(body,
    *, profile)`` and ``get_job(job_id, *, profile)`` -- so a body or a
    profile passed the wrong way fails the test rather than passing silently.
    """

    def __init__(self):
        self.calls = []
        self.jobs = {}
        self._next = 0

    def create_job(self, body, *, profile):
        self._next += 1
        job_id = f"job-{self._next}"
        self.calls.append({"body": body, "profile": profile})
        self.jobs[job_id] = {"id": job_id, "profile": profile, **body}
        return {"id": job_id}

    def get_job(self, job_id, *, profile):
        return self.jobs.get(job_id)

    def delete_job(self, job_id):
        """What the Routines screen does through native cron (11 section 4.3)."""
        self.jobs.pop(job_id, None)


def _creator(tmp_path, cron=None, *, with_lookup=True):
    cron = cron or _FakeCron()
    journal = ReminderJournal(tmp_path)
    creator = ReminderCreator(
        journal, cron.create_job, cron.get_job if with_lookup else None,
    )
    return creator, journal, cron


# --- idempotency key --------------------------------------------------------


def test_idempotency_key_is_deterministic():
    a = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    b = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert a == b
    assert isinstance(a, str) and a


def test_idempotency_key_normalizes_incidental_whitespace():
    a = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    b = idempotency_key(f"  {PROFILE}  ", f"  {SCHEDULE}  ", TIMEZONE, f"  {PROMPT}  ")

    assert a == b


def test_idempotency_key_differs_for_a_different_prompt():
    a = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    b = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, "A completely different prompt.")

    assert a != b


def test_idempotency_key_differs_per_profile():
    a = idempotency_key("thijs", SCHEDULE, TIMEZONE, PROMPT)
    b = idempotency_key("nora", SCHEDULE, TIMEZONE, PROMPT)

    assert a != b


def test_idempotency_key_still_separates_two_timezones():
    """Hermes 0.21.2 cannot schedule per-job timezones, so the zone never reaches
    the scheduler -- but two requests that differ only in zone are still two
    different requests and must not collapse into one receipt (one of them would
    silently go missing)."""
    a = idempotency_key(PROFILE, SCHEDULE, "Europe/Amsterdam", PROMPT)
    b = idempotency_key(PROFILE, SCHEDULE, "America/New_York", PROMPT)

    assert a != b


# --- the pinned cron contract ----------------------------------------------


def test_create_job_body_carries_only_real_cronjobcreate_fields(tmp_path):
    """CronJobCreate (hermes_cli/web_models.py at the pin) has no `timezone` and no
    `profile` field; cron/jobs.py's create_job and the cron.manage RPC accept
    neither either. Sending them would be silently dropped at best."""
    creator, _journal, cron = _creator(tmp_path)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    body = cron.calls[0]["body"]
    assert set(body) == {"schedule", "prompt", "name"}
    assert body["schedule"] == SCHEDULE
    assert body["prompt"] == PROMPT


def test_create_passes_the_profile_out_of_band_not_in_the_body(tmp_path):
    """Cron scopes by profile outside the body: `?profile=` on POST /api/cron/jobs
    (web_server_cron.py's _cron_profile_home) or cron.manage's `profile` param."""
    creator, _journal, cron = _creator(tmp_path)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert cron.calls[0]["profile"] == PROFILE
    assert "profile" not in cron.calls[0]["body"]


def test_create_prefixes_the_job_name_with_the_bot_display_convention(tmp_path):
    """docs/06 section 6: routine names use `[bot:<profile>] `, which is what clients
    filter on (methods_tools.py keeps the same [bot:<name>] fallback filter)."""
    creator, _journal, cron = _creator(tmp_path)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert cron.calls[0]["body"]["name"].startswith(f"[bot:{PROFILE}] ")


def test_routine_name_takes_a_caller_supplied_label_and_never_the_prompt():
    named = routine_name(PROFILE, "Invoice sweep")
    default = routine_name(PROFILE, payload_hash="abcdef0123456789")

    assert named == "[bot:thijs] Invoice sweep"
    assert default == "[bot:thijs] reminder abcdef01"
    assert PROMPT not in default


def test_receipt_returns_the_timezone_as_advisory_only(tmp_path):
    creator, _journal, _cron = _creator(tmp_path)

    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert receipt["timezone_advisory"] == TIMEZONE
    assert "timezone" not in receipt


# --- receipt contents -------------------------------------------------------


def test_receipt_stores_the_prompt_hash_never_the_prompt(tmp_path):
    """11 section 4.3: the receipt records the schedule/timezone/prompt *hash*."""
    creator, journal, _cron = _creator(tmp_path)

    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    stored = journal.read(receipt["id"])
    assert stored["prompt_hash"] == prompt_hash(PROMPT)
    assert PROMPT not in repr(stored)
    assert "prompt" not in stored


def test_create_records_job_id_after_create(tmp_path):
    creator, _journal, _cron = _creator(tmp_path)

    record = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert record["job_id"] == "job-1"
    assert record["state"] == "created"


def test_create_with_the_same_payload_returns_the_same_receipt_and_creates_once(tmp_path):
    creator, _journal, cron = _creator(tmp_path)

    first = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    second = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert first["job_id"] == second["job_id"] == "job-1"
    assert len(cron.calls) == 1


def test_create_marks_the_receipt_uncertain_when_create_job_raises_after_send(tmp_path):
    def create_job(body, *, profile):
        raise RuntimeError("connection dropped after the request was sent")

    journal = ReminderJournal(tmp_path)
    creator = ReminderCreator(journal, create_job)

    with pytest.raises(RuntimeError):
        creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    key = idempotency_key(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    record = journal.read(key)
    assert record is not None
    assert record["state"] == "uncertain"


def test_an_uncertain_receipt_is_never_blindly_recreated(tmp_path):
    """11 section 4.3: "no unconditional second create" -- the caller must reconcile."""
    calls = []

    def create_job(body, *, profile):
        calls.append(body)
        raise RuntimeError("connection dropped after the request was sent")

    creator = ReminderCreator(ReminderJournal(tmp_path), create_job)

    with pytest.raises(RuntimeError):
        creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    again = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert again["state"] == "uncertain"
    assert len(calls) == 1


# --- request_id reuse (real idempotency-key reuse detection) ----------------


def test_request_id_becomes_the_journal_id(tmp_path):
    creator, journal, _cron = _creator(tmp_path)

    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")

    assert receipt["id"] == "outbox-42"
    assert journal.read("outbox-42")["request_id"] == "outbox-42"


def test_same_request_id_with_a_different_payload_conflicts_and_creates_no_job(tmp_path):
    """The real guard 11 section 4.3 asks for: "retries with a different payload must
    fail". The app's outbox id is per attempt, so an edited prompt resent under the
    old id is a caller bug -- and used to quietly create a second reminder."""
    creator, journal, cron = _creator(tmp_path)

    first = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")
    conflict = creator.create(
        PROFILE, SCHEDULE, TIMEZONE, "An edited prompt resent under the same id",
        request_id="outbox-42",
    )

    assert first["state"] == "created"
    assert conflict["state"] == "conflict"
    assert conflict["job_id"] is None
    assert len(cron.calls) == 1
    # The stored receipt is untouched: never overwritten by the conflicting retry.
    assert journal.read("outbox-42")["payload_hash"] == first["payload_hash"]


def test_same_request_id_with_the_same_payload_is_a_normal_idempotent_hit(tmp_path):
    creator, _journal, cron = _creator(tmp_path)

    first = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")
    second = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")

    assert second["state"] == "created"
    assert second["job_id"] == first["job_id"]
    assert len(cron.calls) == 1


def test_a_different_request_id_for_the_same_payload_is_a_different_request(tmp_path):
    """Two distinct outbox attempts are two distinct ids by construction, so the
    caller owns de-duplication at that level; the content hash is what makes the
    no-request_id path safe."""
    creator, _journal, cron = _creator(tmp_path)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-1")
    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-2")

    assert len(cron.calls) == 2


def test_an_unusable_request_id_is_rejected_before_anything_is_written(tmp_path):
    creator, journal, cron = _creator(tmp_path)

    with pytest.raises(ReminderCreationError):
        creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="../escape")

    assert journal.list() == []
    assert cron.calls == []


# --- native deletion (stale receipt) ---------------------------------------


def test_create_after_a_native_delete_creates_a_fresh_job_and_receipt(tmp_path):
    """11 section 4.3 keeps delete on native cron, so the receipt can outlive its
    job. Returning the old receipt reported success for a reminder that would
    never fire again."""
    creator, journal, cron = _creator(tmp_path)

    first = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    cron.delete_job(first["job_id"])

    second = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert len(cron.calls) == 2            # exactly one *new* create
    assert second["job_id"] == "job-2"
    assert second["job_id"] != first["job_id"]
    assert second["state"] == "created"
    assert journal.read(second["id"])["job_id"] == "job-2"


def test_create_returns_the_existing_receipt_while_the_job_is_still_there(tmp_path):
    creator, _journal, cron = _creator(tmp_path)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert len(cron.calls) == 1


def test_a_failing_job_lookup_keeps_the_receipt_rather_than_duplicating(tmp_path):
    """"Could not tell" must never mean "gone": an unreachable cron API would
    otherwise turn every retry into a duplicate reminder."""
    cron = _FakeCron()

    def exploding_get_job(job_id, *, profile):
        raise RuntimeError("cron API unreachable")

    journal = ReminderJournal(tmp_path)
    creator = ReminderCreator(journal, cron.create_job, exploding_get_job)

    first = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    second = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert len(cron.calls) == 1
    assert second["job_id"] == first["job_id"]


def test_without_a_job_lookup_the_receipt_is_trusted_as_before(tmp_path):
    creator, _journal, cron = _creator(tmp_path, with_lookup=False)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    cron.delete_job("job-1")
    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert len(cron.calls) == 1  # the stale-receipt bug, unavoidable with no lookup


# --- retention --------------------------------------------------------------


def test_prune_drops_a_receipt_whose_job_is_gone(tmp_path):
    creator, journal, cron = _creator(tmp_path)
    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    cron.delete_job(receipt["job_id"])

    removed = journal.prune(time.time(), cron.get_job)

    assert removed == 1
    assert journal.read(receipt["id"]) is None


def test_prune_keeps_a_receipt_whose_job_still_exists(tmp_path):
    creator, journal, cron = _creator(tmp_path)
    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    removed = journal.prune(time.time(), cron.get_job)

    assert removed == 0
    assert journal.read(receipt["id"]) is not None


def test_prune_drops_a_receipt_unused_for_thirty_days(tmp_path):
    journal = ReminderJournal(tmp_path)
    now = time.time()
    journal.claim("stale", {
        "state": "created", "job_id": "job-1", "profile": PROFILE,
        "created_at": now - REMINDER_MAX_IDLE_SECONDS - 60,
        "last_seen_at": now - REMINDER_MAX_IDLE_SECONDS - 60,
    })
    journal.claim("fresh", {
        "state": "created", "job_id": "job-2", "profile": PROFILE,
        "created_at": now - 60, "last_seen_at": now - 60,
    })

    removed = journal.prune(now)

    assert removed == 1
    assert journal.read("stale") is None
    assert journal.read("fresh") is not None


def test_an_idempotent_hit_refreshes_the_idle_clock(tmp_path):
    creator, journal, _cron = _creator(tmp_path)
    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)
    journal.update(receipt["id"], last_seen_at=time.time() - REMINDER_MAX_IDLE_SECONDS - 60)

    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)

    assert journal.prune(time.time()) == 0


def test_prune_keeps_a_receipt_with_no_timestamps_at_all(tmp_path):
    journal = ReminderJournal(tmp_path)
    journal.claim("ancient", {"state": "created", "job_id": "job-1"})

    assert journal.prune(time.time()) == 0
    assert journal.read("ancient") is not None


def test_reminder_creator_accepts_a_plain_journal(tmp_path):
    """ReminderJournal is a convenience: the creator only needs Journal's API."""
    cron = _FakeCron()
    creator = ReminderCreator(Journal(tmp_path, "reminders"), cron.create_job, cron.get_job)

    assert creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT)["state"] == "created"


# --- a damaged receipt must never become a duplicate job -------------------


def test_a_corrupt_receipt_refuses_the_request_instead_of_creating_a_second_job(tmp_path):
    """`Journal.read` fails closed on an unreadable record, and the creator must
    surface that rather than treat the request as new: a truncated receipt would
    otherwise produce a duplicate cron job for a reminder that already exists."""
    creator, journal, cron = _creator(tmp_path)
    receipt = creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")
    (tmp_path / "reminders" / "outbox-42.json").write_text("{trunc", encoding="utf-8")

    with pytest.raises(ReminderCreationError) as caught:
        creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")

    assert "cannot be read" in str(caught.value)
    assert len(cron.calls) == 1          # no second create_job
    assert receipt["job_id"] == "job-1"  # and the original job is untouched


def test_the_refusal_names_no_prompt_or_record_content(tmp_path):
    creator, _journal, _cron = _creator(tmp_path)
    creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")
    (tmp_path / "reminders" / "outbox-42.json").write_text(
        '{"prompt": "' + PROMPT + '", broken', encoding="utf-8",
    )

    with pytest.raises(ReminderCreationError) as caught:
        creator.create(PROFILE, SCHEDULE, TIMEZONE, PROMPT, request_id="outbox-42")

    assert PROMPT not in str(caught.value)
