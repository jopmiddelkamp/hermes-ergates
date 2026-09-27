/**
 * Home Edit mode as pure functions (docs/10 "Home edit mode"): the flat list
 * Home draws in both modes, the selection, the bottom bar labels, Move up and
 * Move down (Move left and Move right on a pin), and the concierge lock. No
 * React and no React Native, so Node tests cover every rule; the Home screen
 * and `src/ui/home-list` only bind it.
 */

import type { OrderMove, Section } from '@/state/organization'

import type { Bot } from './roster'

/**
 * One item of the Home list, in both modes, top to bottom: the pinned
 * avatars (in pin order, a pinned concierge first), the rows without a
 * section, then each section's header and, unless the section is collapsed,
 * its rows. `key` is unique in the list. A section header keeps its first
 * row (`topRow`), shown or not: a row dropped right under a collapsed header
 * lands in front of it.
 */
export type EditItem =
  | { kind: 'pinned'; key: string; bot: Bot; locked: boolean }
  | { kind: 'section'; key: string; section: Section; topRow: string | null }
  | { kind: 'row'; key: string; bot: Bot; sectionId: string | null }

/** A pinned avatar. */
export type PinnedItem = Extract<EditItem, { kind: 'pinned' }>

/** A line of the rows list below the pinned avatars: a row or a section header. */
export type ListItem = Exclude<EditItem, { kind: 'pinned' }>

/** The Home layout the list is built from (`HomeModel` has this shape). */
export interface EditLayout {
  pinned: Bot[]
  ungrouped: Bot[]
  sections: { section: Section; rows: Bot[] }[]
}

export type Selection = ReadonlySet<string>

export const NO_SELECTION: Selection = new Set()

export type MoveDirection = 'up' | 'down'

export interface MoveAction {
  name: 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
  label: 'Move up' | 'Move down' | 'Move left' | 'Move right'
}

export interface EditBarLabels {
  pin: 'Pin' | 'Unpin'
  read: 'Mark read' | 'Mark unread'
}

export function buildEditItems(layout: EditLayout): EditItem[] {
  const items: EditItem[] = []
  // `deriveHome` already puts a pinned concierge first; it is the one pin that never moves.
  for (const bot of layout.pinned) {
    items.push({ kind: 'pinned', key: `pinned:${bot.profile}`, bot, locked: bot.isDefault })
  }
  for (const bot of layout.ungrouped) {
    items.push({ kind: 'row', key: `row:${bot.profile}`, bot, sectionId: null })
  }
  for (const { section, rows } of layout.sections) {
    items.push({ kind: 'section', key: `section:${section.id}`, section, topRow: rows[0]?.profile ?? null })
    if (!section.collapsed) {
      for (const bot of rows) {
        items.push({ kind: 'row', key: `row:${bot.profile}`, bot, sectionId: section.id })
      }
    }
  }
  return items
}

export function pinnedItems(items: readonly EditItem[]): PinnedItem[] {
  return items.filter((item): item is PinnedItem => item.kind === 'pinned')
}

export function listItems(items: readonly EditItem[]): ListItem[] {
  return items.filter((item): item is ListItem => item.kind !== 'pinned')
}

function profileOf(item: EditItem): string | null {
  return item.kind === 'pinned' || item.kind === 'row' ? item.bot.profile : null
}

export function toggleSelected(selection: Selection, profile: string): Selection {
  const next = new Set(selection)
  if (!next.delete(profile)) {
    next.add(profile)
  }
  return next
}

/** The selection limited to agents the list still shows: a roster refresh drops the rest. */
export function liveSelection(selection: Selection, items: EditItem[]): Selection {
  const shown = new Set(items.map(profileOf).filter((p): p is string => p !== null))
  return [...selection].every(p => shown.has(p)) ? selection : new Set([...selection].filter(p => shown.has(p)))
}

/** Selected profiles in the order the list shows them. */
export function selectedInListOrder(items: EditItem[], selection: Selection): string[] {
  return items.map(profileOf).filter((p): p is string => p !== null && selection.has(p))
}

/**
 * The selection right before a section collapses, with its rows taken out
 * for good: expanding the section again does not restore them. Call this
 * with the layout as it is before the toggle; a section that is already
 * collapsed (the toggle is about to expand it) or unknown leaves the
 * selection unchanged.
 */
export function collapseSelection(selection: Selection, layout: EditLayout, sectionId: string): Selection {
  const group = layout.sections.find(s => s.section.id === sectionId)
  if (!group || group.section.collapsed) {
    return selection
  }
  const drop = new Set(group.rows.map(bot => bot.profile))
  const next = new Set([...selection].filter(profile => !drop.has(profile)))
  return next.size === selection.size ? selection : next
}

export function selectionTitle(count: number): string {
  return `${count} selected`
}

/** "Unpin" when every selected agent is pinned; "Mark read" when at least one is unread. */
export function editBarLabels(profiles: string[], state: { isPinned(profile: string): boolean; isUnread(profile: string): boolean }): EditBarLabels {
  return {
    pin: profiles.length > 0 && profiles.every(p => state.isPinned(p)) ? 'Unpin' : 'Pin',
    read: profiles.some(p => state.isUnread(p)) ? 'Mark read' : 'Mark unread'
  }
}

/** The items that move together with `item`: its group's rows, the pins, or the section headers. */
function peersOf(items: EditItem[], item: EditItem): EditItem[] {
  switch (item.kind) {
    case 'pinned':
      return items.filter(i => i.kind === 'pinned')
    case 'row':
      return items.filter(i => i.kind === 'row' && i.sectionId === item.sectionId)
    default:
      return items.filter(i => i.kind === item.kind)
  }
}

function idOf(item: EditItem | undefined): string | null {
  if (!item) {
    return null
  }
  return item.kind === 'section' ? item.section.id : profileOf(item)
}

/**
 * The order move one step up or down inside the item's own group, or null when
 * it cannot move that way: at the group's edge, the pinned concierge, or a pin
 * that would pass above the concierge. For a pin, up is left and down is right.
 */
export function moveStep(items: EditItem[], key: string, direction: MoveDirection): OrderMove | null {
  const item = items.find(i => i.key === key)
  if (!item || (item.kind === 'pinned' && item.locked)) {
    return null
  }
  const peers = peersOf(items, item)
  const at = peers.indexOf(item)
  const target = direction === 'up' ? peers[at - 1] : peers[at + 1]
  if (!target || (target.kind === 'pinned' && target.locked)) {
    return null
  }
  // Moving up lands in front of the one above; moving down, in front of the one after the next.
  const before = direction === 'up' ? idOf(target) : idOf(peers[at + 2])
  switch (item.kind) {
    case 'pinned':
      return { kind: 'pin', profile: item.bot.profile, before }
    case 'row':
      return { kind: 'row', profile: item.bot.profile, sectionId: item.sectionId, before }
    case 'section':
      return { kind: 'section', sectionId: item.section.id, before }
  }
}

/** The screen-reader actions an item offers: only the moves that can happen; Move left and Move right on a pin. */
export function moveActions(items: EditItem[], key: string): MoveAction[] {
  const pin = items.find(i => i.key === key)?.kind === 'pinned'
  const actions: MoveAction[] = []
  if (moveStep(items, key, 'up')) {
    actions.push(pin ? { name: 'moveLeft', label: 'Move left' } : { name: 'moveUp', label: 'Move up' })
  }
  if (moveStep(items, key, 'down')) {
    actions.push(pin ? { name: 'moveRight', label: 'Move right' } : { name: 'moveDown', label: 'Move down' })
  }
  return actions
}

/** The direction of a move action by its name, or null for any other action. */
export function moveDirection(actionName: string): MoveDirection | null {
  switch (actionName) {
    case 'moveUp':
    case 'moveLeft':
      return 'up'
    case 'moveDown':
    case 'moveRight':
      return 'down'
    default:
      return null
  }
}

/** What a screen reader says for a row or a pinned avatar in Edit mode, ending in its selection state. */
export function editRowLabel(bot: Bot, selected: boolean, unread: boolean): string {
  return [bot.name, bot.role, unread ? 'unread' : '', selected ? 'selected' : 'not selected'].filter(Boolean).join(', ')
}

/**
 * Hides each bot with its own call, all at once; resolves to the bots that were
 * not hidden. `Promise.resolve().then(...)` keeps a call that throws
 * synchronously from aborting `.map` before the rest even start.
 */
export async function hideEach(bots: Bot[], hide: (bot: Bot) => Promise<unknown>): Promise<Bot[]> {
  const results = await Promise.allSettled(bots.map(bot => Promise.resolve().then(() => hide(bot))))
  return bots.filter((_, i) => results[i].status === 'rejected')
}

/** "Linh", "Linh and Kevin", "Linh, Kevin and Mia". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The one alert text after a Hide where some calls failed: it names each agent that is still shown. */
export function hideFailureMessage(failed: Bot[]): string {
  return `${joinNames(failed.map(b => b.name))} ${failed.length === 1 ? 'was' : 'were'} not hidden. Try again.`
}
