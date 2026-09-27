/**
 * The Section page's rules (docs/10 "Home sections and pinned members"): the
 * name it shows, when Save is enabled, the delete confirmation, and the
 * screen-reader action that opens the page from a section header. What a
 * delete does to the organization is `orgActions.deleteSection`. Pure, so
 * Node tests cover it.
 */

import type { Section } from '@/state/organization'

/** The accessibility action a section header offers next to its long-press. */
export const EDIT_SECTION_ACTION = { name: 'editSection', label: 'Edit section' } as const

/**
 * The name Home already shows for this section (`home.organization.sections`,
 * `followedName` in `org-sync.ts`): the stored name is stale right after a
 * Desktop rename, until some organizing action on the phone stores it. The
 * page must start from, and compare against, the same name Home shows, or
 * Save and Delete work with a name the owner cannot see. Falls back to the
 * stored name only when the section itself is gone (opened, then deleted
 * from under the page).
 */
export function shownSectionName(sections: Section[], sectionId: string, storedName: string): string {
  return sections.find(s => s.id === sectionId)?.name ?? storedName
}

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
