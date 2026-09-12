# Hermes source notes (read and corrected 2026-09-12)

Source: the local checkout at `~/Projects/misc/hermes/hermes-agent`, commit `d76856cc69` (2026-09-12), `pyproject.toml` version `0.21.2`. Entries name their source files. Corrections from the second review are folded into this document; source comments/docs can disagree with handlers, so handler shapes and live acceptance evidence take precedence. Website docs are under `website/docs/` in that checkout. Re-verify against the pinned version before building; the JSON-RPC surface is an internal contract shared by the TUI, the dashboard, and the desktop app, and it changes between releases.

## 1. What Hermes Agent is

Hermes Agent (Nous Research, MIT license) is a self-improving agent runtime: model loop, tools (terminal, files, web, browser, vision, memory, skills, delegation, cron), a messaging gateway for 20+ platforms, sessions in SQLite, and a plugin system. It runs on a VPS, in Docker, or on Hermes Cloud. It supports many model providers and switches with `hermes model` (`README.md`).

## 2. Three client protocols (`website/docs/developer-guide/programmatic-integration.md`)

| Protocol | Transport | Defined by | Best for |
|---|---|---|---|
| ACP (Agent Client Protocol) | JSON-RPC over stdio | `acp_adapter/` | IDE clients |
| TUI gateway JSON-RPC | JSON-RPC over stdio or WebSocket | `tui_gateway/server.py`, `tui_gateway/ws.py` | Custom hosts that need sessions, slash commands, approvals, streaming events. **This is what Hermes Desktop uses.** |
| API server | HTTP + Server-Sent Events, OpenAI-compatible | `gateway/platforms/api_server.py` | OpenAI-format frontends, language-agnostic web clients |

All three drive the same `AIAgent` core.

## 3. The `hermes serve` backend (FastAPI, default port 9119)

- `hermes serve` is the headless backend the desktop app spawns or connects to. It serves only JSON-RPC/WebSocket/REST; the dashboard SPA is disabled (`web/AGENTS.md`, section "dashboard vs serve"). `hermes dashboard` is the same server plus the SPA.
- WebSocket endpoint: `/api/ws`. Wire protocol is newline-delimited JSON-RPC, identical to stdio; the server sends `gateway.ready` right after accept (`tui_gateway/ws.py` module docstring). Profile selection: query parameter `?profile=<name>` (`hermes_cli/web_routers/chat_ws.py:447`).
- Auth, plain mode: an ephemeral session token (`_SESSION_TOKEN`, fixed with `HERMES_DASHBOARD_SESSION_TOKEN`) sent as a header or `Authorization: Bearer` (`hermes_cli/web_server.py:305-415`).
- Auth, gated mode: a non-loopback bind engages the auth gate; the server fails closed at startup without a provider (`website/docs/user-guide/features/web-dashboard.md:164`). Providers: username/password (`HERMES_DASHBOARD_BASIC_AUTH_USERNAME`, `_PASSWORD`, `_SECRET`; trusted network or VPN only), Nous Portal OAuth (`HERMES_DASHBOARD_OAUTH_CLIENT_ID`), self-hosted OIDC (`HERMES_DASHBOARD_OIDC_ISSUER`, `_CLIENT_ID`) (`website/docs/user-guide/docker.md`, dashboard section).
- Native sign-in for native apps (RFC 8252 + PKCE): `GET /auth/native/authorize`, `POST /auth/native/token`, `POST /auth/native/refresh`; the public `GET /api/status` advertises `auth_flows` (`["cookie","native_pkce"]`), `auth_required`, `auth_providers`. Access token is short-lived, refresh token rotates. REST uses `Authorization: Bearer`; the WebSocket uses a single-use ticket minted with the bearer (`website/docs/guides/desktop-native-signin.md`). Password providers can use `/login`; the JSON password endpoint is `POST /auth/password-login` (`provider`, `username`, `password`) and sets session cookies. `POST /api/auth/ws-ticket` returns a 30-second single-use ticket. Native token exchange uses `code_verifier`, not `verifier`.
- WebSocket close codes: 4403 = request guard rejected (Host or peer mismatch), 4401 = ticket did not authenticate (`web-dashboard.md:202`). The Host header must match the bind host (DNS-rebinding guard).
- REST routers, one file per surface in `hermes_cli/web_routers/`: `profiles` (`GET/POST /api/profiles`, `PATCH/DELETE /api/profiles/{name}`, soul, description, model, export, import), `cron` (`/api/cron/jobs` CRUD, runs, pause, resume, trigger, delivery-targets, blueprints), `files` (`POST /api/chat/image-upload`, `/api/files/upload`, `/api/files/download`, `/api/fs/*`), `skills`, `tools` (`/api/tools/toolsets`, terminal backend), `mcp` (`/api/mcp/servers` CRUD, test, auth, enabled, catalog), `models` (`/api/model/options`, `/api/model/set`), `oauth` (provider OAuth flows), `messaging` (platform config, Telegram and WhatsApp onboarding), `status` (`/api/status`, `/api/health`, `/api/system/stats`), `actions` (gateway restart, update), `memory_providers`, `sessions`, `analytics`, `audio`, `git`.
- REST chat-image upload has a 25 MiB decoded cap and accepts JSON `{data_url, filename?}`, not multipart. Managed document and RPC byte-attachment limits are separate (`files.py`, `web_models.py`).

## 4. JSON-RPC methods and events (extracted from `tui_gateway/*.py`)

Methods (client to server), grouped:

- Prompting: `prompt.submit` (params include `session_id`, `text`, `profile`, `surface`, `request_id`, `display_kind`, `queued`, `voice_context`, and the rewind flags `truncate_before_row_id`, `confirm_truncate`), `prompt.background`, `prompt.btw`.
- Sessions: `session.create`, `session.list`, `session.active_list`, `session.activate`, `session.resume`, `session.history`, `session.status`, `session.info`, `session.usage`, `session.title`, `session.steer`, `session.interrupt`, `session.compress`, `session.branch`, `session.close`, `session.delete`, `session.set_hidden`, `session.reset`, `session.undo`, `session.most_recent`, `session.events.since`, `session.events.stats`, `session.cwd.set`, `session.control.*`, `session.foreign.*`.
- Human-in-the-loop: `approval.respond` (choices `once`, `session`, `always`, `deny`; `server.py:638-643`), `clarify.respond` (single or batch questions with `choices` and `multi_select`; `tools/clarify_tool.py`), `sudo.respond`, `secret.respond`, `terminal.read.respond`, `mcp.setup.respond`, `vault.*.respond`.
- Agents (profiles): `profiles.list` (returns `ui_meta`, `ui_meta_revisions`, `has_avatar`, and `bot_mode_protocol: true`; `methods_profiles.py:224-254`), `profiles.create`, `profiles.configure`, `profiles.describe`, `profiles.get_asset`, `profiles.set_asset`, `profile.yaml`.
- Group rooms: `groups.list`, `groups.create`, `groups.send`, `groups.state`, `groups.log`, `groups.rename`, `groups.disband`, `groups.stop`, `groups.retry`, `groups.approve`, `groups.capabilities` (reports `driver: true` when the gateway owns room turn scheduling), `groups.peer.*`, `groups.replicate`.
- Subagents: `subagent.list`, `subagent.tail`, `subagent.steer`, `subagent.interrupt`, `delegation.status`, `delegation.pause`.
- Files and images: `file.attach`, `image.attach` (server `path` required), `image.attach_bytes` (`content_base64` or `data`; separate byte cap in the attachment helpers), `image.detach`, `image.generate`, `clipboard.paste`.
- Configuration: `config.get`, `config.set`, `config.show`, `model.options`, `model.default`, `model.provider`, `model.save_key`, `tools.list`, `tools.configure`, `tools.show`, `skills.manage`, `skills.reload`, `mcp.catalog`, `mcp.servers.test`, `mcp.servers.oauth.start`, `connectors.list`, `connectors.connect`, `cron.manage`, `reload.mcp`, `reload.env`.
- Commands: `commands.catalog`, `command.resolve`, `command.dispatch`, `slash.exec`, `complete.slash`, `complete.path`.
- Voice: `voice.record`, `voice.toggle`, `voice.status`, `voice.tts`, `voice.voice_chat_mode`.
- Other: `gateway.ping`, `gateway.capabilities`, `process.list`, `process.stop`, `process.kill`, `projects.*`, `spawn_tree.*`, `billing.*`, `free_tier.*`, `browser.*`.

Events (server to client): `gateway.ready`, `session.info`, `session.usage`, `message.start`, `message.delta`, `message.interim`, `message.complete`, `thinking.delta`, `reasoning.delta`, `reasoning.available`, `status.update`, `tool.start`, `tool.progress`, `tool.complete`, `tool.generating`, `todo.updated`, `clarify.request`, `clarify.expire`, `approval.request`, `approval.pending`, `approval.received`, `sudo.request`, `secret.request`, `background.complete`, `subagent.start`, `subagent.complete`, `subagent.tool`, `subagent.text`, `notification.show`, `notification.clear`, `cron.changed`, `room.activity`, `skin.changed`, `error` (`apps/shared/src/json-rpc-gateway.ts:1-25` and `tui_gateway/*.py`).

Streaming events `message.delta`, `reasoning.delta`, `thinking.delta` are coalesced server-side in ~33 ms batches (`ws.py:_TOKEN_COALESCE_S`).

## 5. The shared TypeScript client (`apps/shared/src/json-rpc-gateway.ts`)

- Package `@hermes/shared` (private, workspace). `JsonRpcGatewayClient` dials `ws://` or `wss://` only, uses the global `WebSocket` or an injected `socketFactory`, and has no browser-only globals (`window`, `document`, `localStorage`) in the client file.
- Heartbeat every 15 s, dead after 45 s; request timeout 120 s; connect timeout 15 s.
- Reconnect: tracks the last event `seq` per `session_id` and calls `session.events.since` with `last_seen`; frames racing replay are parked. The ring is bounded and in-process. `gateway.ready.replay_epoch` and the replay response `epoch` detect reset; `truncated` requires history refetch even without restart.
- `websocket-url.ts`: OAuth-gated gateways need a fresh single-use ticket minted right before opening the socket (`getGatewayWsUrl`).

The pure socket client is a reuse candidate. React Native HTTP/cookies, ticket minting, socket lifecycle and vendored dependencies still require a native adapter and real-device validation; compatibility has not been demonstrated.

## 6. The API server (aiohttp, default port 8642) (`gateway/platforms/api_server.py`, `website/docs/user-guide/features/api-server.md`)

- Enable with `API_SERVER_ENABLED=true`; `API_SERVER_KEY` is required on every deployment; bind with `API_SERVER_HOST`; CORS off by default.
- Routes (`_http_route_table`, line 1523): `/health`, `/health/detailed`, `/v1/models`, `/api/model/options`, `/v1/capabilities`, `/v1/chat/completions`, `/v1/responses` (+ GET/DELETE), `/v1/runs` (+ `{id}`, `/events` SSE, `/approval`, `/steer`, `/stop`), `/api/sessions` CRUD + `/messages`, `/fork`, `/chat`, `/chat/stream`, `/model`, `/api/jobs` CRUD + pause/resume/run, `/v1/skills`, `/v1/toolsets`, `/v1/artifacts/upload`, `/v1/artifacts/download/{id}`, `/v1/browser-control/*`.
- Approval on a run: `POST /v1/runs/{id}/approval` with body `{"choice": "once|session|always|deny"}`; aliases `approve`, `approved`, `allow` map to `once` (`api_server_runs.py:770-798`).
- `Idempotency-Key` header on `POST /v1/runs` is durable across restarts; reuse with a different body returns 409.
- Concurrent-run cap default 10 (`gateway.api_server.max_concurrent_runs`); HTTP 429 when reached.
- Multi-profile routing: with `gateway.multiplex_profiles` every profile is served under `/p/<profile>/...` and must present its own `API_SERVER_KEY`.
- Limits: inline images only, no file upload on the OpenAI-format endpoints (artifact endpoints exist separately); 100 stored responses.
- Sessions started through the API server are "unattended" for dangerous-command approvals: `approvals.unattended_mode: deny` by default (`website/docs/user-guide/security.md:51`). The runs API still emits `approval.request` events and accepts `run_approval` for tool approvals.

## 7. Profiles are agents (`website/docs/user-guide/profiles.md`)

- A profile is a separate Hermes home directory with its own `config.yaml`, `.env`, `SOUL.md`, memories, sessions, skills, cron jobs, and state database. Create with `hermes profile create <name> [--clone|--clone-all|--clone-from]`; every profile gets a command alias and `hermes -p <name>`.
- Profiles have shared files/stores that require the upstream ownership/concurrency mechanisms. The serve/gateway deployment must test interactive, cron and delegated access together; do not launch duplicate unmanaged agents against one profile or infer isolation from a directory alone.
- OAuth logins (Anthropic, Codex, xAI) live in the root `~/.hermes/auth.json` and are shared by all profiles; static API keys are copied per profile.
- One gateway process per profile (systemd or launchd unit each), or one multiplexing gateway for all profiles with `gateway.multiplex_profiles: true` on the default profile (`multi-profile-gateways.md`).
- Profiles carry a `description` used by the kanban orchestrator for routing (`hermes profile describe`).

## 8. Bot Mode (`website/docs/user-guide/bot-mode.md`)

- Built into Hermes Desktop; a Bot **is** a profile. No new backend primitive.
- Each Bot has a canonical, persistent "Bot Chat" session created when the Bot is born; its title is the constant `BOT_CHAT_TITLE` from `tools/bot_mode_probe.py`. The backend injects the Bot Mode teammate-messaging protocol into the system prompt only for sessions with that title (`agent/system_prompt.py:315-333`), controlled by `agent.bot_mode_protocol` (default on).
- `message_agent(target, message)` exists only in canonical Bot Chat sessions; delivery is fire-and-forget into the teammate's Bot Chat; the reply arrives as a background completion. The roster (names, titles, descriptions) is in every Bot Chat's system prompt.
- Bot Mode `ui_meta['hermes-bots']` contains appearance, `title` (friendly name), hidden/pinned state and section membership. Image bytes use the avatar asset API; profile description is a separate metadata field. Desktop section definitions live in plugin storage (`user-sections.ts`), so shared membership alone does not prove a synchronized section list. Mobile field and local organization mapping is explicit in 05/10.
- Routines are cron jobs namespaced `[bot:<name>] <routine>`; runs land in the Bot's own chat history.
- Group chats (2-6 Bots) are rooms; `groups.*` RPCs; up to three serial rounds; @mentions scope the round; `@user` escalation shows a "needs you" badge; when all members live on one gateway the gateway drives the room even when the client disconnects (`groups.capabilities` → `driver: true`).
- Creating a Bot on the desktop: name, title, description; advanced: clone source, model and provider pin, custom SOUL.md, per-skill, per-toolset, per-MCP-server enablement.

## 9. Cron (`website/docs/user-guide/features/cron.md`)

- One `cronjob` tool with actions; one-shot or recurring; natural language or cron expressions; delivery to origin chat, files, or platform targets; skill-backed jobs; no-agent script jobs; per-job model and reasoning pins; provider snapshot at creation.
- REST: dashboard `/api/cron/jobs` and API server `/api/jobs`; `POST .../pause`, `/resume`, `/trigger` (dashboard) or `/run` (API server).
- Agents launched by the scheduler cannot manage cron by default (opt-in).
- Dangerous commands in cron: `approvals.cron_mode: deny` by default, subject to the actual tool/guard path.
- The default in-process ticker polls every 60 seconds (`cron/scheduler_provider.py::InProcessCronScheduler.start`; `gateway/run.py` uses this default). Secondary-profile jobs require multiplexing or their own gateway. This does not supply five-second timer precision or a phone-delivery guarantee.

## 10. Memory, skills, kanban

- Memory: `MEMORY.md` (2,200 chars) and `USER.md` (1,375 chars) in `~/.hermes/memories/`, injected at session start; the `memory` tool adds, replaces, removes; FTS5 session search over past conversations; Honcho and other memory providers are plugins (`features/memory.md`, `features/memory-providers.md`).
- Skills: agentskills.io format (`SKILL.md`); skills hub; autonomous skill creation after complex tasks; `GET /api/skills`, `PUT /api/skills/toggle`.
- Kanban: durable SQLite board in `~/.hermes/kanban.db` shared across profiles; `kanban_*` tools for agents; `hermes kanban` CLI and dashboard for humans; orchestrator routes tasks to profiles by description; worker lanes (`features/kanban.md`).

## 11. Tool policy and approvals

- Toolsets per profile: `hermes tools`, `GET/PUT /api/tools/toolsets/{name}`; `GET /v1/toolsets` shows the concrete tools each toolset expands to.
- MCP servers per profile: `/api/mcp/servers` CRUD, test, OAuth login (`hermes mcp login`, device-code flow supported), per-server control of which tools the server contributes (`features/mcp.md:501`). Elicitation (form mode) is routed through the approval surface.
- Dangerous-command approvals: `approvals.mode: smart|manual|off`, `timeout: 300` s, `cron_mode`, `single_query_mode`, `unattended_mode` (`security.md:30-60`). `off` equals `--yolo`.
- Tool-loop guardrails: unattended gateway and cron sessions enable hard stops by default (`docker.md`, "Tool-loop hard stops"). These are not global cross-agent spend/hop budgets.
- Shell `manual` mode is conditional, not every-action approval. Docker without host access may skip ordinary dangerous-command checks (`tools/approval.py::_should_skip_container_guards`); host mounts and user deny rules change behavior. Enabling an MCP send tool does not automatically add human approval.
- Enforcement: active tool grants are checked in the agent path (`agent/turn_tool_validation.py`, `turn_tool_round.py`). Saving MCP config is not an immediate revocation: `web_routers/mcp.py::set_mcp_server_enabled` documents next-session/gateway effect. Verify direct, delegated and alternative paths before promising a hard limit. There is no separate universal business-action approval proxy.

## 12. Sandboxing and egress

- Seven terminal backends: local, docker, ssh, singularity, modal, daytona, vercel (`configuration.md:204`).
- Docker backend: hardened (`--cap-drop ALL`, no privilege escalation, PID limits), one persistent container per identity, `container_persistent: false` for a fresh container per session, CPU and memory and disk limits, `docker_network: false` for `--network=none`, `docker_forward_env` for secrets, `docker_shared_container_key` to share a container between profiles on purpose (profiles are isolated otherwise) (`configuration.md:309-413`).
- The Docker backend isolates shell execution; host-side MCP, memory and plugins remain distinct trust boundaries. Required skill env forwarding must also be inspected before claiming credentials never enter the sandbox.
- Per-host egress allowlist: not a Hermes config key. The guide `docs/security/network-egress-isolation.md` shows the pattern: an `internal` Docker network without a default route plus an `egress` network with a squid or envoy proxy that allowlists hosts. `website/docs/user-guide/egress/iron-proxy.md` documents Hermes's own egress proxy option.

## 13. Providers and subscriptions (`website/docs/integrations/providers.md:130-175`)

| Plan | Works in Hermes? | What is billed |
|---|---|---|
| Anthropic Claude Max via OAuth (`hermes model` → Anthropic OAuth, or `hermes auth add anthropic --type oauth`) | Yes, **only on Max with purchased extra usage credits** | Only the extra/overage credits; the base Max allowance is never consumed |
| Anthropic Claude Pro | No | Use `ANTHROPIC_API_KEY` (pay per token) |
| OpenAI ChatGPT or Codex plan via device-code OAuth | Yes | Plan-quota semantics not documented |
| xAI SuperGrok or X Premium+ OAuth | Yes | Subscription quota; some tiers return 403 |
| Google Gemini consumer plan | No | `GEMINI_API_KEY` or Vertex AI billing only |
| Nous Portal | Yes, one subscription for 300+ models plus tool gateway | Portal subscription |

Also: `website/docs/user-guide/features/codex-app-server-runtime.md` lets `openai/*` turns run inside the Codex CLI app-server (opt-in) against a ChatGPT subscription. `website/docs/user-guide/features/subscription-proxy.md` proxies raw model inference (no agent) for Nous and xAI.

## 14. Files, images, artifacts

- Attach to a session: `image.attach` (RPC, server path only), `image.attach_bytes` (base64), `file.attach`, JSON `POST /api/chat/image-upload` and JSON `POST /api/files/upload`. Phone URIs are not gateway paths.
- Managed upload is `{path,data_url,overwrite}` and follows request policy; it is not automatically scoped to a Docker session workspace. `/api/files/upload-stream` is the separate multipart route. Test host/sandbox path transfer.
- Read and download workspace files: `GET /api/files`, `/api/files/read`, `/api/files/download`, `/api/fs/list`, `/api/fs/read-text`, `/api/fs/download`.
- Desktop shows an Artifacts gallery (images, files, links) indexed from session outputs; downloads go through the owning gateway (`desktop.md`, Artifacts).
- API server: `POST /v1/artifacts/upload` with a per-principal byte cap and rate limit (30 per 60 s) (`api_server.py:2541-2618`).

## 15. Notifications and push

- No built-in mobile push service. Delivery targets are messaging platforms. The ntfy platform plugin (`plugins/platforms/ntfy`, `messaging/ntfy.md`) publishes to an ntfy topic that a phone subscribes to with the ntfy app; works with `ntfy.sh` or a self-hosted server; cron jobs can deliver to `NTFY_HOME_CHANNEL`. The topic name is the identity, so use access control or a long unguessable topic.
- Connected clients receive `notification.show` and `approval.pending` events over the WebSocket. That does not establish push while no client is connected.
- At the pin, `plugins/platforms/ntfy/adapter.py::send` publishes auth/Markdown headers and content, not chat `Click` metadata. An attention event bridge and deep-link forwarding are custom work.
- Self-hosted instant iOS delivery requires upstream wake-up configuration and device access to the private ntfy server. See [ntfy configuration](https://docs.ntfy.sh/config/#ios-instant-notifications), checked during the review; this external service constraint is independent of the Hermes pin.
- New platform adapters are plugins under `plugins/platforms/<name>/` with `adapter.py` and `plugin.yaml` (`gateway/platforms/ADDING_A_PLATFORM.md`).

## 16. Deployment (`website/docs/user-guide/docker.md`, `docker-compose.yml`)

- Official image `nousresearch/hermes-agent`; data in `~/.hermes` mounted at `/opt/data`; the image is stateless.
- `gateway run` is supervised by s6-overlay and restarts on crash; `HERMES_DASHBOARD=1` runs the dashboard in the same container on 9119; API server on 8642 when enabled.
- The repository compose file runs `gateway` and `dashboard` services with `network_mode: host`, dashboard bound to `127.0.0.1` (use an SSH tunnel, VPN, or a reverse proxy with auth for remote access). `dashboard.public_url` and `dashboard.trusted_proxies` for reverse proxies.
- Alternative hosting: Hermes Cloud (managed instances, discovered from the desktop with a portal login).
- Per-profile gateways: `<profile> gateway install` creates a systemd user service or launchd agent.
- When controllers use the host Docker socket, bind source paths are resolved on that host. `/srv/hermes:/opt/data` alone does not align nested sandbox mounts. Both serve and gateway need a working Docker client/daemon path if both execute Docker tools.

## 17. Hermes Desktop as the reference client

- Electron shell plus a React 19 renderer in `apps/desktop/src` (`api/`, `app/`, `components/`, `hooks/`, `store/`, `sdk/`, `plugins/`); dependencies include `@hermes/shared`, TanStack Query and Virtual, react-router (`apps/desktop/package.json`).
- The desktop connects to many gateways (local, remote `hermes serve`, SSH, Hermes Cloud); each `(connection, profile)` pair gets its own socket; approvals route to the session's owning backend; tokens are stored as owner-only files, optionally encrypted with the OS keychain (`multi-connection-desktop.md`).
- Bot Mode, Routines pane, group rooms, artifacts, live subagents, git review are all renderer features over the same RPCs. The renderer is the best source for how to call each RPC.

## 18. Multi-user

- The dashboard auth gate authenticates one operator identity per gateway. Profiles isolate agents, not people. There are no roles. Hermes Cloud has organizations. Separate gateways are the initial boundary for several people. Cross-person room sharing, relay liveness, credential routing and authorization are additional requirements, not guaranteed by running more instances.


## 19. Mobile theme reuse

`apps/desktop/src/themes/presets.ts` defines `DEFAULT_SKIN_NAME = 'nous'`, with Nous blue `#0053fd` in light and `#4a84fe` in dark. `types.ts` defines semantic colors; `skin.ts` and `color.ts` convert custom `HermesSkin` payloads. `backend-sync.ts` preserves built-in palettes, resolves `default` to Nous, and seeds discovery without overwriting a local preference on reconnect. These are pure-data/conversion reuse candidates; desktop DOM/storage wiring is not native code.

`gateway.ready.skin` and `skin.changed` carry resolved skins. Despite broader source comments suggesting otherwise, the pinned `config.get {key:"skin"}` handler returns `{value:<name>}`, not the full palette. The mobile contract uses the ready/change payloads. Full design: [10-mobile-design.md](../10-mobile-design.md).

## 20. Review corrections and implementation limits

- `session.events.since` uses `last_seen`, not `seq` (`methods_session.py`).
- `prompt.submit` does not establish durable deduplication from a supplied `request_id`; its supported model-note surfaces at this pin are `hud` and `voice-live`, not `mobile` (`methods_prompt.py`).
- `profiles.create` defaults to credential mirroring; Ergates must opt out and explicitly provision narrow credentials. `profiles.configure` reports partial application (`methods_profiles.py`).
- MCP updates include whole-map `PUT /api/mcp/servers`, not a generic individual-server PUT. Cron update body is `{updates:{...}}` (`web_models.py`, corresponding routers).
- Typed agent proposals, confirmed provisioning receipts, idempotent reminder creation and closed-app attention routing are specified as new work in [11](../11-implementation-readiness.md), not facts about stock Hermes.
- These findings came from source inspection. Native auth, deployment, permissions, file transfer and locked-phone delivery have not been run in this documentation task.
- Mobile editing parity was checked against `edit-profile-dialog.tsx`, `profile-config.tsx`, `labels.ts` and `data.ts`. `profiles.configure` supports staged sections, but the current desktop capability view also has immediate side effects; mobile Save/Cancel must avoid that mismatch. An empty enabled-toolset list restores defaults, not deny-all. Metadata revision checks do not make the entire editor atomic.
