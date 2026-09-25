"""Tests for ergates.delivery: the ntfy request, the deep link, and the leased outbox worker."""

from __future__ import annotations

import logging
import threading
import urllib.request

import pytest

from conftest import rows
from ergates.attention import APPROVAL_TTL_SECONDS, AttentionService
from ergates.delivery import (
    APPROVAL_TITLE,
    COMPLETION_TITLE,
    GENERIC_BODY,
    LEASE_SECONDS,
    MAX_ATTEMPTS,
    DeliveryWorker,
    NtfySettings,
    backoff_seconds,
    build_ntfy_publish,
    deep_link,
    ntfy_settings,
    send_ntfy,
)

SETTINGS = NtfySettings(server="https://ntfy.example.internal", topic="ergates-alerts", token="secret-token",
                        connection_id="conn-1")


class SimulatedCrash(BaseException):
    """The process dies inside the ntfy call: nothing after it runs."""


class Publisher:
    """Records every publish; ``fail`` makes it raise, ``during`` runs inside the call."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.fail: BaseException | None = None
        self.during = None

    def __call__(self, spec: dict) -> None:
        self.sent.append(spec)
        hook, self.during = self.during, None
        if hook is not None:
            hook()
        if self.fail is not None:
            raise self.fail


@pytest.fixture
def attention(store, clock):
    return AttentionService(store, clock=clock)


@pytest.fixture
def publisher():
    return Publisher()


@pytest.fixture
def worker(store, publisher, clock):
    return DeliveryWorker(store, publisher, SETTINGS, clock=clock, owner="worker-a")


def _approval(attention, **overrides):
    values = dict(session_key="session-1", pattern_key="rm_recursive", command="rm -rf /tmp/x",
                  surface="gateway", profile="thijs")
    values.update(overrides)
    return attention.approval_requested(**values)


def _outbox(store, event_id):
    return next(row for row in rows(store, "attention_outbox") if row["event_id"] == event_id)


def _event(store, event_id):
    return next(row for row in rows(store, "attention_events") if row["id"] == event_id)


# --- the request ------------------------------------------------------------


def test_deep_link_has_the_c5_shape_with_encoded_values():
    assert deep_link("session-1", "conn-1", "thijs") == "ergates://chat/session-1?connection=conn-1&profile=thijs"
    link = deep_link("sess/with slash", "conn with space", "name&with=chars")
    assert link.startswith("ergates://chat/sess%2Fwith%20slash?")
    assert "connection=conn+with+space" in link
    assert "profile=name%26with%3Dchars" in link


def test_build_ntfy_publish_targets_the_topic_with_title_click_tags_and_priority():
    spec = build_ntfy_publish("https://ntfy.example.internal/", "ergates-alerts", "",
                              title=APPROVAL_TITLE, click_url="ergates://chat/s1", event_id="evt-1")

    assert spec["url"] == "https://ntfy.example.internal/ergates-alerts"
    assert spec["headers"] == {"Title": APPROVAL_TITLE, "Click": "ergates://chat/s1", "X-Tags": "hermes-agent",
                               "Priority": "default"}
    assert spec["body"] == GENERIC_BODY == "You have a new request"
    assert spec["event_id"] == "evt-1"


def test_the_body_stays_generic_even_when_a_caller_misuses_the_title():
    spec = build_ntfy_publish("https://x", "t", "", title="Wire EUR 10,000 to NL00BANK0123456789",
                              click_url="ergates://chat/s1", event_id="evt-1")

    assert spec["body"] == "You have a new request"


@pytest.mark.parametrize("token, expected", [("tok", "Bearer tok"), ("user:pass", "Basic dXNlcjpwYXNz")])
def test_build_ntfy_publish_sets_bearer_or_basic_authorization(token, expected):
    spec = build_ntfy_publish("https://x", "t", token, title="t", click_url="c", event_id="e")

    assert spec["headers"]["Authorization"] == expected


def test_ntfy_settings_need_a_server_and_a_topic():
    assert ntfy_settings({"server": " https://x ", "topic": "t", "token": 7}) == NtfySettings("https://x", "t", "", "")
    assert ntfy_settings({"server": "https://x"}) is None
    assert ntfy_settings({}) is None


def test_send_ntfy_posts_the_spec_with_a_short_timeout(monkeypatch):
    seen = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return b"{}"

    def fake_urlopen(request, timeout):
        seen.update(url=request.full_url, method=request.get_method(), body=request.data,
                    title=request.get_header("Title"), timeout=timeout)
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    send_ntfy(build_ntfy_publish("https://x", "t", "", title="T", click_url="c", event_id="e"))

    assert seen == {"url": "https://x/t", "method": "POST", "body": b"You have a new request", "title": "T",
                    "timeout": 3.0}


def test_backoff_is_30_120_600_then_600():
    assert [backoff_seconds(attempt) for attempt in (1, 2, 3, 4)] == [30, 120, 600, 600]
    assert MAX_ATTEMPTS == 5


# --- delivering -------------------------------------------------------------


def test_deliver_sends_an_approval_with_its_own_routing(attention, worker, publisher, store):
    event_id = _approval(attention)

    assert worker.deliver(event_id) is True

    spec = publisher.sent[0]
    assert spec["headers"]["Title"] == APPROVAL_TITLE
    assert spec["headers"]["Click"] == "ergates://chat/session-1?connection=conn-1&profile=thijs"
    assert spec["headers"]["Authorization"] == "Bearer secret-token"
    outbox = _outbox(store, event_id)
    assert (outbox["state"], outbox["attempts"], outbox["lease_owner"]) == ("sent", 1, None)


def test_a_completion_push_uses_the_routine_title(attention, worker, publisher):
    event_id = attention.turn_completed(session_id="cron-1", profile="thijs", platform="cron",
                                        platforms=frozenset({"cron"}))

    worker.deliver(event_id)

    assert publisher.sent[0]["headers"]["Title"] == COMPLETION_TITLE


def test_deliver_returns_false_when_nothing_is_due(attention, worker, publisher, store):
    assert worker.deliver("no-such-event") is False
    event_id = _approval(attention)
    worker.deliver(event_id)

    assert worker.deliver(event_id) is False
    assert len(publisher.sent) == 1


def test_a_failed_attempt_is_rescheduled_and_logs_only_the_error_class(attention, worker, publisher, store,
                                                                       clock, caplog):
    event_id = _approval(attention)
    publisher.fail = ConnectionError("401 for token secret-token")

    with caplog.at_level(logging.INFO, logger="ergates.delivery"):
        assert worker.deliver(event_id) is False

    outbox = _outbox(store, event_id)
    assert (outbox["state"], outbox["attempts"], outbox["next_attempt_at"]) == ("due", 1, clock() + 30)
    assert outbox["last_error"] == "ConnectionError"
    assert "secret-token" not in caplog.text
    assert _event(store, event_id)["state"] == "pending"


def test_retries_back_off_then_give_up_after_five_attempts(attention, worker, publisher, store, clock):
    event_id = _approval(attention)
    publisher.fail = ConnectionError("down")
    delays = []
    for _ in range(MAX_ATTEMPTS):
        assert worker.run_due() == 1
        outbox = _outbox(store, event_id)
        if outbox["state"] == "due":
            delays.append(outbox["next_attempt_at"] - clock())
            clock.now = outbox["next_attempt_at"]

    assert delays == [30, 120, 600, 600]
    assert (outbox["state"], outbox["attempts"]) == ("gave_up", MAX_ATTEMPTS)
    assert worker.run_due() == 0


def test_run_due_respects_its_limit(attention, worker, publisher):
    for index in range(4):
        _approval(attention, command=f"cmd-{index}")

    assert worker.run_due(limit=3) == 3
    assert worker.run_due() == 1
    assert worker.run_due() == 0
    assert len(publisher.sent) == 4


def test_a_push_scheduled_for_later_waits_until_it_is_due(attention, worker, publisher, store, clock):
    """What quiet hours do to a completion push: next_attempt_at is in the future."""
    event_id = attention.turn_completed(session_id="s", profile="thijs", platform="cron",
                                        platforms=frozenset({"cron"}))
    with store.transaction() as conn:
        conn.execute("UPDATE attention_outbox SET next_attempt_at = ?", (clock() + 3600,))

    assert worker.run_due() == 0
    clock.advance(3600)
    assert worker.run_due() == 1
    assert publisher.sent[0]["event_id"] == event_id


def test_bug4_a_push_enqueued_before_a_crash_is_sent_by_the_next_flush(attention, store, clock):
    """Roadmap bug 4: the server dies after it enqueued the push but before
    ntfy answered. The lease the dead worker took runs out, and
    the next flush sends the push."""
    event_id = _approval(attention)
    dying = Publisher()
    dying.fail = SimulatedCrash()
    with pytest.raises(SimulatedCrash):
        DeliveryWorker(store, dying, SETTINGS, clock=clock, owner="dead-worker").deliver(event_id)

    next_flush = Publisher()
    flush_worker = DeliveryWorker(store, next_flush, SETTINGS, clock=clock, owner="flush")
    assert flush_worker.run_due() == 0            # the dead worker's lease still holds
    clock.advance(LEASE_SECONDS + 1)
    assert flush_worker.run_due() == 1

    assert [spec["event_id"] for spec in next_flush.sent] == [event_id]
    assert _outbox(store, event_id)["state"] == "sent"


def test_an_approval_that_expired_while_the_server_was_down_is_never_pushed(attention, store, clock):
    """Even before the expiry sweep runs, an approval that timed out is not pushed."""
    event_id = _approval(attention)
    dying = Publisher()
    dying.fail = SimulatedCrash()
    with pytest.raises(SimulatedCrash):
        DeliveryWorker(store, dying, SETTINGS, clock=clock, owner="dead-worker").deliver(event_id)

    clock.advance(APPROVAL_TTL_SECONDS)
    next_flush = Publisher()
    assert DeliveryWorker(store, next_flush, SETTINGS, clock=clock, owner="flush").run_due() == 0

    assert next_flush.sent == []
    assert _outbox(store, event_id)["state"] == "cancelled"
    assert _event(store, event_id)["state"] == "pending"   # expiry is the sweep's job, not delivery's


def test_an_answered_approval_is_never_pushed(attention, worker, publisher, store):
    event_id = _approval(attention)
    attention.approval_resolved(session_key="session-1", pattern_key="rm_recursive", command="rm -rf /tmp/x",
                                surface="gateway", choice="once")

    assert worker.deliver(event_id) is False
    assert publisher.sent == []


def test_bug5_giving_up_never_changes_the_event_state(attention, worker, publisher, store, clock):
    """Roadmap bug 5: the give-up branch wrote state "failed" onto the event."""
    event_id = _approval(attention)
    publisher.fail = ConnectionError("down")
    for _ in range(MAX_ATTEMPTS):
        worker.run_due()
        clock.now = _outbox(store, event_id)["next_attempt_at"]

    assert _outbox(store, event_id)["state"] == "gave_up"
    assert _event(store, event_id)["state"] == "pending"


def test_bug5_an_answer_during_the_last_failing_attempt_is_never_overwritten(attention, worker, publisher,
                                                                            store, clock):
    """Roadmap bug 5: the operator answered while the fifth push failed, and the
    give-up overwrote "resolved" with "failed". Delivery now writes only the
    outbox row, and only while it still holds the lease on a due row."""
    event_id = _approval(attention)
    publisher.fail = ConnectionError("down")
    for _ in range(MAX_ATTEMPTS - 1):
        worker.run_due()
        clock.now = _outbox(store, event_id)["next_attempt_at"]
    publisher.during = lambda: attention.approval_resolved(
        session_key="session-1", pattern_key="rm_recursive", command="rm -rf /tmp/x", surface="gateway",
        choice="once")

    worker.run_due()

    assert _event(store, event_id)["state"] == "resolved"
    assert _outbox(store, event_id)["state"] == "cancelled"


def test_two_workers_racing_publish_each_row_once(attention, store, clock):
    for index in range(10):
        _approval(attention, command=f"cmd-{index}")
    publisher = Publisher()
    barrier = threading.Barrier(2)

    def run(owner):
        barrier.wait()
        DeliveryWorker(store, publisher, SETTINGS, clock=clock, owner=owner).run_due()

    threads = [threading.Thread(target=run, args=(owner,)) for owner in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(spec["event_id"] for spec in publisher.sent) == sorted(
        row["event_id"] for row in rows(store, "attention_outbox"))
    assert len(publisher.sent) == 10

