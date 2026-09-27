import { describe, expect, it } from 'vitest'

import { enqueue, markSending, markSent, nextQueued, pendingValues, recoverOrgOutbox, removeItem, requeue, settle, type OrgChange, type OrgOutboxItem } from './org-outbox'

function ids() {
  let n = 0
  return () => `o${++n}`
}

const pinLinh: OrgChange = { profile: 'linh', field: 'pinned', pinned: true }
const moveLinh: OrgChange = { profile: 'linh', field: 'section', sectionId: 'prive', sectionName: 'Prive' }
const pinKevin: OrgChange = { profile: 'kevin', field: 'pinned', pinned: true }

describe('the organization outbox', () => {
  it('queues changes in the order they were made', () => {
    const outbox = enqueue([], [pinLinh, moveLinh, pinKevin], ids())
    expect(outbox.map(item => [item.id, item.profile, item.field, item.status])).toEqual([
      ['o1', 'linh', 'pinned', 'queued'],
      ['o2', 'linh', 'section', 'queued'],
      ['o3', 'kevin', 'pinned', 'queued']
    ])
  })

  it('keeps one item per agent and field: a newer change replaces the older one and goes to the end', () => {
    const next = ids()
    const first = enqueue([], [pinLinh, pinKevin], next)
    const sending = markSending(first, 'o1')
    const outbox = enqueue(sending, [{ profile: 'linh', field: 'pinned', pinned: false }], next)
    expect(outbox.map(item => [item.id, item.profile, item.status])).toEqual([
      ['o2', 'kevin', 'queued'],
      ['o3', 'linh', 'queued']
    ])
    expect(pendingValues(outbox).linh).toEqual({ pinned: false })
  })

  it('shows the value of each queued field, whatever the item status', () => {
    const outbox = markSent(enqueue([], [pinLinh, moveLinh], ids()), 'o1', 8)
    expect(pendingValues(outbox)).toEqual({ linh: { pinned: true, section: { sectionId: 'prive', sectionName: 'Prive' } } })
    expect(pendingValues([])).toEqual({})
  })

  it('hands out the oldest queued item, skipping the ones on the wire or sent', () => {
    const outbox = markSent(markSending(enqueue([], [pinLinh, moveLinh, pinKevin], ids()), 'o1'), 'o2', 4)
    expect(nextQueued(outbox)?.id).toBe('o3')
    expect(nextQueued(markSending(outbox, 'o3'))).toBeUndefined()
  })

  it('moves an item through sending and sent, back to queued when the connection was lost, and out when refused', () => {
    const outbox = enqueue([], [pinLinh], ids())
    expect(markSending(outbox, 'o1')[0].status).toBe('sending')
    expect(markSent(markSending(outbox, 'o1'), 'o1', 9)[0]).toMatchObject({ status: 'sent', revision: 9 })
    expect(requeue(markSending(outbox, 'o1'), 'o1')[0].status).toBe('queued')
    expect(removeItem(outbox, 'o1')).toEqual([])
  })

  it('returns the same list when an id is unknown', () => {
    const outbox = enqueue([], [pinLinh], ids())
    expect(markSending(outbox, 'x')).toBe(outbox)
    expect(markSent(outbox, 'x', 1)).toBe(outbox)
    expect(requeue(outbox, 'x')).toBe(outbox)
    expect(removeItem(outbox, 'x')).toBe(outbox)
    expect(enqueue(outbox, [], ids())).toBe(outbox)
  })

  it('keeps a sent item until a roster read shows its revision or a later one', () => {
    const outbox = markSent(enqueue([], [pinLinh], ids()), 'o1', 8)
    const stale = [{ profile: 'linh', revision: 7 }]
    expect(settle(outbox, stale)).toBe(outbox)
    expect(settle(outbox, [{ profile: 'linh' }])).toBe(outbox)
    expect(settle(outbox, [{ profile: 'linh', revision: 8 }])).toEqual([])
    expect(settle(outbox, [{ profile: 'linh', revision: 11 }])).toEqual([])
  })

  it('keeps queued items through a roster read, and drops the items of an agent Hermes no longer has unless one is on the wire', () => {
    const outbox: OrgOutboxItem[] = markSending(enqueue([], [pinLinh, pinKevin, moveLinh], ids()), 'o3')
    expect(settle(outbox, [{ profile: 'linh', revision: 3 }, { profile: 'kevin', revision: 1 }])).toBe(outbox)
    expect(settle(outbox, [{ profile: 'kevin', revision: 1 }]).map(item => item.id)).toEqual(['o2', 'o3'])
  })

  it('sends a write again after a restart when its answer never came', () => {
    const outbox = markSent(markSending(enqueue([], [pinLinh, pinKevin], ids()), 'o1'), 'o2', 5)
    expect(recoverOrgOutbox(outbox).map(item => item.status)).toEqual(['queued', 'sent'])
    const quiet = enqueue([], [pinLinh], ids())
    expect(recoverOrgOutbox(quiet)).toBe(quiet)
  })
})
