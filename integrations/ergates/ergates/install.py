"""Install the plugin into a Hermes install: ``python -m ergates.install``.

Two things a new deployment and every update need, both safe to repeat:

1. **The proposal templates.** Every ``<template_id>.json`` in the source
   folder (the Compose file mounts ``deploy/templates`` read-only at
   ``/opt/ergates/templates``) must be a template the accept route would
   serve (:func:`ergates.templates.load_template`). Then each is written
   into ``<hermes root>/ergates/templates/``, and a template the source no
   longer has is removed there, so the server holds exactly the reviewed
   set. When any source template is invalid, nothing is written.
2. **The plugin in every profile.** Hermes loads a user plugin only from the
   active home's ``plugins/`` folder, and only when that home's
   ``config.yaml`` enables it, so :func:`~ergates.hermes_adapter.enable_plugin`
   runs for the default profile and every named one. The app's provisioning
   does the same for a profile it creates.

``--check`` changes no template or plugin setting and reports the same facts. The exit code is 0
when every profile would load the plugin and the installed templates equal
the source, 1 when not, and 2 when the command cannot run: no Hermes
runtime, no source folder, or root on a Hermes root that another user owns
(:func:`~ergates.store.root_run_would_break`).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

from . import hermes_adapter
from .paths import hermes_root, templates_dir
from .proposals import ProposalError
from .store import root_run_would_break
from .templates import load_template

DEFAULT_SOURCE = Path("/opt/ergates/templates")


class TemplateSourceError(Exception):
    """A source template the accept route would refuse; ``names`` lists the files."""

    def __init__(self, names: list[str]) -> None:
        super().__init__(f"invalid templates: {', '.join(names)}")
        self.names = names


def source_templates(source: Path) -> dict[str, bytes]:
    """``{template_id: file bytes}`` of every template in ``source``; raises ``TemplateSourceError``."""
    templates: dict[str, bytes] = {}
    invalid: list[str] = []
    for path in sorted(Path(source).glob("*.json")):
        try:
            load_template(path.parent, path.stem)
        except ProposalError:
            invalid.append(path.name)
            continue
        templates[path.stem] = path.read_bytes()
    if invalid:
        raise TemplateSourceError(invalid)
    return templates


def install_templates(templates: dict[str, bytes], target: Path) -> None:
    """Make ``target`` hold exactly ``templates``; each file is replaced atomically.

    ``Path.mkdir(parents=True)`` gives only the leaf its ``mode``; a missing
    parent gets the default mode. The store folder must be 0700 even when the
    installer runs before the store first opens, so it is created first, on
    its own.
    """
    target = Path(target)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target.mkdir(mode=0o700, exist_ok=True)
    for template_id, content in templates.items():
        staging = target / f".{template_id}.json.tmp"
        staging.write_bytes(content)
        os.replace(staging, target / f"{template_id}.json")
    for installed in target.glob("*.json"):
        if installed.stem not in templates:
            installed.unlink()


def templates_match(templates: dict[str, bytes], target: Path) -> bool:
    """True when ``target`` holds exactly ``templates``, byte for byte."""
    installed = {path.stem: path.read_bytes() for path in Path(target).glob("*.json")}
    return installed == templates


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m ergates.install",
        description="Install the proposal templates and enable the ergates plugin in every Hermes profile.",
    )
    parser.add_argument("--templates", type=Path, default=DEFAULT_SOURCE,
                        help=f"folder of <template_id>.json files (default: {DEFAULT_SOURCE})")
    parser.add_argument("--check", action="store_true", help="change nothing; report and set the exit code")
    args = parser.parse_args(argv)

    root = hermes_root()
    if not root.exists():
        print(f"ergates.install: no Hermes home at {root}", file=sys.stderr)
        return 2
    if root_run_would_break(root):
        print(f"ergates.install: refusing to run as root; {root} belongs to another user. "
              "Run it as that user (docker compose exec -u hermes ...).", file=sys.stderr)
        return 2
    if not args.templates.is_dir():
        print(f"ergates.install: no template folder at {args.templates}", file=sys.stderr)
        return 2
    try:
        templates = source_templates(args.templates)
    except TemplateSourceError as exc:
        print(f"ergates.install: {exc}; nothing was installed", file=sys.stderr)
        return 1
    if not templates and not args.check:
        print(f"ergates.install: no templates found at {args.templates}; nothing was installed", file=sys.stderr)
        return 2
    try:
        profiles = hermes_adapter.profile_names()
    except ImportError:
        print("ergates.install: needs the Hermes runtime (run it inside the Hermes container)", file=sys.stderr)
        return 2

    target = templates_dir(root)
    if not args.check:
        install_templates(templates, target)
    ok = templates_match(templates, target)
    print(f"ergates.install: templates={'installed' if ok else 'differ'} ({', '.join(sorted(templates)) or 'none'})")
    for profile in profiles:
        try:
            if not args.check:
                hermes_adapter.enable_plugin(profile)
            state = "enabled" if hermes_adapter.plugin_enabled(profile) else "not enabled"
        except Exception as exc:  # one broken profile must not stop the others
            state = f"failed ({type(exc).__name__})"
        ok = ok and state == "enabled"
        print(f"ergates.install: profile={profile} plugin={state}")
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover - exercised through main() in tests
    raise SystemExit(main())
