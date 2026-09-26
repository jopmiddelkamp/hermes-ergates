import { describe, expect, it } from 'vitest'

import { EDIT_SECTION_ACTION, canSaveSectionName, deleteSectionPrompt } from './section-page'

describe('the Section page', () => {
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
