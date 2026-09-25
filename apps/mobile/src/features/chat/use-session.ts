/**
 * useSession: wires one profile's Bot Chat to the pure session reducer.
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
 *
 * This file is a React/React Native adapter (ADR-029 rule 2): the rules it
 * applies live in `session-reducer.ts`, `session-sync.ts` and `send-queue.ts`,
 * which are tested in plain Node.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { GatewayError, isGatewayError, userMessage } from '@/gateway/errors'
import type { ConnectionFailure, GatewayConnection, GatewayPort } from '@/gateway/port'
import type { ApprovalChoice, GatewayEventFrame, ProfileSummary } from '@/gateway/types'

import { useDeviceStore } from '@/state/device-store'
import { useSkinStore } from '@/theme/skin-store'

import { openCanonicalChat } from './canonical-chat'
import { SendQueue, type OutboxStore } from './send-queue'
import { initialSessionState, sessionReducer, type SessionState } from './session-reducer'
import { HISTORY_STALE_ROUNDS, historyRetryDelayMs, pendingCardActions, resyncSession } from './session-sync'

export type SessionPhase = 'opening' | 'ready' | 'error'

export interface SessionController {
  state: SessionState
  phase: SessionPhase
  openError: string | null
  /** The last connection failure, already safe to render. */
  connectionError: string | null
  /** Reconnecting cannot fix it: offer sign-in again. */
  needsReauth: boolean
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
   * stamped with the live session so the reducer accepts it. A no-op in a
   * release bundle. Used by the simulator pass to reach outcomes the local
   * backend cannot produce on demand (`src/features/chat/dev-inject.ts`).
   */
  devInjectEvent(event: GatewayEventFrame): void
  reconnect(): Promise<void>
  clearError(): void
}

export interface UseSessionOptions {
  enabled?: boolean
  connectionId?: string
  /** Test seam; defaults to the device store's outbox. */
  outbox?: OutboxStore
}

let localCounter = 0
const newLocalId = () => `${Date.now().toString(36)}-${++localCounter}`

export function useSession(port: GatewayPort, profile: string, summary: ProfileSummary | undefined, options: UseSessionOptions = {}): SessionController {
  const enabled = options.enabled ?? true
  const connectionId = options.connectionId ?? 'primary'
  // The resolved canonical pointer, not the summary object: the roster query
  // hands back a new object on every refetch, and the effect must re-run when the
  // roster finally reports a pointer it did not have (an errored first roster
  // makes `summary` undefined, which is exactly when the lookup can read an
  // empty-but-successful list as "this bot never had a chat").
  const pointer = summary?.canonical_session?.resolved_id ?? summary?.canonical_session?.id ?? null
  const ingestSkin = useSkinStore(s => s.ingest)
  const [state, rawDispatch] = useReducer(sessionReducer, initialSessionState)
  // A synchronous shadow of the reducer state. React commits `state` only at
  // the next render, so anything that must read the live phase in the same
  // tick as a dispatch (the send queue's busy check deciding `queued: true`)
  // reads this instead of a render-time ref that is provably stale there.
  const shadowRef = useRef<SessionState>(initialSessionState)
  const dispatch = useCallback((action: Parameters<typeof sessionReducer>[1]) => {
    shadowRef.current = sessionReducer(shadowRef.current, action)
    rawDispatch(action)
  }, [])
  const [phase, setPhase] = useState<SessionPhase>('opening')
  const [openError, setOpenError] = useState<string | null>(null)
  const [failure, setFailure] = useState<ConnectionFailure | null>(null)
  const [reopenNonce, setReopenNonce] = useState(0)
  const connectionRef = useRef<GatewayConnection | null>(null)
  const liveIdRef = useRef<string | null>(null)
  const queueRef = useRef<SendQueue | null>(null)
  const resyncingRef = useRef(false)
  const historyAttemptRef = useRef(0)
  const previousConnection = useRef<SessionState['connection']>('idle')
  const stateRef = useRef(state)
  stateRef.current = state

  const outbox = useMemo<OutboxStore>(
    () =>
      options.outbox ?? {
        list: () => useDeviceStore.getState().outbox,
        add: item => useDeviceStore.getState().addOutboxItem(item),
        update: (localId, patch) => useDeviceStore.getState().updateOutboxItem(localId, patch),
        remove: localId => useDeviceStore.getState().removeOutboxItem(localId)
      },
    [options.outbox]
  )

  const refetchHistory = useCallback(async () => {
    const liveId = liveIdRef.current
    if (!liveId) {
      return
    }
    for (let round = 0; round < HISTORY_STALE_ROUNDS; round += 1) {
      // Capture the revision the snapshot starts from: anything that settles while
      // the fetch is in flight is newer than the result, and the reducer discards a
      // snapshot that would roll it back (spec 5.8).
      const revision = shadowRef.current.revision
      const history = await port.sessions.history(liveId)
      dispatch({ type: 'history/loaded', messages: history.messages, revision })
      // `history/loaded` never moves the revision, so an unchanged one is proof the
      // snapshot was accepted. A discarded one is not a recovery: read again now
      // (spec 5.8), which is why the flag below is cleared only after an accepted one.
      if (shadowRef.current.revision === revision) {
        // Only a SUCCESSFUL load clears the flag: clearing it in a `finally` silently
        // abandoned the recovery a truncated replay or an epoch change asked for.
        dispatch({ type: 'history/refetched' })
        historyAttemptRef.current = 0
        return
      }
    }
    // Three snapshots in a row went stale in flight. Fail, and let the backoff
    // effect pace the next attempt instead of spinning the gateway.
    throw new GatewayError('unknown', 'The chat kept changing while it loaded.')
  }, [port])

  /** Durable transcript rows arrived for live-only observations (spec 5.8). */
  const dispatchReconciled = useCallback((ids: { toolCallIds: string[]; processIds: string[] }) => {
    dispatch({ type: 'transcript/reconciled', toolCallIds: ids.toolCallIds, processIds: ids.processIds })
  }, [])

  /** See `SessionController.devInjectEvent`. Nothing outside a dev bundle can reach the dispatch. */
  const devInjectEvent = useCallback((event: GatewayEventFrame) => {
    const liveId = liveIdRef.current
    if (!__DEV__ || !liveId) {
      return
    }
    dispatch({ type: 'event', event: { ...event, session_id: liveId }, at: Date.now() })
  }, [])

  // Open the socket + canonical chat once per (port, profile, pointer).
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    let offEvent: (() => void) | undefined
    let offState: (() => void) | undefined
    setPhase('opening')
    setOpenError(null)
    ;(async () => {
      try {
        const connection = await port.connect(profile)
        if (cancelled) {
          return
        }
        connectionRef.current = connection
        // Subscribe now so nothing is missed, but hold the frames until the
        // session is bound: until then the reducer cannot tell this session's
        // events from another's, and seqs are per-session.
        let bound = false
        const buffered: GatewayEventFrame[] = []
        const handle = (event: GatewayEventFrame) => {
          if (event.type === 'skin.changed') {
            ingestSkin(connectionId, event.payload, true)
          }
          dispatch({ type: 'event', event, at: Date.now() })
        }
        offEvent = connection.onEvent(event => {
          if (!bound) {
            buffered.push(event)
            return
          }
          handle(event)
        })
        ingestSkin(connectionId, connection.ready.skin, false)

        const opened = await openCanonicalChat(port, profile, summary)
        if (cancelled) {
          return
        }
        liveIdRef.current = opened.liveSessionId
        dispatch({ type: 'session/bound', liveSessionId: opened.liveSessionId, storedSessionId: opened.storedSessionId, epoch: connection.ready.replay_epoch ?? null })
        dispatch({ type: 'history/loaded', messages: opened.messages })
        dispatch({ type: 'history/refetched' })
        // The resume payload is the only carrier of pending hydration and of a scheduled
        // auto-continuation; a created chat has none to report (spec 12.3).
        if (opened.snapshot) {
          dispatch({ type: 'session/resumed', snapshot: opened.snapshot })
        }
        // Pending requests survive reconnects on the server; re-render them.
        for (const action of pendingCardActions(opened.liveSessionId, opened.pending)) {
          dispatch(action)
        }
        if (opened.running) {
          // We did not see this turn start, so it may be one whose completion we
          // already missed: the reducer marks it `unknown`, not ours (spec 5.8).
          dispatch({ type: 'turn/observed-running', at: Date.now() })
        }
        bound = true
        for (const event of buffered.splice(0)) {
          handle(event)
        }
        offState = connection.onState(s => dispatch({ type: 'connection/state', state: s }))

        const queue = new SendQueue({
          outbox,
          connectionId,
          profile,
          submit: (text, opts) => port.sessions.submit(opened.liveSessionId, text, opts),
          dispatch,
          isOnline: () => connectionRef.current?.state === 'open',
          isBusy: () => shadowRef.current.live.streaming,
          newLocalId
        })
        queueRef.current = queue
        // Bubbles for anything the outbox still holds (offline sends, an
        // uncertain submit from before a restart), then send the never-submitted
        // ones now that there is a connection.
        queue.restore()
        setPhase('ready')
        void queue.flush()
      } catch (err) {
        if (cancelled) {
          return
        }
        setOpenError(userMessage(err))
        setPhase('error')
        if (isGatewayError(err) && (err.kind === 'unauthorized' || err.kind === 'forbidden')) {
          // A ticket mint against an expired cookie fails before any socket
          // exists, so no close code ever reports it: surface it here or the app
          // re-mints against a dead session every backoff tick, forever.
          setFailure({ kind: err.kind, message: userMessage(err), terminal: true, code: err.code })
        }
      }
    })()
    return () => {
      cancelled = true
      offEvent?.()
      offState?.()
      connectionRef.current = null
      liveIdRef.current = null
      queueRef.current = null
    }
    // `summary` is read through `pointer`; see the comment on `pointer`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, profile, enabled, pointer, reopenNonce, connectionId, ingestSkin, outbox])

  // The reducer asks for a durable refetch after truncation, an epoch change or a
  // lost turn end. Retry with backoff until one succeeds; the flag stays raised.
  useEffect(() => {
    if (!state.replay.needsHistoryRefetch || phase !== 'ready') {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (): void => {
      void refetchHistory().catch(() => {
        if (cancelled) {
          return
        }
        const delay = historyRetryDelayMs(historyAttemptRef.current)
        historyAttemptRef.current += 1
        timer = setTimeout(attempt, delay)
      })
    }
    attempt()
    return () => {
      cancelled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [state.replay.needsHistoryRefetch, phase, refetchHistory])

  const reconnect = useCallback(async () => {
    const connection = connectionRef.current
    const liveId = liveIdRef.current
    if (!connection || !liveId || resyncingRef.current) {
      return
    }
    const maybe = connection as GatewayConnection & { reconnectNow?: () => Promise<void> }
    if (connection.state !== 'open' && maybe.reconnectNow) {
      try {
        await maybe.reconnectNow()
      } catch (err) {
        setFailure(connection.lastError ?? { kind: isGatewayError(err) ? err.kind : 'unknown', message: userMessage(err), terminal: false })
        return
      }
    }
    resyncingRef.current = true
    try {
      const result = await resyncSession({
        port,
        connection,
        liveSessionId: liveId,
        lastSeq: () => stateRef.current.replay.lastSeq,
        dispatch
      })
      if (result.stale) {
        // The gateway restarted, or reaped the session: the id we hold is gone.
        // Re-run the open path, which resolves the canonical chat again.
        setReopenNonce(n => n + 1)
        return
      }
      if (result.activated) {
        setFailure(null)
        // `gateway.ready` is re-sent on every (re)connect and can carry a new skin.
        ingestSkin(connectionId, connection.ready.skin, false)
        void queueRef.current?.flush()
      } else if (result.error) {
        dispatch({ type: 'error/raised', message: result.error })
      }
    } finally {
      resyncingRef.current = false
    }
  }, [port, connectionId, ingestSkin])

  // Every transition back into `open` after the first bind must rebind the
  // session's transport, not just replay: the backend routes events to the
  // transport the session is bound to, and a disconnect parks that on a drop sink.
  useEffect(() => {
    const previous = previousConnection.current
    previousConnection.current = state.connection
    if (state.connection !== 'open' || previous === 'open' || previous === 'idle' || phase !== 'ready') {
      return
    }
    void reconnect()
  }, [state.connection, phase, reconnect])

  // A terminal socket failure is the screen's cue to offer a new sign-in.
  useEffect(() => {
    if (state.connection === 'error' || state.connection === 'closed') {
      const current = connectionRef.current?.lastError ?? null
      if (current) {
        setFailure(current)
      }
    }
  }, [state.connection])

  // Resynchronise when the app returns to the foreground (iOS kills the socket
  // within seconds of suspension).
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === 'active' && phase === 'ready') {
        void reconnect()
      }
    }
    const sub = AppState.addEventListener('change', onChange)
    return () => sub.remove()
  }, [phase, reconnect])

  const send = useCallback(async (text: string) => {
    const queue = queueRef.current
    if (!queue) {
      dispatch({ type: 'error/raised', message: 'The chat is not open yet.' })
      return
    }
    await queue.press(text)
  }, [])

  const retry = useCallback(async (localId: string) => {
    const item = stateRef.current.items.find(i => i.kind === 'user' && i.localId === localId)
    await queueRef.current?.retry(localId, item?.kind === 'user' ? item.text : undefined)
  }, [])

  const stop = useCallback(async () => {
    const liveId = liveIdRef.current
    if (!liveId) {
      return
    }
    try {
      const result = await port.sessions.interrupt(liveId)
      if (result?.status && result.status !== 'interrupted') {
        // `{status:'not_interrupted'}`: there was no live turn to stop. Saying so
        // is better than a Stop that silently does nothing.
        dispatch({ type: 'error/raised', message: 'There was no running turn to stop.' })
      }
    } catch (err) {
      dispatch({ type: 'error/raised', message: userMessage(err) })
    }
  }, [port])

  const answerClarify = useCallback(
    async (requestId: string, answers: Record<string, string>) => {
      const liveId = liveIdRef.current
      if (!liveId) {
        return
      }
      const card = stateRef.current.items.find(i => i.kind === 'clarify' && i.requestId === requestId)
      const questions = card?.kind === 'clarify' ? card.questions : []
      try {
        if (questions.length > 1) {
          for (const q of questions) {
            await port.sessions.respondClarify({ session_id: liveId, request_id: requestId, question_id: q.qid, answer: answers[q.qid] ?? '' })
          }
        } else {
          const only = questions[0]?.qid ?? 'q0'
          await port.sessions.respondClarify({ session_id: liveId, request_id: requestId, answer: answers[only] ?? Object.values(answers)[0] ?? '' })
        }
      } catch (err) {
        // A mid-loop failure leaves the earlier answers locked in server-side, so
        // the card must stay open and say what happened instead of looking answered.
        dispatch({ type: 'clarify/failed', requestId, message: userMessage(err) })
        return
      }
      dispatch({ type: 'clarify/responded', requestId, answers })
    },
    [port]
  )

  const dismissClarify = useCallback(
    async (requestId: string, freeText: string) => {
      const liveId = liveIdRef.current
      if (!liveId) {
        return
      }
      try {
        // Free text answers the question and marks the card dismissed (FR-121).
        await port.sessions.respondClarify({ session_id: liveId, request_id: requestId, answer: freeText })
      } catch (err) {
        dispatch({ type: 'clarify/failed', requestId, message: userMessage(err) })
        return
      }
      dispatch({ type: 'clarify/dismissed', requestId })
    },
    [port]
  )

  const answerApproval = useCallback(
    async (requestId: string, choice: ApprovalChoice) => {
      const liveId = liveIdRef.current
      if (!liveId) {
        return
      }
      try {
        await port.sessions.respondApproval({ session_id: liveId, request_id: requestId, choice })
      } catch (err) {
        dispatch({ type: 'error/raised', message: userMessage(err) })
        return
      }
      dispatch({ type: 'approval/responded', requestId, choice })
    },
    [port]
  )

  const clearError = useCallback(() => dispatch({ type: 'error/cleared' }), [])

  return {
    state,
    phase,
    openError,
    connectionError: failure?.message ?? null,
    needsReauth: failure?.terminal === true,
    send,
    retry,
    stop,
    answerClarify,
    dismissClarify,
    answerApproval,
    refetchHistory,
    dispatchReconciled,
    devInjectEvent,
    reconnect,
    clearError
  }
}
