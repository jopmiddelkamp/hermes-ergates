"""Hermes plugin wiring: the ``ergates_propose_agent`` tool and the approval-attention hooks.

Registered by ``register(ctx)`` in the top-level ``__init__.py`` (the Hermes
plugin entry point). Kept separate from ``ctx`` so every function here stays
plain and unit-testable: each takes its dependencies (a ``Journal``, a
``publish`` callable, config values) as explicit arguments rather than
reaching into a global ``ctx``.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .attention import AttentionJournal, build_ntfy_publish, command_hash, deep_link
from .journal import Journal
from .proposals import (
    PROPOSED_STATE,
    ProposalError,
    ProposalJournal,
    payload_hash,
    validate_proposal,
)

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
    journal: Journal,
    session_id: Optional[str] = None,
    task_id: Optional[str] = None,
    **_kwargs: Any,
) -> str:
    """Validate a proposal, journal it as ``"proposed"``, and return it as JSON.

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

    The journaled receipt is **not** the proposal. 11 section 4.1 defines it
    as "proposal hash, reserved profile name, completed steps, session id
    and briefing delivery state" -- so the record carries ``proposal_hash``
    (a sha256 over the proposal exactly as returned to the caller, which is
    what the accept operation verifies the approved payload against) and
    never the ``briefing`` (up to 4,000 characters of user content) or the
    ``description``. The full proposal still reaches the app through the
    tool result, which is a transport, not a retained store.
    """
    try:
        proposal = validate_proposal(args)
    except ProposalError as exc:
        return json.dumps({"error": str(exc)})

    proposal["source_session_id"] = session_id or task_id

    record = {
        "kind": proposal["kind"],
        "state": PROPOSED_STATE,
        "proposal_hash": payload_hash(proposal),
        "reserved_profile_name": proposal["agent"]["name"],
        "completed_steps": [],
        "briefing_delivery": None,
        "source_session_id": proposal["source_session_id"],
        "task_id": task_id,
        "expires_at": proposal["expires_at"],
    }
    claimed = journal.claim(proposal["proposal_id"], record)
    if claimed is None:  # pragma: no cover - proposal_id is a fresh uuid4 per call
        return json.dumps({"error": "proposal_id collision; retry"})

    return json.dumps(proposal)


SMART_SURFACE = "smart"

NTFY_TITLE = "Hermes needs your approval"


def duplicate_hook_call(surface: Optional[str], coalesced: Any) -> bool:
    """True when this ``pre_approval_request`` is not a new user-visible prompt.

    Hermes fires the approval hooks more than once per decision, and two of
    those calls must not become a record or a buzz (verified at the pin):

    - ``coalesced=True``: a follower waiting on an already-pending identical
      approval (``tools/approval_gateway_wait.py``'s
      ``_await_coalesced_leader``). The leader's own call already journaled
      and pushed. Worse, a follower that adopts a ``once`` decision
      deliberately fires **no** post hook and falls through to a fresh
      prompt, so journaling it would strand a pending record that nothing
      ever resolves.
    - ``surface == "smart"``: the guardian pre-check in
      ``tools/approval_smart.py``, which fires pre/post around an aux-LLM
      verdict and only fires post when the verdict decides. That is not a
      request for the user's attention at all, and an undecided verdict
      would likewise strand a pending record.

    ``coalesced`` is read for truthiness rather than identity: it arrives as
    a keyword Hermes sets only on the follower path, and any truthy value
    means "not the leader".
    """
    return bool(coalesced) or surface == SMART_SURFACE


def _publish_in_background(
    journal: AttentionJournal,
    event_id: str,
    spec: Dict[str, Any],
    publish: Callable[[Dict[str, Any]], None],
) -> "threading.Thread":
    """Publish ``spec`` off the caller's thread and record the attempt. Never raises.

    ``pre_approval_request`` is deliberately **not** in
    ``_HOOK_TIMEOUT_BOUNDED_HOOKS`` (``hermes_cli/plugins_dispatch.py`` at
    the pin: "Hooks not listed below run synchronously to completion"), and
    on the gateway path it fires *before* ``notify_cb`` reaches the app
    (``tools/approval_gateway_wait.py``). So anything slow here delays the
    in-app approval card itself, on every dangerous command, with no
    timeout from Hermes to rescue it. The journal write stays synchronous --
    it is a local, locked file write and it is what the retry sweep needs --
    but the network call runs on a short-lived daemon thread so the hook
    returns immediately. The thread records its own outcome through
    ``record_publish_attempt``, so a failure is still picked up by
    ``flush_retries`` rather than lost.
    """
    def _run() -> None:
        try:
            publish(spec)
        except Exception:
            ok = False
        else:
            ok = True
        try:
            journal.record_publish_attempt(event_id, ok=ok, now=time.time())
        except Exception as exc:  # pragma: no cover - the record was just claimed
            logger.warning("ergates: could not record publish attempt for %s: %s", event_id, exc)

    thread = threading.Thread(target=_run, name=f"ergates-ntfy-{event_id}", daemon=True)
    thread.start()
    return thread


def on_approval_request(
    journal: AttentionJournal,
    *,
    command: Optional[str] = None,
    description: Optional[str] = None,
    pattern_key: Optional[str] = None,
    pattern_keys: Optional[Any] = None,
    session_key: Optional[str] = None,
    surface: Optional[str] = None,
    coalesced: Any = None,
    ntfy_server: Optional[str] = None,
    ntfy_topic: Optional[str] = None,
    ntfy_token: Optional[str] = None,
    connection_id: Optional[str] = None,
    profile: Optional[str] = None,
    publish: Optional[Callable[[Dict[str, Any]], None]] = None,
    **_kwargs: Any,
) -> Optional["threading.Thread"]:
    """``pre_approval_request`` hook: journal a pending attention event and push when configured.

    The journaled record is restricted to exactly what 11 section 4.2
    defines -- event id, owning profile/session, approval id, state,
    attempts, next retry and delivery result -- and never the raw
    ``command`` or ``description``: only ``command_hash`` (a sha256 digest)
    is stored, which is enough for ``on_approval_response`` to correlate a
    later response back to this event without ever persisting the command
    text itself. ``connection_id`` and ``profile`` are captured here too --
    non-secret routing identifiers, not the command -- so a later retry (see
    ``flush_retries``) builds its ``Click`` link from *this event's own*
    values instead of whatever connection/profile happens to be configured
    at retry time, which could belong to a different pending approval.

    Publishing is best-effort, off-thread, and never raises into the
    approval path: a push failure must not block or fail the underlying
    approval request, and a slow ntfy server must not delay the in-app
    approval card (see :func:`_publish_in_background`). It is still tracked:
    a failed attempt schedules a retry (or gives up after
    :data:`~ergates.attention.MAX_PUBLISH_ATTEMPTS` attempts) via
    :meth:`AttentionJournal.record_publish_attempt`, rather than being
    silently swallowed.

    Calls that are not a new user-visible prompt -- a coalesced follower, or
    the ``smart`` guardian pre-check -- are skipped entirely: no record, no
    push (see :func:`duplicate_hook_call`). ``surface`` is stored on the
    record so ``on_approval_response`` correlates within the same surface.

    Returns the publish thread when one was started (for tests); Hermes
    ignores approval-observer return values by design.
    """
    if duplicate_hook_call(surface, coalesced):
        logger.debug(
            "ergates: skipping duplicate approval hook (surface=%r coalesced=%r)",
            surface, coalesced,
        )
        return None

    event_id = str(uuid.uuid4())
    now = time.time()
    record = journal.claim(event_id, {
        "state": "pending",
        "session_key": session_key,
        "pattern_key": pattern_key,
        "command_hash": command_hash(command),
        "connection_id": connection_id,
        "profile": profile,
        "surface": surface,
        "created_at": now,
        "resolved_at": None,
        "attempts": 0,
        "next_retry": None,
        "delivery": None,
    })
    if record is None:  # pragma: no cover - event_id is a fresh uuid4 per call
        return None

    if not (ntfy_server and ntfy_topic) or publish is None:
        return None

    click_url = deep_link(session_key or "", connection_id or "", profile or "")
    spec = build_ntfy_publish(
        ntfy_server, ntfy_topic, ntfy_token or "",
        title=NTFY_TITLE,
        click_url=click_url,
        event_id=event_id,
    )
    return _publish_in_background(journal, event_id, spec, publish)


def on_approval_response(
    journal: AttentionJournal,
    *,
    choice: Optional[str] = None,
    decided_by: Optional[str] = None,
    command: Optional[str] = None,
    description: Optional[str] = None,
    pattern_key: Optional[str] = None,
    pattern_keys: Optional[Any] = None,
    session_key: Optional[str] = None,
    surface: Optional[str] = None,
    coalesced: Any = None,
    **_kwargs: Any,
) -> None:
    """``post_approval_response`` hook: resolve the matching unresolved attention event.

    The approval hooks carry no stable approval id (see ``VALID_HOOKS`` in
    ``hermes_cli/plugins.py``), and Hermes allows several approvals to be
    pending in the same session at once, so ``session_key`` alone is not
    enough to pick the right event -- it risks resolving the wrong one.
    This correlates on ``(session_key, pattern_key, command_hash)`` instead
    (``command_hash`` is the same sha256 digest ``on_approval_request``
    stored, computed here from ``command`` -- the raw command is never
    persisted) and resolves the *oldest* matching unresolved record. A
    record whose delivery already gave up (``state == "failed"``) still
    matches: giving up on notifying is not the same as the approval being
    answered, and the user may have answered through a channel this push
    never reached. When nothing matches, this resolves nothing and logs,
    rather than guessing.

    ``surface`` joins the correlation tuple because the same command can be
    approved on two surfaces (a ``smart`` guardian pre-check and then the
    real gateway prompt), and only the record from *this* surface should be
    resolved by this response. Responses on the paths
    :func:`duplicate_hook_call` covers never journaled a record in the
    first place, so they are skipped here too instead of resolving somebody
    else's event -- notably a coalesced follower, whose post hook would
    otherwise close out the leader's still-open request.
    """
    if duplicate_hook_call(surface, coalesced):
        logger.debug(
            "ergates: skipping duplicate approval response (surface=%r coalesced=%r)",
            surface, coalesced,
        )
        return

    wanted_hash = command_hash(command)
    candidates = [
        r for r in journal.list()
        if r.get("state") != "resolved"
        and r.get("session_key") == session_key
        and r.get("pattern_key") == pattern_key
        and r.get("command_hash") == wanted_hash
        and r.get("surface") == surface
    ]
    if not candidates:
        logger.info(
            "on_approval_response: no matching unresolved attention event for "
            "session_key=%r pattern_key=%r (command given: %s)",
            session_key, pattern_key, command is not None,
        )
        return
    target = min(candidates, key=lambda r: r.get("created_at") or 0)
    journal.update(
        target["id"],
        state="resolved",
        resolved_at=time.time(),
        choice=choice,
        decided_by=decided_by,
    )


def flush_retries(
    journal: AttentionJournal,
    now: float,
    publish: Callable[[Dict[str, Any]], None],
    *,
    ntfy_server: str,
    ntfy_topic: str,
    ntfy_token: str = "",
) -> int:
    """Re-publish every due ntfy retry in ``journal``. Returns how many were attempted.

    Deliberately takes no global ``connection_id``/``profile`` -- each due
    record's ``Click`` link is built from *that record's own*
    ``session_key``/``connection_id``/``profile`` (captured once, when
    ``on_approval_request`` first journaled the event). Applying one
    global connection/profile to every due record would be wrong the moment
    two different pending approvals belong to different sessions/profiles:
    a retried notification would carry the wrong deep link. ``ntfy_server``/
    ``ntfy_topic``/``ntfy_token`` remain deployment-wide, since they are not
    per-approval routing -- every retry goes to the same ntfy server/topic.

    Not wired into any Hermes hook -- there is no periodic-timer hook in the
    approval-observer surface this package uses (``pre_approval_request`` /
    ``post_approval_response`` both fire only on an actual approval event).
    This is a plain function meant to be driven by an external periodic
    job (a cron job, a systemd timer, a manual invocation) -- see
    ``integrations/ergates/README.md``.
    """
    attempted = 0
    for record in journal.retry_due(now):
        attempted += 1
        click_url = deep_link(
            record.get("session_key") or "",
            record.get("connection_id") or "",
            record.get("profile") or "",
        )
        spec = build_ntfy_publish(
            ntfy_server, ntfy_topic, ntfy_token,
            title=NTFY_TITLE,
            click_url=click_url,
            event_id=record["id"],
        )
        try:
            publish(spec)
        except Exception:
            journal.record_publish_attempt(record["id"], ok=False, now=now)
        else:
            journal.record_publish_attempt(record["id"], ok=True, now=now)
    return attempted


def hermes_home() -> Path:
    """The Hermes data root: ``$HERMES_HOME``, defaulting to ``~/.hermes``."""
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()


def send_ntfy(spec: Dict[str, Any], *, timeout: float = 3.0) -> None:
    """Default runtime transport for ``build_ntfy_publish`` output: a plain HTTP POST.

    Uses only :mod:`urllib.request` (standard library) so the package stays
    dependency-free. Not exercised by the unit test suite -- tests inject
    their own ``publish`` callable instead of touching the network.

    The socket timeout is short on purpose. It applies to the connect *and*
    the read, so the worst case is roughly twice this value, and a push is
    retryable (``AttentionJournal.record_publish_attempt`` schedules the
    next attempt) while a blocked thread is not free. ``on_approval_request``
    already runs this off the hook thread, so the timeout is a backstop for
    the worker, not for the approval path.
    """
    import urllib.request

    request = urllib.request.Request(
        spec["url"],
        data=spec["body"].encode("utf-8"),
        headers=spec["headers"],
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        response.read()


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


def register(ctx: Any) -> None:
    """Wire the ``ergates_propose_agent`` tool and the approval-attention hooks into Hermes."""
    home = hermes_home()
    proposals_journal = ProposalJournal(home / "ergates")
    attention_journal = AttentionJournal(home / "ergates")

    def handle_propose(args: Dict[str, Any], **kwargs: Any) -> str:
        return propose_handler(args, journal=proposals_journal, **kwargs)

    def handle_pre_approval(**kwargs: Any) -> None:
        on_approval_request(
            attention_journal,
            ntfy_server=ctx.get_config("ntfy.server", None),
            ntfy_topic=ctx.get_config("ntfy.topic", None),
            ntfy_token=ctx.get_config("ntfy.token", None),
            connection_id=ctx.get_config("ntfy.connection_id", None),
            profile=_resolve_profile(ctx),
            publish=send_ntfy,
            **kwargs,
        )

    def handle_post_approval(**kwargs: Any) -> None:
        on_approval_response(attention_journal, **kwargs)

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
