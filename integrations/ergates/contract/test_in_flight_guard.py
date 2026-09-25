"""The in-flight hook guard behind the roadmap's live-only gate (deploy/VERIFY.md, Plan 5).

Hermes skips a callback that is still running and keys that check on the hook
and the callback only, not on the session. For `pre_tool_call` a skip is a
block, so two sessions calling tools at the same moment can block each other.
Only a live check can show whether that happens in practice.
"""

from __future__ import annotations

from pinned import PinnedSource

DISPATCH = "hermes_cli/plugins_dispatch.py"


def test_the_guard_key_has_no_session_in_it(hermes: PinnedSource) -> None:
    # hermes_cli/plugins_dispatch.py:208
    assert hermes.lines(DISPATCH, 208, 208) == "        callback_key = (hook_name, id(cb))"


def test_a_callback_still_running_is_skipped(hermes: PinnedSource) -> None:
    # hermes_cli/plugins_dispatch.py:210-217
    assert hermes.lines(DISPATCH, 210, 217) == (
        "        with self._hook_timeout_lock:\n"
        "            suppressed_until = self._hook_timeout_suppressed_until.get(callback_key)\n"
        "            running = callback_key in self._hook_running_callbacks\n"
        "            if (suppressed_until is not None and suppressed_until > time.monotonic()) or running:\n"
        "                logger.warning(\n"
        '                    "Hook \'%s\' callback %s skipped after previous "\n'
        '                    "timeout or while still running", hook_name, callback_name)\n'
        "                return _HOOK_SKIPPED"
    )
