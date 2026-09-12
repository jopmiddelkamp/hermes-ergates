# 08 - Architecture Decision Log

Format: context, options, decision, consequences. Status: proposed until Jop approves.

## ADR-001 Model access: unmodified vendor harness binaries on the user's own subscriptions (Claude Code first)
- Context: Jop wants to use his USD 200 Max subscription. Anthropic allows an end user to sign in to the unmodified Claude Code binary with their own subscription, also when hosted; the Agent SDK and third-party products must use API keys (04-security-and-compliance.md).
- Options: (A) `claude -p` subprocess with `CLAUDE_CODE_OAUTH_TOKEN`; (B) Claude Agent SDK with API key; (C) Managed Agents (Anthropic-hosted sandbox, API billing); (D) direct Messages API with a hand-written tool loop.
- Decision: A for personal use, behind a harness adapter interface (see ADR-015); B for business use. Amended 2026-09-12: Claude Code is the first adapter, not the only one. C rejected because it moves the sandbox off the VPS and bills per token. D rejected because it re-implements what Claude Code already provides (tools, compaction, skills, MCP, permissions).
- Consequences: pin the CLI version; parse stream-json; respect subscription limits; keep the API-key switch tested.

## ADR-002 Agents act only through MCP and a file workspace (no cloud desktop)
- Context: Jop's core requirement is per-tool control. Grok Bot's browser-based computer cannot be limited per action.
- Options: (A) MCP + workspace only; (B) add a headless browser MCP later; (C) full desktop per agent.
- Decision: A now; B possible later as a switchable connector; C never.
- Consequences: some tasks Grok Bot did (booking websites) are not possible until a browser connector exists; that is accepted.

## ADR-003 Two-layer tool enforcement
- Context: BR-29 "not a promise". Claude Code permission rules are model-side; a proxy is server-side.
- Decision: Claude Code `permissions.deny` plus filtered `tools/list` (layer 1) and an MCP gateway that rejects disallowed calls and injects credentials (layer 2).
- Consequences: one extra service; all connectors go through the gateway.

## ADR-004 One sandbox container per agent
- Context: Grok Bot shares one computer for all bots with per-agent folders. Isolation between agents matters when agents have different tool rights.
- Options: (A) one container per agent, started on demand; (B) one shared container with per-agent users; (C) container per turn.
- Decision: A. Idle containers are stopped after 10 minutes and restarted on the next turn (cold start under 2 s with a warm image).
- Consequences: Docker socket access for the runner only; memory budget per agent.

## ADR-005 Session per (agent, thread); memory per agent
- Context: Grok Bot showed shared knowledge across threads. Claude Code sessions are linear transcripts.
- Decision: one Claude session per agent per thread; agent-wide knowledge through memory entries, CLAUDE.md, and workspace files.
- Consequences: a group thread has one session per agent; exchanges run in the agent's primary session.

## ADR-006 Platform MCP server for all platform actions
- Context: agents must create agents, routines, jobs, cards. The CLI cannot do that natively.
- Decision: a stdio MCP server inside the sandbox with a per-turn token; the same server implements the permission prompt tool.
- Consequences: platform features are testable as MCP tools; rules live in the server (briefing required, idempotency, hop caps).

## ADR-007 TypeScript monorepo
- Context: MCP SDK, Agent SDK, Claude Code are TypeScript-first; one language reduces cognitive load for one developer.
- Decision: TypeScript for web, core, runner, gateway, platform MCP. Python allowed inside the sandbox for agent scripts.

## ADR-008 PostgreSQL + Redis + object storage
- Decision: Postgres as the system of record, Redis/BullMQ for queues and schedules, MinIO or disk for blobs.
- Consequences: three stateful services to back up.

## ADR-009 Routines and timers owned by the platform, not by Claude Code
- Context: Claude Code `/schedule` needs a claude.ai login and is not available with `setup-token` auth.
- Decision: BullMQ-based scheduler with idempotent creation and run history.

## ADR-010 Notifications: web push first, Telegram bridge second
- Context: missed pings were the biggest reliability complaint.
- Decision: VAPID web push in the PWA; Telegram as an optional second channel with reply support.

## ADR-011 Internal catalog instead of a public marketplace
- Decision: connectors and templates are JSON/tarball entries in a versioned catalog folder in the repo, rendered in the UI. Publishing to the public is out of scope.

## ADR-012 Business use requires per-user credentials
- Decision: Phase 3 users authenticate to the model with their own credential; the platform never proxies one subscription for many people. Default for organizations is an API key billed to the organization.

## ADR-013 Built-in agent brain, no external knowledge product
- Context: each agent needs durable, searchable memory and open loops. An external system (for example gbrain) would add a runtime dependency and split ownership of personal data.
- Decision: memory tables in the platform database with full-text and `pgvector` indexes, a local embedding model, explicit tools plus an end-of-turn extraction pass. External knowledge systems may be exposed to agents as ordinary connectors, never as the agent's own brain.
- Consequences: one more index to maintain; embedding model runs in the API container (CPU is enough).

## ADR-014 WebSocket for live updates, HTTPS for actions, push for background
- Context: the UI must update in real time when agents act through MCP (new agent, cards, routines) and while text streams.
- Options: polling; Server-Sent Events; WebSocket.
- Decision: WebSocket with monotonic event ids and resume-by-id; SSE rejected because the client also sends typing, subscriptions, and read markers; polling rejected for latency and battery.
- Consequences: an `event` table with 7-day retention; Redis pub/sub between API instances.

## ADR-015 Multi-harness: the agent runtime is a per-agent setting, detected on the server
- Context: Jop wants to use whichever AI subscriptions he has (Claude Max today; ChatGPT, Gemini, or SuperGrok tomorrow), mix them per agent, and switch later. Vendor agent CLIs (Claude Code, Codex CLI, Gemini CLI, Grok Build) all offer headless mode, streaming JSON, sessions, and MCP (research/notes-harness-facts.md).
- Options: (A) Claude Code only; (B) adapter per vendor CLI with a capability descriptor and a detector that offers only installed, logged-in harnesses; (C) one own API loop with provider SDKs (API keys only).
- Decision: B, with C as a later fallback adapter. Approvals and tool policy live in the MCP gateway so they work for every harness. Agent identity, memory, files, routines, and policy are platform-owned; the harness session is disposable and rebuilt by context replay on a switch.
- Consequences: sandbox image carries all CLIs (pinned); a detector and a Settings > Harnesses screen; per-adapter contract tests; per-vendor compliance rows in 04. Cost: about +11 person-days.

## ADR-016 Build-stack defaults fixed for executors
- Context: several stack choices were left open (Next.js vs SPA, Prisma vs Drizzle, MinIO vs disk). A builder without judgment needs one answer.
- Decision: Vite + React SPA (no SSR), Drizzle ORM with SQL migrations, disk file store behind an interface, Fastify 5, BullMQ, `@xenova/transformers` for local embeddings, dockerode for sandboxes, pnpm workspaces only. Full list in `docs/build/01-gap-review-and-decisions.md` section A.
- Consequences: `docs/03-technical-design.md` section 3 is superseded where it differs; MinIO returns only in Phase 3 if multi-user needs it.
