import { describe, expect, it } from 'vitest'

import { deriveHome, emptyOrganization, isUnread, memberSection, orgActions, type BotRow, type Organization } from './organization'

const emptyOrg = emptyOrganization

/** Linh and Kevin belong to Prive (10 section: "Home sections and pinned members"). */
function priveOrg(): Organization {
  return {
    ...emptyOrg(),
    sections: [{ id: 'prive', name: 'Prive', collapsed: false, order: 0 }],
    membership: { linh: 'prive', kevin: 'prive' }
  }
}

const rows: BotRow[] = [
  { profile: 'linh', hidden: false, lastActivityAt: 300 },
  { profile: 'kevin', hidden: false, lastActivityAt: 200 },
  { profile: 'mia', hidden: false, lastActivityAt: 500 },
  { profile: 'ghost', hidden: true, lastActivityAt: 999 }
]

describe('deriveHome', () => {
  it('puts pinned Prive members in the pinned area, excludes them from Prive, and never duplicates a row', () => {
    let org = priveOrg()
    org = orgActions.pin(org, 'linh')
    org = orgActions.pin(org, 'kevin')

    const layout = deriveHome(rows, org)

    expect(layout.pinned).toEqual(['linh', 'kevin'])
    const prive = layout.sections.find(s => s.section.id === 'prive')
    expect(prive?.rows).toEqual([])
    expect(layout.ungrouped).not.toContain('linh')
    expect(layout.ungrouped).not.toContain('kevin')

    const allProfiles = [...layout.pinned, ...layout.ungrouped, ...layout.sections.flatMap(s => s.rows)]
    expect(allProfiles.filter(p => p === 'linh')).toHaveLength(1)
    expect(allProfiles.filter(p => p === 'kevin')).toHaveLength(1)
  })

  it('renders membership of an unknown section as ungrouped so a bot never vanishes', () => {
    // Stored state can name a section that no longer exists. Without absorbing it
    // here the row is excluded from `ungrouped` (membership is non-null) AND from
    // every section (none matches), so the bot disappears from Home entirely.
    const org: Organization = { ...emptyOrg(), sections: [{ id: 'prive', name: 'Prive', collapsed: false, order: 0 }], membership: { linh: 'deleted-section', kevin: 'prive' } }

    const layout = deriveHome(rows, org)

    expect(layout.ungrouped).toContain('linh')
    expect(layout.sections.find(s => s.section.id === 'prive')?.rows).toEqual(['kevin'])
    const allProfiles = [...layout.pinned, ...layout.ungrouped, ...layout.sections.flatMap(s => s.rows)]
    expect(allProfiles.filter(p => p === 'linh')).toHaveLength(1)
  })

  it('keeps the Prive header even when every member is pinned', () => {
    let org = priveOrg()
    org = orgActions.pin(org, 'linh')
    org = orgActions.pin(org, 'kevin')

    const layout = deriveHome(rows, org)

    const prive = layout.sections.find(s => s.section.id === 'prive')
    expect(prive).toBeDefined()
    expect(prive?.section.name).toBe('Prive')
  })

  it('unpinning Linh returns her to Prive; re-pinning leaves her Prive membership unchanged', () => {
    let org = priveOrg()
    org = orgActions.pin(org, 'linh')
    org = orgActions.pin(org, 'kevin')

    const unpinned = orgActions.unpin(org, 'linh')
    const layoutAfterUnpin = deriveHome(rows, unpinned)
    expect(layoutAfterUnpin.pinned).toEqual(['kevin'])
    const prive = layoutAfterUnpin.sections.find(s => s.section.id === 'prive')
    expect(prive?.rows).toEqual(['linh'])

    const repinned = orgActions.pin(unpinned, 'linh')
    expect(repinned.membership.linh).toBe('prive')
    expect(repinned.pins).toContain('linh')
    const layoutAfterRepin = deriveHome(rows, repinned)
    expect(layoutAfterRepin.pinned).toContain('linh')
  })

  it('collapsing Prive marks the section collapsed without dropping pinned members or their data', () => {
    let org = priveOrg()
    org = orgActions.pin(org, 'linh')
    org = orgActions.pin(org, 'kevin')

    const collapsed = orgActions.toggleCollapsed(org, 'prive')
    const layout = deriveHome(rows, collapsed)

    const prive = layout.sections.find(s => s.section.id === 'prive')
    expect(prive?.section.collapsed).toBe(true)
    // Pinned avatars are never affected by collapse: both stay in the pinned area.
    expect(layout.pinned).toEqual(['linh', 'kevin'])
  })

  it('moving a pinned bot to another section preserves its pin', () => {
    let org = priveOrg()
    org = orgActions.pin(org, 'linh')
    org = orgActions.createSection(org, { id: 'work', name: 'Work', collapsed: false, order: 1 })

    const moved = orgActions.moveRowsToSection(org, ['linh'], 'work')

    expect(moved.pins).toContain('linh')
    expect(moved.membership.linh).toBe('work')
    const layout = deriveHome(rows, moved)
    expect(layout.pinned).toContain('linh')
    const work = layout.sections.find(s => s.section.id === 'work')
    expect(work?.rows).toEqual([])
  })

  it('removing Prive clears membership for its members while keeping their pins', () => {
    let org = priveOrg()
    org = orgActions.pin(org, 'linh')
    org = orgActions.pin(org, 'kevin')

    const removed = orgActions.removeSection(org, 'prive')

    expect(removed.sections.find(s => s.id === 'prive')).toBeUndefined()
    expect(removed.membership.linh).toBeNull()
    expect(removed.membership.kevin).toBeNull()
    expect(removed.pins).toEqual(['linh', 'kevin'])
  })

  it('hidden bots appear nowhere in the derived layout', () => {
    const layout = deriveHome(rows, priveOrg())
    const allProfiles = [...layout.pinned, ...layout.ungrouped, ...layout.sections.flatMap(s => s.rows)]
    expect(allProfiles).not.toContain('ghost')
  })

  it('shows rows the manual order does not know yet by lastActivityAt descending', () => {
    const orderedRows: BotRow[] = [
      { profile: 'a', hidden: false, lastActivityAt: 100 },
      { profile: 'b', hidden: false, lastActivityAt: 300 },
      { profile: 'c', hidden: false, lastActivityAt: 200 }
    ]
    const layout = deriveHome(orderedRows, emptyOrg())
    expect(layout.ungrouped).toEqual(['b', 'c', 'a'])
  })

  it('keeps pins in insertion order regardless of lastActivityAt', () => {
    const orderedRows: BotRow[] = [
      { profile: 'a', hidden: false, lastActivityAt: 100 },
      { profile: 'b', hidden: false, lastActivityAt: 300 }
    ]
    let org = emptyOrg()
    org = orgActions.pin(org, 'a')
    org = orgActions.pin(org, 'b')
    const layout = deriveHome(orderedRows, org)
    expect(layout.pinned).toEqual(['a', 'b'])
  })

  it('a pinned profile that no longer has a visible row is dropped from the pinned area', () => {
    let org = emptyOrg()
    org = orgActions.pin(org, 'ghost')
    const layout = deriveHome(rows, org)
    expect(layout.pinned).not.toContain('ghost')
  })
})

describe('orgActions', () => {
  it('pin/unpin are idempotent no-ops when already in that state', () => {
    let org = emptyOrg()
    org = orgActions.pin(org, 'linh')
    const pinnedAgain = orgActions.pin(org, 'linh')
    expect(pinnedAgain.pins).toEqual(['linh'])

    const unpinned = orgActions.unpin(org, 'linh')
    const unpinnedAgain = orgActions.unpin(unpinned, 'linh')
    expect(unpinnedAgain.pins).toEqual([])
  })

  it('createSection appends a new section and ignores a duplicate id', () => {
    let org = emptyOrg()
    org = orgActions.createSection(org, { id: 'prive', name: 'Prive', collapsed: false, order: 0 })
    expect(org.sections).toHaveLength(1)
    const duplicate = orgActions.createSection(org, { id: 'prive', name: 'Prive Again', collapsed: false, order: 5 })
    expect(duplicate.sections).toHaveLength(1)
    expect(duplicate.sections[0].name).toBe('Prive')
  })

  it('renameSection updates only the matching section', () => {
    let org = priveOrg()
    org = orgActions.createSection(org, { id: 'work', name: 'Work', collapsed: false, order: 1 })
    const renamed = orgActions.renameSection(org, 'prive', 'Private Life')
    expect(renamed.sections.find(s => s.id === 'prive')?.name).toBe('Private Life')
    expect(renamed.sections.find(s => s.id === 'work')?.name).toBe('Work')
  })

  it('toggleCollapsed flips only the targeted section', () => {
    let org = priveOrg()
    org = orgActions.createSection(org, { id: 'work', name: 'Work', collapsed: false, order: 1 })
    const toggled = orgActions.toggleCollapsed(org, 'prive')
    expect(toggled.sections.find(s => s.id === 'prive')?.collapsed).toBe(true)
    expect(toggled.sections.find(s => s.id === 'work')?.collapsed).toBe(false)
    const toggledBack = orgActions.toggleCollapsed(toggled, 'prive')
    expect(toggledBack.sections.find(s => s.id === 'prive')?.collapsed).toBe(false)
  })
})

describe('isUnread', () => {
  it('is true when manually marked unread, regardless of watermark', () => {
    const org = orgActions.markUnread(emptyOrg(), 'linh')
    expect(isUnread(org, 'linh', 0)).toBe(true)
  })

  it('is true when the last agent message arrived after the last-opened watermark', () => {
    const org = orgActions.markRead(emptyOrg(), 'linh', 100)
    expect(isUnread(org, 'linh', 50)).toBe(false)
    expect(isUnread(org, 'linh', 150)).toBe(true)
  })

  it('markRead clears a manual unread flag and sets the watermark', () => {
    let org = orgActions.markUnread(emptyOrg(), 'linh')
    org = orgActions.markRead(org, 'linh', 100)
    expect(org.manualUnread.linh).toBeFalsy()
    expect(isUnread(org, 'linh', 50)).toBe(false)
  })

  it('defaults to read when there is no watermark and no manual flag', () => {
    expect(isUnread(emptyOrg(), 'linh', 0)).toBe(false)
  })
})

describe('acknowledgeExchanges (spec 12.1)', () => {
  it('unions identities per profile, keeps order, never removes, and is a no-op for nothing new', () => {
    const org = emptyOrg()
    const once = orgActions.acknowledgeExchanges(org, 'kevin', ['send:call_1', 'outcome:call_1:settled:settled:text:false'])
    expect(once.exchangeAcks).toEqual({ kevin: ['send:call_1', 'outcome:call_1:settled:settled:text:false'] })
    const twice = orgActions.acknowledgeExchanges(once, 'kevin', ['outcome:call_1:settled:settled:text:false', 'return:proc_1'])
    expect(twice.exchangeAcks.kevin).toEqual(['send:call_1', 'outcome:call_1:settled:settled:text:false', 'return:proc_1'])
    expect(orgActions.acknowledgeExchanges(twice, 'kevin', ['return:proc_1'])).toBe(twice)
    expect(orgActions.acknowledgeExchanges(twice, 'kevin', [])).toBe(twice)
    // another profile is independent
    const other = orgActions.acknowledgeExchanges(twice, 'default', ['answer:31'])
    expect(other.exchangeAcks).toEqual({ kevin: twice.exchangeAcks.kevin, default: ['answer:31'] })
  })

  it('never touches pins, sections, membership or reading state', () => {
    const org = orgActions.pin(emptyOrg(), 'kevin')
    const acked = orgActions.acknowledgeExchanges(org, 'kevin', ['send:x'])
    expect(acked.pins).toEqual(['kevin'])
    expect(acked.membership).toEqual({})
    expect(acked.lastOpenedAt).toEqual({})
  })
})

/** Five visible agents and one hidden one; Linh and Kevin are in Prive, Mia is in Work. */
function orderedOrg(): Organization {
  return {
    ...emptyOrg(),
    sections: [
      { id: 'prive', name: 'Prive', collapsed: false, order: 0 },
      { id: 'work', name: 'Work', collapsed: false, order: 1 }
    ],
    membership: { linh: 'prive', kevin: 'prive', mia: 'work' },
    rowOrder: ['kevin', 'ghost', 'linh', 'noor', 'mia', 'otto']
  }
}

const orderedRows: BotRow[] = [
  { profile: 'linh', hidden: false, lastActivityAt: 300 },
  { profile: 'kevin', hidden: false, lastActivityAt: 200 },
  { profile: 'mia', hidden: false, lastActivityAt: 500 },
  { profile: 'noor', hidden: false, lastActivityAt: 100 },
  { profile: 'otto', hidden: false, lastActivityAt: 900 },
  { profile: 'ghost', hidden: true, lastActivityAt: 999 }
]

const rowsOf = (org: Organization, sectionId: string) => deriveHome(orderedRows, org).sections.find(s => s.section.id === sectionId)?.rows

describe('the manual row order', () => {
  it('shows every group in rowOrder, whatever the activity', () => {
    const layout = deriveHome(orderedRows, orderedOrg())
    expect(layout.ungrouped).toEqual(['noor', 'otto'])
    expect(rowsOf(orderedOrg(), 'prive')).toEqual(['kevin', 'linh'])
    expect(rowsOf(orderedOrg(), 'work')).toEqual(['mia'])
  })

  it('does not move a row when a new message arrives', () => {
    const busier = orderedRows.map(r => (r.profile === 'noor' ? { ...r, lastActivityAt: 10_000 } : r))
    expect(deriveHome(busier, orderedOrg()).ungrouped).toEqual(['noor', 'otto'])
  })

  it('shows profiles the order does not know yet first in their group, latest activity first', () => {
    const rows: BotRow[] = [...orderedRows, { profile: 'ada', hidden: false, lastActivityAt: 50 }, { profile: 'bo', hidden: false, lastActivityAt: 60 }]
    expect(deriveHome(rows, orderedOrg()).ungrouped).toEqual(['bo', 'ada', 'noor', 'otto'])
  })

  it('ignores names in rowOrder that have no row', () => {
    const org = { ...orderedOrg(), rowOrder: ['deleted', ...orderedOrg().rowOrder, 'gone'] }
    expect(deriveHome(orderedRows, org).ungrouped).toEqual(['noor', 'otto'])
  })

  it('keeps a hidden profile in its place, so unhiding puts it back where it was', () => {
    const unhidden = orderedRows.map(r => (r.profile === 'ghost' ? { ...r, hidden: false } : r))
    expect(deriveHome(orderedRows, orderedOrg()).ungrouped).not.toContain('ghost')
    expect(deriveHome(unhidden, orderedOrg()).ungrouped).toEqual(['ghost', 'noor', 'otto'])
  })

  it('shows the pins in the device\'s own order, the default profile included, and an unpinned one as an ordinary row', () => {
    const rows = orderedRows.map(r => (r.profile === 'otto' ? { ...r, isDefault: true } : r))
    // Noor is pinned first, the default profile (Otto) second: it stays second.
    const pinned = orgActions.pinMany(orderedOrg(), ['noor', 'otto'])
    expect(deriveHome(rows, pinned).pinned).toEqual(['noor', 'otto'])
    expect(deriveHome(rows, orgActions.unpin(pinned, 'otto')).pinned).toEqual(['noor'])
    expect(deriveHome(rows, orgActions.unpin(pinned, 'otto')).ungrouped).toEqual(['otto'])
  })
})

describe('adoptProfiles', () => {
  it('records new profiles at the front, latest activity first, and changes nothing when none is new', () => {
    const org = orderedOrg()
    const rows: BotRow[] = [...orderedRows, { profile: 'ada', hidden: false, lastActivityAt: 50 }, { profile: 'bo', hidden: true, lastActivityAt: 60 }]
    const adopted = orgActions.adoptProfiles(org, rows)
    expect(adopted.rowOrder).toEqual(['bo', 'ada', ...org.rowOrder])
    expect(orgActions.adoptProfiles(adopted, rows)).toBe(adopted)
  })

  it('keeps the screen as it was on the first load after the update, then keeps it still', () => {
    const before: Organization = { ...emptyOrg(), sections: orderedOrg().sections, membership: orderedOrg().membership, pins: ['linh'] }
    const adopted = orgActions.adoptProfiles(before, orderedRows)
    expect(deriveHome(orderedRows, adopted)).toEqual(deriveHome(orderedRows, before))
    expect(adopted.rowOrder).toEqual(['ghost', 'otto', 'mia', 'linh', 'kevin', 'noor'])

    const busier = orderedRows.map(r => (r.profile === 'noor' ? { ...r, lastActivityAt: 10_000 } : r))
    expect(deriveHome(busier, adopted).ungrouped).toEqual(['otto', 'noor'])
  })
})

describe('placeRow', () => {
  it('reorders a row inside its group', () => {
    const org = orgActions.placeRow(orderedOrg(), 'linh', 'prive', 'kevin')
    expect(rowsOf(org, 'prive')).toEqual(['linh', 'kevin'])
    expect(org.membership.linh).toBe('prive')
  })

  it('moves a row into another group in front of the named row, in one step', () => {
    const org = orgActions.placeRow(orderedOrg(), 'otto', 'prive', 'linh')
    expect(rowsOf(org, 'prive')).toEqual(['kevin', 'otto', 'linh'])
    expect(deriveHome(orderedRows, org).ungrouped).toEqual(['noor'])
  })

  it('puts the row at the end of its group when before is null or names no row in the order', () => {
    expect(rowsOf(orgActions.placeRow(orderedOrg(), 'kevin', 'prive', null), 'prive')).toEqual(['linh', 'kevin'])
    expect(rowsOf(orgActions.placeRow(orderedOrg(), 'noor', 'work', 'nobody'), 'work')).toEqual(['mia', 'noor'])
    expect(deriveHome(orderedRows, orgActions.placeRow(orderedOrg(), 'mia', null, null)).ungrouped).toEqual(['noor', 'otto', 'mia'])
  })

  it('changes nothing when a row is placed in front of itself', () => {
    const org = orderedOrg()
    expect(orgActions.placeRow(org, 'kevin', 'prive', 'kevin')).toBe(org)
  })

  it('changes nothing when the row already sits directly in front of the named row, in its current section', () => {
    // rowOrder is ['kevin', 'ghost', 'linh', ...]: kevin already sits directly in
    // front of ghost, and is already a Prive member, so this move lands nowhere new.
    const org = orderedOrg()
    expect(orgActions.placeRow(org, 'kevin', 'prive', 'ghost')).toBe(org)
  })
})

describe('moveRowsToSection', () => {
  it('moves several rows to the end of the section, keeping their relative order', () => {
    const org = orgActions.moveRowsToSection(orderedOrg(), ['otto', 'kevin', 'noor'], 'work')
    expect(rowsOf(org, 'work')).toEqual(['mia', 'kevin', 'noor', 'otto'])
    expect(rowsOf(org, 'prive')).toEqual(['linh'])
    expect(deriveHome(orderedRows, org).ungrouped).toEqual([])
  })

  it('leaves rows that are already in the section where they are, and moves rows back to no section', () => {
    const org = orderedOrg()
    expect(orgActions.moveRowsToSection(org, ['kevin', 'linh'], 'prive')).toBe(org)
    const back = orgActions.moveRowsToSection(org, ['kevin', 'noor'], null)
    expect(deriveHome(orderedRows, back).ungrouped).toEqual(['noor', 'otto', 'kevin'])
    expect(back.membership.kevin).toBeNull()
  })

  it('treats membership of a section that no longer exists as no section', () => {
    const org: Organization = { ...orderedOrg(), membership: { ...orderedOrg().membership, noor: 'deleted' } }
    expect(memberSection(org, 'noor')).toBeNull()
    expect(orgActions.moveRowsToSection(org, ['noor'], null)).toBe(org)
  })

  it('keeps pins when rows move between sections', () => {
    const org = orgActions.moveRowsToSection(orgActions.pin(orderedOrg(), 'linh'), ['linh'], 'work')
    expect(org.pins).toEqual(['linh'])
    expect(org.membership.linh).toBe('work')
  })
})

describe('pin and section order', () => {
  it('pinMany appends the unpinned ones in the given order; unpinMany removes them', () => {
    const one = orgActions.pin(orderedOrg(), 'mia')
    const more = orgActions.pinMany(one, ['noor', 'mia', 'kevin', 'noor'])
    expect(more.pins).toEqual(['mia', 'noor', 'kevin'])
    expect(orgActions.pinMany(more, ['kevin'])).toBe(more)
    expect(orgActions.unpinMany(more, ['mia', 'kevin']).pins).toEqual(['noor'])
    expect(orgActions.unpinMany(more, ['otto'])).toBe(more)
  })

  it('movePin reorders pins and ignores a profile that is not pinned', () => {
    const org = orgActions.pinMany(orderedOrg(), ['linh', 'kevin', 'mia'])
    expect(orgActions.movePin(org, 'mia', 'linh').pins).toEqual(['mia', 'linh', 'kevin'])
    expect(orgActions.movePin(org, 'linh', null).pins).toEqual(['kevin', 'mia', 'linh'])
    expect(orgActions.movePin(org, 'noor', 'linh')).toBe(org)
    expect(orgActions.movePin(org, 'linh', 'linh')).toBe(org)
  })

  it('changes nothing when the pin already sits directly in front of the named pin', () => {
    const org = orgActions.pinMany(orderedOrg(), ['linh', 'kevin', 'mia'])
    expect(orgActions.movePin(org, 'linh', 'kevin')).toBe(org)
  })

  it('moveSection reorders sections and renumbers their order', () => {
    const three = orgActions.createSection(orderedOrg(), { id: 'ideas', name: 'Ideas', collapsed: true, order: 7 })
    const moved = orgActions.moveSection(three, 'ideas', 'prive')
    expect(deriveHome(orderedRows, moved).sections.map(s => [s.section.id, s.section.order])).toEqual([
      ['ideas', 0],
      ['prive', 1],
      ['work', 2]
    ])
    expect(moved.sections.find(s => s.id === 'ideas')?.collapsed).toBe(true)
    expect(orgActions.moveSection(three, 'prive', null).sections.map(s => s.id)).toEqual(['work', 'ideas', 'prive'])
    expect(orgActions.moveSection(three, 'unknown', null)).toBe(three)
  })

  it('changes nothing when the section is already directly in front of the named section', () => {
    const org = orderedOrg()
    expect(orgActions.moveSection(org, 'prive', 'work')).toBe(org)
  })

  it('applyMove runs the move of each kind', () => {
    const org = orgActions.pinMany(orderedOrg(), ['linh', 'kevin'])
    expect(orgActions.applyMove(org, { kind: 'row', profile: 'otto', sectionId: 'work', before: 'mia' }).rowOrder).toEqual(
      orgActions.placeRow(org, 'otto', 'work', 'mia').rowOrder
    )
    expect(orgActions.applyMove(org, { kind: 'pin', profile: 'kevin', before: 'linh' }).pins).toEqual(['kevin', 'linh'])
    expect(orgActions.applyMove(org, { kind: 'section', sectionId: 'work', before: 'prive' }).sections.map(s => [s.id, s.order])).toEqual([
      ['work', 0],
      ['prive', 1]
    ])
  })

  it('applyMove pins a row dragged into the pinned area at the spot it was dropped', () => {
    const org = orgActions.pinMany(orderedOrg(), ['linh', 'kevin'])
    expect(orgActions.applyMove(org, { kind: 'pinAt', profile: 'otto', before: 'kevin' }).pins).toEqual(['linh', 'otto', 'kevin'])
    expect(orgActions.applyMove(org, { kind: 'pinAt', profile: 'otto', before: null }).pins).toEqual(['linh', 'kevin', 'otto'])
    // Its section stays: unpinning it later brings it back there.
    expect(orgActions.applyMove(org, { kind: 'pinAt', profile: 'mia', before: 'linh' }).membership.mia).toBe('work')
  })

  it('applyMove unpins a pin dragged into the rows list and places it at the spot it was dropped, in that group', () => {
    const org = orgActions.pinMany(orderedOrg(), ['linh', 'kevin'])
    const moved = orgActions.applyMove(org, { kind: 'unpinAt', profile: 'linh', sectionId: 'work', before: 'mia' })
    expect(moved.pins).toEqual(['kevin'])
    expect(moved.membership.linh).toBe('work')
    expect(moved.rowOrder).toEqual(['kevin', 'ghost', 'noor', 'linh', 'mia', 'otto'])
    const home = orgActions.applyMove(org, { kind: 'unpinAt', profile: 'kevin', sectionId: null, before: null })
    expect(home.pins).toEqual(['linh'])
    expect(home.membership.kevin).toBeNull()
    expect(home.rowOrder.at(-1)).toBe('kevin')
  })
})

describe('reading state for several agents', () => {
  it('markManyUnread flags each; markManyRead clears each and sets the watermark', () => {
    const unread = orgActions.markManyUnread(emptyOrg(), ['linh', 'kevin'])
    expect(unread.manualUnread).toEqual({ linh: true, kevin: true })
    const read = orgActions.markManyRead(unread, ['linh', 'kevin'], 400)
    expect(read.manualUnread).toEqual({})
    expect(read.lastOpenedAt).toEqual({ linh: 400, kevin: 400 })
  })

  it('changes nothing when every named profile is already in that state', () => {
    const unread = orgActions.markManyUnread(emptyOrg(), ['linh', 'kevin'])
    expect(orgActions.markManyUnread(unread, ['linh', 'kevin'])).toBe(unread)
    expect(orgActions.markManyUnread(unread, [])).toBe(unread)

    const read = orgActions.markManyRead(unread, ['linh', 'kevin'], 400)
    expect(orgActions.markManyRead(read, ['linh', 'kevin'], 400)).toBe(read)
    expect(orgActions.markManyRead(read, [], 400)).toBe(read)
    // A later read still legitimately moves the watermark, even with no manual flag left to clear.
    expect(orgActions.markManyRead(read, ['linh'], 500)).not.toBe(read)
  })
})

describe('forget', () => {
  it('removes a deleted profile from pins, sections and the order, so a new one with that name starts at the top', () => {
    let org = orgActions.pin(orderedOrg(), 'linh')
    org = orgActions.markUnread(org, 'linh')
    const forgotten = orgActions.forget(org, 'linh', 700)
    expect(forgotten.pins).toEqual([])
    expect(forgotten.rowOrder).not.toContain('linh')
    expect('linh' in forgotten.membership).toBe(false)
    expect(forgotten.manualUnread).toEqual({})
    expect(forgotten.lastOpenedAt.linh).toBe(700)

    const recreated: BotRow[] = [...orderedRows.filter(r => r.profile !== 'linh'), { profile: 'linh', hidden: false, lastActivityAt: 1 }]
    expect(deriveHome(recreated, forgotten).ungrouped).toEqual(['linh', 'noor', 'otto'])
  })
})

describe('deleteSection', () => {
  it('moves the members to the end of No section in their order, keeps pins, and removes the section', () => {
    // Linh is pinned and Ghost is hidden; both are Prive members, like Kevin.
    const pinned = orgActions.pin(orderedOrg(), 'linh')
    const org: Organization = { ...pinned, membership: { ...pinned.membership, ghost: 'prive' } }
    const deleted = orgActions.deleteSection(org, 'prive')
    expect(deleted.sections.map(s => s.id)).toEqual(['work'])
    expect(deleted.membership).toEqual({ linh: null, kevin: null, mia: 'work', ghost: null })
    expect(deleted.pins).toEqual(['linh'])
    expect(deleted.rowOrder).toEqual(['noor', 'mia', 'otto', 'kevin', 'ghost', 'linh'])
    expect(deriveHome(orderedRows, deleted).ungrouped).toEqual(['noor', 'otto', 'kevin'])
  })

  it('changes nothing for a section that does not exist', () => {
    const org = orderedOrg()
    expect(orgActions.deleteSection(org, 'gone')).toBe(org)
  })
})
