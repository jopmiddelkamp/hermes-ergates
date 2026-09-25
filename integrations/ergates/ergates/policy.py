"""The Ergates tool gate: which agent tool calls are blocked (roadmap contract C6, decision D6).

``tool.register`` wires :func:`decide` into Hermes's ``pre_tool_call`` hook,
wrapped in :func:`guarded`. Hermes vetoes a tool call when a callback returns
``{"action": "block", "message": <text>}``; the message becomes the tool's
result, so the agent reads it.

Hermes fails OPEN when a callback raises: it logs the exception and runs the
tool (``hermes_cli/plugins_dispatch.py`` at the pin, pinned by
``contract/test_pre_tool_call.py``). :func:`guarded` therefore turns any
exception into a block, so a broken gate never lets a call through.

Rules, in order:

1. ``admitted`` is false (an accepted proposal is still provisioning this
   profile): block with :data:`BLOCK_SETUP`.
2. ``cronjob_manage`` with ``action == "create"``: block with
   :data:`BLOCK_RAW_CRON`. Reminders go through ``ergates_create_reminder``,
   which a retry can never turn into a second job.
3. Revoked toolsets (:data:`BLOCK_REVOKED`): added by roadmap Plan 5, which
   supplies ``granted_toolsets`` and ``tool_toolset``. Until then both are
   ``None`` and the rule does not apply.
4. Otherwise ``None``: the tool runs.
"""

from __future__ import annotations

import functools
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

BLOCK_SETUP = "This agent is still being set up. Finish setup in the Ergates app."
BLOCK_RAW_CRON = "Create reminders with ergates_create_reminder so a retry never makes a duplicate."
BLOCK_REVOKED = "This tool is turned off for this agent."
BLOCK_UNVERIFIED = "Ergates could not verify this tool call, so it was blocked."

RAW_CRON_TOOL = "cronjob_manage"


def block(message: str) -> dict:
    """The ``pre_tool_call`` directive that vetoes a tool call with ``message``."""
    return {"action": "block", "message": message}


def decide(
    tool_name: str, args: dict, *, admitted: bool,
    granted_toolsets: frozenset[str] | None, tool_toolset: str | None,
) -> dict | None:
    """The block directive for one tool call, or ``None`` to let it run (rules 1, 2 and 4 above)."""
    if not admitted:
        return block(BLOCK_SETUP)
    if tool_name == RAW_CRON_TOOL and str(args.get("action", "")).strip().lower() == "create":
        return block(BLOCK_RAW_CRON)
    # Rule 3 (revoked toolsets) is Plan 5's: it reads granted_toolsets and tool_toolset here.
    return None


def guarded(fn: Callable[..., dict | None]) -> Callable[..., dict | None]:
    """``fn``, except that any exception becomes a block with :data:`BLOCK_UNVERIFIED`."""

    @functools.wraps(fn)
    def gate(*args: Any, **kwargs: Any) -> dict | None:
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            # Class name only: an exception can carry tool arguments.
            logger.warning("ergates: tool gate failed (%s); blocking the call", type(exc).__name__)
            return block(BLOCK_UNVERIFIED)

    return gate
