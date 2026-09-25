/**
 * Outbox state machine for composer messages (docs/05 section 5).
 * Pure functions; the device store persists the items.
 */

export type OutboxStatus = 'draft' | 'queued_unsent' | 'submitting' | 'acknowledged' | 'unconfirmed' | 'failed'

export interface OutboxItem {
  localId: string
  connectionId: string
  profile: string
  text: string
  createdAt: number
  status: OutboxStatus
  error?: string
  /** Number of deliberate user retries; informational. */
  attempts?: number
}

export const UNSENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function pressSend(item: OutboxItem, online: boolean): OutboxItem {
  if (item.status !== 'draft') {
    return item
  }
  return { ...item, status: online ? 'submitting' : 'queued_unsent', error: undefined }
}

/** Authenticated reconnect: only items that were never submitted may go out automatically. */
export function reconnect(item: OutboxItem): OutboxItem {
  return item.status === 'queued_unsent' ? { ...item, status: 'submitting' } : item
}

/** App restart: a submission whose outcome is unknown must never be re-sent automatically. */
export function recoverAfterRestart(item: OutboxItem): OutboxItem {
  return item.status === 'submitting' ? { ...item, status: 'unconfirmed' } : item
}

export type SubmitOutcome = { ok: true } | { ok: false; definite: boolean; error: string }

export function submitResult(item: OutboxItem, outcome: SubmitOutcome): OutboxItem {
  if (item.status !== 'submitting') {
    return item
  }
  if (outcome.ok) {
    return { ...item, status: 'acknowledged', error: undefined }
  }
  return outcome.definite
    ? { ...item, status: 'failed', error: outcome.error }
    : { ...item, status: 'unconfirmed', error: outcome.error }
}

/** The user inspected history and chose to send again. */
export function userRetry(item: OutboxItem): OutboxItem {
  if (item.status !== 'unconfirmed' && item.status !== 'failed') {
    return item
  }
  return { ...item, status: 'draft', error: undefined, attempts: (item.attempts ?? 0) + 1 }
}

export function isUnsent(item: OutboxItem): boolean {
  return item.status !== 'acknowledged'
}

export function expired(item: OutboxItem, now: number): boolean {
  return isUnsent(item) && now - item.createdAt > UNSENT_RETENTION_MS
}
