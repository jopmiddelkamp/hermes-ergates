# 00 - Executor Handbook (read this first)

You are an engineer, human or AI, who builds jop-bot from these documents. This handbook tells you how to work, what you may never do, and where every answer lives. Read it fully before your first task.

## 1. Reading order

1. This handbook.
2. `docs/build/01-gap-review-and-decisions.md` - every default and decision. If two documents disagree, this file wins.
3. `docs/build/02-contracts.md` - exact types, schemas, SQL. Copy names from here. Never invent a name.
4. `docs/build/03-templates.md` - full text of config files, prompts, Docker files.
5. `docs/build/04-algorithms.md` - step-by-step logic with numbers.
6. `docs/build/05-test-strategy.md` - how to test without touching real vendors.
7. The plan for your phase in `docs/superpowers/plans/`. Execute one task at a time.
8. Background only when needed: `docs/01..09` (design) and `docs/research/` (why).

## 2. Rules you must follow

Safety rules (never break, even if a task seems to require it):

| # | Rule |
|---|---|
| S1 | Never call a real AI vendor (Claude, OpenAI, Google, xAI) from a test. Tests use the fake harness in `packages/fake-harness`. Real calls happen only in `scripts/smoke.sh` and only when `ALLOW_REAL_HARNESS=1` is set by a human. |
| S2 | Never commit secrets. `.env` is git-ignored. Only `.env.example` with placeholder values is committed. If you see a real token in a file, stop and report. |
| S3 | Never run destructive host commands: no `docker system prune`, no `docker rm` of containers without the label `jopbot.managed=true`, no `rm -rf` outside the repository or `/srv/jopbot`, no changes to files under `/srv/harness-home`. |
| S4 | Never modify, patch, or wrap the vendor binaries (`claude`, `codex`, `gemini`, `grok`). The platform only invokes them. |
| S5 | Never enable a connector tool of category `send`, `pay`, or `delete` in a development or test configuration. The gateway must deny them by default and tests must assert that. |
| S6 | Never bypass the MCP gateway. Sandboxes reach connectors only through it. |
| S7 | Never push to a remote, open a pull request, or delete branches unless the task says so. Commit locally after every green task. |
| S8 | Never store message bodies or file contents in logs or the audit table. |
| S9 | If a task cannot be completed as written, stop, write what blocks you in `docs/build/BLOCKERS.md`, and report. Do not improvise around a blocker. |

Engineering rules:

| # | Rule |
|---|---|
| E1 | Test first. Write the failing test, run it, implement the smallest code that passes, run again, commit. Every task in the plan follows this rhythm. |
| E2 | One task at a time, in plan order. Do not start the next task before the current one is green and committed. |
| E3 | Copy names, types, and file paths from the contracts and the plan. If you must add a name, add it to `02-contracts.md` in the same commit. |
| E4 | No placeholders in code: no `TODO`, no `throw new Error("not implemented")` left behind at commit time. |
| E5 | Keep files small: one responsibility per file, under 300 lines. |
| E6 | Validate every external input with zod at the boundary (HTTP body, WebSocket message, MCP tool input, vendor event stream). Trust nothing that crosses a boundary. |
| E7 | Every error the user can see has a code from the error catalog in `02-contracts.md` section 9. |
| E8 | Commit messages: `type(scope): summary` with type in feat, fix, test, chore, docs, refactor. Example: `feat(runner): parse claude stream-json result event`. |
| E9 | When the plan and reality differ (a library renamed a function, a flag changed), follow reality, note the difference in `docs/build/DEVIATIONS.md`, and keep going. |

## 3. Environment

| Item | Value |
|---|---|
| OS for development | macOS or Linux |
| Node | 22 LTS (`.nvmrc` = `22`) |
| Package manager | pnpm 9, workspaces, no turborepo |
| Language | TypeScript 5.x strict everywhere; Python 3.12 only inside the sandbox image |
| Database | PostgreSQL 16 with the `vector` extension (pgvector) |
| Queue | Redis 7 with AOF persistence, BullMQ |
| Containers | Docker Engine 26+, docker compose v2 |
| Reverse proxy | Caddy 2 |
| Test runner | vitest; e2e with Playwright |
| Lint and format | eslint (typescript-eslint) + prettier; `pnpm lint` must be clean before commit |

Local start: `docker compose -f docker-compose.dev.yml up -d` (db, redis) then `pnpm dev`.

## 4. Repository layout (fixed)

```
jop-bot/
  apps/api/               Fastify core: REST, WebSocket, scheduler entry, auth
  apps/runner/            turn queue worker, harness adapters, sandbox control
  apps/web/               Vite + React SPA (PWA)
  apps/mcp-gateway/       policy proxy in front of connectors
  packages/shared/        zod schemas, TS types, error catalog, harness catalog JSON
  packages/platform-mcp/  stdio MCP server used inside sandboxes
  packages/fake-harness/  fake `claude`/`codex`/`gemini`/`grok` binaries that replay fixtures
  packages/sandbox-image/ Dockerfile and entrypoint for agent sandboxes
  connectors/             connector catalog entries (JSON) and local connector images
  scripts/                bootstrap, smoke, backup, restore
  docs/
  docker-compose.yml      production
  docker-compose.dev.yml  db + redis for local development
```

## 5. Definition of done (every task)

1. New tests exist and pass; the full suite passes (`pnpm test`).
2. `pnpm lint` and `pnpm typecheck` pass.
3. No secrets, no placeholders, no skipped tests without a linked blocker.
4. Contracts or templates updated if the task introduced a name or file.
5. Committed with a conventional message.

## 6. Where answers live

| Question | File |
|---|---|
| What is the exact shape of X? | `02-contracts.md` |
| What does the generated file or prompt look like? | `03-templates.md` |
| How exactly does the logic work, with numbers? | `04-algorithms.md` |
| How do I test this without real vendors? | `05-test-strategy.md` |
| Why was this decided? | `docs/08-decision-log.md` |
| What does the user see? | `docs/02-functional-design.md` section 5 |
| Which vendor flag do I pass? | `docs/research/notes-harness-facts.md` |
