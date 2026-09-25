/**
 * Pure types for bot-to-bot traffic in chat (docs/superpowers/specs/2026-09-14-agent-traffic-design.md
 * sections 4.2-4.3). No React or React Native imports (ADR-029 rule 1).
 */

/** Delivery, worker and reply are independent properties of one exchange (spec 4.3). */
export type Delivery = 'unknown' | 'admitted' | 'queued' | 'claimed' | 'settled' | 'refused' | 'failed' | 'cancelled'

export type Worker =
  | { kind: 'not_observed' }
  | { kind: 'running' }
  | { kind: 'exited'; code: number | 'unknown' }
  | { kind: 'lost' }
  | { kind: 'terminated'; by?: string }
  | { kind: 'failed_start' }

export type Reply =
  | { kind: 'none' }
  | { kind: 'text'; body: string; completeness: 'complete' | 'unknown' }
  | { kind: 'empty' }
  | { kind: 'excerpt'; body: string }
  | { kind: 'damaged' }

export interface ExchangeState {
  delivery: Delivery
  worker: Worker
  reply: Reply
  latestOutcomeUnavailable: boolean
}

/** A message-agent peer, resolved against the local roster when possible (spec 4.2). */
export interface PeerRef {
  handle: string
  /** Local roster profile when resolved. */
  profile?: string
  remote?: { peer: string; agent?: string }
  display: { name: string; color?: string; avatarProfile?: string }
}

/** The roster slice the agent-traffic rules need to resolve a `PeerRef`'s display. */
export interface RosterPeer {
  profile: string
  name: string
  color?: string
  hasAvatar: boolean
}

export type { TranscriptPage, TranscriptRow, TranscriptToolCall } from '@/gateway/types'
