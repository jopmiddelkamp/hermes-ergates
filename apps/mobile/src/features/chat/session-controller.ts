/**
 * createSessionController: one profile's Bot Chat, wired to the pure session
 * reducer. No React, React Native or Expo (ADR-029 rule 1): `use-session.ts`
 * binds it to React, and the scenario tests drive this same controller with
 * the fake gateway (ADR-029 rule 3).
 *
 * Responsibilities (docs/03 sections 4-5, docs/05 section 5):
 *  - open the socket and the canonical chat, load history
 *  - bind the session BEFORE subscribing, so no foreign frame can move the
 *    replay watermark; events that arrive during the bind are buffered, not lost
 *  - resynchronise on every reconnect: `session.activate` (which rebinds the
 *    session's event transport) and only then replay
 *  - refetch history when the reducer asks, retrying with backoff on failure
 *  - send through the durable outbox: exactly one `prompt.submit` per attempt,
 *    no automatic resend of anything that already went out (ADR-027)
 */

import { GatewayError, isGatewayError, userMessage } from '@/gateway/errors'
import type { ConnectionFailure, ConnectionState, GatewayConnection, GatewayPort } from '@/gateway/port'
import type { ApprovalChoice, GatewayEventFrame, ProfileSummary } from '@/gateway/types'

import { openCanonicalChat } from './canonical-chat'
import { SendQueue, type OutboxStore } from './send-queue'
import { initialSessionState, sessionReducer, type SessionAction, type SessionState } from './session-reducer'
import { HISTORY_STALE_ROUNDS, historyRetryDelayMs, pendingCardActions, resyncSession } from './session-sync'

export type { OutboxStore } from './send-queue'
export type { SessionState } from './session-reducer'

export type SessionPhase = 'opening' | 'ready' | 'error'

/** Everything a screen renders. A new object whenever any part of it changes. */
export interface SessionView {
  state: SessionState
  phase: SessionPhase
  openError: string | null
  /** The last connection failure, already safe to render. */
  connectionError: string | null
  /** Reconnecting cannot fix it: offer sign-in again. */
  needsReauth: boolean
}

/** What a screen can ask the chat to do. */
export interface SessionCommands {
  send(text: string): Promise<void>
  retry(localId: string): Promise<void>
  stop(): Promise<void>
  answerClarify(requestId: string, answers: Record<string, string>): Promise<void>
  dismissClarify(requestId: string, freeText: string): Promise<void>
  answerApproval(requestId: string, choice: ApprovalChoice): Promise<void>
  /** Pull-to-refresh: force a full durable refetch. Rejects when the gateway refuses. */
  refetchHistory(): Promise<void>
  /** A merged transcript page made these live observations durable; drop the live twins (spec 5.8). */
  dispatchReconciled(ids: { toolCallIds: string[]; processIds: string[] }): void
  /**
   * Development only: pushes one synthetic frame through the normal event path,
   * stamped with the live session so the reducer accepts it. A no-op unless the
   * controller was created with `allowDevInject` (`src/features/chat/dev-inject.ts`).
   */
  devInjectEvent(event: GatewayEventFrame): void
  reconnect(): Promise<void>
  clearError(): void
}

export interface SessionController extends SessionCommands {
  getView(): SessionView
  /** Calls `listener` after every change to the view. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /**
   * Opens the socket and the canonical chat. Calling it again re-opens: it drops
   * the previous attempt first. The reducer state is kept across re-opens.
   */
  open(summary?: ProfileSummary): Promise<void>
  /** Drops the connection handlers and the history retry. `open` may be called again. */
  close(): void
}

export interface SessionControllerOptions {
  port: GatewayPort
  profile: string
  connectionId: string
  /** The device store's outbox, narrowed to what the send queue needs. */
  outbox: OutboxStore
  /** Feeds `gateway.ready` and `skin.changed` skins to the theme (docs/10 section 2). */
  ingestSkin?: (connectionId: string, skin: unknown, apply: boolean) => void
  /** Lets `devInjectEvent` reach the reducer. The React binding passes `__DEV__`. */
  allowDevInject?: boolean
  now?: () => number
  newLocalId?: () => string
  /** The pause before a settling `session.activate` is retried. */
  sleep?: (ms: number) => Promise<void>
  /** Schedules a history refetch retry. Defaults to `setTimeout`. */
  setTimer?: (run: () => void, ms: number) => unknown
  /** Cancels a timer from `setTimer`. Defaults to `clearTimeout`. */
  clearTimer?: (timer: unknown) => void
}

let localCounter = 0
const defaultLocalId = (): string => `${Date.now().toString(36)}-${++localCounter}`

export function createSessionController(options: SessionControllerOptions): SessionController {
  const { port, profile, connectionId, outbox } = options
  const now = options.now ?? Date.now
  const ingestSkin = options.ingestSkin ?? ((): void => undefined)
  const setTimer = options.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms))
  const clearTimer = options.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>))

  let state: SessionState = initialSessionState
  let phase: SessionPhase = 'opening'
  let openError: string | null = null
  let failure: ConnectionFailure | null = null
  let view: SessionView = buildView()
  const listeners = new Set<() => void>()

  /** The open attempt in progress or completed; `cancelled` once it was replaced or closed. */
  let attempt: { cancelled: boolean; offEvent?: () => void; offState?: () => void } | null = null
  let lastSummary: ProfileSummary | undefined
  let connection: GatewayConnection | null = null
  let liveId: string | null = null
  let queue: SendQueue | null = null
  let resyncing = false
  /** The running history recovery, while the reducer asks for one. */
  let recovery: { cancelled: boolean; timer: unknown } | null = null
  let historyAttempt = 0

  function buildView(): SessionView {
    return { state, phase, openError, connectionError: failure?.message ?? null, needsReauth: failure?.terminal === true }
  }

  function emit(): void {
    view = buildView()
    for (const listener of [...listeners]) {
      listener()
    }
    syncHistoryRecovery()
  }

  function dispatch(action: SessionAction): void {
    state = sessionReducer(state, action)
    emit()
  }

  // The reducer asks for a durable refetch after truncation, an epoch change or a
  // lost turn end. Retry with backoff until one succeeds; the flag stays raised.
  function syncHistoryRecovery(): void {
    const wanted = phase === 'ready' && state.replay.needsHistoryRefetch
    if (wanted && recovery === null) {
      startRecovery()
    } else if (!wanted && recovery !== null) {
      stopRecovery()
    }
  }

  function startRecovery(): void {
    const run = { cancelled: false, timer: undefined as unknown }
    recovery = run
    const tryOnce = (): void => {
      run.timer = undefined
      void refetchHistory().catch(() => {
        if (run.cancelled) {
          return
        }
        const delay = historyRetryDelayMs(historyAttempt)
        historyAttempt += 1
        run.timer = setTimer(tryOnce, delay)
      })
    }
    tryOnce()
  }

  function stopRecovery(): void {
    if (recovery === null) {
      return
    }
    recovery.cancelled = true
    if (recovery.timer !== undefined) {
      clearTimer(recovery.timer)
    }
    recovery = null
  }

  async function refetchHistory(): Promise<void> {
    const live = liveId
    if (!live) {
      return
    }
    for (let round = 0; round < HISTORY_STALE_ROUNDS; round += 1) {
      // Capture the revision the snapshot starts from: anything that settles while
      // the fetch is in flight is newer than the result, and the reducer discards a
      // snapshot that would roll it back (spec 5.8).
      const revision = state.revision
      const history = await port.sessions.history(live)
      dispatch({ type: 'history/loaded', messages: history.messages, revision })
      // `history/loaded` never moves the revision, so an unchanged one is proof the
      // snapshot was accepted. A discarded one is not a recovery: read again now
      // (spec 5.8), which is why the flag below is cleared only after an accepted one.
      if (state.revision === revision) {
        // Only a SUCCESSFUL load clears the flag: clearing it in a `finally` silently
        // abandoned the recovery a truncated replay or an epoch change asked for.
        historyAttempt = 0
        dispatch({ type: 'history/refetched' })
        return
      }
    }
    // Three snapshots in a row went stale in flight. Fail, and let the backoff
    // pace the next attempt instead of spinning the gateway.
    throw new GatewayError('unknown', 'The chat kept changing while it loaded.')
  }

  function detach(): void {
    if (attempt !== null) {
      attempt.cancelled = true
      attempt.offEvent?.()
      attempt.offState?.()
    }
    attempt = null
    connection = null
    liveId = null
    queue = null
    stopRecovery()
  }

  async function open(summary?: ProfileSummary): Promise<void> {
    detach()
    lastSummary = summary
    const run: { cancelled: boolean; offEvent?: () => void; offState?: () => void } = { cancelled: false }
    attempt = run
    phase = 'opening'
    openError = null
    emit()
    try {
      const opened = await port.connect(profile)
      if (run.cancelled) {
        return
      }
      connection = opened
      // Subscribe now so nothing is missed, but hold the frames until the
      // session is bound: until then the reducer cannot tell this session's
      // events from another's, and seqs are per-session.
      let bound = false
      const buffered: GatewayEventFrame[] = []
      const handle = (event: GatewayEventFrame): void => {
        if (event.type === 'skin.changed') {
          ingestSkin(connectionId, event.payload, true)
        }
        dispatch({ type: 'event', event, at: now() })
      }
      run.offEvent = opened.onEvent(event => {
        if (!bound) {
          buffered.push(event)
          return
        }
        handle(event)
      })
      ingestSkin(connectionId, opened.ready.skin, false)

      const chat = await openCanonicalChat(port, profile, summary)
      if (run.cancelled) {
        return
      }
      liveId = chat.liveSessionId
      dispatch({ type: 'session/bound', liveSessionId: chat.liveSessionId, storedSessionId: chat.storedSessionId, epoch: opened.ready.replay_epoch ?? null })
      dispatch({ type: 'history/loaded', messages: chat.messages })
      dispatch({ type: 'history/refetched' })
      // The resume payload is the only carrier of pending hydration and of a scheduled
      // auto-continuation; a created chat has none to report (spec 12.3).
      if (chat.snapshot) {
        dispatch({ type: 'session/resumed', snapshot: chat.snapshot })
      }
      // Pending requests survive reconnects on the server; re-render them.
      for (const action of pendingCardActions(chat.liveSessionId, chat.pending)) {
        dispatch(action)
      }
      if (chat.running) {
        // We did not see this turn start, so it may be one whose completion we
        // already missed: the reducer marks it `unknown`, not ours (spec 5.8).
        dispatch({ type: 'turn/observed-running', at: now() })
      }
      bound = true
      for (const event of buffered.splice(0)) {
        handle(event)
      }
      run.offState = opened.onState(next => onConnectionState(opened, next))

      const sendQueue = new SendQueue({
        outbox,
        connectionId,
        profile,
        submit: (text, opts) => port.sessions.submit(chat.liveSessionId, text, opts),
        dispatch,
        // Bound to this open attempt, not to the controller-wide `connection`: a
        // re-open sets that again, and a queue left from the previous attempt
        // must stop flushing instead of sending on the new attempt's behalf.
        isOnline: () => !run.cancelled && opened.state === 'open',
        isBusy: () => state.live.streaming,
        now,
        newLocalId: options.newLocalId ?? defaultLocalId
      })
      queue = sendQueue
      // Bubbles for anything the outbox still holds (offline sends, an
      // uncertain submit from before a restart), then send the never-submitted
      // ones now that there is a connection.
      sendQueue.restore()
      phase = 'ready'
      emit()
      void sendQueue.flush()
    } catch (err) {
      if (run.cancelled) {
        return
      }
      openError = userMessage(err)
      phase = 'error'
      if (isGatewayError(err) && (err.kind === 'unauthorized' || err.kind === 'forbidden')) {
        // A ticket mint against an expired cookie fails before any socket
        // exists, so no close code ever reports it: surface it here or the app
        // re-mints against a dead session every backoff tick, forever.
        failure = { kind: err.kind, message: userMessage(err), terminal: true, code: err.code }
      }
      emit()
    }
  }

  function onConnectionState(opened: GatewayConnection, next: ConnectionState): void {
    const previous = state.connection
    dispatch({ type: 'connection/state', state: next })
    // A terminal socket failure is the screen's cue to offer a new sign-in.
    if ((next === 'error' || next === 'closed') && opened.lastError) {
      failure = opened.lastError
      emit()
    }
    // Every transition back into `open` after the first bind must rebind the
    // session's transport, not just replay: the backend routes events to the
    // transport the session is bound to, and a disconnect parks that on a drop sink.
    if (next === 'open' && previous !== 'open' && previous !== 'idle' && phase === 'ready') {
      void reconnect()
    }
  }

  async function reconnect(): Promise<void> {
    // Captured, not read live: `close()` cancels this same object (`detach`
    // flips `attempt.cancelled`) without touching the local reference, so a
    // reconnect started before `close()` can tell it was abandoned even after
    // `attempt` itself has moved on to null or a fresh `open()`.
    const run = attempt
    if (!run) {
      return
    }
    const current = connection
    const live = liveId
    if (!current || !live || resyncing) {
      return
    }
    const maybe = current as GatewayConnection & { reconnectNow?: () => Promise<void> }
    if (current.state !== 'open' && maybe.reconnectNow) {
      try {
        await maybe.reconnectNow()
      } catch (err) {
        failure = current.lastError ?? { kind: isGatewayError(err) ? err.kind : 'unknown', message: userMessage(err), terminal: false }
        emit()
        return
      }
    }
    if (run.cancelled) {
      return
    }
    resyncing = true
    try {
      const result = await resyncSession({
        port,
        connection: current,
        liveSessionId: live,
        lastSeq: () => state.replay.lastSeq,
        dispatch,
        sleep: options.sleep,
        now
      })
      if (run.cancelled) {
        return
      }
      if (result.stale) {
        // The gateway restarted, or reaped the session: the id we hold is gone.
        // Re-run the open path, which resolves the canonical chat again.
        void open(lastSummary)
        return
      }
      if (result.activated) {
        failure = null
        emit()
        // `gateway.ready` is re-sent on every (re)connect and can carry a new skin.
        ingestSkin(connectionId, current.ready.skin, false)
        void queue?.flush()
      } else if (result.error) {
        dispatch({ type: 'error/raised', message: result.error })
      }
    } finally {
      resyncing = false
    }
  }

  async function send(text: string): Promise<void> {
    const current = queue
    if (!current) {
      dispatch({ type: 'error/raised', message: 'The chat is not open yet.' })
      return
    }
    await current.press(text)
  }

  async function retry(localId: string): Promise<void> {
    const item = state.items.find(i => i.kind === 'user' && i.localId === localId)
    await queue?.retry(localId, item?.kind === 'user' ? item.text : undefined)
  }

  async function stop(): Promise<void> {
    const live = liveId
    if (!live) {
      return
    }
    try {
      const result = await port.sessions.interrupt(live)
      if (result?.status && result.status !== 'interrupted') {
        // `{status:'not_interrupted'}`: there was no live turn to stop. Saying so
        // is better than a Stop that silently does nothing.
        dispatch({ type: 'error/raised', message: 'There was no running turn to stop.' })
      }
    } catch (err) {
      dispatch({ type: 'error/raised', message: userMessage(err) })
    }
  }

  async function answerClarify(requestId: string, answers: Record<string, string>): Promise<void> {
    const live = liveId
    if (!live) {
      return
    }
    const card = state.items.find(i => i.kind === 'clarify' && i.requestId === requestId)
    const questions = card?.kind === 'clarify' ? card.questions : []
    try {
      if (questions.length > 1) {
        for (const q of questions) {
          await port.sessions.respondClarify({ session_id: live, request_id: requestId, question_id: q.qid, answer: answers[q.qid] ?? '' })
        }
      } else {
        const only = questions[0]?.qid ?? 'q0'
        await port.sessions.respondClarify({ session_id: live, request_id: requestId, answer: answers[only] ?? Object.values(answers)[0] ?? '' })
      }
    } catch (err) {
      // A mid-loop failure leaves the earlier answers locked in server-side, so
      // the card must stay open and say what happened instead of looking answered.
      dispatch({ type: 'clarify/failed', requestId, message: userMessage(err) })
      return
    }
    dispatch({ type: 'clarify/responded', requestId, answers })
  }

  async function dismissClarify(requestId: string, freeText: string): Promise<void> {
    const live = liveId
    if (!live) {
      return
    }
    try {
      // Free text answers the question and marks the card dismissed (FR-121).
      await port.sessions.respondClarify({ session_id: live, request_id: requestId, answer: freeText })
    } catch (err) {
      dispatch({ type: 'clarify/failed', requestId, message: userMessage(err) })
      return
    }
    dispatch({ type: 'clarify/dismissed', requestId })
  }

  async function answerApproval(requestId: string, choice: ApprovalChoice): Promise<void> {
    const live = liveId
    if (!live) {
      return
    }
    try {
      await port.sessions.respondApproval({ session_id: live, request_id: requestId, choice })
    } catch (err) {
      dispatch({ type: 'error/raised', message: userMessage(err) })
      return
    }
    dispatch({ type: 'approval/responded', requestId, choice })
  }

  return {
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open,
    close: detach,
    send,
    retry,
    stop,
    answerClarify,
    dismissClarify,
    answerApproval,
    refetchHistory,
    dispatchReconciled(ids) {
      dispatch({ type: 'transcript/reconciled', toolCallIds: ids.toolCallIds, processIds: ids.processIds })
    },
    devInjectEvent(event) {
      const live = liveId
      if (!options.allowDevInject || !live) {
        return
      }
      dispatch({ type: 'event', event: { ...event, session_id: live }, at: now() })
    },
    reconnect,
    clearError() {
      dispatch({ type: 'error/cleared' })
    }
  }
}
