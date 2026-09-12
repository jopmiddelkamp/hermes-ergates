# 05 - Test Strategy

## 1. Principles
1. No test ever contacts a real AI vendor, a real connector, or the internet. (Handbook S1)
2. Every boundary has a contract test with recorded fixtures: harness stdout, MCP tool inputs, WebSocket messages, REST bodies.
3. Fast unit tests for logic (policy, caps, idempotency, retrieval ordering, parsers). Integration tests with real Postgres and Redis from `docker-compose.dev.yml`. One end-to-end path with Playwright against the fake harness.

## 2. Layers

| Layer | Tool | Runs in | What |
|---|---|---|---|
| Unit | vitest | any package | pure functions: `resolvePolicy`, `parse` per adapter, prompt rendering, idempotency key, mention parsing, event mapping |
| Integration (API) | vitest + `light-my-request` (Fastify inject) + real Postgres/Redis | `apps/api` | REST + WebSocket + event log; migrations applied to a fresh database per run (`DATABASE_URL_TEST`) |
| Integration (runner) | vitest + fake harness binary on PATH | `apps/runner` | full turn: enqueue -> spawn fake -> events -> DB rows -> published events |
| Integration (MCP) | vitest + `@modelcontextprotocol/sdk` client | `packages/platform-mcp`, `apps/mcp-gateway` | call tools over stdio/HTTP; assert DB effects and errors |
| E2E | Playwright | `apps/web` against dev API + fake harness | login, send message, see streamed reply, upload file, choice card |
| Smoke (manual) | `scripts/smoke.sh` | real harness | only with `ALLOW_REAL_HARNESS=1`; one "say ok" turn per detected harness |

## 3. The fake harness (`packages/fake-harness`)
- Provides executables `claude`, `codex`, `gemini`, `grok` (Node scripts) placed first on `PATH` by the test setup (`process.env.PATH = fakeBin + ":" + PATH`).
- Behavior: reads `FAKE_FIXTURE`; replays `fixtures/<harness>/<name>.jsonl` line by line with 20 ms delay; exit code from the fixture's last line `{"__exit": n}` if present else 0. With `FAKE_FIXTURE=echo` it prints a valid init + text + result where the text equals the prompt (for E2E).
- Records nothing; never opens sockets.
- Fixtures are recorded from real runs once, by a human, with tokens and personal data removed, and checked in. A `fixtures/README.md` lists source version per fixture (for example "claude 2.1.266").

## 4. Required tests per subsystem (minimum)

### Shared
- zod schemas accept the sample DTOs in `02-contracts.md` and reject one malformed example each.
- `resolvePolicy`: disabled tool -> denied; category send with hard limit -> ask; override deny beats enabled; category read -> allow; unknown category -> ask.
- Idempotency key: same name with different case and spaces gives the same key; different trigger gives a different key.

### API
- Login sets cookie; wrong password 401 with `UNAUTHENTICATED`; 6th failed attempt in 15 min -> 429.
- POST message creates message row, event row, and enqueues a turn job with `jobId = turnId`.
- WebSocket: subscribe then receive `message.created`; `resume` with an old id replays missing events in order; `resume` older than retention returns `fullRefetch: true`.
- Upload: 51 MB rejected with `VALIDATION`; HEIC converted and both files stored; sha256 recorded.

### Runner
- Claude adapter: `parse` of `fixtures/claude/hello.jsonl` yields init, text_delta*, text_final, result with usage numbers copied from the fixture.
- Claude adapter: `prepare` writes `turn/settings.json` whose deny list contains `Bash` in host mode and does not in docker mode; `mcp.json` contains `platform` and one `gw_*` per connector.
- Worker: two turns for the same agent run sequentially (lock); turns for different agents run concurrently up to 3.
- Timeout: fixture with `{"__sleep": 999999}` and `TURN_TIMEOUT_MS=2000` -> turn failed `TURN_TIMEOUT` and a status message row.
- Rate limit: fixture with `api_retry rate_limit` then no result -> retried with delay 60 s (assert BullMQ delay), status row "Waiting for capacity".

### Platform MCP
- `create_agent` without briefing -> error; with briefing -> agent row, exchange thread, first exchange message, queued turn for the child, event rows in both primary threads.
- `send_message_to_agent` 7th hop in a chain -> `HOP_LIMIT`.
- `create_routine` twice with the same request in the same turn -> same id, `created:false`.
- `share_file` with `../` path -> error; with a workspace path -> file row + message kind file.
- `ask_user` with `wait:true` resolves when `POST /cards/{id}/answer` is called; times out to `expired` after `timeoutSeconds`.

### Gateway
- `tools/list` hides disabled tools and flags ask tools with `_meta`.
- `tools/call` on a denied tool -> `TOOL_DISABLED` and an audit row; on an ask tool -> approval card created, resolves on allow, `APPROVAL_DENIED` on deny, `APPROVAL_PENDING` after the hold timeout (use 1 s in test via `APPROVAL_HOLD_MS`).
- Credential injection: upstream stub asserts the `Authorization` header equals the decrypted account token; the sandbox-side request never contained it.

### Web (E2E)
- Login -> sidebar shows "Assistant" -> send "hello" -> streamed reply appears within 5 s (fake echo) -> reload keeps history -> upload image shows gallery.

## 5. Safety assertions that must exist
- A test in `apps/mcp-gateway` that loads every connector catalog entry and asserts no tool of category `send`, `pay`, `delete` is `enabled: true` by default.
- A test in `apps/runner` that asserts the sandbox run options contain `--cap-drop ALL`, `--read-only`, `--network sandbox`, and no `/var/run/docker.sock` mount.
- A test in `packages/shared` that asserts `ALLOW_REAL_HARNESS` is not `"1"` in the test environment (fails the suite if a human left it on).
- A lint rule (eslint `no-restricted-imports`) that forbids importing vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`) anywhere except `apps/runner/src/adapters/api-loop/` (Phase 3).

## 6. Commands
```
pnpm test            # unit + integration (needs docker-compose.dev.yml up)
pnpm test:e2e        # Playwright
pnpm lint && pnpm typecheck
ALLOW_REAL_HARNESS=1 scripts/smoke.sh   # human only
```
