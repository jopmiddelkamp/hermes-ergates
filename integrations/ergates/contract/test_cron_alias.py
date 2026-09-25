"""The legacy tool-name alias the raw-cron gate relies on.

`policy.py` blocks `cronjob_manage` with `action: create` and tells agents to
use `ergates_create_reminder` instead (roadmap contract C6, `test_pre_tool_call.py`
pins the gate mechanics themselves). That only closes the raw creation path
because Hermes canonicalizes a model's `cronjob` tool call to `cronjob_manage`
*before* dispatch and *before* the `pre_tool_call` hook runs, on both of its
call paths -- so a model that asks for the legacy name `cronjob` is blocked
exactly like one that asks for `cronjob_manage`, and the gate never sees the
alias.
"""

from __future__ import annotations

from pinned import PinnedSource

MODEL_TOOLS = "model_tools.py"
TOOL_EXECUTOR = "agent/tool_executor.py"


def test_the_legacy_alias_maps_cronjob_to_cronjob_manage(hermes: PinnedSource) -> None:
    # model_tools.py:598-601
    aliases = hermes.assigned(MODEL_TOOLS, "_LEGACY_TOOL_ALIASES")
    assert aliases["cronjob"] == "cronjob_manage"


def test_model_tools_own_dispatch_canonicalizes_before_running_the_tool(hermes: PinnedSource) -> None:
    # model_tools.py:875
    assert hermes.lines(MODEL_TOOLS, 875, 875) == (
        "    function_name = _LEGACY_TOOL_ALIASES.get(function_name, function_name)"
    )


def test_the_agent_loop_canonicalizes_before_the_pre_tool_call_hook_too(hermes: PinnedSource) -> None:
    # agent/tool_executor.py:433, calling the helper defined at 364-368
    assert hermes.lines(TOOL_EXECUTOR, 433, 433) == "    name = _canonical_tool_name(tool_call.function.name)"
    assert hermes.lines(TOOL_EXECUTOR, 364, 368) == (
        "def _canonical_tool_name(function_name: str) -> str:\n"
        '    """Map legacy tool-name aliases BEFORE agent-loop dispatch."""\n'
        "    from model_tools import _LEGACY_TOOL_ALIASES as _lta\n"
        "\n"
        "    return _lta.get(function_name, function_name)"
    )
