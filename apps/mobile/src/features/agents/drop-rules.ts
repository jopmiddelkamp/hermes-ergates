/**
 * Dragging in Home Edit mode as pure functions (docs/10 "Home edit mode"):
 * the live rule the rows list asks while the finger moves, how a finished
 * drop becomes one `OrderMove` (or null: the item goes back), the pinned
 * avatars' drop, the headers-only list shown while a section header is
 * dragged, and a drag from one area into the other (a row into the pinned
 * area, a pin into the rows list). No React, React Native or Reanimated, so
 * Node tests cover every rule. The functions marked 'worklet' also run on
 * the UI thread, inside the rows list's sort strategy and while a finger
 * drags an item over the other area; they call only each other.
 */

import type { OrderMove } from '@/state/organization'

import type { ListItem, PinnedItem } from './edit-mode'

/** The fixed heights (points) the rows list draws; the section drag and swipe to select measure with them. */
export const EDIT_ITEM_HEIGHT = { row: 64, section: 48 } as const

export const SPACER_KEY = 'spacer'

/** An invisible item on top of the headers-only list that keeps the dragged header under the finger. */
export interface DragSpacer {
  kind: 'spacer'
  key: typeof SPACER_KEY
  height: number
}

/**
 * The drop skeleton under an empty, expanded section's header in Edit mode:
 * a dashed row that says "Drag agents here". It is an item of the rows list,
 * so a row dropped right above or right below it lands in that section. It
 * has no handle, so it is never dragged itself; the drop rules skip its key
 * (it is not a row or a header), and swipe to select skips it like a header.
 */
export interface SectionGhost {
  kind: 'ghost'
  key: string
}

/** One line of the rows list: a row or a section header, the ghost row of an empty section, or the spacer while a section header is dragged. */
export type DragItem = ListItem | DragSpacer | SectionGhost

/** What the slot rule needs to know about each key, as plain data a worklet can read. */
export type SlotKind = 'section' | 'row' | 'spacer' | 'ghost'

export type SlotMeta = Record<string, SlotKind>

/** The slot kind of every key in the list, and of the spacer. */
export function slotMeta(items: readonly DragItem[]): SlotMeta {
  const meta: SlotMeta = { [SPACER_KEY]: 'spacer' }
  for (const item of items) {
    meta[item.key] = item.kind
  }
  return meta
}

/**
 * `Sortable.Flex` (`PinnedArea.tsx`) takes children, not data, so it names
 * each pin by React's own child key rather than the pin's own key: a
 * leading `.$`, then the key with every `=` turned into `=0` and every `:`
 * into `=2` (React's escaping for an object property built from a `key`
 * prop, so `pinned:noor` survives as `.$pinned=2noor`). Every key
 * `Sortable.Flex` hands `PinnedArea` back — to `onDragStart`, `onDragMove`,
 * `onDragEnd` and `onActiveItemDropped` — is read back through this, at the
 * boundary, before it reaches any other rule here. `Sortable.Grid`, which
 * the rows list uses, takes `data` and a key extractor instead, so its keys
 * need no such reading back. A key without the `.$` prefix (already a plain
 * item key) is returned unchanged. Marked 'worklet': `onDragMove` runs on
 * the UI thread.
 */
export function sortableChildKey(key: string): string {
  'worklet'
  if (!key.startsWith('.$')) {
    return key
  }
  const escaped = key.slice(2)
  let result = ''
  let i = 0
  while (i < escaped.length) {
    const pair = escaped.slice(i, i + 2)
    if (pair === '=0') {
      result += '='
      i += 2
    } else if (pair === '=2') {
      result += ':'
      i += 2
    } else {
      result += escaped[i]
      i += 1
    }
  }
  return result
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
 * The rows list's order while a dragged row is over the pinned area: the
 * order the drag started with, so the row's own gap shows where it was and
 * nothing shuffles under a row that has left the list. Null when that is
 * already the order, or when the list changed during the drag (the start
 * order would then drop or add an item).
 */
export function returnToStart(order: readonly string[], startOrder: readonly string[]): string[] | null {
  'worklet'
  if (!sameKeys(startOrder, order)) {
    return null
  }
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== startOrder[i]) {
      return [...startOrder]
    }
  }
  return null
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

const isSection = (item: DragItem): item is SectionItem => item.kind === 'section'

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
 * section drag). Keys no longer in `items` are skipped, and so are ghost
 * rows: a row right above or right below one is in that ghost's section.
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
 * The pin move for a finished drop among the pinned avatars, or null for a
 * drop in the same place. `order` is the pinned keys after the drop; keys of
 * pins that disappeared during the drag are skipped.
 */
export function pinDropMove(pins: readonly PinnedItem[], order: readonly string[], key: string): OrderMove | null {
  const item = pins.find(p => p.key === key)
  const known = order.filter(k => pins.some(p => p.key === k))
  if (!item || !known.includes(key)) {
    return null
  }
  const nextKey = known[known.indexOf(key) + 1]
  const before = pins.find(p => p.key === nextKey)?.bot.profile ?? null
  return before === (pins[pins.indexOf(item) + 1]?.bot.profile ?? null) ? null : { kind: 'pin', profile: item.bot.profile, before }
}

// Dragging between the pinned area and the rows list. Each area keeps its
// own drag list; where the finger is decides, at the drop, whether the item
// landed in the other area. `crossSlot` finds the slot under the finger on
// the UI thread while it moves (it also places the insertion marker), and
// `crossMove` turns that slot into one `OrderMove` at the drop. As above,
// the worklet helpers are declared before `crossSlot`, which closes over them.

/** A point in window coordinates: the finger (react-native-gesture-handler's `absoluteX` and `absoluteY`). */
export interface Point {
  x: number
  y: number
}

/** A box in window coordinates: an area as Reanimated's `measure` reports it (`pageX`, `pageY`, `width`, `height`). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A pin's cell relative to the pinned area's own top left, in pin order (`pinCells`). */
export interface CrossCell {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a drop over the other area would land, or null for none. Over the
 * pinned area: the slot in the pin order, with the insertion bar's center
 * `x` and its line's top `y`, both in the pinned area. Over the rows list:
 * the slot among the lines it shows, with the gap's `y` from the list's top.
 */
export type CrossSlot = { area: 'pinned'; index: number; x: number; y: number } | { area: 'rows'; index: number; y: number } | null

export interface CrossQuery {
  /** The dragged item's key: a row (`row:`), a pin (`pinned:`) or a section header. */
  key: string
  finger: Point
  /** The pinned area, pins or skeleton; null while it is not shown. */
  pinnedArea: Rect | null
  rowsList: Rect | null
  /** The pins' cells at the pinned area's width; none for the empty skeleton. */
  cells: readonly CrossCell[]
  /** The gap between two pins. */
  pinGap: number
  /** The rows list's lines, top to bottom (`swipeLines` over the list as it shows, ghost rows included). */
  lines: readonly { height: number }[]
  /** The part of the scroll view the owner sees (`visibleArea`); a finger outside it is over neither area. */
  visible: Rect | null
}

function inside(point: Point, rect: Rect | null): rect is Rect {
  'worklet'
  return rect !== null && point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

/**
 * The pin slot at (x, y) in a pinned area `width` wide: on the line whose
 * middle is nearest to y (so the padding and the gap between lines count
 * too), in front of the first pin on it whose middle lies right of x, or
 * after its last pin. The bar sits in the middle of the gap next to that
 * pin. With no pins, the one slot there is.
 */
function pinSlot(cells: readonly CrossCell[], gap: number, x: number, y: number, width: number): CrossSlot {
  'worklet'
  if (cells.length === 0) {
    return { area: 'pinned', index: 0, x: width / 2, y: 0 }
  }
  let lineTop = cells[0]!.y
  let nearest = Infinity
  for (const cell of cells) {
    const distance = Math.abs(cell.y + cell.height / 2 - y)
    if (distance < nearest) {
      nearest = distance
      lineTop = cell.y
    }
  }
  let last = 0
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!
    if (cell.y !== lineTop) {
      continue
    }
    if (cell.x + cell.width / 2 > x) {
      return { area: 'pinned', index: i, x: cell.x - gap / 2, y: lineTop }
    }
    last = i
  }
  const end = cells[last]!
  return { area: 'pinned', index: last + 1, x: end.x + end.width + gap / 2, y: lineTop }
}

/** The gap between two lines of the rows list (or above the first, or under the last) nearest to y from the list's top. */
function rowSlot(lines: readonly { height: number }[], y: number): CrossSlot {
  'worklet'
  let top = 0
  let index = 0
  let at = 0
  let nearest = Math.abs(y)
  for (let i = 0; i < lines.length; i++) {
    top += lines[i]!.height
    const distance = Math.abs(top - y)
    if (distance < nearest) {
      nearest = distance
      index = i + 1
      at = top
    }
  }
  return { area: 'rows', index, y: at }
}

/**
 * The slot under the finger in the other area: the pin slot for a row over
 * the pinned area, the gap between lines for a pin anywhere below the top of
 * the rows list (under its last row is the end of the list, and an empty
 * list, every agent pinned, still takes it). Null for a finger outside the
 * part of the scroll view the owner sees (over the top bar, or over the bar
 * at the bottom), over neither area or over the area the item came from, for
 * an area that is not shown, and for a section header.
 */
export function crossSlot(query: CrossQuery): CrossSlot {
  'worklet'
  const { key, finger, pinnedArea, rowsList } = query
  if (!inside(finger, query.visible)) {
    return null
  }
  if (key.startsWith('row:')) {
    return inside(finger, pinnedArea) ? pinSlot(query.cells, query.pinGap, finger.x - pinnedArea.x, finger.y - pinnedArea.y, pinnedArea.width) : null
  }
  if (key.startsWith('pinned:')) {
    return rowsList !== null && finger.y >= rowsList.y ? rowSlot(query.lines, finger.y - rowsList.y) : null
  }
  return null
}

/** Whether two slots put the marker in the same place, so an unchanged slot is not written again on every frame. */
export function sameSlot(a: CrossSlot, b: CrossSlot): boolean {
  'worklet'
  if (a === null || b === null) {
    return a === b
  }
  if (a.area === 'pinned' && b.area === 'pinned') {
    return a.index === b.index && a.x === b.x && a.y === b.y
  }
  return a.area === b.area && a.index === b.index && a.y === b.y
}

/** A measured view (Reanimated's `measure`: `pageX`, `pageY`, `width`, `height`) as a window box; null when it could not be measured. */
export function pageRect(measured: { pageX: number; pageY: number; width: number; height: number } | null): Rect | null {
  'worklet'
  return measured ? { x: measured.pageX, y: measured.pageY, width: measured.width, height: measured.height } : null
}

/** The part of the scroll view the owner sees: the scroll view's window box without the `bottomCover` points an overlay (the Edit bar) covers at its bottom. */
export function visibleArea(scrollView: Rect | null, bottomCover: number): Rect | null {
  'worklet'
  return scrollView ? { ...scrollView, height: Math.max(0, scrollView.height - bottomCover) } : null
}

/** Stands in for the dropped pin in the rows list's keys; no list item has it. */
const DROPPED_KEY = 'dropped'

const isListItem = (item: DragItem): item is ListItem => item.kind === 'row' || item.kind === 'section'

/**
 * The move for a drop over the other area, or null when there is none (no
 * slot, or the dragged item is no longer shown). A row dropped over the
 * pinned area is pinned in front of the pin at its slot (`pinAt`). A pin
 * dropped over the rows list is unpinned into the group of its slot, in
 * front of the row after it (`unpinAt`), by the rules a row drop follows:
 * right under a header is that section, right under a collapsed header is
 * that section's top, and right above or below a ghost row is the ghost's
 * section. `shown` is the rows list the slot was found in, ghost rows included.
 */
export function crossMove(slot: CrossSlot, key: string, pins: readonly PinnedItem[], shown: readonly DragItem[]): OrderMove | null {
  if (slot === null) {
    return null
  }
  if (slot.area === 'pinned') {
    const row = shown.find(item => item.key === key)
    return row?.kind === 'row' ? { kind: 'pinAt', profile: row.bot.profile, before: pins[slot.index]?.bot.profile ?? null } : null
  }
  const pin = pins.find(item => item.key === key)
  if (!pin) {
    return null
  }
  const keys = shown.map(item => item.key)
  const at = Math.min(Math.max(slot.index, 0), keys.length)
  const order = [...keys.slice(0, at), DROPPED_KEY, ...keys.slice(at)]
  const known = new Map(shown.filter(isListItem).map(item => [item.key, item]))
  const where = placement(order, DROPPED_KEY, known)
  const group = where.group === null ? undefined : known.get(where.group)
  return { kind: 'unpinAt', profile: pin.bot.profile, sectionId: group?.kind === 'section' ? group.section.id : null, before: landsBefore(where, known) }
}

/**
 * What the end of a drag does about the other area. `followed` is the key of
 * the drag whose finger was followed (null: none yet) and `slot` the slot it
 * was over. Null when the drag that ended is not the followed one (a second
 * finger's drag): nothing changes. Otherwise `over` says whether it ended
 * over the other area, so the caller skips its own drop, and `move` is the
 * move to apply (null when the item is no longer shown).
 */
export function crossDrop(
  followed: string | null,
  key: string,
  slot: CrossSlot,
  pins: readonly PinnedItem[],
  shown: readonly DragItem[]
): { over: boolean; move: OrderMove | null } | null {
  if (followed !== null && followed !== key) {
    return null
  }
  return { over: slot !== null, move: crossMove(slot, key, pins, shown) }
}

/** The fixed height (points) the rows list draws an item at: a ghost row is as high as a row. */
export function dragItemHeight(item: DragItem): number {
  switch (item.kind) {
    case 'spacer':
      return item.height
    case 'ghost':
      return EDIT_ITEM_HEIGHT.row
    default:
      return EDIT_ITEM_HEIGHT[item.kind]
  }
}

function listHeight(items: readonly DragItem[]): number {
  return items.reduce((sum, item) => sum + dragItemHeight(item), 0)
}

/**
 * The rows list as Edit mode shows it: a ghost row right under the header of
 * every expanded section without rows. A collapsed section gets none; a row
 * dropped right under its header still joins it (`dropMove`).
 */
export function withSectionGhosts(items: readonly ListItem[]): DragItem[] {
  const shown: DragItem[] = []
  for (const item of items) {
    shown.push(item)
    if (item.kind === 'section' && !item.section.collapsed && item.topRow === null) {
      shown.push({ kind: 'ghost', key: `ghost:${item.section.id}` })
    }
  }
  return shown
}

/**
 * The list while a section header is dragged: only the section headers, under
 * a spacer whose height keeps the dragged header at the same place on screen
 * (ghost rows above it count). A key that names no section shows the whole list.
 */
export function sectionDragItems(items: readonly DragItem[], sectionKey: string): DragItem[] {
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
 * The least height of the rows list: the whole list, ghost rows included. It
 * stays the same while only the headers show and while the whole list comes
 * back (the drag list draws its new height a few frames after the data
 * changes), so the scroll content never gets shorter than the scroll position needs.
 */
export function listMinHeight(items: readonly DragItem[]): number {
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
