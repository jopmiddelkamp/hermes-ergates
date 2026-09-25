"""Read-only helpers over the pinned Hermes source tree."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

HERMES_PIN = "d76856cc6971b6e0e1903b5369498bcc4bb83a60"


@dataclass(frozen=True)
class PinnedSource:
    root: Path

    def text(self, relative: str) -> str:
        return (self.root / relative).read_text(encoding="utf-8")

    def lines(self, relative: str, first: int, last: int) -> str:
        """Lines `first`..`last` (1-based, inclusive), joined with newlines."""
        return "\n".join(self.text(relative).splitlines()[first - 1 : last])

    def tree(self, relative: str) -> ast.Module:
        return ast.parse(self.text(relative), filename=relative)

    def function(self, relative: str, name: str, owner: str | None = None) -> ast.FunctionDef:
        """A module-level function, or a method of the class `owner`."""
        body = self.tree(relative).body
        if owner is not None:
            body = next(n for n in body if isinstance(n, ast.ClassDef) and n.name == owner).body
        return next(n for n in body if isinstance(n, ast.FunctionDef) and n.name == name)

    def assigned(self, relative: str, name: str) -> object:
        """The literal value of a module-level `name = ...` or `name: T = ...`."""
        for node in self.tree(relative).body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
                return _literal(node.value)
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name and node.value is not None:
                return _literal(node.value)
        raise KeyError(f"{relative} assigns no {name}")


def _literal(node: ast.expr) -> object:
    """`ast.literal_eval`, also accepting `frozenset({...})` and `set({...})`."""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"frozenset", "set"} and len(node.args) == 1:
        return frozenset(ast.literal_eval(node.args[0]))
    return ast.literal_eval(node)
