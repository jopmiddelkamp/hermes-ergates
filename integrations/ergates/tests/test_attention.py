"""Tests for ergates.attention: build_ntfy_publish, deep_link, and AttentionJournal.prune."""

import threading
import time

from ergates.attention import (
    MAX_PUBLISH_ATTEMPTS,
    PENDING_MAX_AGE_SECONDS,
    RETENTION_SECONDS,
    RETRY_BACKOFF_SECONDS,
    AttentionJournal,
    build_ntfy_publish,
    command_hash,
    deep_link,
    pending_expired,
)


def test_deep_link_has_the_expected_scheme_and_path():
    link = deep_link("session-1", "connection-1", "thijs")

    assert link.startswith("ergates://chat/session-1?")
    assert "connection=connection-1" in link
    assert "profile=thijs" in link


def test_deep_link_url_encodes_special_characters_in_every_field():
    link = deep_link("sess/with slash", "conn with space", "name&with=chars")

    # The raw separators must never leak into the query string unescaped.
    assert "sess/with slash" not in link
    assert " " not in link
    assert "connection=conn+with+space" in link or "connection=conn%20with%20space" in link
    assert "profile=name%26with%3Dchars" in link


def test_build_ntfy_publish_targets_the_server_and_topic():
    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "",
        title="Hermes needs your approval",
        click_url="ergates://chat/s1?connection=c1&profile=thijs",
        event_id="evt-1",
    )

    assert result["url"] == "https://ntfy.example.internal/hermes-alerts"


def test_build_ntfy_publish_sets_click_header():
    click_url = "ergates://chat/s1?connection=c1&profile=thijs"

    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "",
        title="Hermes needs your approval",
        click_url=click_url,
        event_id="evt-1",
    )

    assert result["headers"]["Click"] == click_url


def test_build_ntfy_publish_body_is_generic_and_never_carries_the_prompt():
    sensitive_prompt = "Wire EUR 10,000 to the following IBAN: NL00BANK0123456789"

    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "",
        title=sensitive_prompt,  # even if a caller misuses the title, the body stays fixed
        click_url="ergates://chat/s1?connection=c1&profile=thijs",
        event_id="evt-1",
    )

    assert result["body"] == "You have a new request"
    assert "IBAN" not in result["body"]
    assert "Wire" not in result["body"]


def test_build_ntfy_publish_sets_bearer_authorization_for_a_plain_token():
    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "sometoken",
        title="t", click_url="ergates://chat/s1", event_id="evt-1",
    )

    assert result["headers"]["Authorization"] == "Bearer sometoken"


def test_build_ntfy_publish_sets_basic_authorization_for_a_user_pass_token():
    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "user:pass",
        title="t", click_url="ergates://chat/s1", event_id="evt-1",
    )

    assert result["headers"]["Authorization"].startswith("Basic ")


def test_build_ntfy_publish_omits_authorization_when_no_token():
    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "",
        title="t", click_url="ergates://chat/s1", event_id="evt-1",
    )

    assert "Authorization" not in result["headers"]


def test_build_ntfy_publish_sets_tags_and_priority():
    result = build_ntfy_publish(
        "https://ntfy.example.internal", "hermes-alerts", "",
        title="t", click_url="ergates://chat/s1", event_id="evt-1",
    )

    assert result["headers"]["X-Tags"] == "hermes-agent"
    assert "Priority" in result["headers"]


def test_prune_drops_resolved_events_older_than_seven_days_and_keeps_pending(tmp_path):
    journal = AttentionJournal(tmp_path)
    now = time.time()

    journal.claim("old-resolved", {
        "state": "resolved", "resolved_at": now - RETENTION_SECONDS - 60,
    })
    journal.claim("recent-resolved", {
        "state": "resolved", "resolved_at": now - 60,
    })
    journal.claim("still-pending", {
        "state": "pending", "resolved_at": None,
    })

    removed = journal.prune(now)

    assert removed == 1
    assert journal.read("old-resolved") is None
    assert journal.read("recent-resolved") is not None
    assert journal.read("still-pending") is not None


def test_prune_keeps_a_resolved_event_exactly_at_the_seven_day_boundary(tmp_path):
    journal = AttentionJournal(tmp_path)
    now = time.time()

    journal.claim("at-boundary", {"state": "resolved", "resolved_at": now - RETENTION_SECONDS})

    removed = journal.prune(now)

    assert removed == 0
    assert journal.read("at-boundary") is not None


def test_prune_is_a_no_op_on_an_empty_journal(tmp_path):
    journal = AttentionJournal(tmp_path)

    assert journal.prune(time.time()) == 0


def test_prune_skips_in_flight_temp_writes_and_corrupt_records(tmp_path):
    journal = AttentionJournal(tmp_path)
    journal.claim("old-resolved", {"state": "resolved", "resolved_at": time.time() - RETENTION_SECONDS - 60})

    kind_dir = tmp_path / "notifications"
    (kind_dir / ".tmp-orphan123.json").write_text('{"incomplete": tr', encoding="utf-8")
    (kind_dir / "corrupt.json").write_text("{not valid json", encoding="utf-8")

    removed = journal.prune(time.time())

    assert removed == 1
    assert journal.read("old-resolved") is None


def test_command_hash_is_none_for_no_command():
    assert command_hash(None) is None
    assert command_hash("") is None


def test_command_hash_is_stable_and_content_sensitive():
    a = command_hash("rm -rf /tmp/x")
    b = command_hash("rm -rf /tmp/x")
    c = command_hash("rm -rf /tmp/y")

    assert a == b
    assert a != c
    assert len(a) == 64
    int(a, 16)  # valid hex


def test_record_publish_attempt_schedules_backoff_then_gives_up(tmp_path):
    journal = AttentionJournal(tmp_path)
    journal.claim("evt-1", {"state": "pending", "attempts": 0, "next_retry": None, "resolved_at": None})
    assert RETRY_BACKOFF_SECONDS == (30, 120, 600)
    assert MAX_PUBLISH_ATTEMPTS == 5

    t0 = 1_000_000.0
    r1 = journal.record_publish_attempt("evt-1", ok=False, now=t0)
    assert (r1["attempts"], r1["state"], r1["next_retry"]) == (1, "pending", t0 + 30)

    r2 = journal.record_publish_attempt("evt-1", ok=False, now=t0 + 30)
    assert (r2["attempts"], r2["state"], r2["next_retry"]) == (2, "pending", t0 + 30 + 120)

    r3 = journal.record_publish_attempt("evt-1", ok=False, now=t0 + 150)
    assert (r3["attempts"], r3["state"], r3["next_retry"]) == (3, "pending", t0 + 150 + 600)

    # Backoff table exhausted after 3 entries -- holds steady at the last value.
    r4 = journal.record_publish_attempt("evt-1", ok=False, now=t0 + 750)
    assert (r4["attempts"], r4["state"], r4["next_retry"]) == (4, "pending", t0 + 750 + 600)

    # 5th attempt: give up.
    r5 = journal.record_publish_attempt("evt-1", ok=False, now=t0 + 1350)
    assert r5["attempts"] == 5
    assert r5["state"] == "failed"
    assert r5["next_retry"] is None
    assert r5["delivery"] == "gave_up"


def test_record_publish_attempt_success_clears_retry_state_but_keeps_pending(tmp_path):
    journal = AttentionJournal(tmp_path)
    journal.claim("evt-1", {"state": "pending", "attempts": 2, "next_retry": 123.0, "resolved_at": None})

    result = journal.record_publish_attempt("evt-1", ok=True, now=1000.0)

    assert result["attempts"] == 3
    assert result["next_retry"] is None
    assert result["delivery"] == "sent"
    # A delivered push is not the same as an answered approval.
    assert result["state"] == "pending"


def test_record_publish_attempt_is_atomic_across_concurrent_threads(tmp_path):
    """Two threads racing to record a failed attempt for the SAME event must never
    lose an increment to a race between one thread's read and the other's write --
    the old read()-then-update() implementation could produce attempts == 1 here
    instead of 2. next_retry must also land on the value that matches a true,
    strictly-serialized attempts=1-then-2 sequence (30s then 120s backoff), not
    some inconsistent mix from two threads computing off the same stale read."""
    journal = AttentionJournal(tmp_path)
    journal.claim("evt-1", {"state": "pending", "attempts": 0, "next_retry": None, "resolved_at": None})
    now = 1_000_000.0
    barrier = threading.Barrier(2)

    def worker():
        barrier.wait()  # maximize the chance both threads overlap
        journal.record_publish_attempt("evt-1", ok=False, now=now)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    record = journal.read("evt-1")
    assert record["attempts"] == 2
    # Whichever thread ran second must have seen attempts=1 (the first thread's
    # committed write), landing on the second backoff entry -- never two
    # first-backoff writes racing each other.
    assert record["next_retry"] == now + RETRY_BACKOFF_SECONDS[1]
    assert record["state"] == "pending"


def test_retry_due_returns_only_pending_records_whose_next_retry_has_arrived(tmp_path):
    journal = AttentionJournal(tmp_path)
    journal.claim("due", {"state": "pending", "next_retry": 100.0})
    journal.claim("not-due-yet", {"state": "pending", "next_retry": 200.0})
    journal.claim("no-retry-scheduled", {"state": "pending", "next_retry": None})
    journal.claim("resolved-with-past-retry", {"state": "resolved", "next_retry": 50.0})
    journal.claim("failed-with-past-retry", {"state": "failed", "next_retry": 50.0})

    due = journal.retry_due(150.0)

    assert sorted(r["id"] for r in due) == ["due"]


# --- pending expiry and the give-up branch (11 section 4.2) ----------------


def test_a_gave_up_record_is_stamped_resolved_at_and_is_prunable(tmp_path):
    """The give-up branch is terminal, so prune() must be able to collect it seven
    days later. Without a resolved_at stamp it was immortal -- prune() skips any
    record without one -- contradicting the class docstring and 11 section 4.2."""
    journal = AttentionJournal(tmp_path)
    journal.claim("evt-1", {
        "state": "pending", "attempts": MAX_PUBLISH_ATTEMPTS - 1,
        "next_retry": 1.0, "resolved_at": None, "created_at": 1_000_000.0,
    })
    gave_up_at = 1_000_500.0

    record = journal.record_publish_attempt("evt-1", ok=False, now=gave_up_at)
    assert (record["state"], record["delivery"]) == ("failed", "gave_up")
    assert record["resolved_at"] == gave_up_at

    assert journal.prune(gave_up_at + RETENTION_SECONDS - 1) == 0
    assert journal.prune(gave_up_at + RETENTION_SECONDS + 1) == 1
    assert journal.read("evt-1") is None


def test_pending_max_age_matches_the_shipped_approval_timeout():
    """deploy/profiles/*/config.yaml set approvals.timeout: 1800, so an approval
    still pending past that has expired in Hermes."""
    assert PENDING_MAX_AGE_SECONDS == 1800


def test_retry_due_never_returns_an_expired_pending_record(tmp_path):
    """11 section 4.2: "Never retry an expired approval notification." A push that
    lands after the approval timed out points the user at a dead request."""
    journal = AttentionJournal(tmp_path)
    created = 1_000_000.0
    journal.claim("expired", {
        "state": "pending", "created_at": created, "next_retry": created + 30, "attempts": 1,
    })
    journal.claim("live", {
        "state": "pending", "created_at": created, "next_retry": created + 30, "attempts": 1,
    })

    still_live = journal.retry_due(created + 60)
    after_expiry = journal.retry_due(created + PENDING_MAX_AGE_SECONDS + 1)

    assert sorted(r["id"] for r in still_live) == ["expired", "live"]
    assert after_expiry == []


def test_retry_due_still_returns_a_record_with_no_created_at(tmp_path):
    """An unknowable age is not an expiry: guessing would drop live events."""
    journal = AttentionJournal(tmp_path)
    journal.claim("no-created-at", {"state": "pending", "next_retry": 100.0})

    assert [r["id"] for r in journal.retry_due(1_000_000.0)] == ["no-created-at"]


def test_a_stale_pending_record_becomes_terminal_rather_than_disappearing(tmp_path):
    """A process that dies between the pre and post hooks leaves a pending record
    nothing will ever resolve. It must not stay pending (the retry sweep would keep
    looking at it) and it must not simply vanish: an approval nobody answered is
    worth the same seven-day audit window as one that was answered."""
    journal = AttentionJournal(tmp_path)
    created = 1_000_000.0
    journal.claim("orphan", {
        "state": "pending", "created_at": created, "resolved_at": None,
        "attempts": 2, "delivery": "sent", "next_retry": created + 30,
    })

    assert journal.expire_pending(created + PENDING_MAX_AGE_SECONDS - 1) == 0
    assert journal.read("orphan")["state"] == "pending"

    assert journal.expire_pending(created + PENDING_MAX_AGE_SECONDS + 1) == 1
    record = journal.read("orphan")
    assert record["state"] == "expired"
    # Stamped at the moment it stopped being answerable, not at sweep time, so a
    # record noticed days late still ages out from its real expiry.
    assert record["resolved_at"] == created + PENDING_MAX_AGE_SECONDS
    assert record["next_retry"] is None
    # What delivery managed is left exactly as delivery left it.
    assert record["attempts"] == 2
    assert record["delivery"] == "sent"


def test_expiring_a_pending_record_is_idempotent(tmp_path):
    journal = AttentionJournal(tmp_path)
    created = 1_000_000.0
    journal.claim("orphan", {"state": "pending", "created_at": created})
    later = created + PENDING_MAX_AGE_SECONDS + 1

    assert journal.expire_pending(later) == 1
    assert journal.expire_pending(later) == 0
    assert journal.read("orphan")["state"] == "expired"


def test_an_expired_record_ages_out_on_the_same_seven_day_rule(tmp_path):
    journal = AttentionJournal(tmp_path)
    created = 1_000_000.0
    journal.claim("orphan", {"state": "pending", "created_at": created})
    expired_at = created + PENDING_MAX_AGE_SECONDS

    # prune() expires first, then applies the terminal rule in the same call.
    assert journal.prune(expired_at + RETENTION_SECONDS - 1) == 0
    assert journal.read("orphan")["state"] == "expired"

    assert journal.prune(expired_at + RETENTION_SECONDS + 1) == 1
    assert journal.read("orphan") is None


def test_prune_expires_and_removes_a_long_dead_pending_record_in_one_call(tmp_path):
    journal = AttentionJournal(tmp_path)
    created = 1_000_000.0
    journal.claim("ancient", {"state": "pending", "created_at": created})

    assert journal.prune(created + PENDING_MAX_AGE_SECONDS + RETENTION_SECONDS + 60) == 1
    assert journal.read("ancient") is None


def test_retry_due_skips_an_already_expired_record(tmp_path):
    journal = AttentionJournal(tmp_path)
    created = 1_000_000.0
    journal.claim("orphan", {
        "state": "pending", "created_at": created, "next_retry": created + 30, "attempts": 1,
    })
    journal.expire_pending(created + PENDING_MAX_AGE_SECONDS + 1)

    assert journal.retry_due(created + PENDING_MAX_AGE_SECONDS + 2) == []


def test_prune_keeps_a_live_pending_record_pending(tmp_path):
    journal = AttentionJournal(tmp_path)
    now = time.time()
    journal.claim("live", {"state": "pending", "created_at": now, "resolved_at": None})

    assert journal.prune(now + 60) == 0
    assert journal.read("live")["state"] == "pending"


def test_a_pending_record_with_no_created_at_is_never_expired(tmp_path):
    journal = AttentionJournal(tmp_path)
    journal.claim("unknowable", {"state": "pending"})

    assert journal.expire_pending(1_000_000.0) == 0
    assert journal.prune(1_000_000.0) == 0
    assert journal.read("unknowable")["state"] == "pending"


def test_pending_expired_is_false_without_a_created_at():
    assert pending_expired({"state": "pending"}, 1_000_000.0) is False
    assert pending_expired({"created_at": 0.0}, PENDING_MAX_AGE_SECONDS + 1) is True
