/**
 * One chat session, shared by every `chat/[profile]/*` route.
 *
 * The chat, Activity and the read-only transcript must read the same socket
 * session, the same REST transcript window and the same timeline: mounting
 * `useSession`/`useTranscriptWindow` per screen would open a second chat and a
 * second window (and Activity, a modal above the chat, would keep both alive).
 * This provider calls them once, at `app/chat/[profile]/_layout.tsx`, and every
 * screen underneath reads the result through `useChatSession()`.
 *
 * A React adapter (ADR-029 rule 2): the rules live in `timeline.ts`,
 * `exchange.ts` and `window.ts`, which are pure and tested in Node. Nothing
 * here decides what a line says.
 */

import React, { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'

import { useAvatar, useRoster, type Bot } from '@/features/agents/roster'
import type { GatewayPort } from '@/gateway/port'
import { useGateway } from '@/gateway/registry'
import { useDeviceStore } from '@/state/device-store'

import { assembleTimeline, type ActivityEntry, type TimelineInput, type TimelineResult } from './agent-traffic/timeline'
import type { RosterPeer } from './agent-traffic/types'
import { useTranscriptWindow, type TranscriptController } from './agent-traffic/use-transcript'
import type { LiveTurn } from './session-reducer'
import { useSession, type UseSessionResult } from './use-session'

export interface ChatSessionValue {
  connectionId: string
  profile: string
  port: GatewayPort
  bot: Bot | undefined
  /** The bot's display name, falling back to the profile id before the roster arrives. */
  name: string
  avatarUri: string | null
  roster: RosterPeer[]
  session: UseSessionResult
  transcript: TranscriptController
  timeline: TimelineResult
  activity: ActivityEntry[]
}

const ChatSessionContext = createContext<ChatSessionValue | null>(null)

export interface ChatSessionProviderProps {
  connectionId: string
  profile: string
  children: ReactNode
}

export function ChatSessionProvider({ connectionId, profile, children }: ChatSessionProviderProps) {
  // Guarded by `app/chat/[profile]/_layout.tsx`, which shows a spinner until a
  // connection exists.
  const connection = useDeviceStore(s => s.connections.find(c => c.id === connectionId))!
  const gateway = useGateway(connection)
  const rosterQuery = useRoster(gateway, connectionId)
  const bot = rosterQuery.data?.find(b => b.profile === profile)
  const avatar = useAvatar(gateway, connectionId, profile, Boolean(bot?.hasAvatar))
  const name = bot?.name ?? profile
  const session = useSession(gateway, profile, bot?.summary, { enabled: rosterQuery.isSuccess || rosterQuery.isError, connectionId })

  // The pure modules take only the roster slice they need; memoized on the
  // query data so a refetch that changes nothing does not rebuild the timeline.
  const roster = useMemo<RosterPeer[]>(
    () => (rosterQuery.data ?? []).map(b => ({ profile: b.profile, name: b.name, color: b.color, hasAvatar: b.hasAvatar })),
    [rosterQuery.data]
  )

  const transcript = useTranscriptWindow(gateway, {
    enabled: session.phase === 'ready',
    connectionId,
    profile,
    storedSessionId: session.state.storedSessionId,
    liveSessionId: session.state.liveSessionId,
    epoch: session.state.replay.epoch,
    revision: session.state.revision,
    tailWanted: session.state.tailWanted,
    items: session.state.items,
    roster,
    onReconciled: session.dispatchReconciled
  })

  const { items, live, inflightError, idleSnapshot } = session.state
  const window = transcript.window

  // Device-local acknowledgements (ADR-028); a stable empty list keeps the memo below from rebuilding
  // the timeline every render when nothing has been acknowledged yet.
  const acknowledged = useDeviceStore(s => s.organization[connectionId]?.exchangeAcks[profile])
  const acknowledgedList = useMemo(() => acknowledged ?? [], [acknowledged])

  /**
   * `assemble` reads four things out of the live turn: `streaming`,
   * `statusLine`, `reasoningText`, and whether `assistantText` is empty (it
   * chooses the streaming bubble over the working line, never the text). The
   * reducer hands back a fresh `live` object on every streamed delta, so keying
   * the timeline memo on it would re-walk the whole chat per token. This view
   * changes identity only when one of those four values changes; the real
   * `assistantText` (and the fields `assemble` does not read) ride along,
   * always read from the current render.
   */
  const liveRef = useRef(live)
  liveRef.current = live
  const hasAssistantText = Boolean(live.assistantText)
  const liveView = useMemo<LiveTurn>(
    () => ({
      streaming: live.streaming,
      statusLine: live.statusLine,
      reasoningText: live.reasoningText,
      assistantText: liveRef.current.assistantText,
      ownership: liveRef.current.ownership,
      turnStartedAt: liveRef.current.turnStartedAt
    }),
    // `hasAssistantText`, not the text: the text itself changes nothing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live.streaming, live.statusLine, live.reasoningText, hasAssistantText]
  )

  // One input, one assembly: the lines and the Activity entries are two views of
  // the same walk and must never disagree about their input (or cost two walks).
  const input = useMemo<TimelineInput>(
    () => ({
      items,
      rows: window.rows,
      window: { loaded: window.loaded, oldestLoadedRowId: window.oldestLoadedRowId, reachedStart: window.reachedStart, error: window.error },
      roster,
      selfProfile: profile,
      selfName: name,
      live: liveView,
      inflightError,
      idleConfirmed: idleSnapshot.confirmed,
      acknowledged: acknowledgedList
    }),
    [items, window, roster, profile, name, liveView, inflightError, idleSnapshot.confirmed, acknowledgedList]
  )

  const { timeline, activity } = useMemo(() => assembleTimeline(input), [input])

  const avatarUri = avatar.data ?? null
  const value = useMemo<ChatSessionValue>(
    () => ({ connectionId, profile, port: gateway, bot, name, avatarUri, roster, session, transcript, timeline, activity }),
    [connectionId, profile, gateway, bot, name, avatarUri, roster, session, transcript, timeline, activity]
  )

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
}

export function useChatSession(): ChatSessionValue {
  const value = useContext(ChatSessionContext)
  if (!value) {
    throw new Error('ChatSessionProvider is missing above this component.')
  }
  return value
}
