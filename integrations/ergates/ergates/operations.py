"""The Ergates HTTP operations of roadmap contract C3, free of any web framework.

``dashboard/api.py`` maps each route under ``/api/plugins/ergates`` onto one
method here and turns the returned :class:`Reply` into a JSON response. A
method never raises for a problem with the request: every answer is a
``Reply`` with the C3 status and body, so the router stays a thin shim and
the behavior is unit-tested without FastAPI.

Error body: ``{"error": {"code": "<code>", "message": "<safe text>"}}``. A
message names fields, states and profile names; it never carries prompt,
briefing or description text.

Hermes is reached only through the functions an ``Operations`` is given
(``hermes_adapter`` in production, fakes in the tests), so this module
imports no Hermes code (decision D5). Methods block: a store write can wait
up to the store's busy timeout, and a second identical reminder request
waits up to ``reminders.IN_FLIGHT_WAIT_SECONDS`` for the first. The router
runs them on a worker thread.
"""

from __future__ import annotations

import logging
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import __version__
from .attention import AttentionError, AttentionService
from .proposals import ProposalError, ProposalService
from .reminders import CronPort, ReminderError, ReminderService
from .store import ControlStore, StoreError
from .templates import load_template

logger = logging.getLogger(__name__)

LABEL_MAX_LEN = 64
PREFS_KEYS = ("profile", "muted", "quiet_start", "quiet_end")
_PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")  # Hermes profile ids at the pin
_REMINDER_STATUS = {"created": 201, "existing": 200, "uncertain": 202}
_REMINDER_ERROR_STATUS = {"invalid": 400, "unknown_profile": 404}
_NOT_AN_OBJECT = "the request body must be a JSON object"


@dataclass(frozen=True)
class Reply:
    """One HTTP answer: status code and JSON body."""

    status: int
    body: dict


def error_reply(status: int, code: str, message: str, **extra: Any) -> Reply:
    """The C3 error body, plus any ``extra`` top-level keys (a conflict carries its ``receipt``)."""
    return Reply(status, {"error": {"code": code, "message": message}, **extra})


def store_unavailable() -> Reply:
    """503 ``store_unavailable``: the control store cannot be opened or read."""
    return error_reply(503, "store_unavailable", "the Ergates control store is unavailable")


def reminder_problem(*, schedule: Any, timezone: Any, prompt: Any, label: Any) -> str | None:
    """Why a reminder request is refused before any Hermes call, or ``None``.

    Shared by ``POST /reminders`` and the ``ergates_create_reminder`` tool.
    ``timezone`` must be an IANA zone name (``Europe/Amsterdam``); ``label``
    is optional, at most 64 printable characters, and becomes part of the
    cron job's name, which the prompt never does.
    """
    for name, value in (("schedule", schedule), ("timezone", timezone), ("prompt", prompt)):
        if not isinstance(value, str) or not value.strip():
            return f"{name} is required and must be a non-empty string"
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return "timezone must be an IANA time zone name, for example Europe/Amsterdam"
    if label is not None and not (
        isinstance(label, str) and label.strip() and len(label) <= LABEL_MAX_LEN and label.isprintable()
    ):
        return f"label must be 1 to {LABEL_MAX_LEN} printable characters"
    return None


class Operations:
    """Every C3 route as a method that returns a :class:`Reply`."""

    def __init__(
        self, store: ControlStore, *, cron: CronPort,
        profile_exists: Callable[[str], bool], plugin_enabled: Callable[[str], bool],
        enable_plugin: Callable[[str], None], check_schedule: Callable[[str, str], None],
        templates: Path, clock: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._profile_exists = profile_exists
        self._plugin_enabled = plugin_enabled
        self._enable_plugin = enable_plugin
        self._check_schedule = check_schedule
        self._templates = Path(templates)
        self._reminders = ReminderService(store, cron, clock=clock)
        self._proposals = ProposalService(store, clock=clock)
        self._attention = AttentionService(store, clock=clock)

    # GET /health
    def health(self) -> Reply:
        try:
            schema_version = self._store.schema_version
        except (StoreError, sqlite3.Error, OSError) as exc:
            logger.warning("operations: the control store is unavailable (%s)", type(exc).__name__)
            return store_unavailable()
        return Reply(200, {"ok": True, "schema_version": schema_version, "plugin_version": __version__})

    # POST /reminders
    def create_reminder(self, body: Any) -> Reply:
        try:
            request = self._reminder_request(body)
            outcome = self._reminders.create(**request)
        except ReminderError as exc:
            return error_reply(_REMINDER_ERROR_STATUS[exc.code], exc.code, str(exc))
        if outcome.status == "conflict":
            return error_reply(
                409, "conflict", "this request_id was already used for a different reminder",
                receipt=outcome.receipt,
            )
        return Reply(_REMINDER_STATUS[outcome.status], {"receipt": outcome.receipt})

    # GET /proposals/{proposal_id}
    def get_proposal(self, proposal_id: str) -> Reply:
        return self._proposal_reply(lambda: self._proposals.get(proposal_id))

    # POST /proposals/{proposal_id}/accept
    def accept_proposal(self, proposal_id: str, body: Any) -> Reply:
        if not isinstance(body, dict):
            return error_reply(400, "invalid", _NOT_AN_OBJECT)
        proposal = body.get("proposal")
        try:
            self._proposals.check_payload(proposal_id, proposal)
            # Before accept: an unknown template must not reserve the profile name.
            template = load_template(self._templates, proposal["agent"]["template_id"])
            receipt = self._proposals.accept(proposal_id, proposal, profile_exists=self._profile_exists)
        except ProposalError as exc:
            return _proposal_error(exc)
        return Reply(200, {"proposal": {**receipt, "template": template}})

    # POST /proposals/{proposal_id}/reject
    def reject_proposal(self, proposal_id: str) -> Reply:
        return self._proposal_reply(lambda: self._proposals.reject(proposal_id))

    # POST /proposals/{proposal_id}/steps
    def record_step(self, proposal_id: str, body: Any) -> Reply:
        if not isinstance(body, dict):
            return error_reply(400, "invalid", _NOT_AN_OBJECT)
        step, status = body.get("step"), body.get("status")

        def record() -> dict:
            receipt = self._proposals.record_step(proposal_id, step, status)
            if step == "briefing" and status == "done":
                receipt = self._proposals.complete(
                    proposal_id, profile_exists=self._profile_exists, plugin_enabled=self._plugin_enabled,
                )
            return receipt

        return self._proposal_reply(record)

    # POST /profiles/{profile}/plugin
    def enable_plugin(self, profile: str) -> Reply:
        if not _is_profile_name(profile):
            return error_reply(404, "unknown_profile", "there is no profile with that name")
        if not self._profile_exists(profile):
            return error_reply(404, "unknown_profile", f"profile {profile!r} does not exist")
        self._enable_plugin(profile)
        return Reply(200, {"profile": profile, "enabled": True})

    # GET /attention/prefs?profile=<name or *>
    def get_prefs(self, profile: Any) -> Reply:
        try:
            prefs = self._attention.get_prefs(profile)
        except AttentionError as exc:
            return error_reply(400, "invalid", str(exc))
        return Reply(200, {"prefs": prefs})

    # PUT /attention/prefs
    def set_prefs(self, body: Any) -> Reply:
        if not isinstance(body, dict):
            return error_reply(400, "invalid", _NOT_AN_OBJECT)
        if any(key not in body for key in PREFS_KEYS):
            return error_reply(400, "invalid", "prefs need profile, muted, quiet_start and quiet_end")
        try:
            prefs = self._attention.set_prefs(
                body["profile"], muted=body["muted"], quiet_start=body["quiet_start"], quiet_end=body["quiet_end"],
            )
        except AttentionError as exc:
            return error_reply(400, "invalid", str(exc))
        return Reply(200, {"prefs": prefs})

    def _reminder_request(self, body: Any) -> dict:
        """The service arguments of a valid request; ``ReminderError`` otherwise.

        Order: the body's fields (400), the profile (404), then the schedule
        as Hermes cron reads it (400), so a schedule Hermes refuses never
        becomes an uncertain create.
        """
        if not isinstance(body, dict):
            raise ReminderError(_NOT_AN_OBJECT)
        profile, request_id = body.get("profile"), body.get("request_id")
        if not _is_profile_name(profile):
            raise ReminderError("profile must be a Hermes profile name")
        if not isinstance(request_id, str) or not request_id:
            raise ReminderError("request_id is required and must be a non-empty string")
        problem = reminder_problem(
            schedule=body.get("schedule"), timezone=body.get("timezone"), prompt=body.get("prompt"),
            label=body.get("label"),
        )
        if problem is not None:
            raise ReminderError(problem)
        if not self._profile_exists(profile):
            raise ReminderError(f"profile {profile!r} does not exist", code="unknown_profile")
        try:
            self._check_schedule(profile, body["schedule"])
        except ValueError:
            raise ReminderError("schedule is not one Hermes cron accepts") from None
        return {
            "profile": profile, "schedule": body["schedule"], "timezone": body["timezone"],
            "prompt": body["prompt"], "request_id": request_id, "label": body.get("label"),
        }

    def _proposal_reply(self, call: Callable[[], dict]) -> Reply:
        """Run a proposal call; its receipt with ``template: null``, or its C3 error."""
        try:
            receipt = call()
        except ProposalError as exc:
            return _proposal_error(exc)
        return Reply(200, {"proposal": {**receipt, "template": None}})


def _is_profile_name(value: Any) -> bool:
    return isinstance(value, str) and bool(_PROFILE_RE.match(value))


def _proposal_error(exc: ProposalError) -> Reply:
    return error_reply(exc.http_status, exc.code, str(exc))
