import { describe, expect, it } from 'vitest'

import { emptyOrganization, type Organization } from '@/state/organization'

import { canCreateSection, membershipChanged, membershipSnapshot, newSection, parseProfiles, profilesParam, sectionChoices } from './move-to-section'

function org(): Organization {
  return {
    ...emptyOrganization(),
    sections: [
      { id: 'work', name: 'Work', collapsed: false, order: 1 },
      { id: 'prive', name: 'Prive', collapsed: true, order: 0 }
    ],
    membership: { linh: 'prive', kevin: 'prive', mia: 'work', noor: 'deleted' }
  }
}

describe('the profiles route parameter', () => {
  it('round-trips a list of agents', () => {
    expect(parseProfiles(profilesParam(['linh', 'kevin']))).toEqual(['linh', 'kevin'])
  })

  it('drops empty and repeated names, and reads an array parameter too', () => {
    expect(parseProfiles(' linh,,kevin,linh ')).toEqual(['linh', 'kevin'])
    expect(parseProfiles(['linh,kevin', 'mia'])).toEqual(['linh', 'kevin', 'mia'])
    expect(parseProfiles(undefined)).toEqual([])
  })
})

describe('sectionChoices', () => {
  it('lists No section, then every section in its order', () => {
    expect(sectionChoices(org(), ['mia']).map(c => [c.id, c.name])).toEqual([
      [null, 'No section'],
      ['prive', 'Prive'],
      ['work', 'Work']
    ])
  })

  it('checks a section only when every given agent is in it', () => {
    const checked = (profiles: string[]) => sectionChoices(org(), profiles).filter(c => c.checked).map(c => c.id)
    expect(checked(['linh', 'kevin'])).toEqual(['prive'])
    expect(checked(['linh', 'mia'])).toEqual([])
    expect(checked(['otto', 'noor'])).toEqual([null])
    expect(checked([])).toEqual([])
  })
})

describe('membership snapshot, for whether backing out of Move to Section moved anything', () => {
  it('snapshots each given profile’s current section', () => {
    expect(membershipSnapshot(org(), ['linh', 'mia', 'otto'])).toEqual({ linh: 'prive', mia: 'work', otto: null })
  })

  it('treats membership of a deleted section as no section', () => {
    expect(membershipSnapshot(org(), ['noor'])).toEqual({ noor: null })
  })

  it('is unchanged when nothing moved, and changed once a snapshotted profile’s section differs', () => {
    const before = membershipSnapshot(org(), ['linh', 'mia'])
    expect(membershipChanged(before, org())).toBe(false)
    const moved: Organization = { ...org(), membership: { ...org().membership, linh: 'work' } }
    expect(membershipChanged(before, moved)).toBe(true)
  })

  it('is unchanged for an empty snapshot', () => {
    expect(membershipChanged(membershipSnapshot(org(), []), org())).toBe(false)
  })
})

describe('creating a section', () => {
  it('keeps the button disabled for an empty name', () => {
    expect(canCreateSection('')).toBe(false)
    expect(canCreateSection('   ')).toBe(false)
    expect(canCreateSection(' Ideas ')).toBe(true)
  })

  it('makes an expanded section after the last one, with the trimmed name', () => {
    const section = newSection(org().sections, '  Ideas ')
    expect(section).toMatchObject({ name: 'Ideas', collapsed: false, order: 2 })
    expect(section.id).toMatch(/^s-[a-z0-9]+-[a-z0-9]{1,4}$/)
    expect(newSection([], 'First').order).toBe(0)
  })
})
