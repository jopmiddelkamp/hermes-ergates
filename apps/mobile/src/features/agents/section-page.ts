/**
 * The Section page's rules (docs/10 "Home sections and pinned members"): when
 * Save is enabled, the delete confirmation, and the screen-reader action that
 * opens the page from a section header. What a delete does to the organization
 * is `orgActions.deleteSection`. Pure, so Node tests cover it.
 */

/** The accessibility action a section header offers next to its long-press. */
export const EDIT_SECTION_ACTION = { name: 'editSection', label: 'Edit section' } as const

/** Save is enabled for a name that is not empty after trimming and differs from the current one. */
export function canSaveSectionName(draft: string, current: string): boolean {
  const name = draft.trim()
  return name.length > 0 && name !== current
}

export interface DeletePrompt {
  title: string
  message: string
  confirm: string
}

export function deleteSectionPrompt(name: string): DeletePrompt {
  return { title: `Delete section ${name}?`, message: 'Its agents move to No section.', confirm: 'Delete' }
}
