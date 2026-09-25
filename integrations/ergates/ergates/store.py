"""The Ergates control store: one SQLite file for every integration record.

``<hermes root>/ergates/control.sqlite3`` (see :mod:`ergates.paths`) holds the
reminder and proposal receipts, the attention events, their push outbox and
the attention preferences of every profile and every process of one Hermes
install (roadmap decision D2). Hermes's own databases are never opened here.

Every write runs inside :meth:`ControlStore.transaction`, which starts with
``BEGIN IMMEDIATE``: the write lock is taken before the first read, so two
writers never interleave a read-modify-write, across threads or across
processes. A writer that finds the lock taken waits up to the busy timeout.
Each transaction and each read opens its own short-lived connection, so one
store object is safe to share between Hermes's hook threads and the
delivery threads.

The schema is versioned with ``PRAGMA user_version``. :data:`MIGRATIONS` holds
one tuple of statements per version; opening a store applies the missing
versions inside one transaction, and a file written by a newer plugin is
refused instead of guessed at.

The schema has no column for prompt, command, briefing or description text:
receipts and events keep identifiers and sha256 hashes only (docs/04
sections 4 and 8).
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

SCHEMA_VERSION: int = 1

_V1: tuple[str, ...] = (
    # One row per reminder request. ``version`` grows on every change; every
    # change names the version it read (compare-and-set).
    """
    CREATE TABLE reminder_receipts (
        id TEXT PRIMARY KEY,
        request_id TEXT,
        profile TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('creating', 'created', 'uncertain')),
        job_id TEXT,
        job_name TEXT NOT NULL,
        timezone_advisory TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    )
    """,
    """
    CREATE TABLE proposal_receipts (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('proposed', 'accepted', 'complete', 'rejected')),
        proposal_hash TEXT NOT NULL,
        reserved_profile_name TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        expires_at_epoch REAL NOT NULL,
        source_session_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    )
    """,
    # At most one accepted (still provisioning) proposal per profile name.
    "CREATE UNIQUE INDEX proposal_reservations ON proposal_receipts (reserved_profile_name) "
    "WHERE state = 'accepted'",
    """
    CREATE TABLE proposal_steps (
        proposal_id TEXT NOT NULL REFERENCES proposal_receipts (id) ON DELETE CASCADE,
        step TEXT NOT NULL CHECK (step IN ('profile_created', 'plugin_enabled', 'configured', 'bot_chat', 'briefing')),
        status TEXT NOT NULL CHECK (status IN ('done', 'uncertain', 'failed')),
        updated_at REAL NOT NULL,
        PRIMARY KEY (proposal_id, step)
    ) WITHOUT ROWID
    """,
    """
    CREATE TABLE attention_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('approval', 'completion')),
        state TEXT NOT NULL CHECK (state IN ('pending', 'resolved', 'expired')),
        profile TEXT,
        session_id TEXT,
        surface TEXT,
        correlation TEXT,
        request_id TEXT,
        choice TEXT,
        created_at REAL NOT NULL,
        expires_at REAL,
        resolved_at REAL
    )
    """,
    "CREATE INDEX attention_events_open ON attention_events (kind, state, created_at)",
    "CREATE INDEX attention_events_terminal ON attention_events (state, resolved_at)",
    # One push per event. Delivery bookkeeping lives here, never on the event.
    """
    CREATE TABLE attention_outbox (
        event_id TEXT PRIMARY KEY REFERENCES attention_events (id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('due', 'sent', 'cancelled', 'gave_up')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at REAL NOT NULL,
        lease_owner TEXT,
        lease_until REAL,
        last_error TEXT,
        updated_at REAL NOT NULL
    )
    """,
    "CREATE INDEX attention_outbox_due ON attention_outbox (state, next_attempt_at)",
    # Per-profile push preferences; the profile "*" holds the default.
    """
    CREATE TABLE attention_prefs (
        profile TEXT PRIMARY KEY,
        muted INTEGER NOT NULL CHECK (muted IN (0, 1)),
        quiet_start TEXT,
        quiet_end TEXT,
        updated_at REAL NOT NULL
    )
    """,
)

MIGRATIONS: tuple[tuple[str, ...], ...] = (_V1,)


class StoreError(Exception):
    """The store cannot be used: it is closed, or a newer plugin wrote its schema."""


def _give_to_hermes_owner(paths: list[Path], hermes_root: Path) -> None:
    """Give ``paths`` the owner and group of ``hermes_root`` when this process runs as root.

    A root process that is the first to open the store would otherwise leave
    the folder and the file root's, ``0700`` and ``0600``, and the ``hermes``
    user that runs every Hermes service could not open the store:
    ``register()`` raises and the plugin is gone. Only what this process
    created in this call is passed in; an existing folder or file keeps its
    owner. This does not make root runs safe: on an existing store SQLite
    creates the ``-wal`` and ``-shm`` files as root and never hands them over
    (see :func:`root_run_would_break`). Does nothing when the process is not
    root, or the platform has no ``os.geteuid``. Root without the right to
    change owners (a rootless container) logs a warning and continues, as
    Hermes's own container setup does when its chown fails.
    """
    geteuid = getattr(os, "geteuid", None)
    if not paths or geteuid is None or geteuid() != 0:
        return
    owner = os.stat(hermes_root)
    for path in paths:
        try:
            os.chown(path, owner.st_uid, owner.st_gid)
        except FileNotFoundError:
            pass  # SQLite removed a -wal or -shm file when its last connection closed
        except OSError as exc:
            logger.warning("ergates: could not hand %s to the Hermes user (%s); continuing",
                           path.name, type(exc).__name__)


def root_run_would_break(hermes_root: Path) -> bool:
    """True when this process runs as root and ``hermes_root`` belongs to another user.

    SQLite creates a store's ``-wal`` and ``-shm`` files as the user that
    opens it and does not hand them to the owner of the database file, so a
    root process can leave files the Hermes user cannot open; every hook then
    fails until someone runs ``chown -R hermes:hermes <root>/ergates``.
    ``python -m ergates.flush`` refuses to start when this is true. False when
    root owns the Hermes root (root is then the Hermes user) or the platform
    has no ``os.geteuid``.
    """
    geteuid = getattr(os, "geteuid", None)
    return geteuid is not None and geteuid() == 0 and os.stat(hermes_root).st_uid != 0


class ControlStore:
    """Transactional SQLite store for receipts, attention events and the push outbox."""

    def __init__(self, path: Path | str, *, busy_timeout_ms: int = 5000) -> None:
        self._path = Path(path)
        self._timeout = busy_timeout_ms / 1000.0
        self._closed = False
        folder = self._path.parent
        created: list[Path] = []
        try:
            folder.mkdir(mode=0o700, parents=True)
        except FileExistsError:
            pass
        else:
            created.append(folder)
        try:
            # Create the file ourselves so it is private from the first byte;
            # SQLite gives the -wal and -shm files the same permissions.
            fd = os.open(self._path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
            created.append(self._path)
        # Before the first connection, so the file SQLite opens already
        # belongs to the Hermes user. SQLite does not hand over the -wal and
        # -shm files it creates, so only the ones created in this call are
        # handed over below; root runs on an existing store are unsupported.
        _give_to_hermes_owner(created, folder.parent)
        sidecars = [self._path.with_name(self._path.name + suffix) for suffix in ("-wal", "-shm")]
        new_sidecars = [item for item in sidecars if not item.exists()] if self._path in created else []
        self._migrate()
        _give_to_hermes_owner([item for item in new_sidecars if item.exists()], folder.parent)

    @property
    def path(self) -> Path:
        """The database file."""
        return self._path

    @property
    def schema_version(self) -> int:
        """``PRAGMA user_version`` of the database file."""
        with self.read() as conn:
            return int(conn.execute("PRAGMA user_version").fetchone()[0])

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """``BEGIN IMMEDIATE`` on a fresh connection; commit on success, roll back on any error."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
        finally:
            conn.close()

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        """A read-only snapshot: every statement inside sees the same committed state."""
        conn = self._connect()
        try:
            conn.execute("PRAGMA query_only = ON")
            conn.execute("BEGIN")
            try:
                yield conn
            finally:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
        finally:
            conn.close()

    def close(self) -> None:
        """Refuse further use. Connections live for one operation, so none stays open."""
        self._closed = True

    def _connect(self) -> sqlite3.Connection:
        if self._closed:
            raise StoreError("the control store is closed")
        conn = sqlite3.connect(self._path, timeout=self._timeout, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA synchronous = FULL")
        # On macOS, fsync() only reaches the drive's write cache, not the
        # platter (man 2 fsync); only F_FULLFSYNC does. SQLite issues
        # F_FULLFSYNC on a commit only when this pragma is on. It has no
        # effect on Linux, where fsync() already flushes the drive.
        conn.execute("PRAGMA fullfsync = ON")
        return conn

    def _migrate(self) -> None:
        conn = self._connect()
        try:
            self._use_wal(conn)
            conn.execute("BEGIN IMMEDIATE")
            try:
                current = int(conn.execute("PRAGMA user_version").fetchone()[0])
                if current > len(MIGRATIONS):
                    raise StoreError(
                        f"{self._path.name} has schema version {current}, but this plugin knows "
                        f"versions up to {len(MIGRATIONS)}; upgrade the plugin"
                    )
                for version in range(current + 1, len(MIGRATIONS) + 1):
                    for statement in MIGRATIONS[version - 1]:
                        conn.execute(statement)
                    conn.execute(f"PRAGMA user_version = {version}")
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
        finally:
            conn.close()

    def _use_wal(self, conn: sqlite3.Connection) -> None:
        """Switch the file to WAL. Retried until the busy timeout: SQLite answers
        "database is locked" at once, without waiting, while another process
        holds the lock on a brand-new file."""
        deadline = time.monotonic() + self._timeout
        while True:
            try:
                conn.execute("PRAGMA journal_mode = WAL")
                return
            except sqlite3.OperationalError as exc:
                if "locked" not in str(exc) or time.monotonic() >= deadline:
                    raise
                time.sleep(0.01)
