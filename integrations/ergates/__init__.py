"""Hermes plugin entry point for Ergates.

Installed as a directory plugin into ``~/.hermes/plugins/ergates/``
(``plugin.yaml`` next to this file). Hermes imports this module and calls
``register(ctx)``; the actual logic lives in the sibling ``ergates`` package
(``journal.py``, ``proposals.py``, ``reminders.py``, ``attention.py``,
``tool.py``), reached here through a relative import so it works regardless
of the module name Hermes's namespaced plugin loader assigns to this file.
"""

from .ergates.tool import register

__all__ = ["register"]
