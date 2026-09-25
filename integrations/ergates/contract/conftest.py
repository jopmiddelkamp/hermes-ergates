"""Contract tests: facts about the pinned Hermes source that Ergates depends on.

They read the Hermes checkout named by HERMES_SOURCE as text and never import
it. The checkout must be at HERMES_PIN; `scripts/ci-local.sh contract` and the
CI `contract` job prepare it. When a test here fails after a pin bump, re-check
the roadmap decision it names before changing the test.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from pinned import HERMES_PIN, PinnedSource


@pytest.fixture(scope="session")
def hermes() -> PinnedSource:
    raw = os.environ.get("HERMES_SOURCE", "").strip()
    if not raw:
        pytest.fail(f"HERMES_SOURCE is not set; point it at a Hermes checkout at {HERMES_PIN}")
    root = Path(raw).expanduser().resolve()
    head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    if head.returncode != 0 or head.stdout.strip() != HERMES_PIN:
        found = head.stdout.strip() or head.stderr.strip()
        pytest.fail(f"{root} is not a Hermes checkout at {HERMES_PIN} (found: {found})")
    return PinnedSource(root)
