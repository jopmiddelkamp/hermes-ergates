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
``deploy/README.md``. The ntfy credentials are the install-wide push
settings in the Hermes root's ``config.yaml`` (:mod:`ergates.settings`), the
same ones every hook reads, so **no token ever appears on a command line, in
a process listing, or in this module's output**. The only argument is
``--quiet``.

Inside the Hermes runtime the reminder sweep asks Hermes cron
(:class:`~ergates.hermes_adapter.HermesCron`) whether each receipt's job
still exists, so a job deleted in the Routines screen drops its receipt.
Without Hermes, ``HermesCron`` answers "could not tell" and only the 30-day
idle rule applies.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Optional

from .attention import AttentionService
from .delivery import DeliveryWorker, ntfy_settings, send_ntfy
from .hermes_adapter import HermesCron
from .paths import hermes_root, store_path
from .proposals import ProposalService
from .reminders import CronPort, ReminderService, UnavailableCron
from .settings import load_settings
from .store import ControlStore

logger = logging.getLogger("ergates.flush")


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
            "Credentials are read from the Hermes root's config.yaml, never from arguments."
        ),
    )
    parser.add_argument(
        "--quiet", action="store_true", help="Suppress the summary line (exit code only).",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    root = hermes_root()
    if not root.exists():
        print(f"ergates.flush: no Hermes home at {root}", file=sys.stderr)
        return 2
    counts = flush_once(root, load_settings(root), cron=HermesCron())
    if not args.quiet:
        print(
            "ergates.flush: retried={retried} expired_notifications={expired_notifications} "
            "pruned_notifications={pruned_notifications} pruned_proposals={pruned_proposals} "
            "pruned_reminders={pruned_reminders}".format(**counts)
        )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main() in tests
    raise SystemExit(main())
