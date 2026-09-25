"""Hermes plugin wiring: the ``ergates_propose_agent`` tool and the approval-attention hooks.

Registered by ``register(ctx)`` in the top-level ``__init__.py`` (the Hermes
plugin entry point). Kept separate from ``ctx`` so every function here stays
plain and unit-testable: each takes its dependencies (a service, a delivery
worker, config values) as explicit arguments rather than reaching into a
global ``ctx``.

Every handler writes to the one control store of the Hermes install,
``<hermes root>/ergates/control.sqlite3``, whichever profile it runs in.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .attention import AttentionService
from .delivery import DeliveryWorker, ntfy_settings, send_ntfy
from .paths import hermes_root, store_path
from .proposals import ProposalError, ProposalService, validate_proposal
from .store import ControlStore

logger = logging.getLogger(__name__)

PROPOSE_TOOL_NAME = "ergates_propose_agent"

PROPOSE_SCHEMA: Dict[str, Any] = {
    "name": PROPOSE_TOOL_NAME,
    "description": (
        "Propose a new Ergates specialist agent for operator approval. Validates the "
        "request and returns a typed, time-limited proposal. Never creates a profile "
        "or changes any permission by itself -- provisioning happens only after the "
        "operator approves the proposal in the app."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": (
                    "Unique lowercase profile identifier, e.g. 'thijs'. "
                    "Must match ^[a-z0-9][a-z0-9-]{1,31}$."
                ),
            },
            "title": {
                "type": "string",
                "description": "Friendly display name shown to the user, e.g. 'Thijs'. Max 60 characters.",
            },
            "role": {
                "type": "string",
                "description": "Short role badge, e.g. 'Bookkeeper'. Max 40 characters.",
            },
            "description": {
                "type": "string",
                "description": "One-line summary of what this agent does.",
            },
            "template_id": {
                "type": "string",
                "description": "Identifier of the approved role template to provision from.",
            },
            "provider": {
                "type": "string",
                "description": "Operator-selected model provider for this agent.",
            },
            "model": {
                "type": "string",
                "description": "Operator-selected model for this agent.",
            },
            "briefing": {
                "type": "string",
                "description": (
                    "Role, boundaries, seed facts and reporting instructions. Max 4000 characters."
                ),
            },
        },
        "required": [
            "name", "title", "role", "template_id", "provider", "model", "briefing",
        ],
    },
}


def propose_handler(
    args: Dict[str, Any],
    *,
    service: ProposalService,
    session_id: Optional[str] = None,
    task_id: Optional[str] = None,
    **_kwargs: Any,
) -> str:
    """Validate a proposal, record its receipt as ``"proposed"``, and return it as JSON.

    Always returns a JSON string, per the Hermes tool contract: a validation
    failure or a proposal-id collision comes back as ``{"error": "..."}``
    rather than raising. Never creates a profile.

    ``source_session_id`` is backend-owned: Hermes dispatches tool handlers
    as ``handler(args, task_id=..., session_id=...)`` (``tools/registry.py``'s
    ``dispatch`` via ``_execute_tool``'s ``dispatch_kwargs`` in the pinned
    checkout), never as a model-supplied argument. ``validate_proposal``
    never reads a ``source_session_id`` key out of ``args`` at all, and the
    line below always sets it from these handler kwargs -- so a caller that
    sneaks a ``source_session_id`` into ``args`` has it silently overwritten,
    never honored. ``session_id`` is preferred; ``task_id`` is the fallback
    for contexts (e.g. cron) that may carry a task id but no session id.

    The stored receipt is **not** the proposal. 11 section 4.1 defines it
    as "proposal hash, reserved profile name, completed steps, session id
    and briefing delivery state" -- so :meth:`ProposalService.record` keeps
    the sha256 of the proposal exactly as returned to the caller, which is
    what the accept operation verifies the approved payload against, and
    never the ``briefing`` (up to 4,000 characters of user content) or the
    ``description``. The full proposal still reaches the app through the
    tool result, which is a transport, not a retained store.
    """
    try:
        proposal = validate_proposal(args)
        proposal["source_session_id"] = session_id or task_id
        service.record(proposal)
    except ProposalError as exc:
        return json.dumps({"error": str(exc)})
    return json.dumps(proposal)


NTFY_KEYS = ("server", "topic", "token", "connection_id")


def _deliver_in_background(worker: DeliveryWorker, event_id: str) -> threading.Thread:
    """Send the push of ``event_id`` off the caller's thread. Never raises.

    ``pre_approval_request`` is deliberately **not** in
    ``_HOOK_TIMEOUT_BOUNDED_HOOKS`` (``hermes_cli/plugins_dispatch.py`` at
    the pin: "Hooks not listed below run synchronously to completion"), and
    on the gateway path it fires *before* ``notify_cb`` reaches the app
    (``tools/approval_gateway_wait.py``). So anything slow here delays the
    in-app approval card itself. The event and its outbox row are already
    committed when this starts; the network call runs on a short-lived daemon
    thread. A push this thread cannot finish stays due in the outbox, and
    the next ``python -m ergates.flush`` sends it.
    """
    def _run() -> None:
        try:
            worker.deliver(event_id)
        except Exception as exc:
            logger.warning("ergates: push for event %s failed (%s)", event_id, type(exc).__name__)

    thread = threading.Thread(target=_run, name=f"ergates-ntfy-{event_id}", daemon=True)
    thread.start()
    return thread


def on_approval_request(
    attention: AttentionService,
    *,
    worker: Optional[DeliveryWorker] = None,
    profile: Optional[str] = None,
    **hook_kwargs: Any,
) -> Optional[threading.Thread]:
    """``pre_approval_request`` hook: record a pending approval with its push, then send it.

    ``hook_kwargs`` are Hermes's own hook arguments (``command``,
    ``description``, ``pattern_key``, ``pattern_keys``, ``session_key``,
    ``surface``, ``coalesced``). The store keeps a correlation hash, never
    the command or its description. A coalesced follower or the ``smart``
    guardian pre-check records nothing. ``worker`` is ``None`` when push is
    not configured; the event is still recorded. Returns the push thread
    when one was started (for tests); Hermes ignores observer return values.
    """
    event_id = attention.approval_requested(
        session_key=hook_kwargs.get("session_key"),
        pattern_key=hook_kwargs.get("pattern_key"),
        command=hook_kwargs.get("command"),
        surface=hook_kwargs.get("surface"),
        coalesced=hook_kwargs.get("coalesced"),
        profile=profile,
        request_id=hook_kwargs.get("request_id"),
    )
    if event_id is None or worker is None:
        return None
    return _deliver_in_background(worker, event_id)


def on_approval_response(attention: AttentionService, **hook_kwargs: Any) -> Optional[str]:
    """``post_approval_response`` hook: resolve the matching pending approval and cancel its push.

    The approval hooks carry no stable approval id at the pin, and several
    approvals can be pending in one session, so the service correlates on
    ``(session_key, pattern_key, command hash, surface)`` and resolves the
    oldest match. When nothing matches, nothing changes.
    """
    return attention.approval_resolved(
        session_key=hook_kwargs.get("session_key"),
        pattern_key=hook_kwargs.get("pattern_key"),
        command=hook_kwargs.get("command"),
        surface=hook_kwargs.get("surface"),
        coalesced=hook_kwargs.get("coalesced"),
        choice=hook_kwargs.get("choice"),
        request_id=hook_kwargs.get("request_id"),
    )


def hermes_home() -> Path:
    """The Hermes data root: ``$HERMES_HOME``, defaulting to ``~/.hermes``."""
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()


def _resolve_profile(ctx: Any) -> Optional[str]:
    """The active profile, preferring ``ctx``'s own session context over static config.

    ``ctx.profile_name`` (``hermes_cli/plugins.py`` in the pinned checkout)
    reflects the actual running profile -- derived from ``HERMES_HOME``, so
    it works in gateway and kanban workers too, not just the interactive
    CLI -- which is a better "owning profile" than a static setting. Falls
    back to the ``ntfy.default_profile`` plugin setting when ``ctx`` has no
    such attribute (e.g. a minimal test double) or it raises.
    """
    try:
        session_profile = ctx.profile_name
    except Exception:
        session_profile = None
    if session_profile:
        return session_profile
    return ctx.get_config("ntfy.default_profile", None)


def _delivery_worker(ctx: Any, store: ControlStore) -> Optional[DeliveryWorker]:
    """A worker for this profile's ``ntfy.*`` settings, read at call time; ``None`` when push is off."""
    settings = ntfy_settings({key: ctx.get_config(f"ntfy.{key}", None) for key in NTFY_KEYS})
    if settings is None:
        return None
    return DeliveryWorker(store, send_ntfy, settings)


def register(ctx: Any) -> None:
    """Wire the ``ergates_propose_agent`` tool and the approval-attention hooks into Hermes."""
    store = ControlStore(store_path(hermes_root()))
    proposals = ProposalService(store)
    attention = AttentionService(store)

    def handle_propose(args: Dict[str, Any], **kwargs: Any) -> str:
        return propose_handler(args, service=proposals, **kwargs)

    def handle_pre_approval(**kwargs: Any) -> None:
        on_approval_request(
            attention, worker=_delivery_worker(ctx, store), profile=_resolve_profile(ctx), **kwargs,
        )

    def handle_post_approval(**kwargs: Any) -> None:
        on_approval_response(attention, **kwargs)

    ctx.register_tool(
        name=PROPOSE_TOOL_NAME,
        toolset="ergates",
        schema=PROPOSE_SCHEMA,
        handler=handle_propose,
        description="Propose a new Ergates specialist agent for operator approval.",
        emoji="\U0001FA84",  # magic wand
    )
    ctx.register_hook("pre_approval_request", handle_pre_approval)
    ctx.register_hook("post_approval_response", handle_post_approval)
