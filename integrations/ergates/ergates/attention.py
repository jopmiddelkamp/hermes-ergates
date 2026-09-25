"""Attention events and their push outbox: the server half of docs/11 section 4.2.

An attention event is one row in ``attention_events``: an ``approval`` that
waits for the operator, or a ``completion`` -- a finished routine turn
(roadmap decision D9). Every event that should reach the phone gets its
``attention_outbox`` row in the same transaction, so a process that dies
right after recording the event still leaves the push for
:class:`~ergates.delivery.DeliveryWorker` (roadmap bug 4). Delivery
bookkeeping -- attempts, backoff, give-up -- lives on the outbox row only; an
event's ``state`` changes only through resolution or expiry (roadmap bug 5).
A completion has nothing to answer, so it is recorded ``resolved`` at once
and ages out on the seven-day rule.

The store holds identifiers and hashes, never the command, its description
or a prompt. Approvals correlate on ``sha256([session_key, pattern_key,
command_hash(command), surface])``, because the approval hooks carry no
approval id at the pin; a ``request_id``, when Hermes supplies one, wins.

Preferences (``attention_prefs``) are per profile, with ``"*"`` as the
default row. A muted profile gets its events but no outbox rows. Quiet hours
(``HH:MM`` in server local time; the window may wrap midnight) hold a
completion push until the window ends. Approval pushes ignore quiet hours:
the approval would time out first.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from .store import ControlStore

logger = logging.getLogger(__name__)

# The shipped profiles set approvals.timeout: 1800; an approval still pending
# after that has timed out in Hermes and can no longer be answered.
APPROVAL_TTL_SECONDS = 1800
RETENTION_SECONDS = 7 * 86400
DEFAULT_PREFS_PROFILE = "*"
SMART_SURFACE = "smart"

APPROVAL = "approval"
COMPLETION = "completion"
PENDING = "pending"
RESOLVED = "resolved"
EXPIRED = "expired"

_PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")  # Hermes profile ids at the pin
_CLOCK_RE = re.compile(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
_NO_PREFS = {"muted": False, "quiet_start": None, "quiet_end": None}


class AttentionError(ValueError):
    """Invalid attention input: C3 ``invalid`` (HTTP 400)."""

    code = "invalid"
    http_status = 400


def command_hash(command: Optional[str]) -> Optional[str]:
    """sha256 hex digest of ``command``, or ``None`` when there is nothing to hash."""
    if not command:
        return None
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def duplicate_hook_call(surface: Optional[str], coalesced: Any) -> bool:
    """True when an approval hook call is not a new user-visible prompt.

    Hermes fires the approval hooks more than once per decision (verified at
    the pin):

    - ``coalesced=True``: a follower waiting on an identical pending approval
      (``tools/approval_gateway_wait.py``'s ``_await_coalesced_leader``). The
      leader already recorded and pushed; a follower that adopts ``once``
      fires no post hook, so an event for it would never resolve.
    - ``surface == "smart"``: the guardian pre-check in
      ``tools/approval_smart.py``, which is not a request for the operator's
      attention at all.

    ``coalesced`` is read for truthiness: any truthy value means "not the leader".
    """
    return bool(coalesced) or surface == SMART_SURFACE


def correlation(
    session_key: Optional[str], pattern_key: Optional[str], command: Optional[str], surface: Optional[str],
) -> str:
    """The approval correlation hash: one value per (session, pattern, command, surface)."""
    canonical = json.dumps([session_key, pattern_key, command_hash(command), surface], separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _minutes(clock: str) -> int:
    hours, minutes = clock.split(":")
    return int(hours) * 60 + int(minutes)


def quiet_until(now: float, quiet_start: Optional[str], quiet_end: Optional[str]) -> Optional[float]:
    """The end of the quiet window that contains ``now`` (server local time), or ``None`` outside it."""
    if not quiet_start or not quiet_end or quiet_start == quiet_end:
        return None
    local = datetime.fromtimestamp(now)
    minute = local.hour * 60 + local.minute
    start, end = _minutes(quiet_start), _minutes(quiet_end)
    inside = start <= minute < end if start < end else (minute >= start or minute < end)
    if not inside:
        return None
    window_end = local.replace(hour=end // 60, minute=end % 60, second=0, microsecond=0)
    if window_end <= local:
        window_end += timedelta(days=1)
    return window_end.timestamp()


def _check_profile(profile: Any) -> None:
    if profile != DEFAULT_PREFS_PROFILE and not (isinstance(profile, str) and _PROFILE_RE.match(profile)):
        raise AttentionError("profile must be '*' or a Hermes profile name")


class AttentionService:
    """Records attention events with their outbox rows, resolves and expires them, and applies retention."""

    def __init__(
        self, store: ControlStore, *, clock: Callable[[], float] = time.time,
        approval_ttl_seconds: int = APPROVAL_TTL_SECONDS,
    ) -> None:
        self._store = store
        self._clock = clock
        self._ttl = approval_ttl_seconds

    def approval_requested(
        self, *, session_key: str | None, pattern_key: str | None, command: str | None,
        surface: str | None, coalesced: object = None, profile: str | None, request_id: str | None = None,
    ) -> str | None:
        """Record a pending approval and, unless the profile is muted, its push.

        Returns the event id, or ``None`` (nothing written) for a duplicate hook call.
        """
        if duplicate_hook_call(surface, coalesced):
            return None
        now = self._clock()
        event_id = str(uuid.uuid4())
        with self._store.transaction() as conn:
            conn.execute(
                "INSERT INTO attention_events (id, kind, state, profile, session_id, surface, correlation, "
                "request_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (event_id, APPROVAL, PENDING, profile, session_key, surface,
                 correlation(session_key, pattern_key, command, surface), request_id, now, now + self._ttl),
            )
            if not self._prefs(conn, profile)["muted"]:
                self._enqueue(conn, event_id, now, now)
        return event_id

    def approval_resolved(
        self, *, session_key: str | None, pattern_key: str | None, command: str | None,
        surface: str | None, coalesced: object = None, choice: str | None, request_id: str | None = None,
    ) -> str | None:
        """Resolve the oldest matching pending approval and cancel its due push.

        Matches on ``request_id`` when one is given, else on the correlation
        hash. Returns the event id, or ``None`` when nothing matches: a
        resolved or expired event is never touched again.
        """
        if duplicate_hook_call(surface, coalesced):
            return None
        now = self._clock()
        if request_id is not None:
            where, value = "request_id = ?", request_id
        else:
            where, value = "correlation = ?", correlation(session_key, pattern_key, command, surface)
        with self._store.transaction() as conn:
            match = conn.execute(
                f"SELECT id FROM attention_events WHERE kind = ? AND state = ? AND {where} "
                "ORDER BY created_at, rowid LIMIT 1",
                (APPROVAL, PENDING, value),
            ).fetchone()
            if match is None:
                logger.info("attention: no pending approval matches this response (surface=%r)", surface)
                return None
            conn.execute(
                "UPDATE attention_events SET state = ?, resolved_at = ?, choice = ? WHERE id = ?",
                (RESOLVED, now, choice, match["id"]),
            )
            self._cancel_due(conn, match["id"], now)
        return match["id"]

    def turn_completed(
        self, *, session_id: str, profile: str | None, platform: str | None, platforms: frozenset[str],
    ) -> str | None:
        """Record a finished turn from one of ``platforms`` and its push. ``None`` for any other platform.

        Quiet hours hold the push until they end; a muted profile gets no push.
        """
        if platform not in platforms:
            return None
        now = self._clock()
        event_id = str(uuid.uuid4())
        with self._store.transaction() as conn:
            conn.execute(
                "INSERT INTO attention_events (id, kind, state, profile, session_id, surface, created_at, "
                "resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (event_id, COMPLETION, RESOLVED, profile, session_id, platform, now, now),
            )
            prefs = self._prefs(conn, profile)
            if not prefs["muted"]:
                due = quiet_until(now, prefs["quiet_start"], prefs["quiet_end"]) or now
                self._enqueue(conn, event_id, due, now)
        return event_id

    def get_prefs(self, profile: str) -> dict:
        """The effective ``AttentionPrefs`` (C3): the profile's row, else the ``"*"`` row, else defaults."""
        _check_profile(profile)
        with self._store.read() as conn:
            return {"profile": profile, **self._prefs(conn, profile)}

    def set_prefs(self, profile: str, *, muted: bool, quiet_start: str | None, quiet_end: str | None) -> dict:
        """Store the preferences of ``profile`` (``"*"`` for the default) and return them."""
        _check_profile(profile)
        if not isinstance(muted, bool):
            raise AttentionError("muted must be true or false")
        if (quiet_start is None) != (quiet_end is None):
            raise AttentionError("set both quiet_start and quiet_end, or neither")
        for value in (quiet_start, quiet_end):
            if value is not None and not (isinstance(value, str) and _CLOCK_RE.match(value)):
                raise AttentionError("quiet hours use HH:MM from 00:00 to 23:59")
        if quiet_start is not None and quiet_start == quiet_end:
            raise AttentionError("quiet_start and quiet_end must differ")
        with self._store.transaction() as conn:
            conn.execute(
                "INSERT INTO attention_prefs (profile, muted, quiet_start, quiet_end, updated_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT (profile) DO UPDATE SET muted = excluded.muted, "
                "quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = excluded.updated_at",
                (profile, int(muted), quiet_start, quiet_end, self._clock()),
            )
        return {"profile": profile, "muted": muted, "quiet_start": quiet_start, "quiet_end": quiet_end}

    def expire(self, now: float) -> int:
        """Expire pending approvals past their timeout and cancel their pushes. Returns how many.

        ``resolved_at`` is the moment the approval stopped being answerable,
        so a sweep that runs late still ages it out from its real expiry.
        """
        with self._store.transaction() as conn:
            stale = conn.execute(
                "SELECT id, expires_at FROM attention_events WHERE kind = ? AND state = ? AND expires_at <= ?",
                (APPROVAL, PENDING, now),
            ).fetchall()
            for event in stale:
                conn.execute(
                    "UPDATE attention_events SET state = ?, resolved_at = ? WHERE id = ?",
                    (EXPIRED, event["expires_at"], event["id"]),
                )
                self._cancel_due(conn, event["id"], now)
        return len(stale)

    def prune(self, now: float) -> int:
        """Delete events terminal for more than seven days; their outbox rows go with them."""
        with self._store.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM attention_events WHERE state != ? AND resolved_at < ?",
                (PENDING, now - RETENTION_SECONDS),
            )
        return cursor.rowcount

    @staticmethod
    def _prefs(conn: sqlite3.Connection, profile: str | None) -> dict:
        found = {
            row["profile"]: row
            for row in conn.execute(
                "SELECT profile, muted, quiet_start, quiet_end FROM attention_prefs WHERE profile IN (?, ?)",
                (profile or DEFAULT_PREFS_PROFILE, DEFAULT_PREFS_PROFILE),
            )
        }
        row = found.get(profile) or found.get(DEFAULT_PREFS_PROFILE)
        if row is None:
            return dict(_NO_PREFS)
        return {"muted": bool(row["muted"]), "quiet_start": row["quiet_start"], "quiet_end": row["quiet_end"]}

    @staticmethod
    def _enqueue(conn: sqlite3.Connection, event_id: str, due: float, now: float) -> None:
        conn.execute(
            "INSERT INTO attention_outbox (event_id, state, attempts, next_attempt_at, updated_at) "
            "VALUES (?, 'due', 0, ?, ?)",
            (event_id, due, now),
        )

    @staticmethod
    def _cancel_due(conn: sqlite3.Connection, event_id: str, now: float) -> None:
        conn.execute(
            "UPDATE attention_outbox SET state = 'cancelled', lease_owner = NULL, lease_until = NULL, "
            "updated_at = ? WHERE event_id = ? AND state = 'due'",
            (now, event_id),
        )
