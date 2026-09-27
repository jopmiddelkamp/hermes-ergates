import { describe, expect, it } from 'vitest'

import type { Section } from '@/state/organization'

import { EDIT_SECTION_ACTION, canSaveSectionName, deleteSectionPrompt, shownSectionName } from './section-page'

const section = (id: string, name: string): Section => ({ id, name, collapsed: false, order: 0 })

describe('the Section page', () => {
  it('shows the name Home shows, not the stored one, so a Desktop rename is visible on the page', () => {
    const sections = [section('sec-1', 'Clients'), section('sec-2', 'Prive')]
    expect(shownSectionName(sections, 'sec-1', 'Work')).toBe('Clients')
  })

  it('falls back to the stored name when the section is gone from the shared view', () => {
    expect(shownSectionName([section('sec-2', 'Prive')], 'sec-1', 'Work')).toBe('Work')
  })

  it('enables Save only for a name that is not empty after trimming and differs from the current one', () => {
    expect(canSaveSectionName('', 'Prive')).toBe(false)
    expect(canSaveSectionName('   ', 'Prive')).toBe(false)
    expect(canSaveSectionName('Prive', 'Prive')).toBe(false)
    expect(canSaveSectionName(' Prive ', 'Prive')).toBe(false)
    expect(canSaveSectionName('Private', 'Prive')).toBe(true)
    expect(canSaveSectionName(' Work ', 'Prive')).toBe(true)
  })

  it('asks before deleting, and says where the agents go', () => {
    expect(deleteSectionPrompt('Prive')).toEqual({ title: 'Delete section Prive?', message: 'Its agents move to No section.', confirm: 'Delete' })
  })

  it('offers the page to screen readers as an action on the section header', () => {
    expect(EDIT_SECTION_ACTION).toEqual({ name: 'editSection', label: 'Edit section' })
  })
})
