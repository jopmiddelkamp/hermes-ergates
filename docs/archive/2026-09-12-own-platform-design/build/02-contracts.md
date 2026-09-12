# 02 - Contracts

Exact names and shapes. Code in `packages/shared` must match this file; when you change one, change both in the same commit.

## 1. Identifiers and time
- All entity ids: UUID v7 strings. Event ids: 64-bit integers as JSON numbers (safe below 2^53).
- All timestamps in JSON: ISO 8601 UTC strings, for example `"2026-09-12T08:15:30.123Z"`.

## 2. Harness types (`packages/shared/src/harness.ts`)

```ts
export type HarnessKey = 'claude_code' | 'codex' | 'gemini' | 'grok_build' | 'api_loop';

export interface HarnessCapabilities {
  streaming: boolean;
  resume: boolean;
  mcpStdio: boolean;
  mcpHttp: boolean;
  perToolPolicyInConfig: boolean;
  permissionHook: boolean;
  structuredOutput: boolean;
  inlineImages: boolean;
  settings: Array<'effort' | 'reasoning' | 'approvalMode' | 'sandboxLevel' | 'maxTurns'>;
  auth: Array<'subscription' | 'api_key'>;
}

export interface HarnessStatus {
  harness: HarnessKey;
  installed: boolean;
  version: string | null;
  authKind: 'none' | 'subscription' | 'api_key';
  accountLabel: string | null;
  lastCheckedAt: string;
  lastError: string | null;
  isDefault: boolean;
}

export interface TurnInput {
  turnId: string;
  agentId: string;
  threadId: string;
  chainId: string;
  harness: HarnessKey;
  model: string;
  harnessSettings: Record<string, string | number | boolean>;
  harnessSessionId: string | null;          // null -> new session (with context replay if thread has history)
  systemPrompt: string;                      // full text of turn.md (see 03-templates.md section 4)
  contextReplay: string | null;              // filled when harnessSessionId is null and history exists
  messages: InboundMessage[];                // what triggers this turn
  mcpServers: McpServerConfig[];
  allowedTools: string[];                    // harness-neutral names: "server:tool" or builtin names
  deniedTools: string[];
  workspaceDir: string;                      // absolute path, cwd for the harness
  configDir: string;                         // absolute path for the harness's isolated config/home
  timeoutMs: number;                         // 1_200_000
  maxTurns: number;                          // 40
}

export interface InboundMessage {
  id: string;
  role: 'user' | 'agent' | 'routine' | 'system';
  senderName: string;                        // "Jop", "Linh", "routine:Morning check", "platform"
  text: string;
  filePaths: string[];                       // absolute paths inside workspaceDir
  imagePaths: string[];                      // subset of filePaths that are images
  createdAt: string;
}

export type McpServerConfig =
  | { name: string; transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { name: string; transport: 'http'; url: string; headers: Record<string, string> };

export type TurnEvent =
  | { type: 'init'; harnessSessionId: string; model: string; tools: string[]; mcpServers: Array<{ name: string; status: 'connected' | 'failed' | 'pending' }> }
  | { type: 'text_delta'; text: string }
  | { type: 'text_final'; text: string }                      // complete assistant message text
  | { type: 'tool_call'; callId: string; tool: string; input: unknown }
  | { type: 'tool_result'; callId: string; ok: boolean; summary: string }
  | { type: 'status'; text: string }                           // "Waiting for capacity", "Retrying"
  | { type: 'result'; ok: boolean; harnessSessionId: string; usage: Usage; stopReason: string; error: string | null }
  | { type: 'error'; code: string; message: string };

export interface Usage {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  costEstimateUsd: number | null; estimated: boolean;         // estimated=true when derived from chars/4
}

export interface PreparedTurn {
  command: string; args: string[]; env: Record<string, string>; cwd: string;
  stdin: string | null;                                        // for harnesses that take the prompt on stdin
  filesWritten: string[];
}

export interface HarnessAdapter {
  readonly key: HarnessKey;
  readonly capabilities: HarnessCapabilities;
  detect(): Promise<Omit<HarnessStatus, 'isDefault'>>;
  prepare(input: TurnInput): Promise<PreparedTurn>;            // writes per-turn files under input.configDir
  parse(line: string): TurnEvent | null;                       // one stdout line -> zero or one event
  toolName(server: string, tool: string): string;              // harness naming, e.g. mcp__gw_outlook__list
}
```

## 3. Event envelope (`packages/shared/src/events.ts`)

```ts
export interface EventEnvelope<T extends EventType = EventType> {
  id: number; at: string; type: T; userId: string;
  threadId: string | null; agentId: string | null; payload: EventPayload[T];
}
export type EventType = keyof EventPayload;
export interface EventPayload {
  'message.created': { message: MessageDto };
  'message.delta': { threadId: string; turnId: string; messageId: string; text: string };
  'card.created': { card: CardDto };
  'card.updated': { card: CardDto };
  'agent.created': { agent: AgentDto };
  'agent.updated': { agent: AgentDto };
  'agent.archived': { agentId: string };
  'thread.updated': { thread: ThreadDto };
  'turn.status': { threadId: string; agentId: string; turnId: string; state: 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed'; text: string | null };
  'routine.created': { routine: RoutineDto };
  'routine.updated': { routine: RoutineDto };
  'routine.deleted': { routineId: string; agentId: string; name: string };
  'routine.fired': { routineId: string; runId: string };
  'job.created': { job: JobDto };
  'job.updated': { job: JobDto };
  'exchange.message': { exchangeId: string; message: MessageDto };
  'connector.updated': { connector: ConnectorDto };
  'harness.updated': { status: HarnessStatus };
  'usage.updated': { agentId: string; day: string; inputTokens: number; outputTokens: number };
  'notification': { title: string; body: string; url: string };
}
```

## 4. DTOs (`packages/shared/src/dto.ts`, all zod schemas with inferred types)

```ts
export const MessageDto = z.object({
  id: z.string(), threadId: z.string(),
  senderType: z.enum(['user', 'agent', 'system']), senderId: z.string().nullable(), senderName: z.string(),
  kind: z.enum(['text', 'event', 'card', 'file', 'image_gallery', 'link_preview', 'status']),
  bodyMd: z.string(),
  event: z.object({ type: z.string(), title: z.string(), refId: z.string().nullable() }).nullable(),
  replyToMessageId: z.string().nullable(), turnId: z.string().nullable(),
  attachments: z.array(z.object({ fileId: z.string(), name: z.string(), mime: z.string(), sizeBytes: z.number(), role: z.enum(['upload', 'output', 'avatar', 'evidence']) })),
  createdAt: z.string(),
});
export const AgentDto = z.object({
  id: z.string(), name: z.string(), title: z.string(), description: z.string(), avatarFileId: z.string().nullable(),
  harness: z.enum(['claude_code', 'codex', 'gemini', 'grok_build', 'api_loop']), model: z.string(),
  harnessSettings: z.record(z.union([z.string(), z.number(), z.boolean()])),
  capabilities: z.object({ manageAgents: z.boolean() }), parentAgentId: z.string().nullable(),
  status: z.enum(['active', 'paused', 'archived']), primaryThreadId: z.string(), notificationsEnabled: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(),
});
export const ThreadDto = z.object({
  id: z.string(), kind: z.enum(['primary', 'group', 'exchange']), title: z.string(),
  participants: z.array(z.object({ type: z.enum(['user', 'agent']), id: z.string(), name: z.string(), avatarFileId: z.string().nullable() })),
  leadAgentId: z.string().nullable(), lastMessageAt: z.string().nullable(), lastMessagePreview: z.string(), unreadCount: z.number(),
});
export const CardDto = z.object({
  id: z.string(), messageId: z.string(), threadId: z.string(),
  kind: z.enum(['choice', 'approval', 'connect', 'template_review']),
  spec: z.record(z.unknown()), state: z.enum(['open', 'answered', 'dismissed', 'expired', 'allowed', 'denied']),
  answer: z.record(z.unknown()).nullable(), expiresAt: z.string().nullable(),
});
export const RoutineDto = z.object({
  id: z.string(), agentId: z.string(), name: z.string(), instruction: z.string(), active: z.boolean(),
  trigger: z.discriminatedUnion('type', [
    z.object({ type: z.literal('once'), at: z.string() }),
    z.object({ type: z.literal('cron'), expr: z.string(), tz: z.string() }),
    z.object({ type: z.literal('webhook') }),
  ]),
  oneShot: z.boolean(), nextRunAt: z.string().nullable(), createdAt: z.string(),
});
export const JobDto = z.object({
  id: z.string(), agentId: z.string(), title: z.string(), goal: z.string(),
  status: z.enum(['queued', 'in_progress', 'waiting_on_user', 'blocked', 'done']),
  nextStep: z.string(), waitingOn: z.string().nullable(), updatedAt: z.string(),
});
export const ConnectorDto = z.object({
  id: z.string(), key: z.string(), name: z.string(), description: z.string(), transport: z.enum(['stdio', 'http']),
  authType: z.enum(['none', 'bearer', 'oauth2']), status: z.enum(['installed', 'error']),
  accounts: z.array(z.object({ id: z.string(), label: z.string(), status: z.enum(['connected', 'expired', 'revoked']) })),
  tools: z.array(z.object({ name: z.string(), description: z.string(), category: z.enum(['read', 'write', 'draft', 'send', 'delete', 'pay', 'other']), enabled: z.boolean(), requiresApproval: z.boolean() })),
});
```

## 5. REST conventions
- Base path `/api/v1`. JSON only. Cookie session for the web app.
- List responses: `{ items: T[], nextCursor: string | null }`; query `?cursor=&limit=` (limit 1-100, default 50).
- Success: 200 with the DTO; create: 201; delete: 204.
- Error body: `{ error: { code: ErrorCode, message: string, details?: unknown } }`.

## 6. WebSocket protocol (`/ws`)
Client to server (zod `ClientWsMessage`):
```ts
z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), threadIds: z.array(z.string()).max(100) }),
  z.object({ type: z.literal('resume'), sinceEventId: z.number().int().nonnegative() }),
  z.object({ type: z.literal('read'), threadId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal('typing'), threadId: z.string() }),
  z.object({ type: z.literal('ping') }),
])
```
Server to client: `{ type: 'event', event: EventEnvelope }`, `{ type: 'resumed', lastEventId: number, fullRefetch: boolean }`, `{ type: 'pong' }`, `{ type: 'error', code: ErrorCode }`.
Rules: the server sends every event whose `userId` matches the session user and whose `threadId` is null or subscribed. `agent.*`, `harness.*`, `routine.*`, `job.*`, `connector.*` have `threadId: null` and always go out.

## 7. Platform MCP tools (input and output schemas)

Tool names as seen by the harness: `<prefix>platform<sep><name>` (adapter decides prefix and separator). Every tool returns MCP `content: [{ type: 'text', text: JSON.stringify(output) }]` and `isError: true` with `{ code, message }` on failure.

| Tool | Input (zod) | Output |
|---|---|---|
| `ask_user` | `{ question: z.string().max(500), subtitle: z.string().max(300).optional(), options: z.array(z.object({ label: z.string().max(120), description: z.string().max(300).optional() })).min(0).max(8), multi: z.boolean().default(false), allowFreeText: z.boolean().default(true), wait: z.boolean().default(true), timeoutSeconds: z.number().int().min(10).max(1800).default(600) }` | `{ cardId, state: 'answered'|'open'|'dismissed'|'expired', answer: { optionIndexes: number[], freeText: string|null } | null }` |
| `request_approval` | `{ tool_name: z.string(), input: z.unknown() }` (Claude Code permission prompt tool shape) | `{ behavior: 'allow'|'deny', message?: string, updatedInput?: unknown }` |
| `remember` | `{ text: z.string().max(1000), kind: z.enum(['fact','preference','rule','profile']), personal: z.boolean().default(true) }` | `{ memoryId }` |
| `recall` | `{ query: z.string().max(300).optional(), kind: z.enum([...]).optional(), limit: z.number().int().min(1).max(50).default(20) }` | `{ memories: Array<{ id, kind, text, createdAt }> }` |
| `open_loop` | `{ text: z.string().max(500), waitingOn: z.string().regex(/^(connector:[a-z0-9_-]+|tool:[a-z0-9_:.-]+|date:\d{4}-\d{2}-\d{2}|user_answer|person:.{1,60})$/), jobId: z.string().optional() }` | `{ loopId }` |
| `close_loop` | `{ loopId: z.string(), outcome: z.string().max(500) }` | `{ ok: true }` |
| `search_history` | `{ query: z.string().max(300), kind: z.enum(['messages','files']).default('messages'), since: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }` | `{ hits: Array<{ messageId?, fileId?, threadId, snippet, createdAt }> }` |
| `fetch_file` | `{ fileId: z.string() }` | `{ path }` (absolute path inside workspace inbox) |
| `share_file` | `{ path: z.string(), caption: z.string().max(300).optional() }` | `{ fileId, messageId }` |
| `report_status` | `{ text: z.string().max(200) }` | `{ ok: true }` |
| `send_message_to_user` | `{ text: z.string().max(20000), replyToMessageId: z.string().optional(), attachmentPaths: z.array(z.string()).max(10).default([]) }` | `{ messageId }` |
| `create_job` | `{ title: z.string().max(120), goal: z.string().max(1000), status: z.enum([...]).default('in_progress'), nextStep: z.string().max(300).default('') }` | `{ jobId }` |
| `update_job` | `{ jobId, status?, nextStep?, waitingOn?, note?: z.string().max(1000) }` | `{ ok: true }` |
| `list_jobs` | `{ agentId?: z.string(), status?: z.enum([...]) }` | `{ jobs: JobDto[] }` |
| `create_routine` | `{ name: z.string().max(80), instruction: z.string().max(4000), trigger: RoutineDto.shape.trigger, oneShot: z.boolean().default(true), contextFilePaths: z.array(z.string()).max(10).default([]) }` | `{ routineId, created: boolean }` (created=false when idempotent hit) |
| `update_routine` | `{ routineId, name?, instruction?, trigger?, active? }` | `{ ok: true }` |
| `delete_routine` | `{ routineId }` | `{ ok: true }` |
| `list_routines` | `{}` | `{ routines: RoutineDto[] }` |
| `set_profile` | `{ name?: z.string().min(1).max(40), title?: z.string().max(40), description?: z.string().max(300), avatarPath?: z.string() }` | `{ agent: AgentDto }` |
| `list_agents` | `{}` | `{ agents: Array<{ id, name, title, status }> }` |
| `create_agent` | `{ name, title: z.string().max(40), description: z.string().max(300), instructions: z.string().max(20000), skillPaths: z.array(z.string()).max(5).default([]), connectorKeys: z.array(z.string()).max(10).default([]), harness?: HarnessKey, model?: z.string(), briefing: z.string().min(40).max(4000) }` | `{ agentId, name }` |
| `update_agent` | `{ agentId, name?, title?, description?, instructionsAppend?: z.string().max(4000) }` | `{ ok: true }` |
| `send_message_to_agent` | `{ agentId, text: z.string().max(20000), kind: z.enum(['brief','task','report','ping','info']), attachmentPaths: z.array(z.string()).max(10).default([]) }` | `{ messageId }` |
| `broadcast_to_agents` | `{ agentIds: z.array(z.string()).min(2).max(20), text: z.string().max(20000) }` | `{ messageIds: string[] }` |
| `get_my_connectors` | `{}` | `{ connectors: Array<{ key, name, authenticated: boolean, tools: Array<{ name, enabled, requiresApproval }> }> }` |
| `request_connector` | `{ connectorKey?: z.string(), url?: z.string().url(), reason: z.string().max(300) }` | `{ cardId }` |

Server-enforced rules: `create_agent` requires capability `manageAgents` and a `briefing`; `send_message_to_agent` and `broadcast_to_agents` enforce hop and hourly caps; `create_routine` is idempotent (D-24); `share_file` and `fetch_file` reject paths outside `workspaceDir`; every call writes an `audit_log` row.

## 8. Gateway MCP contract
- Endpoint per connector: `POST /c/{connectorKey}` (Streamable HTTP MCP) with header `Authorization: Bearer <per-turn JWT>`.
- `tools/list` returns only enabled tools for (agent, connector); "ask" tools carry `_meta: { 'anthropic/requiresUserInteraction': true }`.
- `tools/call` decisions: `allow` -> proxy; `ask` -> hold up to 540 s (D-22) then `APPROVAL_PENDING`; `deny` -> error `TOOL_DISABLED`.
- Gateway error codes (MCP `isError` with JSON text): `TOOL_DISABLED`, `APPROVAL_PENDING`, `APPROVAL_DENIED`, `CONNECTOR_UNAUTHENTICATED`, `CONNECTOR_DOWN`, `OUTPUT_TOO_LARGE` (result saved to `workspace/outbox/gateway/<callId>.json`, path returned).

## 9. Error catalog (`packages/shared/src/errors.ts`)

| Code | HTTP | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no or invalid session |
| `FORBIDDEN` | 403 | not the owner |
| `NOT_FOUND` | 404 | |
| `VALIDATION` | 400 | zod failure; `details` = issues |
| `CONFLICT` | 409 | duplicate agent name, idempotent hit with different payload |
| `RATE_LIMITED` | 429 | login attempts, vendor rate limit surfaced |
| `TURN_TIMEOUT` | n/a | turn wall clock exceeded |
| `HARNESS_UNAVAILABLE` | 503 | selected harness not installed or not authenticated |
| `HOP_LIMIT` | n/a | agent-to-agent cap |
| `TOOL_DISABLED`, `APPROVAL_PENDING`, `APPROVAL_DENIED` | n/a | gateway |
| `INTERNAL` | 500 | anything else; logged with a correlation id |

## 10. SQL (Phase 0 migration `0001_init.sql`, Drizzle-generated equivalent must match)

```sql
CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TYPE harness_key AS ENUM ('claude_code','codex','gemini','grok_build','api_loop');
CREATE TYPE agent_status AS ENUM ('active','paused','archived');
CREATE TYPE thread_kind AS ENUM ('primary','group','exchange');
CREATE TYPE sender_type AS ENUM ('user','agent','system');
CREATE TYPE message_kind AS ENUM ('text','event','card','file','image_gallery','link_preview','status');
CREATE TYPE turn_status AS ENUM ('queued','running','waiting_approval','succeeded','failed','cancelled');
CREATE TYPE turn_kind AS ENUM ('user_message','agent_message','routine','system');

CREATE TABLE "user" (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL, password_hash text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Amsterdam', locale text NOT NULL DEFAULT 'en-US', avatar_file_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE file (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES "user"(id), storage_key text NOT NULL, name text NOT NULL, mime text NOT NULL,
  size_bytes bigint NOT NULL, sha256 text NOT NULL, derived_from_file_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE agent (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES "user"(id), name text NOT NULL, title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '', avatar_file_id uuid REFERENCES file(id), instructions_md text NOT NULL DEFAULT '',
  harness harness_key NOT NULL, model text NOT NULL, harness_settings jsonb NOT NULL DEFAULT '{}', capabilities jsonb NOT NULL DEFAULT '{"manageAgents":false}',
  parent_agent_id uuid REFERENCES agent(id), created_by text NOT NULL DEFAULT 'user', template_id uuid, status agent_status NOT NULL DEFAULT 'active',
  primary_thread_id uuid, notifications_enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, lower(name)));
CREATE TABLE thread (id uuid PRIMARY KEY, kind thread_kind NOT NULL, title text NOT NULL DEFAULT '', owner_user_id uuid NOT NULL REFERENCES "user"(id),
  lead_agent_id uuid REFERENCES agent(id), summary text NOT NULL DEFAULT '', summary_upto_message_id uuid, last_message_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE agent ADD CONSTRAINT agent_primary_thread_fk FOREIGN KEY (primary_thread_id) REFERENCES thread(id);
CREATE TABLE thread_participant (thread_id uuid NOT NULL REFERENCES thread(id), participant_type sender_type NOT NULL, participant_id uuid NOT NULL,
  harness harness_key, harness_session_id text, last_read_message_id uuid, PRIMARY KEY (thread_id, participant_type, participant_id));
CREATE TABLE turn (id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agent(id), thread_id uuid NOT NULL REFERENCES thread(id), chain_id uuid NOT NULL,
  kind turn_kind NOT NULL, trigger_message_id uuid, harness harness_key NOT NULL, model text NOT NULL, harness_session_id text,
  status turn_status NOT NULL DEFAULT 'queued', started_at timestamptz, finished_at timestamptz, usage jsonb, result_meta jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE message (id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES thread(id), sender_type sender_type NOT NULL, sender_id uuid, sender_name text NOT NULL,
  kind message_kind NOT NULL DEFAULT 'text', body_md text NOT NULL DEFAULT '', event jsonb, reply_to_message_id uuid REFERENCES message(id),
  turn_id uuid REFERENCES turn(id), created_at timestamptz NOT NULL DEFAULT now(),
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body_md)) STORED);
CREATE INDEX message_thread_created_idx ON message (thread_id, created_at); CREATE INDEX message_body_tsv_idx ON message USING gin (body_tsv);
CREATE TABLE attachment (id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES message(id), file_id uuid NOT NULL REFERENCES file(id), role text NOT NULL);
CREATE TABLE event (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), type text NOT NULL, user_id uuid NOT NULL,
  thread_id uuid, agent_id uuid, payload jsonb NOT NULL);
CREATE INDEX event_user_id_idx ON event (user_id, id);
CREATE TABLE harness_status (harness harness_key PRIMARY KEY, installed boolean NOT NULL, version text, auth_kind text NOT NULL DEFAULT 'none',
  account_label text, last_checked_at timestamptz NOT NULL DEFAULT now(), last_error text, is_default boolean NOT NULL DEFAULT false);
```

Phase 1 migration `0002_platform.sql` adds: `memory` (id, agent_id, kind text, text, waiting_on, status text default 'open', personal bool, source_message_id, created_by text, embedding vector(384), created_at, updated_at; `text_tsv` generated; ivfflat index on embedding), `card`, `routine`, `routine_run`, `job`, `job_note`, `tool_call`, `approval`, `approval_rule`, `connector`, `connector_account`, `connector_tool`, `agent_connector`, `exchange`, `device`, `audit_log`, `usage_daily`, `skill`, `skill_install`, `template` with the columns listed in `docs/05-data-model.md`.

## 11. Harness catalog (`packages/shared/harness-catalog.json`)

```json
{
  "claude_code": { "binary": "claude", "instructionsFile": "CLAUDE.md", "configEnv": "CLAUDE_CONFIG_DIR",
    "models": ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"], "defaultModel": "claude-opus-5", "cheapModel": "claude-haiku-4-5",
    "egressHosts": ["api.anthropic.com", "platform.claude.com", "console.anthropic.com"] },
  "codex": { "binary": "codex", "instructionsFile": "AGENTS.md", "configEnv": "CODEX_HOME",
    "models": ["gpt-5.6", "gpt-5.6-mini"], "defaultModel": "gpt-5.6", "cheapModel": "gpt-5.6-mini",
    "egressHosts": ["api.openai.com", "chatgpt.com", "auth.openai.com"] },
  "gemini": { "binary": "gemini", "instructionsFile": "GEMINI.md", "configEnv": "HOME",
    "models": ["auto", "gemini-2.5-pro", "gemini-2.5-flash"], "defaultModel": "auto", "cheapModel": "gemini-2.5-flash",
    "egressHosts": ["generativelanguage.googleapis.com", "oauth2.googleapis.com", "cloudcode-pa.googleapis.com", "accounts.google.com"] },
  "grok_build": { "binary": "grok", "instructionsFile": "AGENTS.md", "configEnv": "HOME",
    "models": ["grok-4.6"], "defaultModel": "grok-4.6", "cheapModel": "grok-4.6",
    "egressHosts": ["api.x.ai", "x.ai"] }
}
```
Model lists are data; update the JSON when vendors change models. Unknown names typed by the user are passed through unchanged.
