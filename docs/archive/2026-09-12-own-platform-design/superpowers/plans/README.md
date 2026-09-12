# Implementation plans

Plans are executed one task at a time with `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Every executor reads `docs/build/00-executor-handbook.md` first.

| Plan | Status | Scope |
|---|---|---|
| [2026-09-12-phase-0-foundations.md](2026-09-12-phase-0-foundations.md) | Ready to execute | Monorepo, contracts, core, API, WebSocket, files, fake harness, Claude Code adapter, runner, web PWA, bootstrap, deploy |
| Phase 1 plan | To be written with `superpowers:writing-plans` when Phase 0 is green, using the task breakdown below | Platform MCP, Docker sandboxes, gateway, connectors, routines, memory, cards, approvals, push, Codex adapter, harness settings UI |
| Phase 2 plan | Same | Group threads, exchanges UI, templates, catalog UI, jobs board, approval rules, Telegram, usage view, Gemini and Grok adapters, harness switch |
| Phase 3 plan | Same | Organizations, roles, per-user credentials, API-loop adapter, SSO, audit export, hardening |

Rule: a phase plan is written only when the previous phase is complete, so that it reflects the real code. The breakdown below fixes the task order and the interfaces so the writer of the next plan cannot drift.

## Phase 1 task breakdown (order is binding)

| # | Task | Produces (interfaces) | Acceptance test (from 05-test-strategy.md) |
|---|---|---|---|
| 1 | Docker sandbox mode | `spawnDocker(prepared, agentId, opts)` in `apps/runner/src/spawn/docker.ts`; sandbox image `packages/sandbox-image`; runner creates labeled containers with the run options in `03-templates.md` 8.5; `SANDBOX_MODE=docker` switches spawners | run options contain `--cap-drop ALL`, `--read-only`, `--network sandbox`, no docker.sock; a turn runs in a container against the fake harness image |
| 2 | Migration 0002 | all Phase 1 tables from `05-data-model.md` incl. `memory.embedding vector(384)`; Drizzle schema | migrate on fresh DB; insert one row per table |
| 3 | Platform MCP server core | `packages/platform-mcp` stdio server with per-turn JWT; tools `report_status`, `send_message_to_user`, `share_file`, `fetch_file`, `search_history` | tools callable over stdio; `share_file` rejects `../` |
| 4 | Memory and open loops | tools `remember`, `recall`, `open_loop`, `close_loop`; `retrieveMemories` (04 section 6); embedding service; prompt sections filled | retrieval ordering test; loop appears in prompt |
| 5 | Choice cards and `ask_user` | `card` table, `POST /cards/:id/answer|dismiss`, `card.created/updated` events, web card component; `ask_user` with wait | wait resolves on answer; expires |
| 6 | Jobs | `create_job`, `update_job`, `list_jobs`, `GET /jobs`, `job.*` events, minimal list view | status change emits event row |
| 7 | Routines and scheduler | `routine`, `routine_run` tables; `create/update/delete/list_routine`; BullMQ scheduler process; webhook endpoint; routine editor UI; idempotency | duplicate request returns same id; one-shot deletes itself; fires within 5 s in test with 1 s delay |
| 8 | Agent lifecycle tools | `set_profile`, `list_agents`, `create_agent`, `update_agent`, `send_message_to_agent`, `broadcast_to_agents`; exchange threads; hop caps; agent details panel (settings, memories, files) | briefing required; 7th hop -> HOP_LIMIT; exchange transcript endpoint |
| 9 | Connector catalog and gateway | `connector*` tables; catalog JSON loader; `apps/mcp-gateway` with `tools/list` filtering, `tools/call` policy, credential injection, approval hold; `resolvePolicy` | list hides disabled; deny -> TOOL_DISABLED; ask -> card; hold timeout -> APPROVAL_PENDING |
| 10 | First connectors | Outlook limited (stdio, from `~/Projects/prive/outlook-mcp`) and ClickUp (remote, OAuth); connector detail UI with tool switches; `get_my_connectors`, `request_connector` | send/delete categories not enabled by default (safety test) |
| 11 | Approvals end to end | `request_approval` as Claude permission prompt tool; approval cards; late approval re-enqueue; pause/resume agent | allow continues; deny returns error; late allow enqueues system turn |
| 12 | Web push | VAPID keys, service worker, `POST /devices/push`, notifier queue, quiet hours | subscription stored; push sent on `message.created` when thread not open (mock transport) |
| 13 | Capability events and turn briefing | events `connector.enabled_for_agent`, `tool.enabled`, `skill.installed`; matcher against open loops; "Since your last turn" builder | enabling a connector with a matching open loop enqueues a system turn |
| 14 | Extraction pass | extraction queue, prompt from templates section 6, zod-validated output, `created_by: extractor`; thread summary for context replay | extractor writes memories from a fixture transcript |
| 15 | Codex adapter and harness settings UI | `CodexAdapter` (prepare config.toml, parse JSONL); detector rows; Settings > Harnesses; agent settings form (harness, model, custom model, advanced) | adapter contract test on `fixtures/codex/hello.jsonl`; an agent on codex completes a turn |
| 16 | Usage counters | daily aggregation job, `GET /usage`, sidebar percentage placeholder | usage summed per agent per day |

## Phase 2 task breakdown
1. Group threads (turn selection D-25, sender labels, "To:" new-chat flow). 2. Exchange overlay UI and broadcast. 3. Templates export/import; private skills; catalog UI (Connectors, Agents). 4. Jobs board view. 5. Approval rules with classifier prompt (templates section 7). 6. Telegram bridge. 7. Usage view with 5-hour and weekly warnings per harness. 8. Gemini and Grok Build adapters (resolve O-01 first). 9. Harness switch with context replay (D-26, D-44). 10. Egress proxy learn mode and final allowlists (O-03).

## Phase 3 task breakdown
1. Organizations, roles, invitations, per-agent visibility. 2. Per-user credentials and API-key mode per harness. 3. API-loop adapter (provider SDKs, only place vendor SDKs are allowed). 4. SSO (OIDC). 5. Audit export, retention, GDPR deletion. 6. Secrets via SOPS or Vault; restore drill; dashboards.
