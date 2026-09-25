"""Roadmap D5 and C1: how ``ergates/hermes_adapter.py`` calls Hermes.

``default_hermes_root()`` calls ``hermes_constants.get_default_hermes_root()``
with no arguments and wraps the result in ``Path``. ``test_hermes_root.py``
pins what that function computes; this file pins how it is called. The facts
behind the rest of the adapter (roadmap contract C2) belong here too.
"""

from __future__ import annotations

import ast

from pinned import PinnedSource

CONSTANTS = "hermes_constants.py"


def test_get_default_hermes_root_takes_no_arguments_and_returns_a_path(hermes: PinnedSource) -> None:
    function = hermes.function(CONSTANTS, "get_default_hermes_root")
    arguments = function.args
    assert arguments.posonlyargs == []
    assert arguments.args == []
    assert arguments.vararg is None
    assert arguments.kwonlyargs == []
    assert arguments.kwarg is None
    assert ast.unparse(function.returns) == "Path"
