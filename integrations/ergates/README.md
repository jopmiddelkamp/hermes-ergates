# ergates (Hermes plugin)

Small, dependency-free Hermes Agent plugin for the Ergates project. It gives
the concierge a validated agent-proposal tool, records approval requests and
finished routine turns as attention events with an ntfy push, and keeps
idempotent reminder receipts. Every record lives in one transactional SQLite
control store under the Hermes root (ADR-030).

This package does **not** create profiles or run a scheduler. The app
performs the provisioning steps; Hermes cron stays the scheduler. The cron
calls go through a `CronPort` (`ergates/reminders.py`), and the push goes
through an injectable `publish` callable (`ergates/delivery.py`).

See `docs/11-implementation-readiness.md` section 4 and
`docs/03-technical-design.md` sections 8-9 in the repository root for the
contracts this package implements.

## Layout

```
integrations/ergates/
  plugin.yaml          # Hermes directory-plugin manifest
  __init__.py          # Hermes entry point: register(ctx)
  ergates/             # the actual logic, plain importable package
    hermes_adapter.py  # the only module that imports Hermes (decision D5)
    paths.py           # hermes_root() and store_path(): where the store lives
    store.py           # ControlStore: SQLite, WAL, BEGIN IMMEDIATE, versioned schema
    reminders.py       # ReminderService: idempotent reminders on top of Hermes cron
    proposals.py       # ergates.agent-proposal.v1 validation, hash, ProposalService
    attention.py       # AttentionService: events, outbox rows, prefs, expiry, retention
    delivery.py        # DeliveryWorker: leased outbox delivery to ntfy, deep link
    tool.py            # ctx.register_tool / ctx.register_hook wiring
    flush.py           # `python -m ergates.flush`: due pushes, expiry, retention
  tests/               # pytest suite (one file per module above);
                       # test_hermes_boundary.py fails when a module other than
                       # ergates/hermes_adapter.py or dashboard/api.py imports Hermes
  contract/            # contract tests: facts read from the pinned Hermes source
                       # (HERMES_SOURCE); run by `scripts/ci-local.sh contract`
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
the profile's `config.yaml`:

| Key | Default | Purpose |
|---|---|---|
| `ntfy.server` | unset (push disabled) | ntfy server base URL |
| `ntfy.topic` | unset (push disabled) | ntfy topic to publish attention events to |
| `ntfy.token` | unset | ntfy publish token (Bearer), or `user:pass` for Basic |
| `ntfy.connection_id` | unset | app connection id used to build the `Click` deep link |
| `ntfy.default_profile` | unset | profile name for the deep link, **only** when `ctx.profile_name` is unavailable |
| `attention.completed_platforms` | `["cron"]` | platforms whose finished turns push "A routine finished" (decision D9); `[]` turns them off |

No credentials are ever read from, or written into, this repository or the
store. Push is skipped (not an error) whenever `ntfy.server` or `ntfy.topic`
is unset; the event and its outbox row are still recorded.

## The control store

One SQLite file per Hermes install: `<hermes root>/ergates/control.sqlite3`.
`paths.hermes_root()` is `hermes_constants.get_default_hermes_root()` inside
Hermes, which maps a profile home (`<root>/profiles/<name>`) back to the
root, so every profile and every process (gateway, `hermes serve`, the
flush) shares it. The file and its folder are created private (`0600`,
`0700`).

| Table | Holds |
|---|---|
| `reminder_receipts` | receipt id (request id or payload hash), request id, profile, state (`creating`, `created`, `uncertain`), cron job id and unique job name, advisory timezone, payload hash, prompt hash, version |
| `proposal_receipts` | proposal id, state (`proposed`, `accepted`, `complete`, `rejected`), proposal hash, reserved profile name, `expires_at`, source session id, version |
| `proposal_steps` | status (`done`, `uncertain`, `failed`) of each provisioning step the app reports |
| `attention_events` | approval or completion event: profile, session, surface, correlation hash, state (`pending`, `resolved`, `expired`), choice, times |
| `attention_outbox` | one push per event: state (`due`, `sent`, `cancelled`, `gave_up`), attempts, next attempt, lease, last error class |
| `attention_prefs` | per profile (`*` = default): muted, quiet hours |

Rules the store enforces:

- Every write is `BEGIN IMMEDIATE`, so a read-modify-write never
  interleaves with another writer, in this process or another one. A second
  writer waits up to the busy timeout (5 s).
- Every receipt change is a versioned compare-and-set: it names the version
  it read and changes nothing when another writer got there first.
- An attention event and its outbox row commit in one transaction. Delivery
  writes only the outbox row; an event's state changes only through
  resolution or expiry.
- The schema is versioned with `PRAGMA user_version`; a file written by a
  newer plugin is refused.
- No column holds prompt, command, briefing or description text. Receipts
  and events keep identifiers and sha256 hashes (docs/04 sections 4 and 8).

### Retention and expiry

`python -m ergates.flush` applies these (nothing inside Hermes runs a timer):

| Record | Rule |
|---|---|
| Approval event | expires 1800 s after it was created (the profiles' `approvals.timeout`); its due push is cancelled, never sent |
| Terminal attention event (resolved, expired, completion) | deleted 7 days after `resolved_at`, with its outbox row |
| Unaccepted proposal receipt (proposed or rejected) | deleted 24 h after its `expires_at`; accepted and complete receipts are kept for resume-by-receipt |
| Reminder receipt | deleted when cron reports its job gone, or after 30 days without use |

## Reminders

`ReminderService.create(profile, schedule, timezone, prompt, request_id=..., label=...)`
returns a `ReminderOutcome` with `status` `created`, `existing`, `conflict`
or `uncertain`, and the receipt.

- **The receipt id** is the caller's `request_id` (the app's per-attempt
  outbox id) when given, else the payload hash. The same id with a
  different payload is a `conflict` and creates no job.
- **Two identical requests at the same moment** create one job: the second
  waits for the first creator (up to 5 s) and returns the same receipt.
- **A job deleted natively** (Routines screen) is created again once, by
  the one request that still holds the version that saw it missing.
- **A create whose answer was lost** leaves the receipt `uncertain`. The
  next request reconciles it through the job's unique name
  (`[bot:<profile>] <label> · <8 hex>`): one match is adopted, none is
  created once, several leave it `uncertain`. A `creating` receipt older
  than 60 s belongs to a creator that died and is reconciled the same way.
- **Timezone is advisory.** Hermes 0.21.2 has no per-job timezone, so the
  zone stays in the idempotency key and comes back as `timezone_advisory`;
  a reminder fires in the timezone Hermes is configured for
  (`HERMES_TIMEZONE` or `timezone` in `config.yaml`; server local time when
  neither is set).

The roadmap's contract C2 names the production `CronPort`,
`hermes_adapter.HermesCron`. Until it is wired in, no entry point creates
reminders, and the flush prunes with `UnavailableCron`, which applies only the
30-day rule.

## Proposals

`ergates_propose_agent` validates the model's arguments, attaches the
backend-owned `source_session_id` (from the handler's `session_id` or
`task_id`, never from `args`), records the receipt as `proposed`, and
returns the proposal as JSON. It never creates a profile.
`ProposalService` then accepts (exactly as proposed, decision D10) or
rejects it, records each provisioning step the app reports in order
(`profile_created`, `plugin_enabled`, `configured`, `bot_chat`,
`briefing`), and marks it `complete` only after it verifies the profile and
the plugin. `is_admitted(profile)` is false while an accepted proposal still
provisions that profile.

## Attention and push

- `pre_approval_request` records a pending approval and its outbox row, then
  sends the push on a short-lived thread, so a slow ntfy server never delays
  the in-app approval card. A coalesced follower (`coalesced=True`) or the
  `smart` guardian pre-check records nothing.
- `post_approval_response` resolves the oldest pending approval with the
  same `(session_key, pattern_key, command hash, surface)` and cancels its
  due push. The hooks carry no approval id at the pin.
- `post_llm_call` records a finished turn from `attention.completed_platforms`
  and pushes "A routine finished". It reads only `session_id` and
  `platform`, never the messages.
- A muted profile gets events but no pushes. Quiet hours (`HH:MM`, may wrap
  midnight) hold completion pushes and their retries until they end;
  approval pushes and their retries ignore them. They are read in the
  timezone Hermes is configured for, the zone its cron runs routines in, and
  in server local time when Hermes has none.
- A worker leases an outbox row for 60 s before it sends, so two workers
  never send one row at once, and a worker that dies mid-send leaves a lease
  that runs out. Failed attempts back off 30 s, 120 s, 600 s, 600 s; the
  fifth failure gives up. Push is at least once.
- The body is always `You have a new request`; the title is `Hermes needs
  your approval` or `A routine finished`; the `Click` link is
  `ergates://chat/<session>?connection=<id>&profile=<name>`. Errors are
  logged by class name only, so a token echoed in an HTTP error never
  reaches a log.

## Periodic sweep

```bash
HERMES_HOME=/opt/data python -m ergates.flush [--profile <name>] [--quiet]
# ergates.flush: retried=0 expired_notifications=0 pruned_notifications=0 pruned_proposals=0 pruned_reminders=0
```

It opens the store under the Hermes root and reads the ntfy settings from
the `config.yaml` of `--profile`, else of the `HERMES_HOME` it runs with,
else of the root. No credential is ever passed as an argument or printed.
`deploy/README.md` schedules it from host cron every two minutes, inside the
container.

## Development

Requires [`uv`](https://docs.astral.sh/uv/) and Python 3.11. Standard
library only at runtime (`sqlite3`, `json`, `hashlib`, `urllib`, `threading`
and friends). `pytest`, `pytest-cov` and `pyyaml` are test dependencies only
-- `ergates.flush` imports `yaml` lazily, from the Hermes runtime that ships
it.

```bash
cd integrations/ergates
uv run --python 3.11 --with pytest --with pytest-cov --with pyyaml pytest

# the CI gate: the same run with branch coverage of ergates/, at least 90%
uv run --python 3.11 --with pytest --with pytest-cov --with pyyaml pytest --cov --cov-fail-under=90
```

The contract tests read the Hermes source at the pin and need a checkout of it.
From the repository root, `scripts/ci-local.sh contract` prepares one under
`.cache/hermes-pin` (a detached `git worktree add` from your Hermes clone) and
runs them; or point `HERMES_SOURCE` at a clean checkout of
`d76856cc6971b6e0e1903b5369498bcc4bb83a60`.
