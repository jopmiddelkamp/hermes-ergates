"""Background attention/push: ntfy publish requests, the mobile deep link, and retention.

Implements docs/11-implementation-readiness.md section 4.2. The stock Hermes
ntfy adapter (``plugins/platforms/ntfy/adapter.py`` at the pinned checkout)
posts plain-text bodies with ``Authorization``, ``Content-Type`` and
``X-Tags: hermes-agent`` headers, but never sets a ``Click`` header.
``build_ntfy_publish`` is this package's addition: it builds the full
publish request -- server URL, headers (including ``Title``, ``Click``,
``Priority`` and ``X-Tags``) and a fixed, generic body -- without ever
sending it, so callers can unit-test the request shape and inject their own
transport (mirroring ``ReminderCreator``'s ``create_job`` pattern).

The body is a constant string on purpose: notifications carry a generic
preview and identifiers, never the prompt, a command, or an approval
decision (04 section 6-7; 11 section 4.2). ``event_id`` is accepted for the
caller's own bookkeeping (e.g. to correlate a publish attempt with an
``AttentionJournal`` record) -- ntfy's publish API has no client-settable
message-id header, so it is deliberately not encoded into the HTTP request
itself.

The notification record itself is equally restricted: 11 section 4.2 defines
it as event id, owning profile/session, approval id, event state, attempts,
next retry and delivery result -- never the command or its description.
``command_hash`` (a sha256 digest, never the command text) lets
``tool.on_approval_response`` correlate a response back to the right pending
event without the journal ever holding the command itself.
"""

from __future__ import annotations

import base64
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .journal import Journal

SECONDS_PER_DAY = 86400
RETENTION_SECONDS = 7 * SECONDS_PER_DAY

_GENERIC_BODY = "You have a new request"
_ECHO_TAG = "hermes-agent"

_PENDING = "pending"
_RESOLVED = "resolved"
_FAILED = "failed"
_EXPIRED = "expired"

# Backoff between ntfy publish retries: 30s, then 2min, then 10min, then hold
# at 10min for any further attempt before giving up (11 section 4.2's "at
# least once" push is best-effort, not unbounded).
RETRY_BACKOFF_SECONDS: Tuple[int, ...] = (30, 120, 600)
MAX_PUBLISH_ATTEMPTS = 5

# How long a pending attention event can be worth notifying about. The shipped
# profiles set ``approvals.timeout: 1800`` (deploy/profiles/*/config.yaml), so
# an approval still pending past that has expired in Hermes and must never be
# re-published: 11 section 4.2 is explicit -- "Never retry an expired approval
# notification". Records that stay pending past this age are also the ones a
# crashed process leaves behind (a pre hook journaled, the post hook never
# fired), so this age cap is what makes them collectable at all.
PENDING_MAX_AGE_SECONDS = 1800


def command_hash(command: Optional[str]) -> Optional[str]:
    """sha256 hex digest of ``command``, or ``None`` when there is nothing to hash.

    A hash is not the command: this is what ``AttentionJournal`` records and
    what ``on_approval_response`` correlates on, so the journal never has to
    store the command text itself to tell two pending approvals apart.
    """
    if not command:
        return None
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def pending_expired(record: Dict[str, Any], now: float) -> bool:
    """True when a still-pending record is older than :data:`PENDING_MAX_AGE_SECONDS`.

    A record without a ``created_at`` is never treated as expired -- its age
    is unknowable, and guessing would delete live events.
    """
    created_at = record.get("created_at")
    if created_at is None:
        return False
    try:
        return (now - float(created_at)) > PENDING_MAX_AGE_SECONDS
    except (TypeError, ValueError):  # pragma: no cover - defensive against a hand-edited record
        return False


def deep_link(session_id: str, connection_id: str, profile: str) -> str:
    """``ergates://chat/<session>?connection=<id>&profile=<name>``, values url-encoded.

    Opening this link only ever leads to connection selection for an unknown
    ``connection_id`` -- it is never treated as automatic trust of a
    supplied URL (11 section 4.2).
    """
    path = urllib.parse.quote(str(session_id), safe="")
    query = urllib.parse.urlencode({"connection": connection_id, "profile": profile})
    return f"ergates://chat/{path}?{query}"


def _authorization_header(token: str) -> Dict[str, str]:
    token = (token or "").strip()
    if not token:
        return {}
    if ":" in token:
        encoded = base64.b64encode(token.encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {encoded}"}
    return {"Authorization": f"Bearer {token}"}


def build_ntfy_publish(
    server: str,
    topic: str,
    token: str,
    *,
    title: str,
    click_url: str,
    event_id: str,
) -> Dict[str, Any]:
    """Build (never send) an ntfy publish request for one attention event.

    Returns ``{"url", "headers", "body", "event_id"}``. ``headers`` holds
    ``Authorization`` (only when ``token`` is set), ``Title``, ``Click``,
    ``X-Tags`` and ``Priority``. ``body`` is always the fixed generic string
    below, regardless of input -- it can never carry a prompt, a command, or
    an approval decision.
    """
    url = f"{server.rstrip('/')}/{topic}"
    headers: Dict[str, str] = {}
    headers.update(_authorization_header(token))
    headers["Title"] = title
    headers["Click"] = click_url
    headers["X-Tags"] = _ECHO_TAG
    headers["Priority"] = "default"
    return {
        "url": url,
        "headers": headers,
        "body": _GENERIC_BODY,
        "event_id": event_id,
    }


class AttentionJournal(Journal):
    """Durable, non-secret attention/notification records under ``ergates/notifications/``.

    A record holds exactly: event id (the journal id), owning
    profile/session (``session_key``, ``profile``), ``pattern_key`` and
    ``command_hash`` (approval-id-shaped correlation, never the command
    text), ``connection_id`` (a non-secret app-connection routing
    identifier, captured once so a later retry addresses the same app
    connection the original push did), ``state`` (``"pending"`` /
    ``"resolved"`` / ``"failed"`` / ``"expired"``), ``attempts``, ``next_retry`` and
    ``delivery`` and ``surface`` -- matching 11 section 4.2 exactly
    (``connection_id`` and ``surface`` are routing metadata the app already
    handles, never the command or its description).

    Retention (11 section 4.2: "Retain pending events until resolved or
    expired; retain resolved delivery metadata for seven days"):

    - A pending event older than :data:`PENDING_MAX_AGE_SECONDS` is
      *transitioned*, not deleted: :meth:`expire_pending` stamps
      ``state="expired"`` and a ``resolved_at`` of the moment the approval
      actually timed out, leaving ``attempts``/``delivery`` untouched as the
      record of what delivery managed. It then ages out on the same
      seven-day rule as every other terminal event, so an approval nobody
      answered leaves an audit trail instead of vanishing.
      :meth:`retry_due` never returns one, expired-but-not-yet-swept
      included.
    - Terminal events -- resolved, expired, or given up on after
      :data:`MAX_PUBLISH_ATTEMPTS` delivery attempts -- are pruned seven
      days after they stopped being pending, tracked in ``resolved_at``. All
      three branches stamp ``resolved_at``, so "gave up" is genuinely
      collectable rather than immortal.

    The expiry sweep is a backstop, not the normal path: a gateway approval
    that times out fires ``post_approval_response`` with ``choice="timeout"``
    (``tools/approval_gateway_wait.py``'s ``_finish``), which resolves the
    record properly. This catches the cases where no post hook arrives at
    all -- a process that died between the two hooks.
    """

    def __init__(self, root):
        super().__init__(root, "notifications")

    def expire_pending(self, now: float) -> int:
        """Turn stale pending records terminal. Returns how many were expired.

        A pending record older than :data:`PENDING_MAX_AGE_SECONDS` points
        at an approval that has timed out in Hermes: it can no longer be
        answered, and 11 section 4.2 forbids re-notifying it. Rather than
        delete it, this stamps ``state="expired"`` and a ``resolved_at`` of
        the moment it stopped being answerable (``created_at`` plus the max
        age -- not "now", so a record the sweep only notices days later
        still ages out from its real expiry), clears any scheduled
        ``next_retry``, and leaves ``attempts`` and ``delivery`` exactly as
        delivery left them. :meth:`prune` then applies the ordinary
        seven-day terminal rule to it.
        """
        expired = 0
        with self._lock():
            for path in sorted(self._record_paths()):
                record = self._try_read(path)
                if record is None or record.get("state") != _PENDING:
                    continue
                if not pending_expired(record, now):
                    continue
                record["state"] = _EXPIRED
                record["resolved_at"] = float(record["created_at"]) + PENDING_MAX_AGE_SECONDS
                record["next_retry"] = None
                self._write_atomic(path, record)
                expired += 1
        return expired

    def prune(self, now: float) -> int:
        """Delete records whose retention window has passed. Returns how many were removed.

        Runs :meth:`expire_pending` first, so a stale pending record becomes
        terminal and is then subject to the single retention rule from 11
        section 4.2: a ``state`` other than ``"pending"`` and a
        ``resolved_at`` older than :data:`RETENTION_SECONDS`. A record that
        expired more than seven days ago is therefore transitioned and
        removed in the same call.

        A pending record with no ``created_at``, or a terminal one with no
        ``resolved_at``, is kept: its age is unknowable and guessing would
        delete live events.
        """
        self.expire_pending(now)
        removed = 0
        with self._lock():
            for path in sorted(self._record_paths()):
                record = self._try_read(path)
                if record is None:
                    continue
                if record.get("state") == _PENDING:
                    continue
                resolved_at = record.get("resolved_at")
                if resolved_at is None:
                    continue
                if now - resolved_at > RETENTION_SECONDS:
                    path.unlink(missing_ok=True)
                    removed += 1
        return removed

    def retry_due(self, now: float) -> List[Dict[str, Any]]:
        """Pending, not-yet-expired records whose scheduled retry has arrived.

        An expired pending record (older than
        :data:`PENDING_MAX_AGE_SECONDS`) is deliberately *not* returned,
        however overdue its retry is: 11 section 4.2 forbids retrying an
        expired approval notification, and a push that lands after the
        approval timed out points the user at a request they can no longer
        answer. This holds whether or not :meth:`expire_pending` has already
        marked it, so a retry can never slip through between sweeps.
        """
        return [
            record
            for record in self.list()
            if record.get("state") == _PENDING
            and not pending_expired(record, now)
            and record.get("next_retry") is not None
            and record["next_retry"] <= now
        ]

    def record_publish_attempt(self, event_id: str, *, ok: bool, now: float) -> Dict[str, Any]:
        """Record the outcome of one ntfy publish attempt for ``event_id``.

        On success: clears any scheduled retry and marks ``delivery`` as
        ``"sent"`` -- the record's ``state`` is untouched, since a
        successfully delivered push does not by itself mean the approval was
        answered (that is ``on_approval_response``'s job).

        On failure: increments ``attempts`` and schedules the next retry per
        :data:`RETRY_BACKOFF_SECONDS`, or -- once ``attempts`` reaches
        :data:`MAX_PUBLISH_ATTEMPTS` -- gives up: clears ``next_retry``,
        sets ``state`` to ``"failed"`` and stamps ``resolved_at`` so the
        seven-day retention sweep can collect it. Giving up on *notifying* is not the
        same as the approval being resolved; ``on_approval_response`` still
        matches ``"failed"`` records (any state other than ``"resolved"``),
        since the user may still answer the approval through a channel this
        push never reached.

        Built on :meth:`~ergates.journal.Journal.modify`, so the read of the
        current ``attempts`` count and the write of the new one happen
        inside one lock acquisition. Two concurrent calls for the same
        ``event_id`` (e.g. two threads racing to record an attempt) can
        therefore never both read the same starting ``attempts`` value and
        stomp on each other's increment -- each one is guaranteed to observe
        the other's already-committed result.
        """
        def _apply(record: Dict[str, Any]) -> Dict[str, Any]:
            attempts = int(record.get("attempts") or 0) + 1
            record["attempts"] = attempts

            if ok:
                record["next_retry"] = None
                record["delivery"] = "sent"
                return record

            if attempts >= MAX_PUBLISH_ATTEMPTS:
                record["next_retry"] = None
                record["state"] = _FAILED
                record["delivery"] = "gave_up"
                # Stamp the moment it stopped being pending, or prune() can
                # never collect it: the seven-day rule keys off resolved_at,
                # and this branch is exactly the terminal state the class
                # docstring and 11 section 4.2 promise to retire.
                record["resolved_at"] = now
                return record

            delay = RETRY_BACKOFF_SECONDS[min(attempts - 1, len(RETRY_BACKOFF_SECONDS) - 1)]
            record["next_retry"] = now + delay
            record["delivery"] = "error"
            return record

        return self.modify(event_id, _apply)
