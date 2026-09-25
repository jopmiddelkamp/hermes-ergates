import { describe, expect, it } from 'vitest'

import { deriveHome, isUnread, orgActions, type BotRow, type Organization } from './organization'

function emptyOrg(): Organization {
  return { pins: [], sections: [], membership: {}, manualUnread: {}, lastOpenedAt: {}, exchangeAcks: {} }
}

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

    const moved = orgActions.moveToSection(org, 'linh', 'work')

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

  it('orders rows by lastActivityAt descending', () => {
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
