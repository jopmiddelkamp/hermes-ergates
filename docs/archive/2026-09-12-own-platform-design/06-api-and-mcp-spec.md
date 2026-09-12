# 06 - API and Platform MCP Specification

| Field | Value |
|---|---|
| Version | 0.1 draft |
| Date | 2026-09-12 |

## 1. Core REST API (JSON, `/api/v1`)

Auth: cookie session (web) or bearer JWT (internal services). All list endpoints support `?cursor=&limit=`.

### Threads and messages
| Method | Path | Purpose |
|---|---|---|
| GET | /threads | Sidebar list (primary, group), with last message and unread |
| POST | /threads | Create group thread `{title?, agent_ids[]}` |
| GET | /threads/{id}/messages | Messages with cards and attachments |
| POST | /threads/{id}/messages | Send `{text, reply_to?, file_ids[]}`; enqueues turns |
| POST | /threads/{id}/read | Mark read |
| GET | /threads/{id}/exchange | For kind=exchange: read-only transcript |
| GET | /search?q= | Messages and threads |

### Agents
| Method | Path | Purpose |
|---|---|---|
| GET | /agents | List |
| POST | /agents | Create `{name, title?, description?, instructions?, template_id?, skill_file_id?}` |
| GET | /agents/{id} | Details incl. routines, memories, connectors, usage |
| PATCH | /agents/{id} | Update name, title, description, instructions, model, effort, notifications, status |
| POST | /agents/{id}/avatar | Upload avatar |
| DELETE | /agents/{id} | Archive (soft delete) |
| GET | /agents/{id}/files?path= | Browse workspace |
| GET | /agents/{id}/files/download?path= | Download a workspace file |
| POST | /agents/{id}/export | Create template archive (review first) |
| POST | /agents/import | From archive or template id |
| POST | /agents/{id}/pause, /resume | |

### Harnesses
| Method | Path | Purpose |
|---|---|---|
| GET | /harnesses | Detected harnesses with version, auth kind, account label, known models |
| POST | /harnesses/rescan | Run the detector now |
| PATCH | /harnesses/{key} | Set default, or override model list |
| PATCH | /agents/{id} | also accepts `harness`, `model`, `harness_settings` (validated against the harness capability descriptor) |

### Memories
GET/POST/PATCH/DELETE `/agents/{id}/memories`

### Routines
| Method | Path | Purpose |
|---|---|---|
| GET/POST | /agents/{id}/routines | |
| GET/PATCH/DELETE | /routines/{id} | |
| POST | /routines/{id}/test-run | |
| GET | /routines/{id}/runs | History |
| POST | /hooks/routines/{id}/{secret} | Webhook trigger |

### Jobs
GET `/jobs?status=&agent_id=`, PATCH `/jobs/{id}` (user can change status or add a note)

### Cards and approvals
| Method | Path | Purpose |
|---|---|---|
| POST | /cards/{id}/answer | `{option_ids[], free_text?}` |
| POST | /cards/{id}/dismiss | |
| POST | /approvals/{id}/decide | `{decision: allow|deny, remember_rule?: bool}` |

### Connectors
| Method | Path | Purpose |
|---|---|---|
| GET | /catalog/connectors | Catalog with installed state |
| POST | /connectors | Install from catalog or by URL `{key?|url, transport, auth_type}` |
| GET | /connectors/{id} | Accounts, tools, status |
| POST | /connectors/{id}/accounts | Start OAuth (returns redirect URL) or save token |
| GET | /oauth/callback/{connector} | OAuth redirect target |
| PATCH | /connectors/{id}/tools/{tool} | `{enabled, requires_approval}` |
| DELETE | /connectors/{id} | Uninstall |
| PATCH | /agents/{id}/connectors | Assign connectors and overrides |

### Templates and skills
GET `/catalog/templates`, GET `/templates/{id}`, POST `/templates` (publish an exported archive to the internal catalog), GET/POST `/skills`

### Settings, usage, devices
GET/PATCH `/settings`, GET/POST/DELETE `/approval-rules`, GET `/usage?from=&to=&agent_id=`, POST `/devices/push` (subscribe), POST `/devices/telegram/pair`

### Files
POST `/files` (multipart, returns file id), GET `/files/{id}` (signed URL or stream)

## 2. WebSocket (`/ws`)

Server -> client events (JSON, one per line): `message.created`, `message.delta` (streaming text for a turn), `card.*`, `turn.status` (typing indicator, tool name), `thread.updated`, `agent.updated`, `routine.*`, `job.*`, `usage.updated`, `notification`.

Client -> server: `subscribe {thread_ids[]}`, `resume {since_event_id}`, `typing`, `read {thread_id, message_id}`, `ping`.

Catch-up: after `resume`, the server replays events with id greater than `since_event_id` from the event table, then continues live. Each event carries its id; clients persist the last id.

## 3. Platform MCP server (tools available to every agent)

Transport: stdio inside the sandbox. Each tool call carries the per-turn token so the server knows the agent, thread, and turn. Tool names below appear to the model as `mcp__platform__<name>`.

| Tool | Input | Output | Behavior and rules |
|---|---|---|---|
| `send_message_to_user` | `{text, reply_to_message_id?, attachments?: [{path}]}` | message id | Posts to the current thread. Normal replies do not need this; it is used from routine turns and for extra messages. |
| `ask_user` | `{question, subtitle?, options: [{label, description?}], multi?: bool, allow_free_text?: bool, wait?: bool, timeout_s?}` | `{answer: {option_indexes[], free_text?}, state}` | Renders a choice card. With `wait:true` the turn blocks (up to timeout) for the answer; otherwise returns `state: open` and the answer arrives as the next user message. |
| `request_approval` | (called by Claude Code as the permission prompt tool) `{tool_name, input}` | `{behavior: allow|deny, message?}` | Creates an approval card, pushes a notification, waits up to 30 min. Approval rules may auto-decide. |
| `remember` | `{text, kind: fact|preference|rule|profile, personal?: bool}` | memory id | Adds a memory entry; the chat shows no row (silent) unless the agent says so. |
| `recall` | `{query?, kind?, limit?}` | memories[] | Search memories beyond the injected set (full text + vector). |
| `open_loop` | `{text, waiting_on: string, job_id?}` | loop id | Records unfinished work and what it waits on; shows as Blocked/Waiting on the board |
| `close_loop` | `{loop_id, outcome}` | ok | |
| `search_history` | `{query, kind: messages|files, since?, limit?}` | hits[] with message ids, file ids, snippets | Finds anything the agent ever received; files can then be fetched into the workspace with `fetch_file` |
| `fetch_file` | `{file_id}` | workspace path | Copies a stored file into `/agent/workspace/inbox/fetched/` |
| `create_job` | `{title, goal, status?, next_step?}` | job id | Title format enforced: "[<AgentName>] ..." |
| `update_job` | `{job_id, status?, next_step?, waiting_on?, note?}` | ok | Emits a job event row when status changes |
| `list_jobs` | `{agent_id?, status?}` | jobs[] | |
| `create_routine` | `{name, instruction, trigger: {type: once, at} \| {type: cron, expr, tz?} \| {type: webhook}, one_shot?: bool, context?: {file_paths[]}, idempotency_key}` | routine id | Emits "Created routine" row; idempotent |
| `update_routine` | `{routine_id, name?, instruction?, trigger?, active?}` | ok | Emits "Updated routine" |
| `delete_routine` | `{routine_id}` | ok | Emits "Deleted routine" |
| `list_routines` | `{}` | routines[] | |
| `share_file` | `{path, caption?}` | file id | Copies from workspace to object storage; posts a file card |
| `set_profile` | `{name?, title?, description?, avatar_path?}` | ok | Self-management; emits "Renamed to X" when the name changes |
| `list_agents` | `{}` | agents[] (id, name, title, status) | |
| `create_agent` | `{name, title, description, instructions, skills?: [{path}], connectors?: [connector_key], model?, effort?, briefing}` | agent id | Requires capability `manage_agents`; creates record, sandbox, installs skills, stores briefing as first exchange message, enqueues the child's first turn; emits "Messaged <child>" |
| `update_agent` | `{agent_id, name?, title?, description?, instructions_append?}` | ok | Requires `manage_agents`; cannot widen tool access |
| `send_message_to_agent` | `{agent_id, text, kind: brief|task|report|ping|info, attachments?}` | message id | Hop and rate caps; emits event rows in both primary threads |
| `broadcast_to_agents` | `{agent_ids[], text}` | ok | Emits "Messaged N agents" |
| `get_my_connectors` | `{}` | connectors[] with tools and enabled/auth state | Lets the agent explain what it can and cannot do |
| `request_connector` | `{connector_key?, url?, reason}` | request id | Posts a connect card for the user; never installs by itself |
| `report_status` | `{text}` | ok | Posts a small status row (interim status) |

Rules implemented in the server, not left to the model:
1. `create_agent` without `briefing` is rejected.
2. `send_message_to_agent` beyond the hop cap returns an error that tells the agent to ask the user.
3. `create_routine` duplicates return the existing id.
4. `share_file` refuses paths outside `/agent/workspace`.
5. All tools log an audit entry.

## 4. MCP gateway

- Exposes each connector to sandboxes as an HTTP MCP endpoint `http://mcp-gateway/c/<connector_key>` with a per-turn bearer token.
- `tools/list`: returns only tools enabled for (agent, connector); adds `_meta.anthropic/requiresUserInteraction: true` for "ask" tools so Claude Code prompts (which routes to `request_approval`).
- `tools/call`: verifies policy again, injects the connector credential (OAuth bearer, API token) into the upstream call, records `tool_call`, returns the upstream result; on deny returns an MCP error `{code: -32001, message: "Tool disabled by policy"}`.
- Upstream transports: stdio (spawns the connector process in its own container, one per connector, long-lived) or remote HTTP/SSE.
- Output cap: 25k tokens default (Claude Code `MAX_MCP_OUTPUT_TOKENS`), larger results are saved to the agent workspace and the path is returned.

## 5. Generated per-turn files

`/agent/mcp/turn.json` (example for an agent with the platform server and two connectors):
```json
{
  "mcpServers": {
    "platform": { "command": "node", "args": ["/opt/platform-mcp/index.js"], "env": { "PLATFORM_TOKEN": "<per-turn token>" } },
    "gw_outlook": { "type": "http", "url": "http://mcp-gateway/c/outlook", "headers": { "Authorization": "Bearer <per-turn token>" } },
    "gw_clickup": { "type": "http", "url": "http://mcp-gateway/c/clickup", "headers": { "Authorization": "Bearer <per-turn token>" } }
  }
}
```

`/agent/prompt/turn.md` (structure):
```
# Identity
You are <Name>, <Title>. <Description>
# Standing rules (from 02-functional-design.md section 4)
...
# Memories (most recent 50)
- [preference] ...
# Thread context
Thread: <primary|group|exchange>, participants: ...
Inbox files for this turn: /agent/workspace/inbox/<id>/...
# Protocol reminders
Use mcp__platform__ask_user for questions with options. Use create_job/update_job for every piece of work. ...
```

## 6. Stream-json handling in the runner

| Event from `claude` | Runner action |
|---|---|
| `system/init` | Record session id, tools, mcp_servers status; fail the turn if a required server is missing |
| `assistant` with text deltas (with `--include-partial-messages`) | Forward `message.delta` to the thread |
| `assistant` `tool_use` | Emit `turn.status {tool}`; store tool_call |
| `user` `tool_result` | Store result status |
| `system/api_retry` | Emit status "Waiting for capacity" if `rate_limit` |
| `permission_denied` | Store; the agent already got a message |
| `result` | Persist usage and session id; mark turn succeeded or failed by `is_error` |
