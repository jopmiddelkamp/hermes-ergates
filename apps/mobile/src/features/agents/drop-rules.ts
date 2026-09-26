/**
 * Dragging in Home Edit mode as pure functions (docs/10 "Home edit mode"):
 * which slots a dragged row, pin or section header may take, the live rule the
 * drag list asks while the finger moves, how a finished drop becomes one
 * `OrderMove` (or null: the item goes back), and the headers-only list shown
 * while a section header is dragged. No React, React Native or Reanimated, so
 * Node tests cover every rule. The functions marked 'worklet' also run on the
 * UI thread inside the drag list's sort strategy; they call only each other.
 */

import type { OrderMove } from '@/state/organization'

import type { EditItem } from './edit-mode'

/** The fixed heights (points) the edit list draws; the section drag anchors with them. */
export const EDIT_ITEM_HEIGHT = { caption: 36, pinned: 64, row: 64, section: 48 } as const

/** Bottom padding under the edit list. */
const LIST_PADDING = 40

export const SPACER_KEY = 'spacer'

/** An invisible item on top of the headers-only list that keeps the dragged header under the finger. */
export interface DragSpacer {
  kind: 'spacer'
  key: typeof SPACER_KEY
  height: number
}

/** One line of the drag list: an edit item, or the spacer while a section header is dragged. */
export type DragItem = EditItem | DragSpacer

/** What the slot rule needs to know about each key, as plain data a worklet can read. */
export type SlotKind = 'pinnedCaption' | 'noneCaption' | 'section' | 'pinned' | 'lockedPinned' | 'row' | 'spacer'

export type SlotMeta = Record<string, SlotKind>

function slotKind(item: DragItem): SlotKind {
  switch (item.kind) {
    case 'caption':
      return item.key === 'caption:pinned' ? 'pinnedCaption' : 'noneCaption'
    case 'pinned':
      return item.locked ? 'lockedPinned' : 'pinned'
    default:
      return item.kind
  }
}

/** The slot kind of every key in the list, and of the spacer. */
export function slotMeta(items: readonly DragItem[]): SlotMeta {
  const meta: SlotMeta = { [SPACER_KEY]: 'spacer' }
  for (const item of items) {
    meta[item.key] = slotKind(item)
  }
  return meta
}

// Declaration order matters here: the worklets Babel plugin turns a 'worklet'
// function into a factory evaluated at module load, and `nextOrder` below
// closes over `orderIsLegal` and `sameKeys`. Moving either of them below
// `nextOrder` compiles fine and passes the Node tests, but crashes on device
// with a temporal-dead-zone error the first time the drag list calls it.
// Keep `orderIsLegal` and `sameKeys` declared above `nextOrder`.

/**
 * Whether an order (keys, top to bottom) keeps the drag rules: pins stay in the
 * Pinned group with a pinned concierge first, unpinned rows stay out of it,
 * section headers stay below No section, and nothing sits above the first
 * caption, or above the spacer that tops the headers-only list. Keys the meta
 * does not know are skipped.
 */
export function orderIsLegal(order: readonly string[], meta: SlotMeta): boolean {
  'worklet'
  // 'top' is above every caption; the spacer starts the headers-only list, which has no captions.
  let group: 'top' | 'pinned' | 'other' = 'top'
  let pinsSeen = 0
  for (const key of order) {
    const kind = meta[key]
    switch (kind) {
      case undefined:
        break
      case 'spacer':
      case 'noneCaption':
        group = 'other'
        break
      case 'pinnedCaption':
        group = 'pinned'
        break
      case 'section':
      case 'row':
        if (group !== 'other') {
          return false
        }
        break
      default:
        // A pin, or the pinned concierge, which must be the first pin.
        if (group !== 'pinned' || (kind === 'lockedPinned' && pinsSeen > 0)) {
          return false
        }
        pinsSeen++
    }
  }
  return true
}

/** Rows, pins and section headers carry a drag handle; captions and the pinned concierge do not. */
export function hasHandle(item: DragItem): boolean {
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

type SectionItem = Extract<EditItem, { kind: 'section' }>

const isSection = (item: EditItem): item is SectionItem => item.kind === 'section'

/** Where a key sits in an order: the key of its caption or section header, and the item right after it. */
function placement(order: readonly string[], key: string, known: ReadonlyMap<string, EditItem>): { group: string | null; next: EditItem | undefined } {
  const at = order.indexOf(key)
  let group: string | null = null
  for (let i = at - 1; i >= 0; i--) {
    const item = known.get(order[i]!)
    if (item?.kind === 'caption' || item?.kind === 'section') {
      group = item.key
      break
    }
  }
  let next: EditItem | undefined
  for (let i = at + 1; i < order.length && !next; i++) {
    next = known.get(order[i]!)
  }
  return { group, next }
}

function profileOf(item: EditItem | undefined, kind: 'row' | 'pinned'): string | null {
  return item?.kind === kind ? item.bot.profile : null
}

/**
 * The order move for a finished drop, or null when nothing moves: a drop in
 * the same place, a drop the rules forbid, a caption or the pinned concierge,
 * or an agent that disappeared during the drag. `items` is the list as it is
 * now; `order` is the keys after the drop (the full list, or the headers-only
 * list of a section drag). Keys no longer in `items` are skipped.
 */
export function dropMove(items: readonly EditItem[], order: readonly string[], key: string): OrderMove | null {
  const item = items.find(i => i.key === key)
  if (!item || item.kind === 'caption' || !hasHandle(item) || !order.includes(key) || !orderIsLegal(order, slotMeta(items))) {
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
  const peer = item.kind === 'pinned' ? 'pinned' : 'row'
  const before = profileOf(now.next, peer)
  if (now.group === was.group && before === profileOf(was.next, peer)) {
    return null
  }
  if (item.kind === 'pinned') {
    return { kind: 'pin', profile: item.bot.profile, before }
  }
  const group = now.group === null ? undefined : known.get(now.group)
  return { kind: 'row', profile: item.bot.profile, sectionId: group?.kind === 'section' ? group.section.id : null, before }
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
export function sectionDragItems(items: readonly EditItem[], sectionKey: string): DragItem[] {
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
 * The least height of the scroll content: the whole list plus its bottom
 * padding. It stays the same while only the headers show and while the whole
 * list comes back (the drag list draws its new height a few frames after the
 * data changes), so the list never gets shorter than the scroll position needs
 * and the scroll position does not move.
 */
export function listMinHeight(items: readonly EditItem[]): number {
  return listHeight(items) + LIST_PADDING
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
