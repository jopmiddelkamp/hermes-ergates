# Proposal: engineering stack, best practices, and the "build bible" plan

| Field | Value |
|---|---|
| Date | 2026-09-12 |
| Status | Proposal for Jop's decision |
| Inputs | docs/01..09, docs/research/principles-input (OWASP, compliance, SOLID, DRY, KISS from Jop), 14 primary sources listed at the end |

## Part 1 - Honest critique: could a less capable model build this from the current docs?

No. The current documents explain *what* and *why* well. They do not yet give a builder the exact *how*. A less capable model needs contracts, fixtures, and pass/fail tests, not prose. Gaps found, ordered by damage if missing:

| # | Gap | Why it hurts a builder | Fix in the bible |
|---|---|---|---|
| 1 | No acceptance tests per requirement | "Done" is a judgment call; the model will declare victory early | Every FR gets Given/When/Then cases; every task card has runnable checks |
| 2 | No machine contracts | API, events, cards, tool inputs exist only as tables | OpenAPI 3.1 file, JSON Schemas for events/cards/tool I/O/harness events, migration `0001` with the full schema |
| 3 | No coding standards or repo skeleton | Each task invents its own structure; drift | `docs/standards/` per language, folder layout, naming, error handling, logging, DI rules; a generated skeleton repo |
| 4 | Prompts are described, not written | Concierge behavior is the product; it cannot be "roughly right" | Versioned prompt files in `prompts/` with tests (golden transcripts) |
| 5 | Turn prompt assembly not specified | Ordering, size caps, and templates decide quality | Exact template with sections, token caps, and truncation rules |
| 6 | Harness adapters lack fixtures | Vendor stream formats are the riskiest integration | Recorded event streams per harness in `fixtures/`; contract test suite each adapter must pass |
| 7 | MCP gateway protocol not specified | "Held approval" collides with per-harness tool timeouts (Gemini default 600 s, Claude `MCP_TOOL_TIMEOUT`) | Gateway spec: token minting, proxying stdio and HTTP, timeouts, error codes, approval hold with keep-alive |
| 8 | State machines only in prose | Turn, job, routine, card, approval, agent | Explicit state tables and diagrams; illegal transitions rejected in code and tested |
| 9 | Auth and session details missing | Cookie flags, CSRF, passkeys, MFA, session lifetimes | Applied OWASP parameters (from Jop's owasp reference) as concrete config |
| 10 | Multi-tenant model absent | Adding `tenant_id` and RLS later is a rewrite | `tenant_id` on every table plus Postgres RLS from migration 0001, even with one tenant |
| 11 | Event publishing has a dual-write bug | "Write to Postgres, then publish to Redis" can lose events | Transactional outbox: events are rows; a relay publishes them |
| 12 | Scheduler semantics undefined | Missed runs, DST, catch-up, exactly-once | Scheduler spec with time zone rules and idempotent firing |
| 13 | Sandbox not concretely specified | Dockerfile, egress control, credential paths per harness | Pinned Dockerfile, nftables/proxy egress rules, per-harness home layout, verified paths |
| 14 | File intake risks not covered | Zip slip, zip bombs, unbounded decompression, MIME spoofing | Upload rules: allow-list, magic bytes, post-decompression size cap, path checks |
| 15 | UI has no design system | Components, states (loading, empty, error), accessibility, Dutch/English copy | Design tokens, component specs with states, WCAG 2.2 AA checklist, copy file |
| 16 | No test strategy | Only a definition of done | Test pyramid, testcontainers, fake harness binary, contract tests, misuse tests |
| 17 | No CI/CD or environments | Nothing enforces the gates | Pipeline spec: build, lint, tests, SCA, secret scan, SBOM, image signing, deploy, rollback |
| 18 | No runbooks or alerts | Operations rely on memory | Deploy, rollback, backup/restore, key rotation, incident response, alert catalog |
| 19 | Compliance evidence files missing | Jop's compliance skill requires them | supplier register, data inventory, risk register, incident response, continuity, access reviews |
| 20 | No error catalog | Inconsistent errors leak details | RFC 9457 problem types with codes and user-facing text |
| 21 | No config catalog | 12-factor config unspecified | Env var table with types, defaults, validation at boot |
| 22 | No rules for the building agent itself | A builder with broad permissions is a risk | "Builder contract": allowed and forbidden actions, branch rules, PR checklist, escalation |
| 23 | Data lifecycle unspecified | Retention, soft delete, erasure | Retention table and jobs; deletion cascade rules |
| 24 | Observability vague | No correlation ids, metric names, trace spans | OpenTelemetry plan with span and metric names |

Conclusion: keep documents 01 to 09 as the *design*. Add a second layer, the *build bible*, that a builder can execute task by task.

## Part 2 - Best practices and patterns to adopt (all long-proven)

Only patterns with more than a decade of use or an official standard behind them.

### 2.1 Architecture
- **Modular monolith**: one deployable per tier (api, runner, gateway, web) with strict module boundaries (chat, agents, harness, connectors, scheduler, files, memory, notifications). No microservices on one VPS.
- **Clean architecture / ports and adapters**: domain, application, adapters, infrastructure. Jop's SOLID, DRY, and KISS skills already assume these standard layers; keep interfaces only at layer boundaries and where 3+ implementations exist (harness adapters, connectors, notifiers).
- **Twelve-Factor App** for config, processes, logs, disposability, dev/prod parity [1].
- **C4 model** for the four diagram levels: context, container, component, code [5].
- **ADRs** for every significant decision; the decision log already exists [6].
- **Bounded contexts with explicit DTOs** per boundary; no entity binding of request bodies (Jop's OWASP rule, API3).

### 2.2 Data and consistency
- PostgreSQL as the single system of record; versioned migrations (expand then contract); optimistic concurrency with version columns.
- **Transactional outbox** for all events: "store the message in the database as part of the transaction that updates the business entities. A separate process then sends the messages" [3]. Replaces the dual write in the current design.
- **Idempotency keys** at every boundary that causes side effects: routines, tool calls, agent creation, outbound actions.
- **Row-level security** with `tenant_id` on every table and `FORCE ROW LEVEL SECURITY` so owners are bound too [9].
- UTC in storage; IANA time zone per user; routines evaluated in the user's zone.
- Retention as data: every table has a documented retention rule and a job that enforces it.

### 2.3 Reliability
- Timeouts, retries with exponential backoff and jitter, circuit breakers on every external call (Jop's SOC 2 rules A1.1, CC9.1).
- Bulkheads: one queue per agent; global concurrency cap; queue-based load leveling.
- Graceful shutdown and fast startup (12-factor IX); liveness and readiness endpoints.
- At-least-once delivery with consumer-side dedupe by event id (the WebSocket resume design already uses monotonic ids).
- State machines persisted in the database for every long-running thing (turn, job, routine run, approval); no fire-and-forget (SOC 2 PI1.3).

### 2.4 Security (technical)
- **OWASP ASVS 5.0 Level 2** as the verification baseline [4], plus **OWASP Top 10 2025**, **API Security Top 10 2023**, and **Top 10 for LLM Applications 2025** [2], exactly as Jop's owasp reference prescribes; the LLM list maps one-to-one onto this product (prompt injection, sensitive information disclosure, supply chain, improper output handling, excessive agency, system prompt leakage, vector weaknesses, misinformation, unbounded consumption).
- Deny-by-default central authorization; object-level checks; 404 for foreign tenants; tenant from session only.
- **RFC 9457 Problem Details** for every error response, with a correlation id and no internals [4b].
- Secrets only from the environment or a vault; secret scanning as a blocking check; no secrets in images.
- Supply chain per **NIST SSDF** practices [7]: pinned lockfiles, SCA blocking on known-exploited criticals, SBOM per release, signed images, reviewed PRs only.
- Sandboxes: non-root, read-only root, dropped capabilities, egress allow-list, resource limits (already in 04, to be made concrete).
- LLM controls: untrusted content in delimited data blocks; taint the turn once untrusted content is present so send/pay/delete tools require approval; recipients and targets resolved by verified ids, never free text; bounded loops and budgets; model versions pinned; injection red-team suite in CI.

### 2.5 API and contracts
- OpenAPI 3.1 generated from code; a route missing from the spec fails CI (API9). `/v1/` versioning with a sunset policy.
- JSON Schema as the one source of truth for events, cards, platform tool inputs, and harness events; client types generated from it (Jop's DRY rule on contract sync).
- Pagination with max page size, body size caps, 405/413/415 handling, accurate content types.

### 2.6 Testing
- Test pyramid: unit (domain and application), integration (testcontainers for Postgres), contract tests per adapter and connector with recorded fixtures, end-to-end with a **fake harness binary** that replays vendor event streams, so no real subscription is used in CI.
- Misuse tests are part of the spec: cross-tenant access, disabled tool call, hop cap, approval deny, zip slip.
- DAMP tests: readable scenarios, shared infrastructure (Jop's DRY skill).
- Injection red-team suite for prompts and tool descriptions.

### 2.7 Delivery
- Trunk-based development with short-lived branches, PR-only merges, required CI [SOC 2 CC8.1].
- **Conventional Commits** [8b] and **Semantic Versioning** [8a]; changelog generated.
- CI gates: build, lint, type check, tests, SCA, secret scan, SBOM, image scan, contract tests.
- Deploy from CI only; tagged releases; documented rollback; feature flags for risky changes.
- Infrastructure as code for the VPS (cloud-init or Ansible plus compose files) so the server can be rebuilt from the repo.

### 2.8 Observability and operations
- **OpenTelemetry** for traces, metrics, and logs, vendor-neutral [10]; correlation id per request and turn; structured JSON logs; no sensitive payloads in logs.
- Golden signals per service (latency, traffic, errors, saturation) plus product metrics (turn duration, tokens per agent, routine on-time rate, approval wait).
- Alerts with a named responder and a runbook; test that a synthetic failure fires the alert.
- Backups: encrypted, off-server, restore-tested quarterly; RPO/RTO written down before promises.
- Audit log: append-only, separate from application logs, 12 months retention.

### 2.9 Frontend and UX
- Design tokens and a component library with explicit states; WCAG 2.2 AA; Dutch and English copy in one file; optimistic UI with reconciliation; offline queue; PWA installability and push.
- Security headers exactly per Jop's owasp reference (HSTS, CSP without unsafe-inline, frame-ancestors none, and so on).

### 2.10 Engineering principles (from Jop's zip, adopted as-is)
- SOLID with the pragmatic deviations listed in the skill; `// SOLID-DEVIATION:` comments.
- DRY as knowledge duplication, not code similarity; DAMP tests; `// DRY:` and `// DRY-DEVIATION:` comments.
- KISS with the four tests (comprehension, necessity, deletion, explanation); extract at the second occurrence only with a clean name, no flags, same reason to change.
- Compliance-first: ISO 27001 and SOC 2 controls from the first line; evidence files in `docs/security/`; HIPAA safeguards adopted voluntarily where relevant (sensitive records: messages, memories, connector tokens).

### 2.11 Practices specific to building with less capable models
- **Walking skeleton first**: one thin end-to-end slice (login, one thread, one turn with the fake harness) before any breadth.
- **Vertical slices as task cards**: each card names the files, the interfaces it may touch, the tests that must pass, and what it must not do.
- **Contract-first**: schemas and fixtures exist before the code that uses them.
- **Golden fixtures**: recorded harness streams, recorded MCP exchanges, golden prompts and transcripts.
- **Small PRs, one card each**, self-review checklist from the owasp and compliance skills before "done".
- **Builder contract**: the building agent runs only in a dev container with synthetic data, no production credentials, no outbound network except package registries, and must stop and ask when a card is ambiguous.

## Part 3 - Programming language combinations (top 3), product-first

Revised 2026-09-12 on Jop's instruction: the builder's and the owner's personal experience are excluded. The criteria are what serves the end product: runtime performance, long-term maintainability, operational simplicity, ecosystem fit, and consistency of AI-written code.

Facts used: official MCP SDKs are Tier 1 for TypeScript, Python, C#, Go, and Rust [11]. Official vendor SDKs: Anthropic (Python, TypeScript, Java, Go, Ruby, C#, PHP), OpenAI (Python, TypeScript, .NET with Microsoft, Java and Go in beta) [12], Google Gen AI (Python, TypeScript, Go, Java, C#) [13]. Go promises that "programs written to the Go 1 specification will continue to compile and run correctly, unchanged, over the lifetime of that specification" [15]. .NET ships "a new major release ... every year in November"; LTS releases "are supported for three years", STS for two [16]. The harnesses are vendor CLIs driven as subprocesses, so the backend language is free; SDKs matter only for the later API-loop adapter.

The frontend is React with TypeScript in all three options: the largest and most stable UI ecosystem, mature PWA and push support, one client for phone, tablet, and desktop. Faster-rendering frameworks (Solid, Svelte) exist, but their smaller ecosystems are a maintenance risk, and a chat UI is not render-bound. Native apps (Flutter or Swift/Kotlin) can be added later on the same API.

### Option 1 - Go backend + React/TypeScript frontend (recommended)
- Performance: compiled, static binary, goroutines; memory in the tens of megabytes per service; instant start. Top tier for an I/O-bound orchestrator.
- Maintainability: small language, one idiomatic way to do most things, `gofmt`, and the Go 1 compatibility promise [15]: code written this year keeps compiling for years. Few framework migrations over the product's life.
- AI-written code: the small language surface makes code from many AI sessions look the same, which is what keeps a large codebase readable.
- Ecosystem: Tier 1 MCP Go SDK [11]; Anthropic and Google official SDKs; standard library covers HTTP, process spawning, stream handling, and reverse proxying, which is most of what the runner and gateway do. Postgres via `pgx` and `sqlc` (SQL-first, generated types). Jobs and schedules on Postgres with the proven `SELECT ... FOR UPDATE SKIP LOCKED` pattern (library: River, or a small own implementation), so Redis is not needed.
- Operational simplicity: one binary per service, tiny images, no runtime to patch separately.
- Costs: more explicit code than .NET (errors, wiring); auth, migrations, and WebSockets are libraries, not a framework. The build bible pins them once.

### Option 2 - C#/.NET backend + React/TypeScript frontend
- Performance: compiled with a JIT; ASP.NET Core is in the same performance class as Go for HTTP; memory higher; cold start a few seconds.
- Maintainability: strong typing, analyzers, and one framework family (ASP.NET Core, SignalR, EF Core, hosted services, DI, OpenTelemetry). Cost: a major version every year with LTS every two years [16], so the product must plan a framework upgrade at least every three years, and framework surface is much larger than Go's.
- AI-written code: least hand-written glue; more framework features to misuse.
- Ecosystem: Tier 1 MCP C# SDK [11]; official Anthropic, OpenAI, Google SDKs.
- Operational: larger images (100-200 MB), runtime patches.

### Option 3 - Rust backend + React/TypeScript frontend
- Performance: the best; no garbage collector; lowest memory.
- Maintainability: stable language, but ownership and async lifetimes make changes slow; compile times grow with the codebase; the async ecosystem still moves.
- AI-written code: highest error and stall rate of the three, even for strong models; the borrow checker fights generated code.
- Ecosystem: Tier 1 MCP Rust SDK [11]; no official Anthropic, OpenAI, or Google SDK (community crates only) [12][13].
- Verdict: the extra performance is not usable by this product (it waits on subprocesses, connectors, and the database). Not recommended for the whole backend; a candidate for one hot component later if profiling demands it.

TypeScript full-stack is excluded from the top three on performance and dependency churn, given that performance is a top criterion.

### Scorecard (1 = weak, 5 = strong; experience excluded)

| Criterion | 1: Go | 2: .NET | 3: Rust |
|---|---|---|---|
| Runtime performance | 5 | 4 | 5 |
| Long-term maintainability | 5 | 4 | 3 |
| Consistency and safety of AI-written code | 4 | 5 | 2 |
| Ecosystem fit (MCP, vendor SDKs, Postgres, WebSockets) | 4 | 5 | 3 |
| Operational simplicity | 5 | 4 | 5 |
| **Total** | **23** | **22** | **18** |

Recommendation: **Go + React/TypeScript**. In one line: it delivers top-tier performance and the lowest maintenance burden over a decade, and the slightly larger amount of explicit code is a one-time cost that the build bible pays with pinned choices and contract tests. .NET is a respectable second if maximum framework batteries are valued over runtime simplicity.

## Part 4 - The build bible: what it will contain

The bible is a second document set that turns the design into executable work. Proposed layout:

```
docs/bible/
  00-builder-contract.md        # rules for the building agent: allowed and forbidden actions, PR checklist, escalation
  01-standards/                 # coding standards (backend language, TypeScript), repo layout, naming, errors, logging, DI, comments
  02-contracts/                 # openapi.yaml, schemas/*.json (events, cards, platform tools, harness events), db/0001_init.sql, state-machines.md, error-catalog.md, config-catalog.md
  03-security-baseline.md       # ASVS L2 items applied, threat model per module, data classification, LLM controls, applied OWASP parameters
  04-prompts/                   # concierge.md, specialist.md, briefing-template.md, delegation-template.md, extraction.md, turn-template.md + golden transcripts
  05-test-strategy.md           # pyramid, fixtures, fake harness binary, contract tests, misuse tests, red-team suite
  06-cicd-and-environments.md   # pipeline, gates, environments, secrets, IaC for the VPS
  07-runbooks/                  # deploy, rollback, backup-restore, key-rotation, incident-response, alerts
  08-work-breakdown/            # epics -> slices -> task cards (T-001...), dependency order, walking skeleton first
  09-ui-spec/                   # tokens, components with states, screens, copy (nl/en), accessibility checklist
docs/security/                  # evidence files required by the compliance skill
.claude/skills/                 # owasp, compliance, solid, dry, kiss adapted to this product (tenant, sensitive data, automated actions = tool calls)
```

Task card format (every card):
```
T-042  Gateway holds "ask" tool calls until approval
Depends on: T-030, T-031
Touches: apps/gateway/src/approval/*, packages/schemas/approval.json
Interfaces: IApprovalStore, ITurnEvents (no other modules)
Steps: 1..n (small, ordered)
Acceptance tests: gateway_test: ask_tool_waits_for_card_then_continues; ask_tool_deny_returns_error; hold_survives_60s_keepalive
Security checklist: policy re-checked on continue; audit row written; no args in logs
Forbidden: changing the policy engine; adding new env vars without config-catalog entry
Done when: tests green, lint clean, PR checklist ticked
```

Work to produce the bible (my effort, after Jop's choices): about 4 to 6 working sessions. Order: builder contract and standards, contracts and schemas, security baseline, prompts, test strategy, CI/CD, runbooks, UI spec, then the work breakdown (about 80 to 120 cards).

## Part 5 - Decisions needed now

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D-A | Backend language | A) Go  B) C#/.NET  C) Rust | **Decided 2026-09-12: C#/.NET** (Jop; familiarity speeds reviews; second-ranked option, one point behind Go) |
| D-B | Client | A) React + TypeScript PWA  B) native apps later on the same API | **Decided 2026-09-12: A** |
| D-C | Queue and events | A) Postgres-only: outbox table + `SKIP LOCKED` job queue + LISTEN/NOTIFY (Quartz.NET / Hangfire with Postgres storage in .NET) - one less service  B) Redis + a queue library | **Decided 2026-09-12: A, no Redis** |
| D-D | Security and compliance target | A) ASVS 5.0 L2 + SOC 2 and ISO 27001 readiness from day one, evidence files in repo  B) ASVS L2 only, compliance later | **Decided 2026-09-12: A, everything from day one** |
| D-E | Tenancy | A) `tenant_id` + RLS from migration 0001  B) single-user schema, migrate later | **Decided 2026-09-12: A** |
| D-F | Product name | free text | **Decided 2026-09-12: Cobbers** (Australian for loyal mates). Code name `Cobbers`, namespaces `Cobbers.*`, repo to be renamed from jop-bot |
| D-G | Builder capability | A) Fable-class model: 20-30 vertical slices with contracts and gates  B) smaller models: 80-120 micro task cards | **Decided 2026-09-12: one strong model builds everything.** The bible is still written at task-card granularity with contracts and gates, grouped into slices, so any model can execute it safely |

## Sources
1. [The Twelve-Factor App](https://12factor.net/)
2. [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)
3. [Transactional Outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html)
4. [OWASP ASVS project (5.0.0 released 2025)](https://owasp.github.io/www-project-application-security-verification-standard)
4b. [RFC 9457 Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
5. [C4 model](https://c4model.com/)
6. [Architectural Decision Records](https://adr.github.io/)
7. [NIST SP 800-218 SSDF](https://csrc.nist.gov/pubs/sp/800/218/final)
8a. [Semantic Versioning](https://semver.org/)
8b. [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
9. [PostgreSQL row-level security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
10. [OpenTelemetry](https://opentelemetry.io/docs/what-is-opentelemetry/)
11. [MCP official SDKs and tiers](https://modelcontextprotocol.io/docs/sdk)
12. [OpenAI client libraries](https://developers.openai.com/api/docs/libraries)
13. [Google Gen AI SDK languages](https://ai.google.dev/gemini-api/docs/libraries)
14. Jop's principle skills: docs/research/principles-input (owasp, compliance, solid, dry, kiss)
15. [Go 1 and the Future of Go Programs (compatibility promise)](https://go.dev/doc/go1compat)
16. [.NET support policy: release cadence, LTS and STS](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)
