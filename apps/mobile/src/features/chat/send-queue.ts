/**
 * The composer's send path, wired to the durable outbox (docs/05 section 5, ADR-027).
 *
 * Rules this enforces, in one place, for both the hook and the scenario tests:
 *  - Send with no connection never reaches the wire: it becomes `queued_unsent`
 *    and goes out automatically on the next authenticated reconnect (`flush`).
 *  - `prompt.submit` is sent exactly once per attempt. A timeout or network
 *    failure is `unconfirmed` — "we don't know" — and is only ever resent by a
 *    deliberate user action (`retry`).
 *  - An item the gateway accepted leaves the outbox; only unsent or uncertain
 *    items are persisted, so a restart has exactly the set it must reconcile.
 *  - The gateway's `prompt.submit` status decides what the bubble is: a busy
 *    send comes back `queued` (parked), or `redirected`/`steered` (it became a
 *    live correction, not a user turn).
 *  - A submit still in flight belongs to the process, not to one queue: a chat
 *    screen that remounts builds a new queue, which shows the item as
 *    `submitting` and applies its answer when it lands (`inFlight`).
 *
 * No React or React Native imports: the caller passes the store adapter in.
 */

import { isGatewayError, userMessage } from '@/gateway/errors'
import type { SubmitResult } from '@/gateway/types'

import { isUnsent, pressSend, reconnect as reconnectItem, submitResult, userRetry, type OutboxItem, type OutboxStatus } from '@/state/outbox'
import type { DeliveryState, SessionAction } from './session-reducer'

/** The device store's outbox, narrowed to what the queue needs. */
export interface OutboxStore {
  list(): OutboxItem[]
  add(item: OutboxItem): void
  update(localId: string, patch: Partial<OutboxItem>): void
  remove(localId: string): void
}

export interface SendQueueOptions {
  outbox: OutboxStore
  connectionId: string
  profile: string
  /** One `prompt.submit`. Never called more than once per attempt. */
  submit: (text: string, opts: { queued: boolean }) => Promise<SubmitResult>
  dispatch: (action: SessionAction) => void
  /** Is the session's socket open right now? */
  isOnline: () => boolean
  /** Is a turn running right now? A second send must queue, never interrupt. */
  isBusy?: () => boolean
  now?: () => number
  newLocalId?: () => string
}

/** How a persisted outbox status renders as a bubble after a restart. */
const RESTORED_DELIVERY: Record<OutboxStatus, DeliveryState> = {
  draft: 'queued_unsent',
  queued_unsent: 'queued_unsent',
  // `recoverAfterRestart` already turns a persisted `submitting` into
  // `unconfirmed`; this covers a store that skipped the merge.
  submitting: 'unconfirmed',
  acknowledged: 'acknowledged',
  unconfirmed: 'unconfirmed',
  failed: 'failed'
}

let counter = 0
const defaultLocalId = (): string => `${Date.now().toString(36)}-${++counter}`

/** How one `prompt.submit` attempt ended; every queue that shows the item applies it. */
type DeliveryOutcome =
  | { kind: 'acknowledged' }
  | { kind: 'queued' }
  | { kind: 'correction'; status: 'redirected' | 'steered' }
  | { kind: 'unconfirmed' }
  | { kind: 'failed'; message: string }

/**
 * The submits of this process still waiting for their answer, by local id.
 * The outbox says an item is `submitting`, but only this map says whether its
 * answer can still arrive: after an app restart it cannot, and the item is
 * unconfirmed (`recoverAfterRestart`).
 */
const inFlight = new Map<string, Promise<DeliveryOutcome>>()

export class SendQueue {
  private readonly options: SendQueueOptions
  private flushing = false

  constructor(options: SendQueueOptions) {
    this.options = options
  }

  private get now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** This connection+profile's persisted items, oldest first. */
  private mine(): OutboxItem[] {
    return this.options.outbox
      .list()
      .filter(i => i.connectionId === this.options.connectionId && i.profile === this.options.profile)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /**
   * Re-render the durable outbox as bubbles (app restart, chat re-open). A
   * submit another queue of this process still has in flight stays
   * `submitting`, and its answer is applied here too when it lands.
   */
  restore(): void {
    const unsent = this.mine().filter(isUnsent)
    const pending = unsent.filter(i => i.status === 'submitting' && inFlight.has(i.localId))
    const items = unsent.map(i => ({
      localId: i.localId,
      text: i.text,
      at: i.createdAt,
      delivery: pending.includes(i) ? ('submitting' as const) : RESTORED_DELIVERY[i.status]
    }))
    if (items.length > 0) {
      this.options.dispatch({ type: 'outbox/restored', items })
    }
    for (const item of pending) {
      void inFlight.get(item.localId)?.then(outcome => this.apply(item.localId, outcome))
    }
  }

  /** The user pressed Send. */
  async press(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    const localId = (this.options.newLocalId ?? defaultLocalId)()
    const draft: OutboxItem = {
      localId,
      connectionId: this.options.connectionId,
      profile: this.options.profile,
      text: trimmed,
      createdAt: this.now,
      status: 'draft'
    }
    const item = pressSend(draft, this.options.isOnline())
    this.options.outbox.add(item)
    this.options.dispatch({ type: 'submit/started', localId, text: trimmed, at: item.createdAt })
    if (item.status !== 'submitting') {
      this.options.dispatch({ type: 'submit/unsent', localId })
      return
    }
    await this.deliver(item)
  }

  /** A deliberate user retry of an unconfirmed or failed item (ADR-027: never automatic). */
  async retry(localId: string, fallbackText?: string): Promise<void> {
    const existing = this.mine().find(i => i.localId === localId)
    const base: OutboxItem =
      existing ??
      ({
        localId,
        connectionId: this.options.connectionId,
        profile: this.options.profile,
        text: fallbackText ?? '',
        createdAt: this.now,
        status: 'unconfirmed'
      } satisfies OutboxItem)
    if (!base.text.trim()) {
      return
    }
    const draft = userRetry(base)
    if (draft.status !== 'draft') {
      return
    }
    const item = pressSend(draft, this.options.isOnline())
    if (existing) {
      this.options.outbox.update(localId, { status: item.status, error: undefined, attempts: item.attempts })
    } else {
      this.options.outbox.add(item)
    }
    if (item.status !== 'submitting') {
      this.options.dispatch({ type: 'submit/unsent', localId })
      return
    }
    this.options.dispatch({ type: 'submit/retry', localId })
    await this.deliver(item)
  }

  /**
   * An authenticated reconnect: send the items that never left the device, in
   * order. Items that were already submitted are NOT resent — their outcome is
   * unknown and only the user may decide (ADR-027).
   *
   * Each item's status is read from the store again right before its send, not
   * from the list taken when the flush started: while an earlier send awaited
   * its answer, a re-opened chat's queue may have sent the item already. Only a
   * `queued_unsent` item goes out; a `submitting` one is in flight elsewhere.
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.options.isOnline()) {
      return
    }
    this.flushing = true
    try {
      for (const { localId } of this.mine()) {
        if (!this.options.isOnline()) {
          return
        }
        const stored = this.options.outbox.list().find(i => i.localId === localId)
        if (stored?.status !== 'queued_unsent') {
          continue
        }
        const item = reconnectItem(stored)
        this.options.outbox.update(item.localId, { status: 'submitting', error: undefined })
        this.options.dispatch({ type: 'submit/retry', localId: item.localId })
        await this.deliver(item)
      }
    } finally {
      this.flushing = false
    }
  }

  /** One `prompt.submit`, then show how it ended. */
  private async deliver(item: OutboxItem): Promise<void> {
    const attempt = this.submitOnce(item)
    inFlight.set(item.localId, attempt)
    try {
      this.apply(item.localId, await attempt)
    } finally {
      if (inFlight.get(item.localId) === attempt) {
        inFlight.delete(item.localId)
      }
    }
  }

  /** Sends, records the outcome in the outbox once, and never throws. */
  private async submitOnce(item: OutboxItem): Promise<DeliveryOutcome> {
    try {
      // A second message while a turn is running must never interrupt it:
      // `display.busy_input_mode` defaults to `interrupt`, which hard-kills the
      // live turn. `queued: true` forces the server's queue mode instead.
      // Another send of ours still waiting for its answer counts as a running
      // turn: the gateway handles one frame before it reads the next, so that
      // submit set the session running before this one arrives. On an idle
      // session the flag changes nothing.
      const anotherInFlight = this.mine().some(i => i.localId !== item.localId && inFlight.has(i.localId))
      const result = await this.options.submit(item.text, { queued: anotherInFlight || Boolean(this.options.isBusy?.()) })
      const status = String(result?.status ?? 'streaming')
      this.options.outbox.remove(item.localId)
      if (status === 'queued') {
        return { kind: 'queued' }
      }
      if (status === 'redirected' || status === 'steered') {
        return { kind: 'correction', status }
      }
      return { kind: 'acknowledged' }
    } catch (err) {
      const uncertain = isGatewayError(err) && (err.kind === 'timeout' || err.kind === 'network')
      const message = userMessage(err)
      const next = submitResult({ ...item, status: 'submitting' }, { ok: false, definite: !uncertain, error: message })
      this.options.outbox.update(item.localId, { status: next.status, error: next.error })
      return uncertain ? { kind: 'unconfirmed' } : { kind: 'failed', message }
    }
  }

  private apply(localId: string, outcome: DeliveryOutcome): void {
    switch (outcome.kind) {
      case 'queued':
        this.options.dispatch({ type: 'submit/queued', localId })
        return
      case 'correction':
        this.options.dispatch({ type: 'submit/correction', localId, status: outcome.status, at: this.now })
        return
      case 'unconfirmed':
        this.options.dispatch({ type: 'submit/unconfirmed', localId })
        return
      case 'failed':
        this.options.dispatch({ type: 'submit/failed', localId, message: outcome.message })
        return
      default:
        this.options.dispatch({ type: 'submit/acknowledged', localId })
    }
  }
}
