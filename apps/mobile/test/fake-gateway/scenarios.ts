/**
 * runSession: a Node-only stand-in for the React parts of `useSession`, wired to
 * the SAME modules the hook uses — `openCanonicalChat`, `sessionReducer`,
 * `SendQueue` and `resyncSession` (ADR-029 rule 3). Only the React plumbing
 * (effects, refs, AppState) is replaced here; every rule under test lives in
 * shipped code.
 *
 * It follows the hook's ordering exactly: bind first, subscribe second, and
 * every transition back into `open` resynchronises with `session.activate`
 * before replaying.
 *
 * No React Native or Expo imports - this runs in Node under Vitest.
 */

import type { ConnectionState, GatewayConnection, GatewayPort } from '@/gateway/port'

import {
  AUTO_PAGE_BUDGET,
  FIRST_PAGE_LIMIT,
  TAIL_LIMIT,
  emptyWindow,
  mergePage,
  olderQuery,
  reconciledIds,
  tailOverlaps,
  tailQuery,
  type TranscriptWindow
} from '@/features/chat/agent-traffic/window'
import { openCanonicalChat } from '@/features/chat/canonical-chat'
import type { OutboxItem } from '@/features/chat/outbox'
import { SendQueue, type OutboxStore } from '@/features/chat/send-queue'
import { initialSessionState, sessionReducer, type SessionAction, type SessionState } from '@/features/chat/session-reducer'
import { HISTORY_STALE_ROUNDS, pendingCardActions, resyncSession } from '@/features/chat/session-sync'

export interface SessionDriver {
  dispatch: (action: SessionAction) => void
  getState: () => SessionState
  send: (text: string) => Promise<void>
  retry: (localId: string) => Promise<void>
  refetchHistory: () => Promise<void>
  /** The REST transcript window, as `use-transcript.ts` holds it in the Query cache. */
  transcript: () => TranscriptWindow
  /** Chat open: the latest page (spec 5.5). */
  fetchInitial: () => Promise<void>
  /** One tail run: `tailQuery(0)`, continuing backward until it reaches the loaded boundary (spec 5.8). */
  fetchTail: () => Promise<void>
  /** One page further back (spec 5.5). */
  fetchOlder: () => Promise<void>
  /** Rebind + replay, exactly what the hook does on a reconnect. */
  reconnect: () => Promise<void>
  /** Every resync the state watcher kicked off (drop -> open). */
  settled: () => Promise<void>
  outbox: () => OutboxItem[]
  liveSessionId: string
}

/** In-memory stand-in for the device store's outbox slice. */
export function memoryOutbox(): OutboxStore & { items: OutboxItem[] } {
  const items: OutboxItem[] = []
  return {
    items,
    list: () => [...items],
    add: item => {
      items.push(item)
    },
    update: (localId, patch) => {
      const index = items.findIndex(i => i.localId === localId)
      if (index >= 0) {
        items[index] = { ...items[index]!, ...patch }
      }
    },
    remove: localId => {
      const index = items.findIndex(i => i.localId === localId)
      if (index >= 0) {
        items.splice(index, 1)
      }
    }
  }
}

export interface RunSessionOptions {
  outbox?: OutboxStore
  connectionId?: string
  /** Pre-seed the outbox (restart recovery, an offline send from a previous run). */
  seed?: OutboxItem[]
  /** Start with the connection reported as offline (`press` must not submit). */
  online?: () => boolean
}

let localCounter = 0
const nextLocalId = () => `driver-${++localCounter}`

/** Connect, bind the canonical chat, and wire events/state the way `useSession` does. */
export async function runSession(port: GatewayPort, profile: string, options: RunSessionOptions = {}): Promise<SessionDriver> {
  let state = initialSessionState
  const dispatch = (action: SessionAction): void => {
    state = sessionReducer(state, action)
  }
  const getState = (): SessionState => state
  const outbox = options.outbox ?? memoryOutbox()
  for (const item of options.seed ?? []) {
    outbox.add(item)
  }

  const connection: GatewayConnection = await port.connect(profile)

  // Subscribe first but hold the frames: the reducer must not see a session-scoped
  // event before the session is bound (per-session seqs share one watermark).
  let bound = false
  const buffered: Parameters<Parameters<GatewayConnection['onEvent']>[0]>[0][] = []
  connection.onEvent(event => {
    if (!bound) {
      buffered.push(event)
      return
    }
    dispatch({ type: 'event', event })
  })

  const opened = await openCanonicalChat(port, profile)
  dispatch({ type: 'session/bound', liveSessionId: opened.liveSessionId, storedSessionId: opened.storedSessionId, epoch: connection.ready.replay_epoch ?? null })
  dispatch({ type: 'history/loaded', messages: opened.messages })
  dispatch({ type: 'history/refetched' })
  for (const action of pendingCardActions(opened.liveSessionId, opened.pending)) {
    dispatch(action)
  }
  bound = true
  for (const event of buffered.splice(0)) {
    dispatch({ type: 'event', event })
  }

  const online = options.online ?? (() => connection.state === 'open')
  const queue = new SendQueue({
    outbox,
    connectionId: options.connectionId ?? 'c-test',
    profile,
    submit: (text, opts) => port.sessions.submit(opened.liveSessionId, text, opts),
    dispatch,
    isOnline: online,
    isBusy: () => getState().live.streaming,
    newLocalId: nextLocalId
  })
  queue.restore()

  const reconnect = async (): Promise<void> => {
    await resyncSession({
      port,
      connection,
      liveSessionId: opened.liveSessionId,
      lastSeq: () => getState().replay.lastSeq,
      dispatch,
      sleep: async () => undefined
    })
    await queue.flush()
  }

  // The hook resynchronises on every transition back into `open`.
  const pending: Promise<void>[] = []
  let previous: ConnectionState | 'idle' = 'idle'
  connection.onState(s => {
    dispatch({ type: 'connection/state', state: s })
    const from = previous
    previous = s
    if (s === 'open' && from !== 'open' && from !== 'idle') {
      pending.push(reconnect())
    }
  })

  // Mirrors the hook: the flag is cleared only by a SUCCESSFUL load, so a failed
  // refetch leaves the recovery pending instead of silently abandoning it, and a
  // snapshot that went stale in flight is read again instead of being dropped.
  const refetchHistory = async (): Promise<void> => {
    for (let round = 0; round < HISTORY_STALE_ROUNDS; round += 1) {
      // Same capture-then-compare as the hook: a snapshot older than a settled
      // change is discarded rather than rolling it back (spec 5.8).
      const revision = getState().revision
      const result = await port.sessions.history(opened.liveSessionId)
      dispatch({ type: 'history/loaded', messages: result.messages, revision })
      if (getState().revision === revision) {
        dispatch({ type: 'history/refetched' })
        return
      }
    }
    throw new Error('The chat kept changing while it loaded.')
  }

  // The REST transcript window, driven through the same pure `window.ts` rules the
  // hook uses; only React's effects are missing, so a test asks for each fetch.
  let loadedWindow = emptyWindow()
  const fetchPage = async (query: { limit: number; offset: number; order: 'latest' }, kind: 'initial' | 'older' | 'tail') => {
    const page = await port.sessions.transcript(opened.storedSessionId, { profile, ...query })
    loadedWindow = mergePage(loadedWindow, page, kind)
    // Exactly what the hook does after every merged page (spec 5.8).
    dispatch({ type: 'transcript/reconciled', ...reconciledIds(page) })
    return page
  }

  return {
    dispatch,
    getState,
    send: text => queue.press(text),
    retry: localId => queue.retry(localId),
    refetchHistory,
    transcript: () => loadedWindow,
    fetchInitial: async () => {
      await fetchPage({ limit: FIRST_PAGE_LIMIT, offset: 0, order: 'latest' }, 'initial')
    },
    fetchTail: async () => {
      // The boundary is the window as it was BEFORE this run: merging a tail page
      // makes its own newest row the newest loaded one, which would make every
      // later page of the run look like an overlap (see `tailOverlaps`).
      const boundary = loadedWindow
      let offset = 0
      for (let pages = 0; pages < AUTO_PAGE_BUDGET; pages += 1) {
        const page = await fetchPage(tailQuery(offset), 'tail')
        if (tailOverlaps(boundary, page)) {
          return
        }
        offset += TAIL_LIMIT
      }
    },
    fetchOlder: async () => {
      await fetchPage(olderQuery(loadedWindow), 'older')
    },
    reconnect,
    settled: async () => {
      while (pending.length > 0) {
        await Promise.all(pending.splice(0))
      }
    },
    outbox: () => outbox.list(),
    liveSessionId: opened.liveSessionId
  }
}
