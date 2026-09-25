"""Periodic maintenance entry point: ``python -m ergates.flush``.

Two jobs this package cannot do for itself from inside Hermes:

1. **Send due pushes.** The approval hooks fire only on an approval event,
   so nothing inside Hermes runs a timer. A push whose first attempt failed,
   or whose process died mid-send, stays due in the control store's outbox
   until this sweep sends it (:class:`~ergates.delivery.DeliveryWorker`).
2. **Apply retention and expiry.** Every service has an ``expire`` or a
   ``prune``; nothing calls them from inside a hook (04 section 8; 11
   sections 4.1-4.3).

Run it from the host, inside the container, every two minutes -- see
``deploy/README.md``. The ntfy credentials are read from the profile's own
``config.yaml`` (``plugins.entries.ergates.settings.ntfy.*``), the same
place ``ctx.get_config`` reads them from, so **no token ever appears on a
command line, in a process listing, or in this module's output**. The only
arguments are a profile name and output flags.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Optional

from .attention import AttentionService
from .delivery import DeliveryWorker, ntfy_settings, send_ntfy
from .paths import hermes_root, store_path
from .proposals import ProposalService
from .reminders import CronPort, ReminderService, UnavailableCron
from .store import ControlStore

logger = logging.getLogger("ergates.flush")

PLUGIN_ID = "ergates"

_SETTING_KEYS = ("server", "topic", "token", "connection_id")


def profile_home(base: Path, profile: Optional[str] = None) -> Path:
    """The ``HERMES_HOME`` of ``profile``: ``base`` itself for the default profile.

    Matches Hermes's own layout (``hermes_cli/profiles.py``'s
    ``get_profile_dir`` at the pin): the default profile's home *is* the
    Hermes root, and a named profile lives at ``<root>/profiles/<name>``.
    """
    if not profile or profile.strip().lower() == "default":
        return Path(base)
    return Path(base) / "profiles" / profile.strip()


def settings_home(root: Path, profile: Optional[str]) -> Path:
    """The home whose ``config.yaml`` holds the push settings for this sweep.

    ``--profile``'s home when given; else the ``HERMES_HOME`` this process
    runs with; else the Hermes root (the default profile).
    """
    if profile:
        return profile_home(root, profile)
    env_home = os.environ.get("HERMES_HOME", "").strip()
    return Path(env_home).expanduser() if env_home else Path(root)


def settings_from_config(config: Any, plugin_id: str = PLUGIN_ID) -> Dict[str, str]:
    """Extract ``plugins.entries.<plugin_id>.settings.ntfy.*`` from a parsed config.

    Kept separate from the file/YAML handling so the resolution rule is
    unit-testable on a plain dict. Missing keys come back absent rather than
    empty, and a non-mapping anywhere along the path is treated as absent
    rather than raising: a maintenance sweep must not die on a config typo.
    """
    node: Any = config
    for segment in ("plugins", "entries", plugin_id, "settings", "ntfy"):
        if not isinstance(node, Mapping) or segment not in node:
            return {}
        node = node[segment]
    if not isinstance(node, Mapping):
        return {}
    settings: Dict[str, str] = {}
    for key in _SETTING_KEYS:
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            settings[key] = value.strip()
    return settings


def load_settings(home: Path, plugin_id: str = PLUGIN_ID) -> Dict[str, str]:
    """Read the ntfy settings out of ``<home>/config.yaml``.

    PyYAML is imported lazily and is not a dependency of this package: it is
    present in the Hermes runtime this command is meant to run inside
    (``docker compose exec hermes-serve``), and every other code path here
    works without it.
    """
    config_path = Path(home) / "config.yaml"
    if not config_path.exists():
        logger.warning("ergates.flush: no config at %s; push settings unavailable", config_path)
        return {}
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - PyYAML ships with the Hermes runtime
        raise RuntimeError(
            "ergates.flush needs PyYAML to read config.yaml -- run it inside the "
            "Hermes container (docker compose exec ... python -m ergates.flush)"
        ) from exc
    with open(config_path, "r", encoding="utf-8") as handle:
        return settings_from_config(yaml.safe_load(handle) or {}, plugin_id)


def flush_once(
    root: Path,
    settings: Mapping[str, str],
    *,
    now: Optional[float] = None,
    publish: Callable[[Dict[str, Any]], None] = send_ntfy,
    cron: Optional[CronPort] = None,
    clock: Callable[[], float] = time.time,
) -> Dict[str, int]:
    """Run one expiry pass, one retention pass and one delivery pass. Counts only, never content.

    ``root`` is the Hermes root; the store is ``paths.store_path(root)``.
    Expiry runs before delivery, so an approval that timed out is cancelled,
    never pushed. The delivery pass is skipped (not an error) when
    ``ntfy.server`` or ``ntfy.topic`` is unset: a deployment without push
    still gets its retention sweep.

    ``cron`` is optional and, when given, lets the reminder sweep drop
    receipts whose cron job has been deleted natively; without it the sweep
    applies only the 30-day idle rule (:class:`~ergates.reminders.UnavailableCron`).

    Expiry and retention run on one timestamp, ``now`` (default: ``clock()``
    at the start). The delivery pass runs on ``clock`` itself, so each lease
    counts from its own claim, however long the passes before it took.
    """
    moment = clock() if now is None else now
    frozen = lambda: moment  # noqa: E731 - one timestamp for expiry and retention
    store = ControlStore(store_path(root))
    try:
        attention = AttentionService(store, clock=frozen)
        counts = {
            "retried": 0,
            # Expiries are reported separately from deletions: an expired approval
            # becomes a terminal record with a seven-day audit window, it is not
            # removed here, and an operator reading the log line should be able to
            # tell "N approvals timed out unanswered" from "N records aged out".
            "expired_notifications": attention.expire(moment),
            "pruned_notifications": attention.prune(moment),
            "pruned_proposals": ProposalService(store, clock=frozen).prune(moment),
            "pruned_reminders": ReminderService(store, cron or UnavailableCron(), clock=frozen).prune(moment),
        }
        ntfy = ntfy_settings(settings)
        if ntfy is not None:
            counts["retried"] = DeliveryWorker(store, publish, ntfy, clock=clock).run_due()
        else:
            logger.info("ergates.flush: ntfy.server/ntfy.topic unset; delivery pass skipped")
    finally:
        store.close()
    return counts


def main(argv: Optional[list] = None) -> int:
    """CLI entry point. Prints one line of counts; exits non-zero only on a hard failure."""
    parser = argparse.ArgumentParser(
        prog="python -m ergates.flush",
        description=(
            "Send due ntfy pushes and apply retention to the ergates control store. "
            "Credentials are read from the profile's config.yaml, never from arguments."
        ),
    )
    parser.add_argument(
        "--profile", default=os.environ.get("ERGATES_PROFILE", "") or None,
        help="Hermes profile to sweep (default: the profile HERMES_HOME points at).",
    )
    parser.add_argument(
        "--quiet", action="store_true", help="Suppress the summary line (exit code only).",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    root = hermes_root()
    home = settings_home(root, args.profile)
    for required in (root, home):
        if not required.exists():
            print(f"ergates.flush: no Hermes home at {required}", file=sys.stderr)
            return 2
    counts = flush_once(root, load_settings(home))
    if not args.quiet:
        print(
            "ergates.flush: retried={retried} expired_notifications={expired_notifications} "
            "pruned_notifications={pruned_notifications} pruned_proposals={pruned_proposals} "
            "pruned_reminders={pruned_reminders}".format(**counts)
        )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main() in tests
    raise SystemExit(main())
