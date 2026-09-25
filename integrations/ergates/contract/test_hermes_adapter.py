"""Roadmap D5 and C1: how ``ergates/hermes_adapter.py`` calls Hermes.

``default_hermes_root()`` calls ``hermes_constants.get_default_hermes_root()``
with no arguments and wraps the result in ``Path``. ``test_hermes_root.py``
pins what that function computes; this file pins how it is called. The facts
behind the rest of the adapter (roadmap contract C2) belong here too.

``configured_timezone()`` calls ``hermes_time.get_timezone()`` with no
arguments. Quiet hours are read in that zone because Hermes cron computes a
routine's next run from ``hermes_time.now()``, which is in that zone.
"""

from __future__ import annotations

import ast

from pinned import PinnedSource

CONSTANTS = "hermes_constants.py"
HERMES_TIME = "hermes_time.py"
CRON_JOBS = "cron/jobs.py"


def test_get_default_hermes_root_takes_no_arguments_and_returns_a_path(hermes: PinnedSource) -> None:
    function = hermes.function(CONSTANTS, "get_default_hermes_root")
    arguments = function.args
    assert arguments.posonlyargs == []
    assert arguments.args == []
    assert arguments.vararg is None
    assert arguments.kwonlyargs == []
    assert arguments.kwarg is None
    assert ast.unparse(function.returns) == "Path"


def test_get_timezone_takes_no_arguments_and_returns_a_zone_or_none(hermes: PinnedSource) -> None:
    function = hermes.function(HERMES_TIME, "get_timezone")
    assert function.lineno == 95
    arguments = function.args
    assert arguments.posonlyargs == []
    assert arguments.args == []
    assert arguments.vararg is None
    assert arguments.kwonlyargs == []
    assert arguments.kwarg is None
    assert ast.unparse(function.returns) == "Optional[ZoneInfo]"
    # hermes_time.py:95-97
    assert hermes.lines(HERMES_TIME, 95, 97) == (
        "def get_timezone() -> Optional[ZoneInfo]:\n"
        '    """Return the active profile\'s configured ZoneInfo, or None (server-local)."""\n'
        "    return _timezone_entry()[1]"
    )


def test_hermes_time_now_is_in_the_configured_zone(hermes: PinnedSource) -> None:
    # hermes_time.py:112-115
    assert hermes.lines(HERMES_TIME, 112, 115) == (
        "def now() -> datetime:\n"
        '    """Current time as a tz-aware datetime: configured zone, else server-local."""\n'
        "    tz = get_timezone()\n"
        "    return datetime.now(tz) if tz is not None else datetime.now().astimezone()"
    )


def test_cron_computes_the_next_run_from_hermes_time_now(hermes: PinnedSource) -> None:
    # cron/jobs.py:36
    assert hermes.lines(CRON_JOBS, 36, 36) == "from hermes_time import now as _hermes_now"
    assert hermes.function(CRON_JOBS, "compute_next_run").lineno == 1097
    # cron/jobs.py:1099, and the cron branch at 1123 counts from it (base_time is now without a last run)
    assert hermes.lines(CRON_JOBS, 1099, 1099) == "    now = _hermes_now()"
    assert hermes.lines(CRON_JOBS, 1106, 1106) == "    base_time = (_parse_aware(last_run_at) if last_run_at else None) or now"
    assert hermes.lines(CRON_JOBS, 1123, 1123) == "        return croniter(expr, base_time).get_next(datetime).isoformat()"
