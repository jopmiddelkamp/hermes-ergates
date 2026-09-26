/**
 * Home Edit mode as pure functions (docs/10 "Home edit mode"): the flat list
 * the edit list draws, the selection, the bottom bar labels, Move up and Move
 * down, and the concierge lock. No React and no React Native, so Node tests
 * cover every rule; the Home screen and `EditList` only bind it.
 */

import type { OrderMove, Section } from '@/state/organization'

import type { Bot } from './roster'

/**
 * One line of the edit list, top to bottom: the Pinned group (caption and
 * pinned rows), the No section group (caption and rows), then each section
 * (header and rows). Every section shows expanded. `key` is unique in the list.
 */
export type EditItem =
  | { kind: 'caption'; key: 'caption:pinned' | 'caption:none'; label: 'Pinned' | 'No section' }
  | { kind: 'pinned'; key: string; bot: Bot; locked: boolean }
  | { kind: 'section'; key: string; section: Section }
  | { kind: 'row'; key: string; bot: Bot; sectionId: string | null }

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
  name: 'moveUp' | 'moveDown'
  label: 'Move up' | 'Move down'
}

export interface EditBarLabels {
  pin: 'Pin' | 'Unpin'
  read: 'Mark read' | 'Mark unread'
}

export function buildEditItems(layout: EditLayout): EditItem[] {
  const items: EditItem[] = []
  if (layout.pinned.length > 0) {
    items.push({ kind: 'caption', key: 'caption:pinned', label: 'Pinned' })
    // `deriveHome` already puts a pinned concierge first; it is the one pin that never moves.
    for (const bot of layout.pinned) {
      items.push({ kind: 'pinned', key: `pinned:${bot.profile}`, bot, locked: bot.isDefault })
    }
  }
  // Always drawn, so the group stays a place to move rows to when it is empty.
  items.push({ kind: 'caption', key: 'caption:none', label: 'No section' })
  for (const bot of layout.ungrouped) {
    items.push({ kind: 'row', key: `row:${bot.profile}`, bot, sectionId: null })
  }
  for (const { section, rows } of layout.sections) {
    items.push({ kind: 'section', key: `section:${section.id}`, section })
    for (const bot of rows) {
      items.push({ kind: 'row', key: `row:${bot.profile}`, bot, sectionId: section.id })
    }
  }
  return items
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
 * it cannot move that way: at the group's edge, a caption, the pinned concierge,
 * or a pin that would pass above the concierge.
 */
export function moveStep(items: EditItem[], key: string, direction: MoveDirection): OrderMove | null {
  const item = items.find(i => i.key === key)
  if (!item || item.kind === 'caption' || (item.kind === 'pinned' && item.locked)) {
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

/** The screen-reader actions an item offers: only the moves that can happen. */
export function moveActions(items: EditItem[], key: string): MoveAction[] {
  const actions: MoveAction[] = []
  if (moveStep(items, key, 'up')) {
    actions.push({ name: 'moveUp', label: 'Move up' })
  }
  if (moveStep(items, key, 'down')) {
    actions.push({ name: 'moveDown', label: 'Move down' })
  }
  return actions
}

/** What a screen reader says for a row in Edit mode, ending in its selection state. */
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

function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The one alert text after a Hide where some calls failed: it names each agent that is still shown. */
export function hideFailureMessage(failed: Bot[]): string {
  return `${joinNames(failed.map(b => b.name))} ${failed.length === 1 ? 'was' : 'were'} not hidden. Try again.`
}
