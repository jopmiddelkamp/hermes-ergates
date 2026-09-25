"""Shared fixtures: a control store in a temporary Hermes root, and a settable clock."""

from __future__ import annotations

import pytest

from ergates.paths import store_path
from ergates.store import ControlStore


class FakeClock:
    """``clock()`` returns ``clock.now``; tests move it with ``advance``."""

    def __init__(self, start: float = 1_800_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def store(tmp_path):
    """The store of a Hermes root at ``tmp_path``: ``tmp_path/ergates/control.sqlite3``."""
    control = ControlStore(store_path(tmp_path))
    yield control
    control.close()


def rows(store: ControlStore, table: str) -> list[dict]:
    """Every row of ``table`` as a dict, read through the store's own snapshot."""
    with store.read() as conn:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table}")]


def raw_bytes(store: ControlStore) -> bytes:
    """The database file plus its write-ahead log, exactly as they sit on disk."""
    files = (store.path, store.path.with_name(store.path.name + "-wal"))
    return b"".join(item.read_bytes() for item in files if item.exists())
