/**
 * Dragging in Home Edit mode as pure functions (docs/10 "Home edit mode"):
 * the live rule the rows list asks while the finger moves, how a finished
 * drop becomes one `OrderMove` (or null: the item goes back), the pinned
 * avatars' drop, and the headers-only list shown while a section header is
 * dragged. No React, React Native or Reanimated, so Node tests cover every
 * rule. The functions marked 'worklet' also run on the UI thread inside the
 * rows list's sort strategy; they call only each other.
 */

import type { OrderMove } from '@/state/organization'

import type { EditItem, ListItem, PinnedItem } from './edit-mode'

/** The fixed heights (points) the rows list draws; the section drag and swipe to select measure with them. */
export const EDIT_ITEM_HEIGHT = { row: 64, section: 48 } as const

export const SPACER_KEY = 'spacer'

/** An invisible item on top of the headers-only list that keeps the dragged header under the finger. */
export interface DragSpacer {
  kind: 'spacer'
  key: typeof SPACER_KEY
  height: number
}

/** One line of the rows list: a row or a section header, or the spacer while a section header is dragged. */
export type DragItem = ListItem | DragSpacer

/** What the slot rule needs to know about each key, as plain data a worklet can read. */
export type SlotKind = 'section' | 'row' | 'spacer'

export type SlotMeta = Record<string, SlotKind>

/** The slot kind of every key in the list, and of the spacer. */
export function slotMeta(items: readonly DragItem[]): SlotMeta {
  const meta: SlotMeta = { [SPACER_KEY]: 'spacer' }
  for (const item of items) {
    meta[item.key] = item.kind
  }
  return meta
}

// Declaration order matters here: the worklets Babel plugin turns a 'worklet'
// function into a factory evaluated at module load, and `nextOrder` below
// closes over `orderIsLegal` and `sameKeys`. Moving either of them below
// `nextOrder` compiles fine and passes the Node tests, but crashes on device
// with a temporal-dead-zone error the first time the rows list calls it.
// Keep `orderIsLegal` and `sameKeys` declared above `nextOrder`.

/**
 * Whether an order (keys, top to bottom) keeps the drag rules. Every row may
 * go anywhere: above the first section header is No section, under a header
 * is that section. Only the spacer that tops the headers-only list must stay
 * first. Keys the meta does not know are skipped.
 */
export function orderIsLegal(order: readonly string[], meta: SlotMeta): boolean {
  'worklet'
  for (let i = 1; i < order.length; i++) {
    if (meta[order[i]!] === 'spacer') {
      return false
    }
  }
  return true
}

/** Rows, pins and section headers carry a drag handle; the pinned concierge and the spacer do not. */
export function hasHandle(item: EditItem | DragSpacer): boolean {
  return item.kind === 'row' || item.kind === 'section' || (item.kind === 'pinned' && !item.locked)
}

/** What the live sort strategy knows while the finger moves. */
export interface SlotQuery {
  /** Keys in the order the list shows now. */
  order: readonly string[]
  /** Keys when the drag started. */
  startOrder: readonly string[]
  activeKey: string
  activeIndex: number
  activeHeight: number
  /** The dragged item's center, from the top of the list. */
  centerY: number
  /** Measured heights: one per key, one for all, or null before the list is measured. */
  heights: Record<string, number> | number | null
  meta: SlotMeta
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  'worklet'
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (!b.includes(a[i]!)) {
      return false
    }
  }
  return true
}

/**
 * The order for the dragged item's nearest slot, or null to keep the current
 * one. A slot the rules forbid is refused: the item slides back to where the
 * drag started, so it drops there (spec: "goes back to where it was").
 */
export function nextOrder(query: SlotQuery): string[] | null {
  'worklet'
  const { order, startOrder, activeKey, activeIndex, activeHeight, centerY, heights, meta } = query
  if (heights === null) {
    return null
  }
  const others = order.filter(key => key !== activeKey)
  let best = activeIndex
  let bestDistance = Infinity
  let top = 0
  for (let i = 0; i <= others.length; i++) {
    const distance = Math.abs(top + activeHeight / 2 - centerY)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
    if (i < others.length) {
      top += typeof heights === 'number' ? heights : (heights[others[i]!] ?? 0)
    }
  }
  if (best === activeIndex) {
    return null
  }
  const next = [...others.slice(0, best), activeKey, ...others.slice(best)]
  if (orderIsLegal(next, meta)) {
    return next
  }
  return startOrder.indexOf(activeKey) !== activeIndex && sameKeys(startOrder, order) ? [...startOrder] : null
}

type SectionItem = Extract<ListItem, { kind: 'section' }>

const isSection = (item: ListItem): item is SectionItem => item.kind === 'section'

/** Where a key sits in an order: the key of the section header above it (null: No section), and the item right after it. */
function placement(order: readonly string[], key: string, known: ReadonlyMap<string, ListItem>): { group: string | null; next: ListItem | undefined } {
  const at = order.indexOf(key)
  let group: string | null = null
  for (let i = at - 1; i >= 0; i--) {
    if (known.get(order[i]!)?.kind === 'section') {
      group = order[i]!
      break
    }
  }
  let next: ListItem | undefined
  for (let i = at + 1; i < order.length && !next; i++) {
    next = known.get(order[i]!)
  }
  return { group, next }
}

/**
 * The row a dropped row lands in front of: the row right after it, or, when
 * nothing but a header or the end follows, the top row of a collapsed
 * section it was dropped under (its rows are not shown), else null (the end).
 */
function landsBefore(where: { group: string | null; next: ListItem | undefined }, known: ReadonlyMap<string, ListItem>): string | null {
  if (where.next?.kind === 'row') {
    return where.next.bot.profile
  }
  const header = where.group === null ? undefined : known.get(where.group)
  return header?.kind === 'section' && header.section.collapsed ? header.topRow : null
}

/**
 * The order move for a finished drop in the rows list, or null when nothing
 * moves: a drop in the same place, a drop the rules forbid, or an item that
 * disappeared during the drag. `items` is the rows list as it is now; `order`
 * is the keys after the drop (the full list, or the headers-only list of a
 * section drag). Keys no longer in `items` are skipped.
 */
export function dropMove(items: readonly ListItem[], order: readonly string[], key: string): OrderMove | null {
  const item = items.find(i => i.key === key)
  if (!item || !order.includes(key) || !orderIsLegal(order, slotMeta(items))) {
    return null
  }
  if (item.kind === 'section') {
    const sections = items.filter(isSection)
    const now = order.map(k => sections.find(s => s.key === k)).filter((s): s is SectionItem => s !== undefined)
    const before = now[now.indexOf(item) + 1]
    if (before === sections[sections.indexOf(item) + 1]) {
      return null
    }
    return { kind: 'section', sectionId: item.section.id, before: before ? before.section.id : null }
  }
  const known = new Map(items.map(i => [i.key, i]))
  const was = placement(items.map(i => i.key), key, known)
  const now = placement(order, key, known)
  const before = landsBefore(now, known)
  if (now.group === was.group && before === landsBefore(was, known)) {
    return null
  }
  const group = now.group === null ? undefined : known.get(now.group)
  return { kind: 'row', profile: item.bot.profile, sectionId: group?.kind === 'section' ? group.section.id : null, before }
}

/**
 * The pin move for a finished drop among the pinned avatars, or null: a drop
 * in the same place, the pinned concierge, or an order with anything in front
 * of a pinned concierge. `order` is the pinned keys after the drop; keys of
 * pins that disappeared during the drag are skipped.
 */
export function pinDropMove(pins: readonly PinnedItem[], order: readonly string[], key: string): OrderMove | null {
  const item = pins.find(p => p.key === key)
  const known = order.filter(k => pins.some(p => p.key === k))
  const locked = pins.find(p => p.locked)
  if (!item || item.locked || !known.includes(key) || (locked && known[0] !== locked.key)) {
    return null
  }
  const nextKey = known[known.indexOf(key) + 1]
  const before = pins.find(p => p.key === nextKey)?.bot.profile ?? null
  return before === (pins[pins.indexOf(item) + 1]?.bot.profile ?? null) ? null : { kind: 'pin', profile: item.bot.profile, before }
}

function heightOf(item: DragItem): number {
  return item.kind === 'spacer' ? item.height : EDIT_ITEM_HEIGHT[item.kind]
}

function listHeight(items: readonly DragItem[]): number {
  return items.reduce((sum, item) => sum + heightOf(item), 0)
}

/**
 * The list while a section header is dragged: only the section headers, under
 * a spacer whose height keeps the dragged header at the same place on screen.
 * A key that names no section shows the whole list.
 */
export function sectionDragItems(items: readonly ListItem[], sectionKey: string): DragItem[] {
  const at = items.findIndex(i => i.kind === 'section' && i.key === sectionKey)
  if (at === -1) {
    return [...items]
  }
  const headers = items.filter(isSection)
  const above = headers.findIndex(h => h.key === sectionKey)
  const y = listHeight(items.slice(0, at))
  return [{ kind: 'spacer', key: SPACER_KEY, height: Math.max(0, y - above * EDIT_ITEM_HEIGHT.section) }, ...headers]
}

/**
 * The least height of the rows list: the whole list. It stays the same while
 * only the headers show and while the whole list comes back (the drag list
 * draws its new height a few frames after the data changes), so the scroll
 * content never gets shorter than the scroll position needs.
 */
export function listMinHeight(items: readonly ListItem[]): number {
  return listHeight(items)
}

/** The section header whose handle is touched or dragged; while `key` is set, the list shows only the headers. */
export interface SectionDrag {
  key: string | null
  dragging: boolean
}

export const NO_SECTION_DRAG: SectionDrag = { key: null, dragging: false }

/**
 * `press`: a finger touched a section handle. `start`: the drag list started a
 * drag (any key). `release`: the finger lifted, or the list began to scroll.
 * `drop`: the drag ended.
 */
export type SectionDragEvent = { type: 'press'; key: string } | { type: 'start'; key: string } | { type: 'release' } | { type: 'drop' }

/**
 * Switches to the headers-only list as soon as a section handle is touched, so
 * the list is ready before the drag starts on a slow phone, and back when the
 * finger lifts without a drag or the drag ends. Returns the same object when
 * nothing changes.
 */
export function nextSectionDrag(state: SectionDrag, event: SectionDragEvent): SectionDrag {
  switch (event.type) {
    case 'press':
      return state.dragging ? state : { key: event.key, dragging: false }
    case 'start':
      if (event.key.startsWith('section:')) {
        return { key: event.key, dragging: true }
      }
      // A row or pin drag starting counts as a drag in progress too: without this, a
      // second finger pressing a section handle mid-drag (Sortable.Touchable's touch
      // tracker fires onTouchesDown regardless of what else is active) would switch the
      // list to headers only and drop the actively dragged item out of `data`.
      return state.dragging ? state : { key: null, dragging: true }
    case 'release':
      return state.dragging || state.key === null ? state : NO_SECTION_DRAG
    case 'drop':
      return state.key === null && !state.dragging ? state : NO_SECTION_DRAG
  }
}
