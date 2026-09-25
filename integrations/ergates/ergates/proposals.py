"""Agent proposal validation and canonical hashing.

Implements the ``ergates.agent-proposal.v1`` payload from
docs/11-implementation-readiness.md section 4.1. ``validate_proposal`` never
creates a profile or touches Hermes state -- it only validates model-supplied
arguments and returns a typed, self-contained proposal dict. Caller identity
and session context are backend-owned and are attached by the tool handler
(see ``tool.py``), never accepted here from model-supplied parameters.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from .journal import Journal

PROPOSAL_KIND = "ergates.agent-proposal.v1"

NAME_PATTERN_DESCRIPTION = "^[a-z0-9][a-z0-9-]{1,31}$"
_NAME_RE = re.compile(NAME_PATTERN_DESCRIPTION)

TITLE_MAX_LEN = 60
ROLE_MAX_LEN = 40
BRIEFING_MAX_LEN = 4000

PROPOSAL_EXPIRY = timedelta(hours=24)

# How long an unaccepted proposal receipt is kept past its own expiry before
# the retention sweep drops it (04 section 8: integration journals are covered
# by the retention policy, not kept forever). The grace window leaves room for
# the app to show "this proposal expired" after the fact instead of the record
# vanishing the same second it stops being acceptable.
PROPOSAL_RETENTION_GRACE = timedelta(hours=24)
PROPOSAL_RETENTION_GRACE_SECONDS = int(PROPOSAL_RETENTION_GRACE.total_seconds())

# Only a receipt still in this state is retention-collectable: once a proposal
# has been accepted, its receipt is the provisioning record 11 section 4.1
# requires for resume-by-receipt (completed steps, briefing delivery state) and
# is no longer an expiring offer.
PROPOSED_STATE = "proposed"

_REQUIRED_STRING_FIELDS = ("name", "title", "role", "template_id", "provider", "model", "briefing")


class ProposalError(ValueError):
    """Raised when proposal input fails validation. Never raised past the tool boundary."""


def _require_string(args: Dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ProposalError(f"{key!r} is required and must be a non-empty string")
    return value


def validate_proposal(args: Dict[str, Any]) -> Dict[str, Any]:
    """Validate model-supplied proposal arguments and return a typed proposal.

    Raises :class:`ProposalError` on any invalid input. Never creates a
    profile, never changes permissions, and never persists anything -- that
    is the tool handler's and the journal's job.
    """
    if not isinstance(args, dict):
        raise ProposalError("proposal arguments must be an object")

    for field in _REQUIRED_STRING_FIELDS:
        _require_string(args, field)

    name = args["name"]
    if not _NAME_RE.match(name):
        raise ProposalError(f"name must match {NAME_PATTERN_DESCRIPTION}")

    title = args["title"]
    if len(title) > TITLE_MAX_LEN:
        raise ProposalError(f"title must be at most {TITLE_MAX_LEN} characters")

    role = args["role"]
    if len(role) > ROLE_MAX_LEN:
        raise ProposalError(f"role must be at most {ROLE_MAX_LEN} characters")

    briefing = args["briefing"]
    if len(briefing) > BRIEFING_MAX_LEN:
        raise ProposalError(f"briefing must be at most {BRIEFING_MAX_LEN} characters")

    description = args.get("description", "")
    if not isinstance(description, str):
        raise ProposalError("description must be a string")

    template_id = args["template_id"]
    provider = args["provider"]
    model = args["model"]

    expires_at = (
        datetime.now(timezone.utc) + PROPOSAL_EXPIRY
    ).isoformat(timespec="seconds").replace("+00:00", "Z")

    return {
        "kind": PROPOSAL_KIND,
        "proposal_id": str(uuid.uuid4()),
        "expires_at": expires_at,
        "agent": {
            "name": name,
            "title": title,
            "role": role,
            "description": description,
            "template_id": template_id,
            "provider": provider,
            "model": model,
        },
        "briefing": briefing,
    }


def payload_hash(proposal: Dict[str, Any]) -> str:
    """Stable sha256 hex digest of ``proposal``'s canonical JSON (key order never matters)."""
    canonical = json.dumps(proposal, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_expires_at(value: Any) -> Optional[float]:
    """Epoch seconds for an ISO-8601 ``expires_at`` (``...Z`` included), or ``None``.

    Returns ``None`` for anything unparseable rather than raising, so one
    hand-edited record cannot stop a retention sweep.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


class ProposalJournal(Journal):
    """Proposal receipts under ``ergates/proposals/``, with expiry-based retention.

    A receipt holds exactly what 11 section 4.1 defines -- proposal hash,
    reserved profile name, completed steps, session id and briefing
    delivery state -- and never the ``briefing`` or ``description`` text
    itself. The hash is over the proposal exactly as returned to the caller,
    so the accept operation can verify the approved payload against it
    without the record ever carrying the content.
    """

    def __init__(self, root):
        super().__init__(root, "proposals")

    def prune(self, now: float) -> int:
        """Drop unaccepted receipts more than :data:`PROPOSAL_RETENTION_GRACE` past expiry.

        Only records still in :data:`PROPOSED_STATE` are eligible: an
        accepted receipt is a provisioning record, not an expiring offer. A
        record with an unparseable or missing ``expires_at`` is kept.
        Returns the number of records removed.
        """
        removed = 0
        with self._lock():
            for path in sorted(self._record_paths()):
                record = self._try_read(path)
                if record is None:
                    continue
                if record.get("state") != PROPOSED_STATE:
                    continue
                expires_at = parse_expires_at(record.get("expires_at"))
                if expires_at is None:
                    continue
                if now > expires_at + PROPOSAL_RETENTION_GRACE_SECONDS:
                    path.unlink(missing_ok=True)
                    removed += 1
        return removed
