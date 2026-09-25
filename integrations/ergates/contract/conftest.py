"""Contract tests: facts about the pinned Hermes source that Ergates depends on.

The tests in this folder read the Hermes checkout named by HERMES_SOURCE as
text and never import it; the tests in `live/` import it (see
`live/conftest.py`). The checkout must be at HERMES_PIN with no local edits;
`scripts/ci-local.sh contract` and the CI `contract` job prepare it. When a
test here fails after a pin bump, re-check the design decision it pins
before changing the test.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from pinned import HERMES_PIN, PinnedSource, check_pin

# `live/` imports the pinned Hermes and needs its dependencies, so the runner
# starts it as its own pytest run (scripts/ci-local.sh contract). A plain
# `pytest contract` collects only the text tests.
collect_ignore = ["live"]


@pytest.fixture(scope="session")
def hermes() -> PinnedSource:
    raw = os.environ.get("HERMES_SOURCE", "").strip()
    if not raw:
        pytest.fail(f"HERMES_SOURCE is not set; point it at a Hermes checkout at {HERMES_PIN}")
    root = Path(raw).expanduser().resolve()
    failure = check_pin(root, HERMES_PIN)
    if failure is not None:
        pytest.fail(failure)
    return PinnedSource(root)
