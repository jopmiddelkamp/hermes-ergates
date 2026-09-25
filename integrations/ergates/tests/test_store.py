"""Tests for ergates.store: the transactional SQLite control store."""

from __future__ import annotations

import os
import sqlite3
import stat
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from conftest import rows
from ergates import store as store_module
from ergates.store import MIGRATIONS, SCHEMA_VERSION, ControlStore, StoreError

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
TABLES = {
    "reminder_receipts", "proposal_receipts", "proposal_steps",
    "attention_events", "attention_outbox", "attention_prefs",
}


def _add_prefs(conn: sqlite3.Connection, profile: str, now: float = 1.0) -> None:
    conn.execute(
        "INSERT INTO attention_prefs (profile, muted, updated_at) VALUES (?, 0, ?)", (profile, now),
    )


def test_a_new_store_is_at_the_current_schema_version(store):
    assert SCHEMA_VERSION == 1 == len(MIGRATIONS)
    assert store.schema_version == SCHEMA_VERSION


def test_a_new_store_has_every_table(store):
    with store.read() as conn:
        names = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert names == TABLES


def test_the_store_runs_in_wal_mode(store):
    with store.read() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_the_store_file_and_folder_are_private(store):
    assert stat.S_IMODE(os.stat(store.path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(store.path.parent).st_mode) == 0o700


def test_reopening_keeps_the_data_and_does_not_migrate_again(store):
    with store.transaction() as conn:
        _add_prefs(conn, "thijs")

    again = ControlStore(store.path)

    assert again.schema_version == SCHEMA_VERSION
    assert [row["profile"] for row in rows(again, "attention_prefs")] == ["thijs"]


def test_a_schema_written_by_a_newer_plugin_is_refused(store):
    with store.transaction() as conn:
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")

    with pytest.raises(StoreError, match="upgrade the plugin"):
        ControlStore(store.path)


def test_a_failing_migration_leaves_an_empty_file_at_version_zero(tmp_path, monkeypatch):
    broken = ((*MIGRATIONS[0], "CREATE TABLE attention_prefs (profile TEXT)"),)
    monkeypatch.setattr(store_module, "MIGRATIONS", broken)
    path = tmp_path / "ergates" / "control.sqlite3"

    with pytest.raises(sqlite3.OperationalError, match="already exists"):
        ControlStore(path)

    monkeypatch.undo()
    reopened = ControlStore(path)
    assert reopened.schema_version == SCHEMA_VERSION


def test_a_transaction_commits_on_success(store):
    with store.transaction() as conn:
        _add_prefs(conn, "thijs")

    assert len(rows(store, "attention_prefs")) == 1


def test_a_transaction_rolls_back_on_an_error(store):
    with pytest.raises(RuntimeError):
        with store.transaction() as conn:
            _add_prefs(conn, "thijs")
            raise RuntimeError("boom")

    assert rows(store, "attention_prefs") == []


def test_a_read_cannot_write(store):
    with pytest.raises(sqlite3.OperationalError, match="readonly"):
        with store.read() as conn:
            _add_prefs(conn, "thijs")


def test_a_read_sees_one_snapshot_while_another_writer_commits(store):
    with store.read() as conn:
        before = conn.execute("SELECT COUNT(*) FROM attention_prefs").fetchone()[0]
        writer = threading.Thread(target=lambda: _write_one(store, "nora"))
        writer.start()
        writer.join()
        during = conn.execute("SELECT COUNT(*) FROM attention_prefs").fetchone()[0]

    assert (before, during) == (0, 0)
    assert len(rows(store, "attention_prefs")) == 1


def _write_one(store: ControlStore, profile: str) -> None:
    with store.transaction() as conn:
        _add_prefs(conn, profile)


def test_begin_immediate_serializes_read_modify_write_across_threads(store):
    """Each writer reads a counter, then writes it back plus one. With the write
    lock taken at BEGIN, no increment is lost."""
    with store.transaction() as conn:
        _add_prefs(conn, "counter", now=0.0)
    barrier = threading.Barrier(8)

    def bump() -> None:
        barrier.wait()
        for _ in range(25):
            with store.transaction() as conn:
                value = conn.execute("SELECT updated_at FROM attention_prefs").fetchone()[0]
                conn.execute("UPDATE attention_prefs SET updated_at = ?", (value + 1,))

    threads = [threading.Thread(target=bump) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert rows(store, "attention_prefs")[0]["updated_at"] == 200


def test_a_second_writer_waits_for_the_first_instead_of_failing(store):
    """A flush holds the write lock while a hook writes: the hook waits, then commits."""
    holding = threading.Event()
    finished = []

    def slow_writer() -> None:
        with store.transaction() as conn:
            _add_prefs(conn, "first")
            holding.set()
            time.sleep(0.5)

    first = threading.Thread(target=slow_writer)
    first.start()
    assert holding.wait(timeout=5)
    started = time.monotonic()
    with store.transaction() as conn:
        _add_prefs(conn, "second")
        finished.append(time.monotonic() - started)
    first.join()

    assert finished[0] >= 0.3
    assert sorted(row["profile"] for row in rows(store, "attention_prefs")) == ["first", "second"]


def test_a_writer_gives_up_after_its_busy_timeout(store):
    impatient = ControlStore(store.path, busy_timeout_ms=50)
    holding = threading.Event()
    release = threading.Event()

    def holder() -> None:
        with store.transaction():
            holding.set()
            release.wait(timeout=5)

    thread = threading.Thread(target=holder)
    thread.start()
    assert holding.wait(timeout=5)
    try:
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            with impatient.transaction():
                pass
    finally:
        release.set()
        thread.join()


def test_two_processes_open_a_fresh_store_at_the_same_moment(tmp_path):
    """The gateway and `hermes serve` start together on a new install."""
    path = tmp_path / "ergates" / "control.sqlite3"
    go = tmp_path / "go"
    script = (
        "import sys, time, pathlib\n"
        "from ergates.store import ControlStore\n"
        "go = pathlib.Path(sys.argv[2])\n"
        "while not go.exists():\n"
        "    time.sleep(0.001)\n"
        "print(ControlStore(sys.argv[1]).schema_version)\n"
    )
    env = {**os.environ, "PYTHONPATH": str(PACKAGE_ROOT)}
    workers = [
        subprocess.Popen(
            [sys.executable, "-c", script, str(path), str(go)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )
        for _ in range(2)
    ]
    time.sleep(0.3)
    go.touch()
    results = [worker.communicate(timeout=30) for worker in workers]

    assert [worker.returncode for worker in workers] == [0, 0], results
    assert [out.strip() for out, _err in results] == ["1", "1"]


def test_a_closed_store_refuses_further_use(store):
    store.close()

    with pytest.raises(StoreError, match="closed"):
        with store.transaction():
            pass
    with pytest.raises(StoreError, match="closed"):
        with store.read():
            pass


def test_foreign_keys_are_enforced(store):
    with pytest.raises(sqlite3.IntegrityError):
        with store.transaction() as conn:
            conn.execute(
                "INSERT INTO attention_outbox (event_id, state, next_attempt_at, updated_at) "
                "VALUES ('no-such-event', 'due', 1.0, 1.0)"
            )


def test_no_table_has_a_column_for_user_content(store):
    """docs/04 sections 4 and 8: the store keeps hashes, never prompt, command,
    briefing or description text. The schema has nowhere to put them."""
    forbidden = {"prompt", "command", "briefing", "description", "body", "text", "message"}
    with store.read() as conn:
        columns = {
            (table, row["name"])
            for table in TABLES
            for row in conn.execute(f"PRAGMA table_info({table})")
        }
    assert not {column for _table, column in columns} & forbidden
