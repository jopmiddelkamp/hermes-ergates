import { describe, expect, it } from 'vitest'

import { markSent } from './org-outbox'
import { firstSyncChanges, organize, sharedChanges, sharedView, syncWithHermes, UNTITLED_SECTION } from './org-sync'
import { deriveHome, emptyOrganization, orgActions, type BotRow, type Organization } from './organization'

function ids() {
  let n = 0
  return () => `o${++n}`
}

/** An organization that has already been through its first sync. */
function synced(patch: Partial<Organization> = {}): Organization {
  return { ...emptyOrganization(), firstSync: 'done', ...patch }
}

const prive = { id: 'prive', name: 'Prive', collapsed: false, order: 0 }
const work = { id: 'work', name: 'Work', collapsed: true, order: 1 }

/** Linh and Kevin are pinned in Hermes, Mia is in Prive, Noor has no metadata yet. */
const rows: BotRow[] = [
  { profile: 'linh', hidden: false, lastActivityAt: 300, pinned: true, sectionId: 'prive', sectionName: 'Prive', revision: 3 },
  { profile: 'kevin', hidden: false, lastActivityAt: 200, pinned: true, sectionId: null, revision: 1 },
  { profile: 'mia', hidden: false, lastActivityAt: 500, pinned: false, sectionId: 'prive', sectionName: 'Prive', revision: 2 },
  { profile: 'noor', hidden: false, lastActivityAt: 100 }
]

describe('reading pins and sections from Hermes', () => {
  it('pins exactly the agents Hermes marks pinned, in the pin order of this phone', () => {
    const view = sharedView(synced({ pins: ['kevin', 'noor', 'linh'] }), rows)
    expect(view.pins).toEqual(['kevin', 'linh'])
  })

  it('adds a pinned agent this phone does not order yet at the end, latest activity first, and drops a pin Hermes no longer has', () => {
    const pinnedElsewhere = rows.map(row => (row.profile === 'mia' || row.profile === 'noor' ? { ...row, pinned: true } : row))
    const view = sharedView(synced({ pins: ['ghost', 'kevin'] }), pinnedElsewhere)
    expect(view.pins).toEqual(['kevin', 'mia', 'linh', 'noor'])
  })

  it('puts each agent in the section Hermes names; a missing or null section is No section', () => {
    const view = sharedView(synced({ sections: [prive], membership: { kevin: 'prive', noor: 'prive' } }), rows)
    expect(view.membership).toEqual({ linh: 'prive', mia: 'prive' })
  })

  it('keeps the sections of this phone, empty ones too, and adds a section only Hermes knows at the end', () => {
    const named = [...rows, { profile: 'otto', hidden: false, lastActivityAt: 50, sectionId: 'sec-clients', sectionName: 'Clients' }]
    const unnamed = [...named, { profile: 'pim', hidden: false, lastActivityAt: 40, sectionId: 'sec-old' }, { profile: 'ada', hidden: false, lastActivityAt: 30, sectionId: 'sec-old', sectionName: '' }]
    const view = sharedView(synced({ sections: [work] }), unnamed)
    expect(view.sections).toEqual([
      work,
      { id: 'prive', name: 'Prive', collapsed: false, order: 2 },
      { id: 'sec-clients', name: 'Clients', collapsed: false, order: 3 },
      { id: 'sec-old', name: UNTITLED_SECTION, collapsed: false, order: 4 }
    ])
  })

  it('shows a queued change instead of what Hermes has, until the change leaves the outbox', () => {
    const org = synced({
      sections: [prive],
      pins: ['kevin', 'linh'],
      outbox: [
        { id: 'o1', profile: 'linh', field: 'pinned', pinned: false, status: 'queued' },
        { id: 'o2', profile: 'noor', field: 'section', sectionId: 'prive', sectionName: 'Prive', status: 'sending' },
        { id: 'o3', profile: 'mia', field: 'section', sectionId: null, sectionName: null, status: 'sent', revision: 3 }
      ]
    })
    const view = sharedView(org, rows)
    expect(view.pins).toEqual(['kevin'])
    expect(view.membership).toEqual({ linh: 'prive', noor: 'prive' })
    expect(deriveHome(rows, view)).toEqual({ pinned: ['kevin'], ungrouped: ['mia'], sections: [{ section: prive, rows: ['linh', 'noor'] }] })
  })
})

describe('organizing through the outbox', () => {
  const view = (org: Organization) => sharedView(org, rows)
  const base = synced({ sections: [prive], pins: ['linh', 'kevin'], rowOrder: ['linh', 'kevin', 'mia', 'noor'] })

  it('queues pinned for each agent a Pin or Unpin changes, and keeps the pin order on this phone', () => {
    const pinned = organize(base, rows, org => orgActions.pinMany(org, ['noor', 'linh', 'mia']), ids())
    expect(pinned.pins).toEqual(['linh', 'kevin', 'noor', 'mia'])
    expect(pinned.outbox.map(item => [item.profile, item.field, item.field === 'pinned' && item.pinned])).toEqual([
      ['mia', 'pinned', true],
      ['noor', 'pinned', true]
    ])
    const unpinned = organize(pinned, rows, org => orgActions.unpinMany(org, ['kevin']), ids())
    expect(view(unpinned).pins).toEqual(['linh', 'noor', 'mia'])
    expect(unpinned.outbox.at(-1)).toMatchObject({ profile: 'kevin', field: 'pinned', pinned: false, status: 'queued' })
  })

  it('queues the section id and name of each moved agent, and keeps the row order on this phone', () => {
    const moved = organize(base, rows, org => orgActions.moveRowsToSection(org, ['kevin', 'noor', 'mia'], 'prive'), ids())
    expect(moved.rowOrder).toEqual(['linh', 'mia', 'kevin', 'noor'])
    expect(moved.outbox).toEqual([
      { id: 'o1', profile: 'kevin', field: 'section', sectionId: 'prive', sectionName: 'Prive', status: 'queued' },
      { id: 'o2', profile: 'noor', field: 'section', sectionId: 'prive', sectionName: 'Prive', status: 'queued' }
    ])
    expect(moved.membership).toEqual({})
  })

  it('stores a new section here and queues its id and name on the agents moved into it', () => {
    const section = { id: 's-new', name: 'Clients', collapsed: false, order: 1 }
    const created = organize(base, rows, org => orgActions.moveRowsToSection(orgActions.createSection(org, section), ['noor'], section.id), ids())
    expect(created.sections).toEqual([prive, section])
    expect(created.outbox).toEqual([{ id: 'o1', profile: 'noor', field: 'section', sectionId: 's-new', sectionName: 'Clients', status: 'queued' }])
  })

  it('renaming a section queues the new name on every member, pinned and hidden ones too', () => {
    const withHidden = [...rows, { profile: 'ghost', hidden: true, lastActivityAt: 999, sectionId: 'prive', sectionName: 'Prive' }]
    const renamed = organize(base, withHidden, org => orgActions.renameSection(org, 'prive', 'Private'), ids())
    expect(renamed.sections).toEqual([{ ...prive, name: 'Private' }])
    expect(renamed.outbox.map(item => item.field === 'section' && [item.profile, item.sectionId, item.sectionName])).toEqual([
      ['linh', 'prive', 'Private'],
      ['mia', 'prive', 'Private'],
      ['ghost', 'prive', 'Private']
    ])
  })

  it('deleting a section queues No section on every member and removes it from this phone', () => {
    const deleted = organize(base, rows, org => orgActions.deleteSection(org, 'prive'), ids())
    expect(deleted.sections).toEqual([])
    expect(deleted.outbox.map(item => item.field === 'section' && [item.profile, item.sectionId, item.sectionName])).toEqual([
      ['linh', null, null],
      ['mia', null, null]
    ])
    expect(deleted.pins).toEqual(['linh', 'kevin'])
  })

  it('keeps reordering rows, pins and sections and collapsing on this phone, and queues nothing for them', () => {
    const withWork = synced({ ...base, sections: [prive, work] })
    let org = organize(withWork, rows, next => orgActions.applyMove(next, { kind: 'row', profile: 'noor', sectionId: null, before: 'kevin' }), ids())
    org = organize(org, rows, next => orgActions.applyMove(next, { kind: 'pin', profile: 'kevin', before: 'linh' }), ids())
    org = organize(org, rows, next => orgActions.applyMove(next, { kind: 'section', sectionId: 'work', before: 'prive' }), ids())
    org = organize(org, rows, next => orgActions.toggleCollapsed(next, 'prive'), ids())
    expect(org.rowOrder).toEqual(['linh', 'noor', 'kevin', 'mia'])
    expect(org.pins).toEqual(['kevin', 'linh'])
    expect(org.sections.map(s => [s.id, s.order, s.collapsed])).toEqual([
      ['work', 0, true],
      ['prive', 1, true]
    ])
    expect(org.outbox).toEqual([])
  })

  it('a row dropped into another section queues its move like Move to', () => {
    const org = organize(base, rows, next => orgActions.applyMove(next, { kind: 'row', profile: 'noor', sectionId: 'prive', before: 'mia' }), ids())
    expect(org.outbox).toEqual([{ id: 'o1', profile: 'noor', field: 'section', sectionId: 'prive', sectionName: 'Prive', status: 'queued' }])
  })

  it('returns the same organization when the action changes nothing, and a newer change replaces a queued one', () => {
    expect(organize(base, rows, org => orgActions.pin(org, 'linh'), ids())).toBe(base)
    const next = ids()
    const twice = organize(organize(base, rows, org => orgActions.pin(org, 'noor'), next), rows, org => orgActions.unpin(org, 'noor'), next)
    expect(twice.outbox).toEqual([{ id: 'o2', profile: 'noor', field: 'pinned', pinned: false, status: 'queued' }])
  })

  it('names only the fields that changed, per agent', () => {
    const before = sharedView(base, rows)
    const after = orgActions.moveRowsToSection(orgActions.unpin(before, 'linh'), ['linh'], null)
    expect(sharedChanges(before, after, ['linh', 'kevin'])).toEqual([
      { profile: 'linh', field: 'pinned', pinned: false },
      { profile: 'linh', field: 'section', sectionId: null, sectionName: null }
    ])
  })
})

describe('syncing with every roster read', () => {
  it('records new agents, the pin order and the sections only Hermes knows, then returns the same organization', () => {
    const org = synced({ pins: ['kevin'], rowOrder: ['kevin'] })
    const next = syncWithHermes(org, rows, ids())
    expect(next.rowOrder).toEqual(['mia', 'linh', 'noor', 'kevin'])
    expect(next.pins).toEqual(['kevin', 'linh'])
    expect(next.sections).toEqual([{ id: 'prive', name: 'Prive', collapsed: false, order: 0 }])
    expect(syncWithHermes(next, rows, ids())).toBe(next)
  })

  it('drops a sent change once Hermes shows it, and keeps it while the roster read is older than the write', () => {
    const org = syncWithHermes(synced(), rows, ids())
    const sent = { ...org, outbox: markSent([{ id: 'o1', profile: 'noor', field: 'pinned', pinned: true, status: 'queued' }], 'o1', 1) }
    expect(syncWithHermes(sent, rows, ids()).outbox).toHaveLength(1)
    expect(sharedView(syncWithHermes(sent, rows, ids()), rows).pins).toContain('noor')
    const caughtUp = rows.map(row => (row.profile === 'noor' ? { ...row, pinned: true, revision: 1 } : row))
    const settled = syncWithHermes(sent, caughtUp, ids())
    expect(settled.outbox).toEqual([])
    expect(settled.pins).toContain('noor')
  })

  it('pins the concierge once on a new install when Hermes has no pinned value for it', () => {
    const concierge = { profile: 'default', hidden: false, lastActivityAt: 10, isDefault: true }
    const next = syncWithHermes(undefined, [concierge, ...rows], ids())
    expect(next.firstSync).toBe('done')
    expect(next.outbox).toEqual([{ id: 'o1', profile: 'default', field: 'pinned', pinned: true, status: 'queued' }])
    expect(next.pins).toEqual(['linh', 'kevin', 'default'])
    expect(deriveHome([concierge, ...rows], sharedView(next, [concierge, ...rows])).pinned).toEqual(['default', 'linh', 'kevin'])
  })

  it('never changes a concierge pinned value Hermes already has, not pinned included', () => {
    const concierge = { profile: 'default', hidden: false, lastActivityAt: 10, isDefault: true, pinned: false }
    expect(syncWithHermes(undefined, [concierge], ids()).outbox).toEqual([])
    expect(firstSyncChanges(emptyOrganization(), [{ ...concierge, pinned: true }])).toEqual([])
  })

  it('on the first start after the update, writes local pins and sections only where Hermes has no value, once', () => {
    const local: Organization = {
      ...emptyOrganization(),
      firstSync: 'update',
      pins: ['noor', 'mia', 'kevin'],
      sections: [prive, work],
      membership: { noor: 'work', kevin: 'work', linh: 'work' }
    }
    const hermes: BotRow[] = [...rows, { profile: 'otto', hidden: false, lastActivityAt: 1 }]
    const next = syncWithHermes(local, hermes, ids())
    expect(next.outbox).toEqual([
      { id: 'o1', profile: 'noor', field: 'pinned', pinned: true, status: 'queued' },
      { id: 'o2', profile: 'noor', field: 'section', sectionId: 'work', sectionName: 'Work', status: 'queued' }
    ])
    expect(next.membership).toEqual({})
    expect(next.firstSync).toBe('done')
    expect(syncWithHermes(next, hermes, ids()).outbox).toBe(next.outbox)
  })
})
