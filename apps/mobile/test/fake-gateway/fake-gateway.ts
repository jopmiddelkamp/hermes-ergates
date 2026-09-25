/**
 * FakeGateway: an in-memory GatewayPort double driven by a small script.
 *
 * It mimics the recorded backend shapes closely enough for scenario tests to
 * drive the real `createSessionController` without a network. Every
 * profile/session RPC is answered from `test/fixtures/*.json`
 * (see docs/superpowers/research/2026-09-13-recorded-backend-shapes.md);
 * only `prompt.submit` and replay are scriptable per test.
 *
 * No React Native or Expo imports (ADR-029 rule 1) - this runs in Node under
 * Vitest.
 */

import { GatewayError } from '@/gateway/errors'
import type { ConnectionFailure, ConnectionState, FilesApi, GatewayConnection, GatewayPort, ProfilesApi, RoutinesApi, SessionsApi, ToolsApi } from '@/gateway/port'
import { normalizeTranscriptPage } from '@/gateway/transcript'
import type * as T from '@/gateway/types'

import assetAvatarFixture from '../fixtures/asset-avatar.json'
import cronJobsFixture from '../fixtures/cron-jobs.json'
import historyFixture from '../fixtures/history.json'
import mcpServersFixture from '../fixtures/mcp-servers.json'
import modelOptionsFixture from '../fixtures/model-options.json'
import profilesDescribeFixture from '../fixtures/profiles-describe.json'
import profilesListFixture from '../fixtures/profiles-list.json'
import sessionCreateFixture from '../fixtures/session-create.json'
import skillsFixture from '../fixtures/skills.json'
import statusFixture from '../fixtures/status.json'
import toolsetsFixture from '../fixtures/toolsets.json'
import transcriptSenderFixture from '../fixtures/agent-traffic/transcript-sender.json'

/** Deep-clones a fixture and casts it to the wire type it represents. */
const clone = <V>(value: unknown): V => structuredClone(value) as V

/**
 * Default `sessions.transcript` answer: `transcript-sender.json` sliced by
 * offset/limit like the real REST route, counted from the newest end when
 * `order === 'latest'` and from the oldest end for `'oldest'`, then returned
 * in ascending id order.
 */
function defaultTranscriptPage(sessionId: string, opts: T.TranscriptQuery): T.TranscriptRawPage {
  const rows = transcriptSenderFixture.messages as unknown[]
  const limit = Math.min(Math.max(opts.limit, 1), 500)
  const offset = opts.offset ?? 0
  const fromOldest = opts.order === 'oldest' ? rows : [...rows].reverse()
  const sliced = fromOldest.slice(offset, offset + limit)
  const ascending = opts.order === 'oldest' ? sliced : [...sliced].reverse()
  return {
    session_id: sessionId,
    profile: opts.profile,
    messages: ascending,
    pagination: { limit, offset, order: opts.order, returned: ascending.length }
  }
}

/**
 * What one `send()` attempt does: stream these frames, fail like the real gateway
 * would, or answer with a non-streaming status (a busy send comes back `queued`,
 * `redirected` or `steered`).
 */
export type SubmitOutcome = T.GatewayEventFrame[] | 'timeout' | 'reject' | { status: T.SubmitResult['status']; events?: T.GatewayEventFrame[] }

export interface FakeScript {
  /** A returned promise keeps that `prompt.submit` in flight until it settles. */
  onSubmit?: (text: string) => SubmitOutcome | Promise<SubmitOutcome>
  /** Overrides merged onto the default (gap-since-lastSeen) replay result. */
  replay?: Partial<T.ReplayResult>
  readyEpoch?: string
  /** Rows the exact-title `session.list` lookup answers with. */
  sessions?: T.SessionRow[]
  /** Overrides merged onto the default `session.activate` result. */
  activate?: Partial<T.ActivateResult>
  /** Reject `session.activate` this many times with 4009 before answering. */
  activateSettling?: number
  /** Reject `session.title` with a uniqueness error (the adopt-before-mint path). */
  titleConflict?: boolean
  /** Reject `session.history` this many times before answering. */
  historyFailures?: number
  /**
   * Answers the Nth (1-based) `session.history` call. It is awaited, so a test can
   * hold one snapshot in flight while events land; `undefined` falls back to the
   * recorded fixture.
   */
  history?: (call: number) => Promise<T.HistoryMessage[] | undefined> | T.HistoryMessage[] | undefined
  /** Overrides the default (sliced `transcript-sender.json`) `sessions.transcript` answer. */
  transcript?: (opts: T.TranscriptQuery & { sessionId: string }) => T.TranscriptRawPage | 'reject'
}

/**
 * One live connection for one profile. `emit` and `simulateDrop` are
 * test-only hooks (not part of `GatewayConnection`) reached via
 * `FakeGateway.connectionFor`.
 */
export class FakeConnection implements GatewayConnection {
  readonly profile: string
  readonly ready: T.GatewayReadyPayload
  /** Count of `prompt.submit` requests this connection has answered. */
  submitCalls = 0
  /** Every RPC this connection saw, in order: `[method, params]`. */
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  lastError: ConnectionFailure | null = null

  private readonly script: FakeScript
  private stateValue: ConnectionState = 'open'
  private readonly eventHandlers = new Set<(event: T.GatewayEventFrame) => void>()
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>()
  private readonly log: T.GatewayEventFrame[] = []
  private seqCounter = 1000
  /** Rejecters of the requests still waiting for an answer. */
  private readonly inFlight = new Set<(err: Error) => void>()

  constructor(profile: string, script: FakeScript) {
    this.profile = profile
    this.script = script
    this.ready = { heartbeat: true, change_events: true, replay_epoch: script.readyEpoch ?? 'epoch-fake' }
  }

  get state(): ConnectionState {
    return this.stateValue
  }

  async request<R>(method: string, params: Record<string, unknown> = {}): Promise<R> {
    // Like the vendored client (vendor/hermes/shared/json-rpc-gateway.ts, `request`):
    // a socket that is not open rejects at once and nothing reaches the server.
    if (this.stateValue !== 'open') {
      throw new GatewayError('network', 'No connection to the gateway.')
    }
    this.requests.push({ method, params })
    if (method === 'prompt.submit') {
      return this.track(this.submit(params)) as unknown as R
    }
    return {} as R
  }

  /** Settles with `work`, unless the socket closes first (see `setState`). */
  private track<V>(work: Promise<V>): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      this.inFlight.add(reject)
      work.then(resolve, reject).finally(() => this.inFlight.delete(reject))
    })
  }

  /** The methods this connection saw, in order. */
  methods(): string[] {
    return this.requests.map(r => r.method)
  }

  private async submit(params: Record<string, unknown>): Promise<T.SubmitResult> {
    this.submitCalls += 1
    const sessionId = String(params.session_id ?? '')
    const text = String(params.text ?? '')
    const outcome = this.script.onSubmit ? await this.script.onSubmit(text) : []
    if (outcome === 'timeout') {
      throw new GatewayError('timeout', 'The gateway did not answer in time.')
    }
    if (outcome === 'reject') {
      throw new GatewayError('rpc', 'The gateway rejected the request.', { code: 4002 })
    }
    const status = Array.isArray(outcome) ? 'streaming' : outcome.status
    const frames = Array.isArray(outcome) ? outcome : outcome.events ?? []
    // The real gateway resolves `{status:'streaming'}` before any event is on
    // the wire; events land on their own turn of the loop.
    setTimeout(() => {
      for (const frame of frames) {
        this.emit({ session_id: sessionId, ...frame })
      }
    }, 0)
    return { status }
  }

  onEvent(handler: (event: T.GatewayEventFrame) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler)
    handler(this.stateValue)
    return () => this.stateHandlers.delete(handler)
  }

  async replay(sessionId: string, lastSeen: number): Promise<T.ReplayResult> {
    this.requests.push({ method: 'session.events.since', params: { session_id: sessionId, last_seen: lastSeen } })
    const gap = this.log.filter(e => typeof e.seq === 'number' && e.seq > lastSeen)
    const latest = gap.reduce((max, e) => Math.max(max, e.seq ?? 0), lastSeen)
    const base: T.ReplayResult = {
      events: gap,
      latest_seq: latest,
      truncated: false,
      count: gap.length,
      epoch: this.script.readyEpoch ?? 'epoch-fake'
    }
    return { ...base, ...(this.script.replay ?? {}) }
  }

  close(): void {
    this.setState('closed')
  }

  /** Test hook: push an event straight to subscribers (and the replay log). */
  emit(event: T.GatewayEventFrame): void {
    this.log.push(event)
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  /** Next seq for events the fake synthesizes itself (well above script seqs). */
  nextSeq(): number {
    this.seqCounter += 1
    return this.seqCounter
  }

  /** Test hook: a brief transport blip - closed (in-flight requests fail), then open again. */
  simulateDrop(): void {
    this.setState('closed')
    this.setState('open')
  }

  /** Test hook: the socket is down until `simulateOnline`; in-flight requests fail. */
  simulateOffline(): void {
    this.setState('closed')
  }

  /** Test hook: the socket is back after `simulateOffline`. */
  simulateOnline(): void {
    this.setState('open')
  }

  private setState(state: ConnectionState): void {
    this.stateValue = state
    for (const handler of this.stateHandlers) {
      handler(state)
    }
    if (state === 'closed') {
      // Like the real client (vendor/hermes/shared/json-rpc-gateway.ts, `close`
      // and the socket's close listener): a closed socket rejects every request
      // still in flight, and the adapter maps that to a `network` error.
      const pending = [...this.inFlight]
      this.inFlight.clear()
      for (const reject of pending) {
        reject(new GatewayError('network', 'No connection to the gateway.'))
      }
    }
  }
}

export class FakeGateway implements GatewayPort {
  private readonly script: FakeScript
  private readonly connections = new Map<string, FakeConnection>()
  /** live session id -> owning profile, set on session.create/resume. */
  private readonly sessionOwner = new Map<string, string>()

  constructor(script: FakeScript = {}) {
    this.script = script
  }

  async status(): Promise<T.BackendStatus> {
    return clone(statusFixture) as T.BackendStatus
  }

  async login(): Promise<T.AuthIdentity | null> {
    return null
  }

  async me(): Promise<T.AuthIdentity | null> {
    return null
  }

  async logout(): Promise<void> {
    this.disconnectAll()
    this.cookiesCleared += 1
  }

  /** How many times the platform cookie jar would have been cleared. */
  cookiesCleared = 0

  async clearCookies(): Promise<void> {
    this.cookiesCleared += 1
  }

  async connect(profile: string): Promise<GatewayConnection> {
    return this.openConnection(profile)
  }

  private openConnection(profile: string): FakeConnection {
    let conn = this.connections.get(profile)
    if (!conn) {
      conn = new FakeConnection(profile, this.script)
      this.connections.set(profile, conn)
    }
    return conn
  }

  /** Test hook: the connection opened for `profile` (throws if not connected yet). */
  connectionFor(profile: string): FakeConnection {
    const conn = this.connections.get(profile)
    if (!conn) {
      throw new Error(`FakeGateway: profile "${profile}" has no open connection`)
    }
    return conn
  }

  disconnectAll(): void {
    for (const conn of this.connections.values()) {
      conn.close()
    }
    this.connections.clear()
  }

  readonly profiles: ProfilesApi = {
    list: async () => clone(profilesListFixture) as T.ProfilesListResult,
    describe: async () => clone(profilesDescribeFixture) as T.ProfileDescribe,
    configure: async () => ({ ok: true }),
    create: async () => ({ ok: true }),
    remove: async () => undefined,
    getAsset: async () => clone(assetAvatarFixture) as T.AssetResult,
    setAsset: async () => undefined,
    modelOptions: async () => clone(modelOptionsFixture) as T.ModelOptions,
    memory: async () => ({ memory: '', user: '', available: false })
  }

  /** Calls the script-driven RPCs recorded for assertions. */
  readonly calls = {
    activate: 0,
    title: [] as string[],
    history: 0,
    transcript: { count: 0, lastQuery: null as (T.TranscriptQuery & { sessionId: string }) | null }
  }

  readonly sessions: SessionsApi = {
    list: async () => ({ sessions: clone(this.script.sessions ?? []) as T.SessionRow[] }),
    create: async params => {
      const result = clone(sessionCreateFixture) as T.SessionCreateResult
      this.sessionOwner.set(result.session_id, params.profile)
      return result
    },
    activate: async (liveSessionId, opts) => {
      this.calls.activate += 1
      const conn = this.connectionForSession(liveSessionId)
      await conn.request('session.activate', { session_id: liveSessionId, omit_messages: opts?.omit_messages ?? true })
      if (this.script.activateSettling && this.calls.activate <= this.script.activateSettling) {
        throw new GatewayError('busy', 'The assistant is busy with another turn.', { code: 4009, data: 'session disconnect interrupt settling' })
      }
      const base = clone(sessionCreateFixture) as T.SessionCreateResult
      const result: T.ActivateResult = {
        session_id: liveSessionId,
        session_key: base.stored_session_id,
        status: 'idle',
        running: false,
        messages: [],
        messages_omitted: true,
        message_count: 0,
        info: base.info,
        ...(this.script.activate ?? {})
      }
      return result
    },
    title: async (liveSessionId, title) => {
      this.calls.title.push(title)
      const conn = this.connectionForSession(liveSessionId)
      await conn.request('session.title', { session_id: liveSessionId, title })
      if (this.script.titleConflict) {
        throw new GatewayError('rpc', `Title '${title}' is already in use by session 20260101_000000_other`, { code: 4022 })
      }
      return { pending: false, title }
    },
    resume: async params => {
      const base = clone(sessionCreateFixture) as T.SessionCreateResult
      this.sessionOwner.set(base.session_id, params.profile ?? '')
      return {
        session_id: base.session_id,
        resumed: params.session_id,
        session_key: params.session_id,
        message_count: historyFixture.count,
        messages: clone(historyFixture.messages) as T.HistoryMessage[],
        running: false,
        status: 'idle',
        info: base.info
      }
    },
    history: async () => {
      this.calls.history += 1
      if (this.script.historyFailures && this.calls.history <= this.script.historyFailures) {
        throw new GatewayError('timeout', 'The gateway did not answer in time.')
      }
      const scripted = await this.script.history?.(this.calls.history)
      if (scripted !== undefined) {
        return { count: scripted.length, messages: clone(scripted) as T.HistoryMessage[] }
      }
      return clone(historyFixture) as T.HistoryResult
    },
    transcript: async (sessionId, opts) => {
      this.calls.transcript.count += 1
      this.calls.transcript.lastQuery = { sessionId, ...opts }
      const scripted = this.script.transcript?.({ sessionId, ...opts })
      if (scripted === 'reject') {
        throw new GatewayError('rpc', 'The gateway rejected the request.', { code: 4002 })
      }
      return normalizeTranscriptPage(scripted ?? defaultTranscriptPage(sessionId, opts))
    },
    submit: async (sessionId, text, opts) => {
      const conn = this.connectionForSession(sessionId)
      return conn.request<T.SubmitResult>('prompt.submit', { session_id: sessionId, text, ...(opts?.queued ? { queued: true } : {}) })
    },
    interrupt: async () => ({ status: 'interrupted' }),
    steer: async () => ({ status: 'queued' }),
    usage: async () => ({}),
    respondApproval: async p => {
      const conn = this.connectionForSession(p.session_id)
      conn.emit({ type: 'approval.received', session_id: p.session_id, seq: conn.nextSeq(), payload: { request_id: p.request_id, choice: p.choice } })
    },
    respondClarify: async () => ({ status: 'answered' }),
    attachImageBytes: async () => ({}),
    attachFile: async () => ({}),
    close: async sessionId => {
      this.sessionOwner.delete(sessionId)
    },
    remove: async () => undefined
  }

  readonly routines: RoutinesApi = {
    list: async () => clone(cronJobsFixture) as T.CronJob[],
    create: async (_profile, body) => ({ id: 'job-fake', name: '', schedule: '', enabled: true, paused: false, ...body }) as T.CronJob,
    update: async (id, updates) => ({ id, name: '', schedule: '', enabled: true, paused: false, ...updates }) as T.CronJob,
    pause: async () => undefined,
    resume: async () => undefined,
    trigger: async () => undefined,
    remove: async () => undefined,
    runs: async () => []
  }

  readonly tools: ToolsApi = {
    toolsets: async () => clone(toolsetsFixture) as T.Toolset[],
    skills: async () => clone(skillsFixture) as T.SkillRow[],
    mcpServers: async () => clone(mcpServersFixture.servers ?? []) as T.McpServerRow[],
    testMcp: async () => ({ ok: true })
  }

  readonly files: FilesApi = {
    uploadImage: async (_profile, _dataUrl, filename) => ({ ok: true, path: `/uploads/${filename}`, name: filename, bytes: 0, mime_type: 'image/png' }),
    uploadFile: async path => ({ ok: true, path })
  }

  private connectionForSession(sessionId: string): FakeConnection {
    const profile = this.sessionOwner.get(sessionId)
    if (!profile) {
      throw new GatewayError('not_found', `FakeGateway: unknown session "${sessionId}"`)
    }
    return this.openConnection(profile)
  }
}
