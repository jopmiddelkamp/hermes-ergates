"""Idempotent reminder creation on top of Hermes cron.

Hermes remains the scheduler (docs/11-implementation-readiness.md section
4.3): this module never runs a timer itself. It serializes reminder creation
per (profile, schedule, timezone, prompt) through a
:class:`~ergates.journal.Journal` so that retries -- from the app, from an
agent, or from a disconnect-after-create -- are safe: the same request
returns the same receipt instead of creating a duplicate cron job, and a
request that reuses an id with a different payload is reported as a conflict
rather than silently overwriting a different reminder.

Both Hermes calls are injected callables rather than a hardcoded transport,
so this module stays usable against the cron REST surface, the
``cron.manage`` RPC, or a test double, and is fully unit-testable without a
running Hermes instance:

``create_job(body, *, profile) -> dict``
    ``body`` holds only real :class:`CronJobCreate` fields
    (``hermes_cli/web_models.py`` at the pin): ``schedule``, ``prompt``,
    ``name``. The owning **profile is passed out of band**, as the
    keyword-only ``profile`` argument, because cron scopes by profile
    outside the body -- ``?profile=`` on ``POST /api/cron/jobs``
    (``hermes_cli/web_routers/cron.py``, ``_cron_profile_home``) or the
    ``profile`` parameter of the ``cron.manage`` RPC
    (``tui_gateway/methods_tools.py``). An implementation that ignores
    ``profile`` writes into the wrong profile's cron store.

``get_job(job_id, *, profile) -> dict | None``
    Optional, but strongly recommended: without it a receipt can outlive
    the cron job it names. 11 section 4.3 keeps list/edit/**delete** on
    native cron, so the job can disappear behind this module's back; when
    the lookup says the job is gone, the receipt is dropped and the next
    request creates a fresh reminder instead of reporting success for a
    reminder that will never fire. ``None`` means "no such job"; raising
    means "could not tell", and the receipt is then kept. Mirrors
    ``cron.jobs.get_job`` / ``GET /api/cron/jobs/{job_id}?profile=`` at the
    pin.

**Timezone is advisory.** Hermes 0.21.2 has no per-job timezone:
``CronJobCreate``, ``cron.jobs.create_job`` and the ``cron.manage`` RPC all
accept none, and ``timezone`` is a single global config key
(``hermes_cli/config_defaults.py``; empty = server-local). So the timezone
is *not* sent to the scheduler -- it is kept in the idempotency key, so two
requests that differ only in zone stay two distinct requests instead of
collapsing into one, and echoed back on the receipt as
``timezone_advisory`` to make the gap explicit to the caller. A reminder
fires in the server's timezone until per-job timezone support exists
upstream.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from typing import Any, Callable, Dict, Optional

from .journal import Journal, JournalError, is_safe_id

logger = logging.getLogger(__name__)

_FIELD_SEPARATOR = "\x1f"  # ASCII unit separator: never appears in normal text input

SECONDS_PER_DAY = 86400

# A receipt that has not been used for this long is dropped by the retention
# sweep (04 section 8). Deliberately much longer than the proposal window:
# a reminder receipt stays relevant for as long as its cron job exists, and
# the job-existence check below is the primary collector -- this is the
# backstop for receipts whose job lookup is unavailable.
REMINDER_MAX_IDLE_SECONDS = 30 * SECONDS_PER_DAY

_CREATING = "creating"
_CREATED = "created"
_UNCERTAIN = "uncertain"
_CONFLICT = "conflict"


class ReminderCreationError(Exception):
    """Raised when a reminder request cannot be journaled at all.

    A bad ``request_id``, a receipt dropped underneath a concurrent
    creator, or a receipt that exists but cannot be read. The last case
    matters most: a damaged receipt must stop the request, never fall
    through to a second ``create_job`` -- "unreadable" is not "absent".
    """


def _normalize(value: str) -> str:
    """Collapse incidental whitespace so cosmetic differences don't change the key."""
    return re.sub(r"\s+", " ", str(value).strip())


def idempotency_key(profile: str, schedule: str, timezone: str, prompt: str) -> str:
    """Stable content hash for one (profile, schedule, timezone, prompt) reminder request.

    Two requests that normalize to the same profile/schedule/timezone/prompt
    always produce the same value, so a retry -- including one from a
    different process -- is recognized as the same request rather than
    creating a second cron job.

    ``timezone`` stays in the hash even though Hermes cannot schedule by it
    (see the module docstring): dropping it would collapse two reminders
    that the caller asked to fire at different wall-clock times into one
    receipt, which is a worse failure than the advisory gap.

    This is both the ``payload_hash`` stored on every receipt and the
    fallback journal id used when the caller supplies no ``request_id``.
    """
    parts = (
        _normalize(profile),
        _normalize(schedule),
        _normalize(timezone),
        _normalize(prompt),
    )
    canonical = _FIELD_SEPARATOR.join(parts)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def prompt_hash(prompt: str) -> str:
    """sha256 hex digest of the normalized prompt. The receipt stores this, never the prompt.

    11 section 4.3 defines the receipt as the idempotency key plus the
    normalized schedule/timezone/prompt **hash** and the resulting cron job
    id; 04 section 4/8 keeps user content out of integration journals. The
    prompt lives in Hermes's own cron store, which is its system of record.
    """
    return hashlib.sha256(_normalize(prompt).encode("utf-8")).hexdigest()


def routine_name(profile: str, label: Optional[str] = None, *, payload_hash: str = "") -> str:
    """``[bot:<profile>] <label>`` -- the display convention clients filter on.

    docs/06 section 6: routine names use the ``[bot:<profile>] `` prefix as a
    *display* convention (not a subscription or an idempotency key), and the
    gateway's own ``cron.manage`` list path documents the same
    ``[bot:<name>]`` client-side filter. ``name`` is a label in
    ``CronJobCreate``, not a profile field, so this is where the profile
    belongs in the body.

    The default label carries a short slice of the payload hash so two
    reminders for the same bot are distinguishable in a cron listing (and
    to ``resolve_job_ref``, which errors on an ambiguous name) without the
    name ever carrying prompt text.
    """
    suffix = label if label else f"reminder {payload_hash[:8]}".strip()
    return f"[bot:{_normalize(profile)}] {suffix}".rstrip()


class ReminderJournal(Journal):
    """Reminder receipts under ``ergates/reminders/``, with job-existence retention.

    A receipt holds the idempotency key (its own id), the owning profile,
    the normalized schedule, the advisory timezone, the payload and prompt
    **hashes**, the request id and the resulting cron job id -- never the
    prompt text.
    """

    def __init__(self, root):
        super().__init__(root, "reminders")

    def prune(
        self,
        now: float,
        get_job: Optional[Callable[..., Optional[Dict[str, Any]]]] = None,
    ) -> int:
        """Drop receipts whose cron job is gone, or that have been unused for 30 days.

        The job-existence rule is the real collector: once the reminder has
        been deleted in the Routines screen (native cron, per 11 section
        4.3), its receipt is worse than useless -- it makes the next
        identical request report success without creating anything. The
        30-day idle rule is the backstop for receipts whose job cannot be
        looked up (no ``get_job`` injected, or the lookup failed). Returns
        the number of records removed.
        """
        # Snapshot under the lock, look jobs up outside it (``get_job`` is a
        # network call in any real wiring and must not hold the directory
        # flock), then remove under the lock again.
        with self._lock():
            snapshot = [(path, self._try_read(path)) for path in sorted(self._record_paths())]
        doomed = []
        for path, record in snapshot:
            if record is None:
                continue
            if job_is_gone(record, get_job):
                doomed.append(path)
                continue
            last_used = record.get("last_seen_at") or record.get("created_at")
            if last_used is None:
                continue
            try:
                idle = now - float(last_used)
            except (TypeError, ValueError):  # pragma: no cover - hand-edited record
                continue
            if idle > REMINDER_MAX_IDLE_SECONDS:
                doomed.append(path)
        removed = 0
        with self._lock():
            for path in doomed:
                if path.exists():
                    path.unlink(missing_ok=True)
                    removed += 1
        return removed


def job_is_gone(
    record: Dict[str, Any],
    get_job: Optional[Callable[..., Optional[Dict[str, Any]]]],
) -> bool:
    """True only when ``get_job`` positively reports the receipt's cron job as absent.

    "Could not tell" (no lookup injected, no job id yet, or the lookup
    raised) is never "gone": deleting a receipt on a transport error would
    turn one unreachable cron API into a duplicate reminder.
    """
    if get_job is None:
        return False
    if record.get("state") != _CREATED:
        return False
    job_id = record.get("job_id")
    if not job_id:
        return False
    try:
        return get_job(job_id, profile=record.get("profile")) is None
    except Exception as exc:
        # Exception type only: an adapter may raise with a response body that
        # carries prompt text, and prompts never enter logs.
        logger.warning(
            "reminders: cron job lookup for %r failed (%s), keeping the receipt",
            job_id, type(exc).__name__,
        )
        return False


class ReminderCreator:
    """Creates Hermes cron reminders exactly once per idempotency key."""

    def __init__(
        self,
        journal: Journal,
        create_job: Callable[..., Dict[str, Any]],
        get_job: Optional[Callable[..., Optional[Dict[str, Any]]]] = None,
        *,
        now: Callable[[], float] = time.time,
    ):
        self._journal = journal
        self._create_job = create_job
        self._get_job = get_job
        self._now = now

    def create(
        self,
        profile: str,
        schedule: str,
        timezone: str,
        prompt: str,
        *,
        request_id: Optional[str] = None,
        label: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create (or return the existing receipt for) a reminder.

        ``request_id`` is the caller's own per-attempt id (the app's outbox
        id). When given it becomes the journal id, which is what makes 11
        section 4.3's "retries with a different payload must fail" real:
        the same id arriving with a different ``payload_hash`` is a caller
        bug (an edited prompt resent under the old id), and it comes back
        as ``state: "conflict"`` with **no** cron job created, instead of
        quietly creating a second reminder. With no ``request_id`` the
        journal id falls back to the payload hash itself, where a changed
        payload is simply a different id -- safe against duplicates, but
        unable to detect reuse, which is why callers that can supply an id
        should.

        - Same id, same payload, job still present: returns the existing
          receipt without calling ``create_job`` again.
        - Same id, same payload, job gone (checked through ``get_job``):
          drops the stale receipt and creates once, so deleting a reminder
          natively and asking for it again works.
        - Same id, different payload: ``state: "conflict"``, no job.
        - New id: claims the receipt, calls ``create_job`` once, and records
          the resulting job id. If ``create_job`` raises (e.g. the request
          was sent but the response never arrived), the receipt is marked
          ``"uncertain"`` before the exception propagates, so a caller can
          reconcile instead of blindly retrying.
        """
        content_hash = idempotency_key(profile, schedule, timezone, prompt)
        key = self._journal_id(request_id, content_hash)

        existing = self._read_receipt(key)
        if existing is not None:
            outcome = self._reuse_or_discard(key, existing, content_hash, request_id)
            if outcome is not None:
                return outcome

        now = self._now()
        claimed = self._journal.claim(key, {
            "profile": profile,
            "schedule": _normalize(schedule),
            "timezone_advisory": _normalize(timezone),
            "prompt_hash": prompt_hash(prompt),
            "payload_hash": content_hash,
            "request_id": request_id,
            "state": _CREATING,
            "job_id": None,
            "created_at": now,
            "last_seen_at": now,
        })
        if claimed is None:
            # Lost a race to another creator (thread or process) between the
            # read above and this claim; re-read and validate like a normal hit.
            existing = self._read_receipt(key)
            if existing is None:  # pragma: no cover - defensive; claim/read are locked together
                raise ReminderCreationError(f"idempotency key {key!r} vanished after claim race")
            outcome = self._reuse_or_discard(key, existing, content_hash, request_id)
            if outcome is not None:
                return outcome
            raise ReminderCreationError(
                f"receipt {key!r} was dropped as stale by a concurrent creator; retry"
            )

        try:
            job = self._create_job(
                {
                    # CronJobCreate fields only (hermes_cli/web_models.py at the
                    # pin). No `timezone` (unsupported upstream) and no
                    # `profile` (scoped out of band, below).
                    "schedule": schedule,
                    "prompt": prompt,
                    "name": routine_name(profile, label, payload_hash=content_hash),
                },
                profile=profile,
            )
        except Exception:
            try:
                self._journal.update(key, state=_UNCERTAIN)
            except JournalError:
                # Never mask the creator's own failure with a journal one.
                logger.warning("reminders: could not mark receipt %r uncertain", key)
            raise

        job_id = job.get("id") if isinstance(job, dict) else None
        return self._journal.update(key, state=_CREATED, job_id=job_id)

    def _update_receipt(self, key: str, **fields: Any) -> Dict[str, Any]:
        """``Journal.update`` with the same fail-closed contract as :meth:`_read_receipt`."""
        try:
            return self._journal.update(key, **fields)
        except JournalError as exc:
            raise ReminderCreationError(
                f"reminder receipt {key!r} exists but cannot be updated ({exc}); "
                "repair or remove the receipt, then retry"
            ) from exc

    def _read_receipt(self, key: str) -> Optional[Dict[str, Any]]:
        """The stored receipt, or ``None`` when there is none. Fails closed on a damaged one.

        ``Journal.read`` raises :class:`~ergates.journal.JournalError` for a
        record that exists but cannot be parsed. Swallowing that would be
        the exact duplicate-creation bug the receipt exists to prevent: the
        request would look new, ``claim`` would find the file in the way,
        and the reconciliation path would have nothing to reconcile. So it
        surfaces as a refusal the caller has to act on.
        """
        try:
            return self._journal.read(key)
        except JournalError as exc:
            raise ReminderCreationError(
                f"reminder receipt {key!r} exists but cannot be read ({exc}); "
                "no cron job was created -- repair or remove the receipt, then retry"
            ) from exc

    def _journal_id(self, request_id: Optional[str], content_hash: str) -> str:
        if request_id is None:
            return content_hash
        if not is_safe_id(request_id):
            raise ReminderCreationError(
                "request_id must be a single safe path segment "
                "(letters, digits, '.', '_', '-'; 128 characters or fewer)"
            )
        return request_id

    def _reuse_or_discard(
        self,
        key: str,
        existing: Dict[str, Any],
        content_hash: str,
        request_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """The receipt to return, or ``None`` when it was stale and has been dropped."""
        if existing.get("payload_hash") != content_hash:
            # Never overwrite and never create: the caller reused an id for a
            # different reminder, which 11 section 4.3 requires to fail.
            logger.warning("reminders: request id %r reused with a different payload", key)
            return {
                "id": key,
                "request_id": request_id,
                "state": _CONFLICT,
                "job_id": None,
                "payload_hash": content_hash,
                "recorded_payload_hash": existing.get("payload_hash"),
            }
        if job_is_gone(existing, self._get_job):
            logger.info(
                "reminders: receipt %r names cron job %r which no longer exists; "
                "dropping the receipt and creating a fresh reminder",
                key, existing.get("job_id"),
            )
            self._journal.delete(key)
            return None
        return self._update_receipt(key, last_seen_at=self._now())
