/**
 * Wire types for the Hermes gateway as recorded from the pinned backend
 * (commit d76856cc, v0.21.2) on 2026-09-13. See
 * docs/superpowers/research/2026-09-13-recorded-backend-shapes.md.
 *
 * This module imports nothing from React Native or Expo (ADR-029 rule 1).
 */

// ── discovery and auth ───────────────────────────────────────────────────

export interface BackendStatus {
  version: string
  auth_required: boolean
  auth_providers: string[]
  auth_flows: string[]
  install_id?: string
  release_date?: string
  [k: string]: unknown
}

export type AuthMode = 'token' | 'password'

export type Credentials =
  | { mode: 'token'; token: string }
  | { mode: 'password'; provider: string; username: string; password: string }

export interface AuthIdentity {
  user_id: string
  email?: string
  display_name?: string
  org_id?: string
  provider: string
  expires_at?: number
}

// ── profiles ─────────────────────────────────────────────────────────────

/** Desktop Bot Mode namespace inside `ui_meta`. Unknown keys must round-trip. */
export interface HermesBotsMeta {
  title?: string
  shape?: string
  color?: string
  imageKind?: string
  custom?: boolean
  hidden?: boolean
  pinned?: boolean
  sectionId?: string
  [k: string]: unknown
}

/** Ergates namespace inside `ui_meta` (docs/05, docs/10). */
export interface ErgatesMeta {
  role?: string
  [k: string]: unknown
}

export interface UiMeta {
  'hermes-bots'?: HermesBotsMeta
  ergates?: ErgatesMeta
  [ns: string]: unknown
}

export interface CanonicalSession {
  id: string
  resolved_id?: string
  root_title?: string
  title: string
  preview?: string
  started_at?: number
  last_active?: number
  message_count?: number
}

export interface ProfileSummary {
  name: string
  path?: string
  is_default: boolean
  model?: string
  provider?: string
  description?: string
  display_name?: string
  skill_count?: number
  last_session?: unknown
  worker_session?: unknown
  canonical_session?: CanonicalSession | null
  ui_meta?: UiMeta
  ui_meta_revisions?: Record<string, number>
  has_avatar?: boolean
}

export interface ProfilesListResult {
  profiles: ProfileSummary[]
  bot_mode_protocol?: boolean
}

export interface DescribeSkill {
  name: string
  enabled: boolean
}

export interface DescribeToolset {
  name: string
  label: string
  description: string
  tool_count: number
  enabled: boolean
}

export interface DescribeMcpServer {
  name: string
  enabled?: boolean
  [k: string]: unknown
}

export interface ProfileDescribe {
  name: string
  description: string
  soul: string
  model: { provider: string; default: string }
  skills: DescribeSkill[]
  toolsets: DescribeToolset[]
  toolsets_pinned: boolean
  mcp_servers: DescribeMcpServer[]
  [k: string]: unknown
}

export interface ConfigureParams {
  name: string
  ui_meta?: UiMeta
  ui_meta_expected_revisions?: Record<string, number>
  soul?: string
  description?: string
  model?: string
  provider?: string
  disabled_skills?: string[]
  enabled_toolsets?: string[]
  enabled_mcp_servers?: string[]
  confirm_expensive_model?: boolean
}

export interface ConfigureResult {
  ok: boolean
  applied?: Record<string, unknown>
  confirm_required?: boolean
  error?: string
  conflicts?: unknown
  ui_meta_revisions?: Record<string, number>
  [k: string]: unknown
}

export interface CreateProfileParams {
  name: string
  description?: string
  soul?: string
  model?: string
  provider?: string
  /** Ergates always provisions fresh profiles without launch credentials. */
  mirror_credentials: false
  share_auth?: boolean
  no_alias?: boolean
}

export interface AssetResult {
  found: boolean
  /** Data URL (`data:image/png;base64,...`) when found. */
  data?: string
  mime?: string
  size?: number
}

export interface ModelCapability {
  fast?: boolean
  reasoning?: boolean
}

export interface ModelProvider {
  slug: string
  name: string
  is_current: boolean
  is_user_defined?: boolean
  authenticated: boolean
  models: string[]
  total_models?: number
  source?: string
  auth_type?: string
  warning?: string
  capabilities?: Record<string, ModelCapability>
  featured_models?: string[]
}

export interface ModelOptions {
  providers: ModelProvider[]
  [k: string]: unknown
}

// ── sessions ─────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string
  resolved_id?: string
  title: string
  preview: string
  started_at: number
  message_count: number
  source: string
}

export interface SessionInfoPayload {
  model?: string
  provider?: string
  reasoning_effort?: string
  service_tier?: string
  fast?: boolean
  yolo?: boolean
  approval_mode?: string
  tools?: Record<string, string[]>
  skills?: Record<string, string[]>
  cwd?: string
  branch?: string
  lazy?: boolean
  profile_name?: string
  [k: string]: unknown
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool'
  text?: string
  timestamp?: number
  row_id?: number
  display_kind?: string
  display_metadata?: unknown
  /** tool rows */
  name?: string
  context?: string
  args?: Record<string, unknown>
  /** assistant detail sidecars */
  reasoning?: string
  reasoning_content?: string
  [k: string]: unknown
}

export interface HistoryResult {
  count: number
  messages: HistoryMessage[]
}

// ── transcript (REST) ────────────────────────────────────────────────────

export interface TranscriptToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface TranscriptRow {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  /** display_content ?? content, as text. */
  text: string
  content: string
  toolCalls?: TranscriptToolCall[]
  toolCallId?: string
  toolName?: string
  /** Tool-row content JSON-decoded when it parses, else the raw string. */
  result?: unknown
  /** Unix seconds. */
  at?: number
  displayKind?: string
  displayMetadata?: unknown
}

export interface TranscriptPage {
  sessionId: string
  rows: TranscriptRow[]
  page: { limit: number; offset: number; returned: number }
}

/** The wire response of GET /api/sessions/{id}/messages (hermes_cli/web_routers/sessions.py:553-565). */
export interface TranscriptRawPage {
  session_id: string
  profile?: string
  messages: unknown[]
  pagination: { limit: number; offset: number; order: string; returned: number }
}

export interface TranscriptQuery {
  profile: string
  limit: number
  offset?: number
  order: 'latest' | 'oldest'
  includeCompacted?: boolean
}

export interface SessionCreateResult {
  session_id: string
  stored_session_id: string
  message_count: number
  messages: HistoryMessage[]
  info: SessionInfoPayload
}

export interface SessionResumeResult {
  session_id: string
  resumed: string
  session_key: string
  message_count: number
  messages: HistoryMessage[]
  messages_omitted?: boolean
  hydrating?: boolean
  info: SessionInfoPayload
  inflight?: InflightSnapshot | null
  running: boolean
  status: string
  started_at?: number
  pending_approval?: ApprovalRequestPayload
  pending_clarify?: ClarifyRequestPayload
  /** Present only when a crash-interrupted turn was scheduled to continue (session_auto_continue.py:57). */
  auto_continue?: unknown
  [k: string]: unknown
}

/**
 * The live turn as the server projects it for a reattaching client
 * (`_inflight_snapshot`, tui_gateway/session_auto_continue.py:339). `corrections`
 * are mid-turn redirects/steers; `error` marks a retained failed turn.
 */
export interface InflightSnapshot {
  user: string
  assistant: string
  streaming: boolean
  corrections?: string[]
  correction_offsets?: number[]
  error?: string
  [k: string]: unknown
}

/** The accepted next-turn prompt (`_queued_prompt_snapshot`). */
export interface QueuedPromptSnapshot {
  user: string
  [k: string]: unknown
}

/**
 * `session.activate {session_id, omit_messages}` — `_live_session_payload`
 * (tui_gateway/server.py:2706). This is the RPC that rebinds the session's
 * transport to the current socket, and the only one that reports
 * `pending_approval` / `pending_clarify` (wire contract section B.4).
 */
export interface ActivateResult {
  session_id: string
  session_key: string
  status: string
  running: boolean
  turn_started_at?: number | null
  started_at?: number
  message_count: number
  messages: HistoryMessage[]
  messages_omitted?: boolean
  info: SessionInfoPayload
  inflight?: InflightSnapshot | null
  queued?: QueuedPromptSnapshot | null
  pending_approval?: ApprovalRequestPayload
  pending_clarify?: ClarifyRequestPayload
  [k: string]: unknown
}

/** `session.title {session_id, title}` — `pending: true` means the row is not written yet. */
export interface TitleResult {
  pending?: boolean
  title?: string
  session_key?: string
  [k: string]: unknown
}

/** `session.interrupt` / `session.steer`: a refusal is a status, not an error. */
export interface InterruptResult {
  status?: 'interrupted' | 'not_interrupted' | (string & {})
  [k: string]: unknown
}

export interface SteerResult {
  status?: 'steered' | 'rejected' | 'queued' | (string & {})
  [k: string]: unknown
}

export interface GatewayEventFrame {
  type: string
  session_id?: string
  seq?: number
  payload?: unknown
}

export interface ReplayResult {
  events: GatewayEventFrame[]
  latest_seq: number
  truncated: boolean
  count: number
  epoch: string
}

export interface SubmitResult {
  status: 'streaming' | 'queued' | 'steered' | 'redirected' | (string & {})
  [k: string]: unknown
}

export interface UsagePayload {
  model?: string
  input?: number
  output?: number
  reasoning?: number
  total?: number
  calls?: number
  context_used?: number
  context_max?: number
  context_percent?: number
  compressions?: number
  [k: string]: unknown
}

// ── event payloads ───────────────────────────────────────────────────────

export interface GatewayReadyPayload {
  skin?: unknown
  change_events?: boolean
  heartbeat?: boolean
  replay_epoch?: string
  [k: string]: unknown
}

export interface TextPayload {
  text?: string
  [k: string]: unknown
}

/** `{layer, code, retryable, provider?, model?}` (agent/error_surface.py:76). */
export interface ErrorSurface {
  layer?: string
  code?: string
  retryable?: boolean
  provider?: string
  model?: string
  [k: string]: unknown
}

/**
 * `message.complete` (tui_gateway/prompt_turn.py:629-683). On `status === 'error'`
 * the payload carries `error` + `recoverable` + `error_surface`; `failure_reason`
 * appears only alongside the billing-wall `billing` descriptor.
 */
export interface MessageCompletePayload {
  text?: string
  usage?: UsagePayload
  status?: string
  reasoning?: string
  warning?: string
  error?: string
  recoverable?: boolean
  error_surface?: ErrorSurface
  failure_reason?: string
  billing?: unknown
  [k: string]: unknown
}

/**
 * `message.interim` (wire contract section A.6): assistant commentary emitted
 * alongside tool calls. `already_streamed: true` means the same text already
 * arrived as `message.delta`s and must not be rendered twice.
 */
export interface MessageInterimPayload {
  text?: string
  already_streamed?: boolean
  [k: string]: unknown
}

export interface StatusUpdatePayload {
  text?: string
  status?: string
  message?: string
  /** `process` marks a background-process notification: receipt or notice grammar, never working-line copy (spec 5.8/5.9). */
  kind?: string
  [k: string]: unknown
}

export interface ToolStartPayload {
  tool_id: string
  name: string
  context?: string
  args?: Record<string, unknown>
}

export interface ToolCompletePayload {
  tool_id: string
  name: string
  args?: Record<string, unknown>
  duration_s?: number
  result?: unknown
  error?: string
}

export interface ClarifyQuestion {
  qid: string
  question: string
  choices: string[]
  multi_select: boolean
}

export interface ClarifyRequestPayload {
  request_id: string
  questions: ClarifyQuestion[]
}

export interface ClarifyExpirePayload {
  request_id: string
}

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export interface ApprovalRequestPayload {
  request_id: string
  command?: string
  description?: string
  tool?: string
  pattern_key?: string
  choices?: ApprovalChoice[]
  timeout?: number
  [k: string]: unknown
}

export interface ApprovalReceivedPayload {
  request_id: string
  choice?: string
  [k: string]: unknown
}

/** `{task_id, text}` (tui_gateway/methods_prompt.py:920-941, :994). No `agent`, no `source`. */
export interface BackgroundCompletePayload {
  task_id?: string
  text?: string
  [k: string]: unknown
}

export interface ErrorPayload {
  message?: string
  code?: number | string
  [k: string]: unknown
}

// ── REST surfaces ────────────────────────────────────────────────────────

export interface CronJob {
  id: string
  name: string
  schedule: string
  prompt?: string
  enabled?: boolean
  paused?: boolean
  next_run?: string | number | null
  last_run?: string | number | null
  timezone?: string
  profile?: string
  [k: string]: unknown
}

export interface CronRun {
  id?: string
  started_at?: string | number
  finished_at?: string | number
  ended_at?: string | number | null
  last_active?: string | number
  status?: string
  output?: string
  error?: string
  /** Added by the cron runs REST route: still running within the last five minutes. */
  is_active?: boolean
  archived?: boolean
  profile?: string
  [k: string]: unknown
}

export interface Toolset {
  name: string
  label: string
  description: string
  enabled: boolean
  available?: boolean
  configured?: boolean
  platform?: string
  tools: string[]
}

export interface SkillRow {
  name: string
  description: string
  category?: string
  enabled: boolean
  usage?: number
  provenance?: string
}

export interface McpServerRow {
  name: string
  enabled?: boolean
  transport?: string
  [k: string]: unknown
}

export interface ImageUploadResult {
  ok: boolean
  path: string
  name: string
  bytes: number
  mime_type: string
}

export interface FileUploadResult {
  ok: boolean
  path: string
  [k: string]: unknown
}

export interface MemoryFiles {
  memory: string
  user: string
  available: boolean
}
