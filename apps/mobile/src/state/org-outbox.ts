/**
 * The organization outbox (docs/05 "Organization outbox"): pin and section
 * changes on their way to Hermes, as pure functions over a plain list the
 * device store keeps inside each connection's organization. Home shows a
 * change at once; the change waits here until Hermes has it, so it survives
 * being offline and an app restart.
 *
 * - One item per agent and field: a newer change to the same agent and field
 *   replaces the older one, wherever it was, and goes to the end.
 * - Items go out in the order they were made (`nextQueued`).
 * - A sent item stays until a roster read shows Hermes at (or past) the
 *   revision the write produced, so a roster answer that left Hermes before
 *   the write cannot undo it on screen (`settle`).
 */

/** One organizing change for one agent, as the fields Hermes Desktop reads in `ui_meta['hermes-bots']`. */
export type OrgChange =
  | { profile: string; field: 'pinned'; pinned: boolean }
  | { profile: string; field: 'section'; sectionId: string | null; sectionName: string | null }

/** `queued` waits to go out, `sending` is on the wire, `sent` waits for a roster read that shows it. */
export type OrgChangeStatus = 'queued' | 'sending' | 'sent'

export type OrgOutboxItem = OrgChange & {
  id: string
  status: OrgChangeStatus
  /** The `hermes-bots` revision Hermes answered with; set once the item is sent. */
  revision?: number
}

/** The values the outbox holds for one agent; a field without a change is absent. */
export interface PendingValues {
  pinned?: boolean
  section?: { sectionId: string | null; sectionName: string | null }
}

/** What `settle` needs from a roster read: every agent Hermes has, with its `hermes-bots` revision. */
export interface RosterRevision {
  profile: string
  revision?: number
}

const sameSlot = (a: OrgChange, b: OrgChange) => a.profile === b.profile && a.field === b.field

/** Queues the changes in order; each replaces an item for the same agent and field. */
export function enqueue(outbox: OrgOutboxItem[], changes: OrgChange[], newId: () => string): OrgOutboxItem[] {
  return changes.reduce<OrgOutboxItem[]>((list, change) => [...list.filter(item => !sameSlot(item, change)), { ...change, id: newId(), status: 'queued' }], outbox)
}

/** The value each agent shows while a change for it is in the outbox, by profile. */
export function pendingValues(outbox: OrgOutboxItem[]): Record<string, PendingValues> {
  const values: Record<string, PendingValues> = {}
  for (const item of outbox) {
    const entry = (values[item.profile] ??= {})
    if (item.field === 'pinned') {
      entry.pinned = item.pinned
    } else {
      entry.section = { sectionId: item.sectionId, sectionName: item.sectionName }
    }
  }
  return values
}

/** The oldest item still waiting to go out. */
export function nextQueued(outbox: OrgOutboxItem[]): OrgOutboxItem | undefined {
  return outbox.find(item => item.status === 'queued')
}

function withItem(outbox: OrgOutboxItem[], id: string, patch: (item: OrgOutboxItem) => OrgOutboxItem): OrgOutboxItem[] {
  return outbox.some(item => item.id === id) ? outbox.map(item => (item.id === id ? patch(item) : item)) : outbox
}

export function markSending(outbox: OrgOutboxItem[], id: string): OrgOutboxItem[] {
  return withItem(outbox, id, item => ({ ...item, status: 'sending' }))
}

export function markSent(outbox: OrgOutboxItem[], id: string, revision: number): OrgOutboxItem[] {
  return withItem(outbox, id, item => ({ ...item, status: 'sent', revision }))
}

/** A send that did not reach Hermes (no connection): the item waits for the next flush. */
export function requeue(outbox: OrgOutboxItem[], id: string): OrgOutboxItem[] {
  return withItem(outbox, id, item => ({ ...item, status: 'queued' }))
}

/** Removes the item: Hermes refused it, or its agent is gone. The agent then shows what Hermes has. */
export function removeItem(outbox: OrgOutboxItem[], id: string): OrgOutboxItem[] {
  return outbox.some(item => item.id === id) ? outbox.filter(item => item.id !== id) : outbox
}

/**
 * After a roster read: drops a sent item once Hermes shows its revision or a
 * later one, and drops every item (except one on the wire) whose agent Hermes
 * no longer has. Returns the same list when nothing is dropped.
 */
export function settle(outbox: OrgOutboxItem[], roster: RosterRevision[]): OrgOutboxItem[] {
  const revisions = new Map(roster.map(row => [row.profile, row.revision ?? 0]))
  const keep = (item: OrgOutboxItem) => {
    if (item.status === 'sending') {
      return true
    }
    const revision = revisions.get(item.profile)
    if (revision === undefined) {
      return false
    }
    return item.status !== 'sent' || revision < (item.revision ?? 0)
  }
  return outbox.every(keep) ? outbox : outbox.filter(keep)
}

/** App restart: a write whose answer never came goes out again (a repeat of the same values is harmless). */
export function recoverOrgOutbox(outbox: OrgOutboxItem[]): OrgOutboxItem[] {
  return outbox.some(item => item.status === 'sending') ? outbox.map(item => (item.status === 'sending' ? { ...item, status: 'queued' } : item)) : outbox
}
