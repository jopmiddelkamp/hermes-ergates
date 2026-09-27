/**
 * Every organizing action of Home, the long-press menu, agent details, the
 * Move to Section page and the Section page (docs/10 "Home sections and
 * pinned members"), bound to one function that runs an action on the
 * organization as Home shows it (`organize` in the device store, which
 * queues the pin and section changes for Hermes). Pure, so Node tests cover it.
 */

import { orgActions, type BotRow, type Organization, type OrderMove } from '@/state/organization'

import { newSection } from './move-to-section'

export type OrganizeAction = (view: Organization) => Organization

export interface Organizer {
  pin(profiles: string[]): void
  unpin(profiles: string[]): void
  /** To the end of that group; `null` is No section. */
  moveToSection(profiles: string[], sectionId: string | null): void
  /** Creates a section with this name after the last one and moves the agents into it. */
  createSectionWith(profiles: string[], name: string): void
  renameSection(sectionId: string, name: string): void
  /** Its agents move to the end of No section; pins stay. */
  deleteSection(sectionId: string): void
  /** A drop, or a Move up / Move down (Move left / Move right for a pin). */
  applyMove(move: OrderMove): void
}

export function createOrganizer(organize: (action: OrganizeAction) => void): Organizer {
  return {
    pin: profiles => organize(view => orgActions.pinMany(view, profiles)),
    unpin: profiles => organize(view => orgActions.unpinMany(view, profiles)),
    moveToSection: (profiles, sectionId) => organize(view => orgActions.moveRowsToSection(view, profiles, sectionId)),
    createSectionWith: (profiles, name) =>
      organize(view => {
        const section = newSection(view.sections, name)
        return orgActions.moveRowsToSection(orgActions.createSection(view, section), profiles, section.id)
      }),
    renameSection: (sectionId, name) => organize(view => orgActions.renameSection(view, sectionId, name)),
    deleteSection: sectionId => organize(view => orgActions.deleteSection(view, sectionId)),
    applyMove: move => organize(view => orgActions.applyMove(view, move))
  }
}

/**
 * The organizer Home uses (`useOrganizer`): every action runs through the
 * device store's `organize` with this connection's roster rows, so the
 * pinned flags and sections it changes are queued for Hermes, whether it
 * came from the bottom bar, the menu, a drop or a drag between the pinned
 * area and the list.
 */
export function connectionOrganizer(organize: (connectionId: string, rows: BotRow[], action: OrganizeAction) => void, connectionId: string, rows: BotRow[]): Organizer {
  return createOrganizer(action => organize(connectionId, rows, action))
}
