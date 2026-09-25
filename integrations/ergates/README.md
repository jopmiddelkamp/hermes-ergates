# ergates (Hermes plugin)

Small, dependency-free Hermes Agent plugin for the Ergates project. It gives
the concierge a validated agent-proposal tool and journals background
attention events (approval requests) with an optional ntfy push, all backed
by locked, atomically-replaced JSON receipts under the Hermes data root.

This package does **not** create profiles, run a scheduler, or talk to any
Hermes RPC/REST endpoint on its own. It is deliberately scoped to validation
and journaling; provisioning, connection registries, and the actual
cron/ntfy transport calls are supplied by the caller (see "Design choices"
below).

See `docs/11-implementation-readiness.md` section 4 and
`docs/03-technical-design.md` sections 8-9 in the repository root for the
contracts this package implements.

## Layout

```
integrations/ergates/
  plugin.yaml          # Hermes directory-plugin manifest
  __init__.py          # Hermes entry point: register(ctx)
  ergates/             # the actual logic, plain importable package
    journal.py         # locked, atomically-replaced JSON receipt store
    proposals.py       # ergates.agent-proposal.v1 validation + canonical hash
    reminders.py        # idempotent reminder creation on top of Hermes cron
    attention.py        # ntfy publish requests, deep link, retention/expiry
    tool.py             # ctx.register_tool / ctx.register_hook wiring
    flush.py            # `python -m ergates.flush`: periodic retries + retention
  tests/               # pytest suite (one file per module above, plus tool.py)
```

## Install

Copy or symlink this directory into `$HERMES_HOME/plugins/ergates/` (the
user-plugin directory Hermes scans, per `hermes_cli/plugins_discovery.py`):

```bash
ln -s "$(pwd)/integrations/ergates" ~/.hermes/plugins/ergates
hermes plugins doctor   # validates plugin.yaml, __init__.py, register(ctx)
```

In the Compose deployment this is a read-only bind mount at
`/opt/data/plugins/ergates` instead -- see `deploy/docker-compose.yml` and
the "Verify the integration plugin is installed" step in `deploy/README.md`.

## Configuration

Read via `ctx.get_config(...)`, i.e. `plugins.entries.ergates.settings.*` in
`config.yaml`:

| Key | Default | Purpose |
|---|---|---|
| `ntfy.server` | unset (push disabled) | ntfy server base URL |
| `ntfy.topic` | unset (push disabled) | ntfy topic to publish attention events to |
| `ntfy.token` | unset | ntfy publish token (Bearer), or `user:pass` for Basic |
| `ntfy.connection_id` | unset | app connection id used to build the `Click` deep link |
| `ntfy.default_profile` | unset | profile name used to build the `Click` deep link, **only** when `ctx.profile_name` is unavailable (see below) |

No credentials are ever read from, or written into, this repository. Push is
skipped (not an error) whenever `ntfy.server` or `ntfy.topic` is unset.

The `profile` used for the `Click` link (and stored on the attention record,
see below) is **not** just `ntfy.default_profile` -- `register(ctx)` prefers
`ctx.profile_name` (the actual running profile, per `hermes_cli/plugins.py`
in the pinned checkout; works in gateway and kanban workers too, not only
the interactive CLI) and only falls back to the `ntfy.default_profile`
setting when that is unavailable.

## Data on disk

Under `$HERMES_HOME/ergates/` (default `~/.hermes/ergates/`):

```
ergates/proposals/<proposal_id>.json      # ergates_propose_agent journal
ergates/reminders/<request_id>.json       # ReminderCreator journal (payload hash
                                          #   when the caller supplies no request_id)
ergates/notifications/<event_id>.json     # AttentionJournal (approval attention events)
```

Every record is a small JSON file, written via temp-file-plus-`os.replace`
under a per-directory advisory lock (POSIX `fcntl`, best-effort `msvcrt` on
Windows) so a reader never sees a partial file and two concurrent claims of
the same id never both succeed. `list()`/`prune()` also take that lock and
tolerate an in-flight temp write or a corrupt file (skipped and logged, never
raised). The lock is re-entrant per (thread, directory): the `flock` is taken
once, on the outermost acquisition, so a nested `update()` from inside a
`modify()` callback completes instead of blocking the holding thread against
its own lock.

### Retention

Every journal expires its records; nothing here is kept forever (04 section
8). All three rules are applied by `python -m ergates.flush` -- see
"Periodic sweep" below, because nothing in Hermes drives them.

| Journal | Dropped when |
|---|---|
| `notifications/` | terminal -- resolved, expired, or delivery gave up -- for more than 7 days, tracked in `resolved_at`. A pending record older than `PENDING_MAX_AGE_SECONDS` (1800s, the shipped profiles' `approvals.timeout`) is first *transitioned* to `state: "expired"` with `resolved_at` set to the moment the approval timed out, keeping `attempts`/`delivery` as delivery left them, and then ages out on that same 7-day rule -- an unanswered approval leaves an audit trail rather than vanishing |
| `proposals/` | still `"proposed"` more than 24h past its own `expires_at`. An accepted receipt is a provisioning record and is never dropped by retention |
| `reminders/` | its cron job no longer exists (via the injected `get_job`), or the receipt has been unused for 30 days |

`retry_due` refuses to return a pending record past that age whether or not
the expiry sweep has marked it yet, so an expired approval is never
re-published (11 section 4.2) and nothing can slip through between sweeps.

Reads fail closed. `Journal.read` takes the directory lock and raises
`JournalError` for a record that exists but cannot be parsed, instead of
reporting it as absent -- a caller that cannot tell "damaged" from "absent"
does the thing the receipt existed to prevent, so `ReminderCreator.create`
turns it into a `ReminderCreationError` and creates no cron job. The sweep
paths (`list`, `prune`) stay tolerant: one bad file must not stop an
iteration over the directory.

A notification record holds exactly what 11 section 4.2 specifies -- plus
two non-secret routing identifiers needed to retry correctly -- and never
the command or its description:

```
{
  "id": "<event_id>",
  "state": "pending" | "resolved" | "expired" | "failed",
  "session_key": "...",
  "pattern_key": "...",
  "command_hash": "sha256 hex, or null -- never the command text",
  "connection_id": "...",   // non-secret app-connection routing id, captured once
  "profile": "...",         // owning profile, captured once
  "surface": "gateway",     // which approval surface asked; correlation is per surface
  "created_at": 1234567890.0,
  "resolved_at": null,
  "attempts": 0,
  "next_retry": null,
  "delivery": null
}
```

`connection_id` and `profile` are captured once, when `on_approval_request`
first journals the event, and never overwritten afterwards. This matters
for retries (below): different pending approvals can belong to different
sessions/connections/profiles, so a retry must use *that event's own*
values, never whatever happens to be configured at retry time.

## Design choices worth flagging

- **`ReminderCreator`'s two injected Hermes calls** are callables, not a
  hardcoded HTTP/RPC client, so the package stays transport-agnostic and
  unit-testable without a running Hermes instance:

  ```python
  create_job(body, *, profile) -> dict          # required
  get_job(job_id, *, profile) -> dict | None    # optional, strongly recommended
  ```

  `body` holds only real `CronJobCreate` fields (`hermes_cli/web_models.py`
  at the pin): `schedule`, `prompt`, `name`. **The profile is passed out of
  band**, as a keyword argument, because cron scopes by profile outside the
  body -- `?profile=` on `POST /api/cron/jobs`
  (`hermes_cli/web_routers/cron.py`, `_cron_profile_home`) or the `profile`
  parameter of the `cron.manage` RPC (`tui_gateway/methods_tools.py`). Wire
  `get_job` to `GET /api/cron/jobs/{job_id}?profile=` (or `cron.jobs.get_job`
  in-process); `None` means "no such job", and raising means "could not
  tell", which keeps the receipt.
- **The reminder `name` carries the `[bot:<profile>] ` prefix** (docs/06
  section 6) because `name` is a display label in `CronJobCreate`, not a
  profile field -- it is what clients filter routines on. The default label
  appends a short slice of the payload hash so two reminders for one bot are
  distinguishable in a listing; it never contains prompt text. Pass
  `label="..."` to override.
- **Timezone is advisory, and the receipt says so.** Hermes 0.21.2 has no
  per-job timezone: `CronJobCreate`, `cron.jobs.create_job` and the
  `cron.manage` RPC accept none, and `timezone` is a single global config key
  (`hermes_cli/config_defaults.py`; empty = server-local). So the zone is not
  sent to the scheduler. It stays in the idempotency key -- two requests that
  differ only in zone must not collapse into one receipt, or one of them
  silently disappears -- and comes back on the receipt as
  `timezone_advisory`. **A reminder fires in the server's timezone** until
  per-job timezone support exists upstream.
- **`request_id` is what makes reuse detection real.** Pass the app's
  per-attempt outbox id as `request_id` and it becomes the journal id, with
  the payload hash stored as an independent field: the same id arriving with
  a different payload comes back as `state: "conflict"` and creates no job
  (11 section 4.3's "retries with a different payload must fail"). Without a
  `request_id` the journal id falls back to the payload hash itself, where a
  changed payload is simply a different id -- safe against duplicates, but
  structurally unable to detect reuse.
- **A receipt is verified against cron before it is trusted.** 11 section 4.3
  keeps list/edit/**delete** on native cron, so a reminder deleted in the
  Routines screen leaves a receipt behind. Before returning an existing
  `created` receipt, `create()` resolves its `job_id` through `get_job`; when
  the job is gone the receipt is dropped and one fresh job is created. Without
  an injected `get_job` this check is impossible and the stale receipt is
  trusted (the old behavior), which reports success for a reminder that will
  never fire.
- **Receipts store hashes, not content.** A reminder receipt holds the
  profile, normalized schedule, `timezone_advisory`, `payload_hash`,
  `prompt_hash`, `request_id` and `job_id` -- never the prompt. A proposal
  receipt holds `proposal_hash`, `reserved_profile_name`, `completed_steps`,
  `source_session_id` and `briefing_delivery` (11 section 4.1) -- never the
  `briefing` or the `description`. The full proposal still reaches the app in
  the tool result, which is a transport, not a store.
- **`build_ntfy_publish`** only builds the request (URL, headers, body); it
  never sends it. The default runtime transport, `ergates.tool.send_ntfy`,
  is a thin `urllib.request` POST wired in by `register(ctx)` -- swap it out
  by calling `on_approval_request(..., publish=your_callable)` directly if
  you need a different transport.
- **`event_id`** on `build_ntfy_publish` is bookkeeping metadata for the
  caller (e.g. to correlate a publish attempt with its `AttentionJournal`
  record); it is not encoded into the HTTP request because ntfy's publish
  API has no client-settable message-id header (confirmed against
  <https://docs.ntfy.sh/publish/> at the time of writing).
- **Correlating `pre_approval_request` and `post_approval_response`**: these
  hooks carry no stable approval id (see `VALID_HOOKS` in
  `hermes_cli/plugins.py`), and Hermes allows several approvals to be
  pending in the same session at once, so `session_key` alone is not enough
  to pick the right one. `on_approval_response` correlates on
  `(session_key, pattern_key, command_hash)` -- `command_hash` is a sha256
  digest of the command, never the command itself -- and resolves the
  *oldest* matching unresolved record. When nothing matches, it resolves
  nothing and logs, rather than guessing.
- **`ergates_propose_agent` never creates a profile.** `propose_handler`
  only validates input and journals a `"proposed"` record; there is no
  profile-creation call anywhere in this package.
- **`source_session_id`** on the returned/journaled proposal comes only from
  the handler's own `session_id`/`task_id` kwargs -- how Hermes actually
  dispatches tool handlers (`handler(args, task_id=..., session_id=...)`,
  per `tools/registry.py`'s `dispatch_kwargs` in the pinned checkout) --
  never from a model-supplied `args` field. `session_id` is preferred;
  `task_id` is the fallback for contexts (e.g. cron) that carry a task id
  but no session id.
- **`Journal.modify(id, fn)`** is the atomic read-modify-write primitive
  every counter-like update on this class is built on (`update()`, and
  `AttentionJournal.record_publish_attempt` below): it takes the lock once,
  reads the current record, calls `fn(record) -> record`, and writes the
  result -- all inside that single lock acquisition. Composing a separate
  `read()` and a separate `update()` call is *not* equivalent: each is
  individually locked, but not together, so two concurrent callers can both
  read the same stale value and one's increment silently overwrites the
  other's.
- **ntfy publish retries.** A failed publish is tracked, not swallowed:
  `AttentionJournal.record_publish_attempt` (built on `Journal.modify`, so
  concurrent callers for the same event can never lose an increment)
  schedules the next retry with a 30s / 2min / 10min backoff (holding at
  10min for any attempt beyond that), and gives up after 5 total attempts
  (`state` becomes `"failed"` -- meaning delivery gave up, not that the
  approval itself was answered; `on_approval_response` still resolves a
  `"failed"` record if the user answers through a channel the push never
  reached). `AttentionJournal.retry_due(now)` lists pending records whose
  retry has arrived, and `ergates.tool.flush_retries(journal, now, publish,
  ntfy_server=..., ntfy_topic=..., ntfy_token=...)` re-publishes them and
  records the outcome. `flush_retries` takes **no** global connection/profile
  argument -- each retried record's `Click` link is built from *that
  record's own* `session_key`/`connection_id`/`profile` (see "Data on disk"
  above), never one global value applied to every due record, which would
  be wrong the moment two due records belong to different
  sessions/profiles. An expired pending record is never re-published at all
  (see "Retention" above).
- **The push runs off the hook thread.** `pre_approval_request` is
  deliberately *not* in Hermes's `_HOOK_TIMEOUT_BOUNDED_HOOKS`
  (`hermes_cli/plugins_dispatch.py`: "Hooks not listed below run
  synchronously to completion"), and on the gateway path it fires *before*
  `notify_cb` reaches the app (`tools/approval_gateway_wait.py`). A
  synchronous POST there would delay the in-app approval card by the socket
  timeout on every dangerous command, with nothing in Hermes to rescue it.
  So the journal write stays synchronous -- local, locked, and what the
  retry sweep needs -- while the publish runs on a short-lived daemon thread
  that records its own outcome through `record_publish_attempt`.
  `send_ntfy`'s socket timeout is 3s as a backstop for that worker.
- **Duplicate hook calls are skipped, not journaled.** Hermes fires
  `pre_approval_request` more than once per user-visible prompt: a coalesced
  follower fires it with `coalesced=True` (and, when it adopts the leader's
  `once`, fires **no** post hook before falling through to a fresh prompt),
  and `approvals.mode: smart` fires pre/post with `surface="smart"` around an
  aux-LLM verdict. Both would mean duplicate buzzes for one decision and
  orphan records nothing resolves, so both are skipped entirely -- no record,
  no push. `surface` is stored on each record and joins the correlation
  tuple, so a response resolves an event from its own surface only.

## Periodic sweep

**Nothing in Hermes calls `flush_retries` or any `prune`** -- the approval
hooks fire only on an approval event, and that surface has no periodic-timer
hook. `python -m ergates.flush` is the driver: one retry pass plus retention
on all three journals. It reads `ntfy.server`/`ntfy.topic`/`ntfy.token` from
the profile's own `config.yaml`, so no credential is ever passed as an
argument or printed:

```bash
HERMES_HOME=/opt/data python -m ergates.flush [--profile <name>] [--quiet]
# ergates.flush: retried=0 expired_notifications=0 pruned_notifications=0 pruned_proposals=0 pruned_reminders=0
```

`deploy/README.md` schedules it from host cron every two minutes, inside the
container. In-process, the same thing by hand:

```python
import time
from ergates.flush import flush_once, load_settings
from ergates.tool import hermes_home

home = hermes_home()                       # $HERMES_HOME, or a profile home under it
flush_once(home, load_settings(home), now=time.time())
```

## Development

Requires [`uv`](https://docs.astral.sh/uv/) and Python 3.11. Standard
library only at runtime (`json`, `os`, `re`, `hashlib`, `fcntl`/`msvcrt`,
`tempfile`, `uuid`, `datetime`, `urllib.parse`, `urllib.request`, `base64`,
`pathlib`, `logging`, `threading`, `argparse`). `pytest` and `pyyaml` are
test dependencies only -- `ergates.flush` imports `yaml` lazily, from the
Hermes runtime that ships it, and every other code path works without it.

```bash
cd integrations/ergates
uv venv --python 3.11
uv pip install -e '.[test]'
uv run --python 3.11 pytest

# or, without a persistent venv:
uv run --python 3.11 --with pytest pytest
```
