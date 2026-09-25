"""Small, locked, atomically replaced JSON receipt store.

Each :class:`Journal` owns one directory, ``<root>/<kind>/``, holding one JSON
file per record: ``<root>/<kind>/<id>.json``. Writes are staged to a temp file
in the same directory and published with :func:`os.replace`, so a reader never
observes a half-written file, and a crash mid-write leaves the previous
complete record (or nothing) in place, never a partial one.

A process-local re-entrant lock plus an on-disk advisory lock file
(``<root>/<kind>/.lock``) serialize claim/update/prune across threads *and*
across separate OS processes sharing the same Hermes data root -- Hermes may
run the plugin's tool handler and its hook callbacks from different call
sites, and the CLI/gateway/cron surfaces are separate processes.

The directory lock is genuinely re-entrant for the *same thread and
directory*: a nested acquisition (e.g. a ``journal.update()`` from inside a
``modify()`` callback, or a second journal operation from a callback that
already holds the lock) only increments a per-(thread, directory) depth
counter. The ``flock`` itself is taken once, at depth 0, and released once,
when the outermost acquisition exits -- because POSIX treats locks from
separate ``open()`` calls as independent, so a naive re-entry would block
the holding thread against itself forever.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

try:  # POSIX
    import fcntl
except ImportError:  # pragma: no cover - exercised only on non-POSIX platforms
    fcntl = None  # type: ignore[assignment]

try:  # Windows fallback
    import msvcrt
except ImportError:  # pragma: no cover - exercised only on POSIX platforms
    msvcrt = None  # type: ignore[assignment]


_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class JournalError(Exception):
    """A record exists but could not be read (corrupt JSON, unreadable file).

    Deliberately distinct from "no such record", which is ``None``: a
    caller that cannot tell the difference will happily treat a damaged
    receipt as a fresh request and do the thing the receipt existed to
    prevent. Every single-record read here fails closed with this instead.
    """

# One process-local lock per (resolved) journal directory, so concurrent
# threads in this process serialize before ever touching the on-disk lock.
_PROCESS_LOCKS: Dict[str, threading.RLock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()

# Per-thread re-entrancy bookkeeping: {directory key -> depth} and the single
# locked file handle held at depth 0. Thread-local by construction, so the
# effective key is (thread, directory) -- exactly the granularity ``flock``
# does *not* give us on its own.
_LOCAL = threading.local()


def _thread_depths() -> Dict[str, int]:
    depths = getattr(_LOCAL, "depths", None)
    if depths is None:
        depths = {}
        _LOCAL.depths = depths
    return depths


def _thread_handles() -> Dict[str, Any]:
    handles = getattr(_LOCAL, "handles", None)
    if handles is None:
        handles = {}
        _LOCAL.handles = handles
    return handles


def is_safe_id(record_id: Any) -> bool:
    """True when ``record_id`` is usable as a journal record id (see :func:`_safe_id`)."""
    return isinstance(record_id, str) and bool(_ID_RE.match(record_id))


def _safe_id(record_id: str) -> str:
    """Validate a record id is a safe, single path segment (no traversal, no separators)."""
    if not is_safe_id(record_id):
        raise ValueError(f"invalid journal id: {record_id!r}")
    return record_id


class _DirectoryLock:
    """Advisory, cross-process exclusive lock guarding one Journal directory.

    Re-entrant per (thread, directory): the ``flock`` is taken on the
    outermost acquisition and released only when that one exits. Nested
    acquisitions in the same thread just bump a depth counter, because
    ``flock``-ing a second file descriptor for the same file would block the
    holding thread against its own lock (POSIX treats descriptors from
    separate ``open()`` calls independently).
    """

    def __init__(self, lock_path: Path):
        self._lock_path = lock_path
        key = str(lock_path.resolve()) if lock_path.parent.exists() else str(lock_path)
        self._key = key
        with _PROCESS_LOCKS_GUARD:
            self._process_lock = _PROCESS_LOCKS.setdefault(key, threading.RLock())

    def _flock(self, fh) -> None:
        if fcntl is not None:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        elif msvcrt is not None:  # pragma: no cover - Windows only
            msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)

    def _unflock(self, fh) -> None:
        if fcntl is not None:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        elif msvcrt is not None:  # pragma: no cover - Windows only
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)

    def __enter__(self) -> "_DirectoryLock":
        self._process_lock.acquire()
        try:
            depths = _thread_depths()
            depth = depths.get(self._key, 0)
            if depth == 0:
                fh = open(self._lock_path, "a+")
                try:
                    self._flock(fh)
                except BaseException:
                    fh.close()
                    raise
                _thread_handles()[self._key] = fh
            depths[self._key] = depth + 1
        except BaseException:
            # Never strand the process lock on an acquisition failure: the
            # next journal operation in this process would deadlock on it.
            self._process_lock.release()
            raise
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            depths = _thread_depths()
            depth = depths.get(self._key, 1) - 1
            if depth > 0:
                depths[self._key] = depth
                return
            depths.pop(self._key, None)
            fh = _thread_handles().pop(self._key, None)
            if fh is not None:
                try:
                    self._unflock(fh)
                finally:
                    fh.close()
        finally:
            self._process_lock.release()


class Journal:
    """Locked, atomically replaced JSON receipts under ``<root>/<kind>/<id>.json``."""

    def __init__(self, root: Path, kind: str):
        self.root = Path(root)
        self.kind = kind
        self.dir = self.root / kind
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock_file = self.dir / ".lock"

    def _lock(self) -> _DirectoryLock:
        return _DirectoryLock(self._lock_file)

    def _record_path(self, record_id: str) -> Path:
        return self.dir / f"{_safe_id(record_id)}.json"

    def claim(self, id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Create the record for ``id`` iff it does not already exist.

        Returns the stored record (payload plus ``id``) on success, or
        ``None`` when a record for this id was already claimed -- by this
        process or another one sharing the same journal directory.
        """
        with self._lock():
            path = self._record_path(id)
            if path.exists():
                return None
            record = dict(payload)
            record["id"] = id
            self._write_atomic(path, record)
            return record

    def update(self, id: str, **fields: Any) -> Dict[str, Any]:
        """Merge ``fields`` into the existing record for ``id`` and persist it.

        Raises ``KeyError`` if no record has been claimed for ``id``. Built
        on :meth:`modify`, so this is one read-modify-write under a single
        lock acquisition, not a separate ``read()`` followed by a separate
        locked write.
        """
        def _merge(record: Dict[str, Any]) -> Dict[str, Any]:
            record.update(fields)
            return record

        return self.modify(id, _merge)

    def modify(self, id: str, fn: Callable[[Dict[str, Any]], Dict[str, Any]]) -> Dict[str, Any]:
        """Atomically read-modify-write the record for ``id`` in one lock acquisition.

        ``fn`` receives the current record (a fresh dict read from disk
        under the lock) and must return the complete record to persist --
        typically the same dict, mutated in place and returned. The read,
        the call to ``fn``, and the write all happen while holding the same
        lock, so this is safe against two concurrent callers modifying the
        same record (e.g. two threads each incrementing a counter): the
        second caller always sees the first caller's already-committed
        write, never a stale value from before it.

        This is the primitive every read-modify-write helper on this class
        (``update``, and ``AttentionJournal.record_publish_attempt``) is
        built on, rather than composing a separate ``read()`` and a separate
        ``update()`` call, which -- each individually locked, but not
        together -- can race and lose an update.

        ``fn`` may itself call back into this journal (or another journal
        over the same directory): the directory lock is re-entrant per
        (thread, directory), so a nested ``update()``/``delete()`` completes
        instead of deadlocking. A nested write is still published before
        this call's own write, which overwrites it -- so nest reads and
        writes to *other* records, not to ``id`` itself.

        Raises ``KeyError`` if no record has been claimed for ``id``.
        """
        with self._lock():
            path = self._record_path(id)
            existing = self._read_strict(path)
            if existing is None:
                raise KeyError(f"no journal record for id {id!r}")
            updated = fn(existing)
            updated["id"] = id
            self._write_atomic(path, updated)
            return updated

    def delete(self, id: str) -> bool:
        """Delete the record for ``id``. Returns ``True`` when a record was removed.

        Used by the retention paths (``prune``) and by the reminder creator
        when a receipt turns out to point at a cron job that no longer
        exists. Safe to call from inside a ``modify()`` callback: the
        directory lock is re-entrant per (thread, directory).
        """
        with self._lock():
            try:
                path = self._record_path(id)
            except ValueError:
                return False
            if not path.exists():
                return False
            path.unlink(missing_ok=True)
            return True

    def read(self, id: str) -> Optional[Dict[str, Any]]:
        """Return the record for ``id``, or ``None`` if it does not exist.

        Locked like every other operation on this class, so a concurrent
        writer never interleaves with the read. A record that exists but
        cannot be parsed raises :class:`JournalError` rather than coming
        back as ``None``: "damaged" is not "absent", and conflating them
        turns a corrupt receipt into a duplicate side effect. An unusable
        id is ``None`` -- no such record can exist under it.
        """
        try:
            path = self._record_path(id)
        except ValueError:
            return None
        with self._lock():
            return self._read_strict(path)

    def list(self) -> List[Dict[str, Any]]:
        """Return every readable record currently in this journal, in filename order.

        Locked like every other operation here, so a concurrent writer never
        interleaves with the read. An in-flight temp write or an
        orphaned/corrupt file is skipped (and logged), never raised --
        ``list()`` iterates over everything in the directory and must not go
        down because one file is bad.
        """
        records: List[Dict[str, Any]] = []
        with self._lock():
            for path in sorted(self._record_paths()):
                record = self._try_read(path)
                if record is not None:
                    records.append(record)
        return records

    def _record_paths(self) -> List[Path]:
        """Real record files only -- excludes in-flight/orphaned temp writes.

        ``_write_atomic`` never leaves a temp file matching this pattern
        (its suffix does not end in ``.json``), but names starting with
        ``.`` are also filtered here as defense in depth: ``pathlib.Path.glob``
        (unlike a POSIX shell glob) *does* match dotfiles against ``"*.json"``.
        """
        return [path for path in self.dir.glob("*.json") if not path.name.startswith(".")]

    def _try_read(self, path: Path) -> Optional[Dict[str, Any]]:
        """Like :meth:`_read_strict`, but never raises -- logs and returns ``None`` instead.

        This is the sweep path (``list``/``prune``): iterating everything in
        the directory must not go down because one file is bad. Single-record
        reads use the strict form, where silently skipping a damaged record
        would be a correctness bug rather than a resilience feature.
        """
        try:
            return self._read_strict(path)
        except JournalError as exc:
            logger.warning("journal: skipping unreadable record %s: %s", path, exc)
            return None

    def _read_strict(self, path: Path) -> Optional[Dict[str, Any]]:
        """``None`` when the file does not exist; :class:`JournalError` when it cannot be read.

        The exception message names the file and the parse failure, never
        any of its content -- a record's bytes must not reach a log line.
        """
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError) as exc:
            # json.JSONDecodeError is a ValueError subclass.
            raise JournalError(f"unreadable journal record {path.name}: {type(exc).__name__}") from exc

    def _write_atomic(self, path: Path, record: Dict[str, Any]) -> None:
        # Suffix deliberately does not end in ".json" so an in-flight or
        # orphaned temp file can never be mistaken for a record by
        # `_record_paths`'s "*.json" glob.
        fd, tmp_name = tempfile.mkstemp(dir=self.dir, prefix=".tmp-", suffix=".json.part")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(record, fh, indent=2, sort_keys=True)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, path)
        except BaseException:
            if os.path.exists(tmp_name):
                os.remove(tmp_name)
            raise
