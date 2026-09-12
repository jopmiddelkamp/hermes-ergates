# 01 - Vision and Scope

| Field | Value |
|---|---|
| Project | jop-bot (working name; product name to be chosen) |
| Version | 0.1 draft |
| Date | 2026-09-12 |
| Owner | Jop Middelkamp |
| Status | For review |

## 1. Vision

A self-hosted "team of AI assistants" that feels like a messaging app. You talk to one assistant. That assistant creates and manages other assistants, gives them work, and reports back. Every assistant works only through tools you have switched on, one tool at a time. It runs on your own server and uses your existing Claude Max subscription.

In one sentence: **Grok Bot's ease of use, on your own VPS, powered by Claude, with tool access you control per tool.**

## 2. Problem statement

Grok Bot shows that a chat-first multi-agent app is very easy to use. It also shows three problems for Jop:

1. The agents run on a vendor cloud computer with a browser. Tool access is coarse. Jop cannot limit what a logged-in agent does on a website.
2. The product is tied to a Grok subscription and a vendor's infrastructure and billing.
3. Reliability gaps: missed timer pings, duplicate routines, a connector that did not register.

Jop already pays for Claude Max. He wants the same experience on a VPS he controls, with agents that act only through MCP servers, so that permissions are enforced by software and not by promises.

## 3. Goals

| ID | Goal | Measure of success |
|---|---|---|
| G1 | Chat-first agent team with the same ease of use as Grok Bot | A new agent can be created, named, and given an avatar by chat only, in under 2 minutes |
| G2 | Agents create, brief, message, and manage other agents | Concierge pattern works end to end: delegate, report back, board updated |
| G3 | Tool access enforced per tool | A disabled tool is not visible to the model and is rejected if called |
| G4 | Runs on a single VPS with whatever agent tools and subscriptions are installed there: Claude Code (Claude Max), Codex CLI (ChatGPT), Gemini CLI (Google), Grok Build (SuperGrok) | Deployed with one `docker compose up`; the app detects installed harnesses; each agent can use a different harness and model; no API key required for personal use |
| G5 | Reliable routines and timers with push notifications | 100% of timers under 1 hour fire within 5 seconds and reach the phone |
| G6 | Files in and out of the chat | Upload zip, unpack, analyze; agent returns files as cards |
| G7 | Group chats with several agents | A thread with the user and 2+ agents works with clear sender labels |
| G8 | Ready for business use later | Multi-user, roles, per-user credentials, audit log are designed in from day one, built in Phase 3 |

## 4. Non-goals (explicitly out of scope)

- A cloud desktop with a GUI browser per agent (Grok Bot's Computer). Headless browsing may be added later as an MCP server, gated like any other tool.
- Executing tasks on Jop's own laptop ("Execution on this computer").
- A public marketplace with third-party creators. An internal catalog of templates and connectors is in scope.
- Selling the product or letting other people use Jop's Claude subscription. Anthropic's terms forbid intermediating subscription credentials (see 04-security-and-compliance.md).
- Replacing ClickUp, Moneybird, Outlook, or any external system. The platform integrates with them through MCP.

## 5. Stakeholders and users

| Role | Who | Needs |
|---|---|---|
| Owner and first user | Jop | Personal assistant team, mobile use, low friction |
| Household user (later) | Linh (fiancee) | Shared agents such as the dining scout |
| Business users (Phase 3) | Beans team and future companies | Group chats, roles, audit, own credentials |
| Operator | Jop | One-command deploy, backups, updates, usage visibility |

## 6. Constraints

| ID | Constraint | Source |
|---|---|---|
| C1 | Model access through unmodified vendor agent binaries (Claude Code, Codex CLI, Gemini CLI, Grok Build) signed in with Jop's own subscriptions; API key path must exist as a switch for business use | research/notes-claude-platform-facts.md, research/notes-harness-facts.md |
| C7 | The platform must not depend on one AI vendor: agent identity, memory, files, routines, and tool policy are owned by the platform; the harness is a per-agent setting that can be changed later | Jop's brief, 2026-09-12 |
| C2 | Usage limits: rolling 5-hour window plus a weekly cap shared with all Claude apps | Claude Help Center |
| C3 | Single VPS (Linux, Docker). No Kubernetes in Phase 1 | Jop's brief |
| C4 | Agents act only through MCP tools and their own workspace files | Jop's brief |
| C5 | Mobile-first UI; voice input; short messages readable on a phone | Kevin chat evidence |
| C6 | Personal data stays on the VPS; no third-party analytics | Privacy |

## 7. Assumptions (stated because Jop could not be asked during this session)

| ID | Assumption | If wrong |
|---|---|---|
| A1 | The VPS is Linux with at least 4 vCPU, 8 GB RAM, 80 GB disk (for example Hetzner CX32 or similar) | Adjust sizing in 03-technical-design.md |
| A2 | TypeScript/Node is the preferred stack (Jop's other projects use it; the Claude Agent SDK and MCP SDK are TypeScript-first) | Python is a valid alternative for the core |
| A3 | PostgreSQL is acceptable as the system of record | SQLite is possible for single-user only |
| A4 | Web app as a PWA is enough for mobile in Phases 1-2; native apps are not needed | Add React Native later |
| A5 | Telegram is acceptable as a fallback push channel for reminders | Use web push only |
| A6 | Jop accepts that vendors may change subscription policy; the design keeps an API-key switch per harness | Move to API keys |
| A7 | Vendor terms for running a consumer subscription headless on a server: Anthropic states it is allowed for the end user's own use; OpenAI documents ChatGPT-account auth in CI as "advanced"; Google and xAI are not explicit. Personal, ordinary use is assumed acceptable; verify before business use | Use API keys for that harness |

## 8. Success criteria for Phase 1 (MVP)

1. Jop chats with a concierge agent on his phone and laptop.
2. The concierge creates a specialist from a chat instruction or an uploaded zip, names it, and briefs it.
3. The specialist reports back; the concierge relays a short summary.
4. Outlook (limited MCP) and ClickUp are connected; Send/Reply/Forward are off; the agent cannot call them.
5. A reminder set in chat fires on time and pushes to the phone.
6. A zip with photos is uploaded, unpacked, and summarized.
7. All of the above runs on the VPS with the Max subscription and no API key.

## 9. Document map

| Document | Purpose |
|---|---|
| research/00-research-summary.md | As-is analysis of Grok Bot, business rules, screenshots |
| research/notes-claude-platform-facts.md | Verified facts about Claude Code, Agent SDK, MCP, policies |
| 01-vision-and-scope.md | This document |
| 02-functional-design.md | Actors, user stories, functional requirements, UI specification |
| 03-technical-design.md | Architecture, components, runtime, deployment |
| 04-security-and-compliance.md | Threat model, least privilege, credentials, Anthropic terms |
| 05-data-model.md | Entities, relations, storage |
| 06-api-and-mcp-spec.md | REST/WebSocket API and the platform MCP tools |
| 07-delivery-plan.md | Phases, milestones, estimates, risks |
| 08-decision-log.md | Architecture decision records |
| 09-glossary.md | Terms |
