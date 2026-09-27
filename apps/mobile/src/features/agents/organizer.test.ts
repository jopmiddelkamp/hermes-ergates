import { describe, expect, it } from 'vitest'

import { emptyOrganization, memberSection, type Organization } from '@/state/organization'

import { createOrganizer, type OrganizeAction } from './organizer'

/** Runs every action on one view, as the device store runs it on the shared view. */
function harness() {
  let view: Organization = {
    ...emptyOrganization(),
    pins: ['linh'],
    rowOrder: ['linh', 'kevin', 'mia'],
    sections: [{ id: 'prive', name: 'Prive', collapsed: false, order: 0 }],
    membership: { mia: 'prive' }
  }
  const organizer = createOrganizer((action: OrganizeAction) => {
    view = action(view)
  })
  return { organizer, view: () => view }
}

describe('the organizer', () => {
  it('pins and unpins several agents', () => {
    const { organizer, view } = harness()
    organizer.pin(['kevin', 'mia'])
    expect(view().pins).toEqual(['linh', 'kevin', 'mia'])
    organizer.unpin(['linh', 'mia'])
    expect(view().pins).toEqual(['kevin'])
  })

  it('moves agents to a section or No section, and into a new section after the last one', () => {
    const { organizer, view } = harness()
    organizer.moveToSection(['kevin'], 'prive')
    expect(memberSection(view(), 'kevin')).toBe('prive')
    organizer.moveToSection(['mia', 'kevin'], null)
    expect(view().membership).toEqual({ mia: null, kevin: null })
    organizer.createSectionWith(['linh', 'mia'], ' Clients ')
    const created = view().sections[1]
    expect(created).toMatchObject({ name: 'Clients', collapsed: false, order: 1 })
    expect([memberSection(view(), 'linh'), memberSection(view(), 'mia')]).toEqual([created.id, created.id])
  })

  it('renames and deletes a section, and applies a drop or a Move up', () => {
    const { organizer, view } = harness()
    organizer.renameSection('prive', 'Private')
    expect(view().sections[0].name).toBe('Private')
    organizer.applyMove({ kind: 'row', profile: 'mia', sectionId: null, before: 'linh' })
    expect(view().rowOrder).toEqual(['mia', 'linh', 'kevin'])
    expect(memberSection(view(), 'mia')).toBeNull()
    organizer.deleteSection('prive')
    expect(view().sections).toEqual([])
  })
})
