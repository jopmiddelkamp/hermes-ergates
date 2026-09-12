# 01 - Gap Review and Decisions Register

Result of a critical review of `docs/01..09` (2026-09-12) with the question: "Could a careful but unimaginative engineer build this without guessing?" Each gap below is closed with a decision. **This file wins over any other document when they disagree.**

## A. Stack decisions (were open or vague)

| # | Gap | Decision |
|---|---|---|
| D-01 | Web framework named as Next.js in one place, unspecified elsewhere | **Vite + React 18 SPA**, TypeScript, TanStack Router and TanStack Query, Tailwind. No server rendering. Served as static files by Caddy. Reason: a chat PWA needs no SSR; fewer moving parts. |
| D-02 | ORM "Prisma or Drizzle" | **Drizzle ORM** with SQL migrations (`drizzle-kit generate`), pgvector via a custom column type. Reason: SQL-first, predictable. |
| D-03 | Object storage "MinIO or disk" | **Local disk** behind a `FileStore` interface (`put`, `get`, `delete`, `signedUrl`) at `/srv/jopbot/files`. MinIO adapter is Phase 3. |
| D-04 | API framework | **Fastify 5** with `fastify-type-provider-zod`, `@fastify/websocket`, `@fastify/multipart`, `@fastify/cookie`. |
| D-05 | Auth libraries | Phase 0: password login with `argon2` and a signed session cookie (`@fastify/secure-session`). Phase 1 adds TOTP (`otplib`) and passkeys (`@simplewebauthn/server`). |
| D-06 | Queue | **BullMQ** on Redis. Queues: `turns` (one job per turn, `jobId` = turn id), `routines` (repeatable and delayed), `notifications`, `extraction`. |
| D-07 | Embeddings for memory search | **`@xenova/transformers`** running `Xenova/multilingual-e5-small` on CPU in the API process (384 dimensions). Reason: Dutch and English, no external API. |
| D-08 | Docker control from the runner | **dockerode**. Every container the runner creates carries labels `jopbot.managed=true` and `jopbot.agent=<agentId>`. The runner touches only labeled containers. |
| D-09 | MCP SDK | `@modelcontextprotocol/sdk` (TypeScript) for the platform MCP server, the gateway's client side, and the gateway's server side. |
| D-10 | Monorepo tooling | pnpm workspaces; shared tsconfig; no turborepo, no nx. |
| D-11 | Logging | `pino`, JSON to stdout, fields `service`, `turnId`, `agentId`, `threadId`, `userId`. |
| D-12 | IDs | UUID v7 (time-ordered) generated in the API with `uuidv7` package; event ids are `bigserial`. |

## B. Mechanisms that were underspecified

| # | Gap | Decision |
|---|---|---|
| D-20 | Sandbox mode in Phase 0 | Phase 0 runs harnesses in **host mode**: the runner spawns the CLI on the host with `cwd=/srv/jopbot/agents/<id>/workspace` and per-agent config dirs. Because host mode has no container, the Claude adapter passes `--disallowedTools "Bash,WebFetch,WebSearch"` and `--permission-mode acceptEdits`. **Docker mode is Phase 1 Task 1** and becomes mandatory before any connector with write tools is enabled. |
| D-21 | Egress allowlist per harness | Sandboxes attach to a network with no default route. An egress proxy (`apps/egress-proxy`, a tiny Node HTTP CONNECT proxy) allows hosts from `packages/shared/harness-catalog.json` `egressHosts` per harness. Initial lists: Claude `api.anthropic.com`, `platform.claude.com`, `console.anthropic.com`; Codex `api.openai.com`, `chatgpt.com`, `auth.openai.com`; Gemini `generativelanguage.googleapis.com`, `oauth2.googleapis.com`, `cloudcode-pa.googleapis.com`, `accounts.google.com`; Grok `api.x.ai`, `x.ai`. The proxy logs blocked hosts; Phase 1 includes a "learn mode" run per harness to complete the lists. Until Docker mode exists (Phase 0 host mode) there is no egress restriction; that is accepted for Phase 0 only. |
| D-22 | Approval hold at the gateway vs harness tool timeouts | The gateway holds an "ask" call open for at most **9 minutes** (below Gemini's 10-minute default and Claude's configurable `MCP_TOOL_TIMEOUT`, which the adapter sets to 600000). If no decision arrives, the gateway returns MCP error `APPROVAL_PENDING` with text "Approval pending. The user has been notified. Stop and wait; do not retry." The approval card stays open for 24 hours. When the user allows later, the platform enqueues a new turn for the agent with the message "Approved: <tool> with the same arguments. Call it now." |
| D-23 | Hop cap numbers | A chain id is created when a user message or a routine starts a turn and is carried on every agent-to-agent message it causes. Limits: **6 hops per chain**, **30 agent-to-agent messages per agent per hour**, **3 concurrent turns globally** (`MAX_CONCURRENT_TURNS`). Exceeding returns MCP error `HOP_LIMIT` with text "Stop and ask the user before continuing." |
| D-24 | Idempotency key for routines | `sha256(turnId + "|" + name.trim().toLowerCase() + "|" + JSON.stringify(trigger))` computed by the platform MCP server; the model does not supply it. Unique per agent. |
| D-25 | Group thread turn policy | On a user message in a group thread: if it contains `@Name` mentions, every mentioned agent gets a turn; if none, only the lead agent gets a turn. Other agents receive the message into their session on their next turn as context (no turn now). Agents may `@Name` each other; hop cap applies. Lead = the first agent added; editable in thread settings. Mention syntax: `@` followed by the agent name, case-insensitive, matched against the participant list. |
| D-26 | Context replay (harness switch, lost session) | Prompt block: the last **40 messages** of the thread verbatim (user and agent, with sender labels) plus a summary of everything older, generated once by the extraction pass and cached on the thread (`thread.summary`, regenerated when older than 200 new messages). Budget for the block: 12,000 tokens; truncate oldest verbatim messages first. |
| D-27 | Memory retrieval budget | Always include: all `rule` memories, all open loops (max 50), the agent's profile memories. Then top 20 by vector similarity over `fact`/`preference`/`profile`, score threshold 0.30, merged with full-text matches on the incoming message. Hard cap 4,000 tokens; drop lowest-scored first. |
| D-28 | Extraction pass | After every succeeded turn with at least one user message, run the harness with model `haiku` (Claude) or the harness's cheapest model (catalog `cheapModel`) on the prompt in `03-templates.md` section 6, output JSON validated with zod; write memories with `created_by: extractor`. Skip when the turn was a routine run with no new user input. Cost cap: skip if the day's extraction count for the agent exceeds 200. |
| D-29 | Detection probes | File and version checks run at startup and hourly (no tokens). The token-costing probe (`say ok`, max 1 turn, cheapest model) runs only on manual Re-scan or when a file check changes state. Results cached in `harness_status`. |
| D-30 | Agent deletion | `DELETE /agents/{id}` sets `status: archived`, stops and removes the container, keeps the volume and all data. A purge command (`pnpm agent:purge <id>`) deletes data after a confirmation prompt; it is operator-only, never exposed to agents. |
| D-31 | Agent pause | `status: paused`: queued turns stay queued, no new turns start, routines are skipped with status `skipped`. Resume drains the queue. |
| D-32 | Agent naming | Name: 1-40 characters, letters, digits, spaces, hyphens; unique per owner, case-insensitive. Folder name is the agent UUID, never the name. Title: 0-40 characters. |
| D-33 | Avatars | PNG/JPEG/WebP up to 5 MB; stored as file; served at `/files/{id}`; resized to 256x256 with `sharp` on upload. |
| D-34 | Uploads | Max 50 MB per file, 10 files per message. MIME sniffed with `file-type`. HEIC converted with `heic-convert`. Zip files are not unpacked by the platform; the agent unpacks them in its workspace (Python `zipfile`). Archive bombs: sandbox disk quota 5 GB and `ulimit`. |
| D-35 | Images to the model | Image paths are listed in the turn prompt. Claude Code, Codex, Gemini, and Grok Build can read image files with their file tools; the adapter also passes the image as an inline attachment when the harness supports it (Claude stream-json user message content blocks). |
| D-36 | Usage accounting | Adapter maps vendor usage fields when present (Claude `result.usage`; Codex `turn.completed.usage`; Gemini `stats`; Grok `result` if present). Fallback: `ceil(chars/4)` on prompt and output text. Stored per turn; summed daily by a scheduled job at 00:05. |
| D-37 | Full-text search | Postgres `tsvector` with the `simple` configuration (language-neutral) over `message.body_md` and `memory.text`; trigram index (`pg_trgm`) for agent and thread names. |
| D-38 | Time zone | Stored per user (IANA). All timestamps stored UTC. Routines store their own `tz`. UI renders in the user's zone. |
| D-39 | Notifications in Phase 0 | None. Phase 1 adds web push. Quiet hours default 23:00-07:00 user time; approvals and timers ignore quiet hours. |
| D-40 | Concierge bootstrap | `pnpm bootstrap` creates the owner user (email + password from prompts), the default harness (first detected), and the concierge agent named "Assistant" with the instructions in `03-templates.md` section 5. The user renames it by chat later. |
| D-41 | Onboarding interview | Implemented purely by the concierge instructions plus the `ask_user` tool; no special UI. |
| D-42 | Turn timeout | 20 minutes wall clock per turn; the runner sends SIGINT, waits 30 s, then SIGKILL; turn marked `failed` with error `TURN_TIMEOUT`; the thread shows a status row. |
| D-43 | Rate-limit backoff | On vendor rate limit: retry the turn after 60 s, then 5 min, then 15 min, then fail with `RATE_LIMITED`. Routines retry 3 times with the same schedule. |
| D-44 | Session per harness | `thread_participant.harness_session_id` is nulled when the agent's harness changes; the next turn uses context replay (D-26). |
| D-45 | Streaming granularity | Text deltas are batched by the runner every 150 ms before publishing `message.delta`. |
| D-46 | Event retention | `event` rows older than 7 days are deleted nightly; the client resume window is 7 days; older gaps force a full refetch. |
| D-47 | Language | UI strings in English for Phases 0-2 (i18n-ready with a `t()` helper, one `en.json`). Agents mirror the user's language by prompt rule. |
| D-48 | Secrets at rest | Connector tokens encrypted with AES-256-GCM (Node `crypto`), key from `SECRETS_KEY` (32 bytes base64) in `.env`; ciphertext stored as `v1:<iv>:<tag>:<data>` base64. |
| D-49 | Per-turn tokens | JWT HS256 signed with `INTERNAL_JWT_SECRET`, 30-minute expiry, claims `{ sub: agentId, turn: turnId, thread: threadId, scope: ["platform","gateway"] }`. |
| D-50 | Connector categories per tool | Every connector catalog entry lists its tools with a `category` from `read, write, draft, send, delete, pay, other`. Unknown tools default to `other`, which is "ask". |

## C. Requirement clarifications

| # | Clarification |
|---|---|
| R-01 | FR-174 "timers fire within 5 s": BullMQ delayed jobs are polled by the worker every 1 s (`settings.stalledInterval` default). Acceptable. |
| R-02 | FR-190 approval cards apply to gateway "ask" tools and to Claude Code's built-in permission prompts routed through the platform MCP `request_approval` tool. Other harnesses do not prompt for built-in tools; their built-in file and shell tools are contained by the sandbox instead. |
| R-03 | FR-109 sender labels: shown in group and exchange threads only; hidden in primary threads. |
| R-04 | FR-161 board: internal only in Phases 1-2. |
| R-05 | FR-231 Telegram: Phase 2, optional, off by default. |
| R-06 | US-1.7 search: messages and threads only; files by name. |
| R-07 | Group threads: Phase 2. Phase 0-1 build only primary threads and exchange threads. |
| R-08 | The platform MCP server never receives connector credentials; the gateway never receives the vendor subscription token. |

## D. Gaps that remain open (must be resolved by a human before the task that needs them)

| # | Gap | Needed by | Owner |
|---|---|---|---|
| O-01 | Grok Build MCP config keys | Phase 2 Grok adapter | Jop verifies in the xai-org/grok-build user guide |
| O-02 | Codex per-tool enable/disable config keys | Phase 1 Codex adapter (not blocking; gateway filters) | Jop |
| O-03 | Exact egress hosts for Codex ChatGPT login and Gemini Google login | Phase 1 Docker mode learn-mode run | Executor, with learn mode |
| O-04 | Product name | Phase 0 web title (uses "jop-bot" until decided) | Jop |
| O-05 | VPS provider and size | Phase 0 deploy task | Jop |
