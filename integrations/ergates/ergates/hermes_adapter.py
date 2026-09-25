"""The one module of the ergates package that imports Hermes (roadmap decision D5).

Every other module reaches Hermes through the functions here, so a Hermes
upgrade has one file to check in this package (plus ``dashboard/api.py``).
``tests/test_hermes_boundary.py`` fails the build when any other module
imports Hermes, and each Hermes fact used here is pinned by a test in
``contract/``.

Imports happen inside each function, so importing this module never needs
Hermes: the test suite and ``python -m ergates.flush`` run without it.
"""

from __future__ import annotations

from pathlib import Path


def default_hermes_root() -> Path | None:
    """``hermes_constants.get_default_hermes_root()``, or ``None`` outside a Hermes runtime.

    Hermes maps a profile home (``<root>/profiles/<name>``) back to the root
    that every profile shares. ``contract/test_hermes_root.py`` pins that
    rule and ``contract/test_hermes_adapter.py`` pins the call.
    """
    try:
        from hermes_constants import get_default_hermes_root
    except ImportError:
        return None
    return Path(get_default_hermes_root())
