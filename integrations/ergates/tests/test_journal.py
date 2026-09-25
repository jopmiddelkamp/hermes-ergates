"""Tests for ergates.journal.Journal: locked, atomically replaced JSON receipts."""

import json
import pathlib
import subprocess
import sys
import threading

from ergates.journal import Journal, JournalError


def test_claim_returns_the_record_the_first_time(tmp_path):
    journal = Journal(tmp_path, "proposals")

    record = journal.claim("abc123", {"state": "proposed"})

    assert record is not None
    assert record["id"] == "abc123"
    assert record["state"] == "proposed"


def test_claim_twice_returns_none_the_second_time(tmp_path):
    journal = Journal(tmp_path, "proposals")

    first = journal.claim("abc123", {"state": "proposed"})
    second = journal.claim("abc123", {"state": "proposed"})

    assert first is not None
    assert second is None


def test_claim_persists_across_journal_instances(tmp_path):
    Journal(tmp_path, "proposals").claim("abc123", {"state": "proposed"})

    # A fresh Journal instance over the same root sees the same claim.
    second_journal = Journal(tmp_path, "proposals")
    assert second_journal.claim("abc123", {"state": "proposed"}) is None
    assert second_journal.read("abc123")["state"] == "proposed"


def test_update_merges_fields_and_persists(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("abc123", {"state": "proposed"})

    updated = journal.update("abc123", state="completed", steps=["a", "b"])

    assert updated["state"] == "completed"
    assert updated["steps"] == ["a", "b"]
    assert journal.read("abc123")["state"] == "completed"
    assert journal.read("abc123")["steps"] == ["a", "b"]


def test_update_missing_id_raises_key_error(tmp_path):
    journal = Journal(tmp_path, "proposals")

    try:
        journal.update("missing", state="completed")
    except KeyError:
        pass
    else:
        raise AssertionError("expected KeyError for updating an unclaimed id")


def test_modify_applies_fn_to_the_current_record_and_persists_the_result(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("abc123", {"counter": 1})

    def _increment(record):
        record["counter"] += 1
        return record

    result = journal.modify("abc123", _increment)

    assert result["counter"] == 2
    assert journal.read("abc123")["counter"] == 2


def test_modify_missing_id_raises_key_error(tmp_path):
    journal = Journal(tmp_path, "proposals")

    try:
        journal.modify("missing", lambda record: record)
    except KeyError:
        pass
    else:
        raise AssertionError("expected KeyError for modifying an unclaimed id")


def test_modify_is_atomic_across_concurrent_threads(tmp_path):
    """The read-compute-write cycle must happen inside one lock acquisition: two
    threads incrementing the same counter must never lose an update to a race
    between one thread's read and the other's write."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("counter", {"n": 0})

    def _increment(record):
        record["n"] += 1
        return record

    def worker():
        for _ in range(25):
            journal.modify("counter", _increment)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert journal.read("counter")["n"] == 100  # 4 threads * 25 increments each


def test_read_missing_returns_none(tmp_path):
    journal = Journal(tmp_path, "proposals")

    assert journal.read("missing") is None


def test_list_returns_all_records(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("a", {"n": 1})
    journal.claim("b", {"n": 2})

    ids = sorted(record["id"] for record in journal.list())

    assert ids == ["a", "b"]


def test_list_is_empty_for_a_fresh_journal(tmp_path):
    journal = Journal(tmp_path, "proposals")

    assert journal.list() == []


def test_atomic_replace_leaves_no_partial_or_temp_file(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("abc123", {"state": "proposed"})
    journal.update("abc123", state="completed")

    kind_dir = tmp_path / "proposals"
    leftover_temp_files = [p for p in kind_dir.iterdir() if p.name.startswith(".tmp-")]
    assert leftover_temp_files == []

    # The record file itself must always contain complete, valid JSON -- never a
    # half-written fragment from an interrupted write.
    on_disk = json.loads((kind_dir / "abc123.json").read_text(encoding="utf-8"))
    assert on_disk["state"] == "completed"


def test_list_skips_in_flight_temp_writes_and_corrupt_records(tmp_path):
    """`_write_atomic`'s own temp files, and any orphaned/corrupt file left behind by
    a crashed writer, must never make list() raise -- only real, valid records count."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("good-one", {"state": "proposed"})

    kind_dir = tmp_path / "proposals"
    # Same naming scheme _write_atomic uses for an in-flight/orphaned temp write.
    (kind_dir / ".tmp-orphan123.json").write_text('{"incomplete": tr', encoding="utf-8")
    # A corrupt/truncated real record file (not a temp file at all).
    (kind_dir / "corrupt.json").write_text("{not valid json", encoding="utf-8")

    records = journal.list()

    assert [r["id"] for r in records] == ["good-one"]


def test_rejects_ids_that_look_like_path_traversal(tmp_path):
    journal = Journal(tmp_path, "proposals")

    try:
        journal.claim("../escape", {"state": "proposed"})
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for a path-traversal id")


def _run_with_watchdog(fn, seconds=3.0):
    """Run ``fn`` on a thread and fail if it has not finished within ``seconds``.

    A deadlock does not raise -- it hangs -- so the only way to test for one is
    a watchdog. The thread is a daemon so a genuine hang cannot wedge pytest.
    """
    box = {}

    def _target():
        try:
            box["value"] = fn()
        except BaseException as exc:  # pragma: no cover - surfaced by the assert below
            box["error"] = exc

    thread = threading.Thread(target=_target, daemon=True)
    thread.start()
    thread.join(timeout=seconds)
    assert not thread.is_alive(), f"deadlock: did not finish within {seconds}s"
    if "error" in box:
        raise box["error"]
    return box.get("value")


def test_a_nested_update_inside_a_modify_callback_completes(tmp_path):
    """The per-directory lock advertises re-entrancy, and flock does not provide it:
    a second acquisition opens a new descriptor, which POSIX treats independently,
    so the holding thread used to block against its own lock forever. No current
    call path nests, but the docstrings invite it -- and because
    pre_approval_request is unbounded in Hermes, a hang there wedges the approval
    prompt instead of failing fast."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("outer", {"n": 0})
    journal.claim("inner", {"n": 0})

    def _nested(record):
        journal.update("inner", n=1)  # nested acquisition, same thread + directory
        record["n"] = 1
        return record

    _run_with_watchdog(lambda: journal.modify("outer", _nested))

    assert journal.read("inner")["n"] == 1
    assert journal.read("outer")["n"] == 1


def test_nested_reads_writes_deletes_and_lists_all_complete(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("keep", {"n": 1})
    journal.claim("drop", {"n": 2})

    def _nested(record):
        record["seen"] = len(journal.list())
        record["read"] = journal.read("keep")["n"]
        journal.delete("drop")
        return record

    _run_with_watchdog(lambda: journal.modify("keep", _nested))

    assert journal.read("keep")["seen"] == 2
    assert journal.read("drop") is None


def test_the_lock_is_released_once_the_outermost_acquisition_exits(tmp_path):
    """Depth tracking must not leave the flock held after the outer `with` block:
    another process would then block forever on the next operation."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("a", {"n": 0})

    def _nested(record):
        journal.update("a", nested=True)
        return record

    _run_with_watchdog(lambda: journal.modify("a", _nested))

    # A fresh acquisition after the nested one must not block.
    _run_with_watchdog(lambda: journal.update("a", after=True))
    assert journal.read("a")["after"] is True


def test_a_second_process_can_still_take_the_lock_after_a_nested_acquisition(tmp_path):
    """The cross-process flock the module docstring leads with must survive the
    depth bookkeeping -- threads alone would be covered by the process RLock."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("counter", {"n": 0})

    def _nested(record):
        journal.update("counter", touched=True)
        return record

    _run_with_watchdog(lambda: journal.modify("counter", _nested))

    code = (
        "import sys;"
        "sys.path.insert(0, %r);"
        "from ergates.journal import Journal;"
        "j = Journal(%r, 'proposals');"
        "print(j.update('counter', from_other_process=True)['n'])"
    ) % (str(pathlib.Path(__file__).resolve().parents[1]), str(tmp_path))
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=30,
    )

    assert result.returncode == 0, result.stderr
    assert journal.read("counter")["from_other_process"] is True


def test_two_processes_serialize_on_the_same_record(tmp_path):
    """The lock's whole reason for existing: the CLI, gateway and cron surfaces are
    separate processes sharing one Hermes data root."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("counter", {"n": 0})
    package_root = str(pathlib.Path(__file__).resolve().parents[1])
    code = (
        "import sys;"
        f"sys.path.insert(0, {package_root!r});"
        "from ergates.journal import Journal;"
        f"j = Journal({str(tmp_path)!r}, 'proposals');"
        "inc = lambda r: (r.__setitem__('n', r['n'] + 1), r)[1];"
        "[j.modify('counter', inc) for _ in range(40)]"
    )
    workers = [
        subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for _ in range(3)
    ]
    for worker in workers:
        _out, err = worker.communicate(timeout=60)
        assert worker.returncode == 0, err.decode()

    assert journal.read("counter")["n"] == 120  # 3 processes * 40 increments


def test_delete_removes_a_record_and_reports_whether_it_did(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("gone", {"state": "proposed"})

    assert journal.delete("gone") is True
    assert journal.read("gone") is None
    assert journal.delete("gone") is False
    assert journal.delete("never-existed") is False


def test_delete_rejects_an_unsafe_id_without_touching_the_filesystem(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("keep", {"state": "proposed"})

    assert journal.delete("../keep") is False
    assert journal.read("keep") is not None


def test_delete_frees_the_id_for_a_fresh_claim(tmp_path):
    """What the reminder path relies on: drop a stale receipt, then claim the same
    idempotency key again for a new cron job."""
    journal = Journal(tmp_path, "reminders")
    journal.claim("key-1", {"job_id": "job-1"})
    journal.delete("key-1")

    assert journal.claim("key-1", {"job_id": "job-2"}) is not None
    assert journal.read("key-1")["job_id"] == "job-2"


def test_read_raises_on_a_corrupt_record_instead_of_reporting_it_absent(tmp_path):
    """"Damaged" is not "absent". A caller that cannot tell the two apart treats a
    corrupt receipt as a fresh request and does the thing the receipt existed to
    prevent -- so a single-record read fails closed."""
    journal = Journal(tmp_path, "reminders")
    journal.claim("receipt", {"job_id": "job-1"})
    (tmp_path / "reminders" / "receipt.json").write_text("{truncated", encoding="utf-8")

    try:
        journal.read("receipt")
    except JournalError as exc:
        assert "receipt.json" in str(exc)
        assert "truncated" not in str(exc)  # never the file's content
    else:
        raise AssertionError("expected JournalError for a corrupt record")


def test_read_still_returns_none_for_a_missing_or_unusable_id(tmp_path):
    journal = Journal(tmp_path, "reminders")

    assert journal.read("never-written") is None
    assert journal.read("../escape") is None


def test_modify_raises_journal_error_on_a_corrupt_record(tmp_path):
    journal = Journal(tmp_path, "proposals")
    journal.claim("rec", {"n": 1})
    (tmp_path / "proposals" / "rec.json").write_text("not json", encoding="utf-8")

    try:
        journal.modify("rec", lambda record: record)
    except JournalError:
        pass
    else:
        raise AssertionError("expected JournalError, not a raw JSONDecodeError")


def test_list_and_prune_stay_tolerant_of_the_corrupt_file_read_now_rejects(tmp_path):
    """The sweep path must keep working: one bad file cannot stop an iteration over
    the whole directory."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("good", {"n": 1})
    (tmp_path / "proposals" / "bad.json").write_text("{nope", encoding="utf-8")

    assert [r["id"] for r in journal.list()] == ["good"]


def test_read_works_from_inside_a_modify_callback(tmp_path):
    """read() now takes the directory lock, so it has to be re-entrant-safe."""
    journal = Journal(tmp_path, "proposals")
    journal.claim("a", {"n": 1})
    journal.claim("b", {"n": 2})

    def _nested(record):
        record["other"] = journal.read("b")["n"]
        return record

    _run_with_watchdog(lambda: journal.modify("a", _nested))

    assert journal.read("a")["other"] == 2
