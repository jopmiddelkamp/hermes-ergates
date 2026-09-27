/**
 * Swipe to select in Home Edit mode as pure functions (docs/10 "Home edit
 * mode"), the iOS Mail convention: a touch that starts on a row's selection
 * circle and moves up or down selects every row from the start row to the row
 * under the finger, or deselects them when the start row was selected. A row
 * the finger leaves again goes back to how it was before the swipe. While the
 * finger is near the list's top or bottom edge, the list scrolls by itself.
 * No React, React Native or Reanimated, so Node tests cover every rule. The
 * functions marked 'worklet' also run on the UI thread inside the rows list's
 * swipe gesture and its auto-scroll frame callback; they call no other function.
 * The same swipe also runs over the pinned avatars, starting on a pin's
 * selection badge instead of a row's circle: `swipeMode` and `swipeSelection`
 * take `EditItem[]`, so the pinned area's gesture (`src/ui/home-list/
 * use-swipe-select.ts`) calls them with the pins in pin order instead of the
 * rows list, and `pinAt` below finds the pin under the finger from the pins'
 * cells, in place of `lineAt`. The cells come from `pinCells`, not from
 * measuring each pin: a pin sits inside a react-native-sortables item
 * wrapper, so its own `onLayout` reports a position relative to that
 * wrapper, not to the pinned area, and several pins measuring in the same
 * frame race the shared value that would hold their cells. `pinCells`
 * computes every cell instead, the way `swipeLines` computes the rows list's
 * lines from fixed heights. A swipe that starts on a pin stays within the
 * pins; it never continues into the rows list, or the other way.
 */

import { dragItemHeight, type DragItem } from './drop-rules'
import type { EditItem, Selection } from './edit-mode'

// Declared above the worklets that read them: the worklets Babel plugin
// evaluates each worklet's closure at module load (see drop-rules.ts).

/** How close to the list's top or bottom edge (points) the finger starts the list scrolling. */
export const AUTO_SCROLL_EDGE = 60
/** The auto-scroll speed with the finger at the edge or past it, in points per second. */
export const AUTO_SCROLL_MAX_SPEED = 1000
/** The longest frame the auto-scroll counts, in ms: after a stall the list moves one short step, not a jump. */
const AUTO_SCROLL_MAX_FRAME = 50

/** One line of the rows list as the swipe gesture reads it on the UI thread. */
export interface SwipeLine {
  key: string
  height: number
}

/** Starting on an unselected row selects; starting on a selected row deselects. */
export type SwipeMode = 'select' | 'deselect'

/** What a swipe ranges over: the pins, or the rows list with its headers and ghost rows. Only pins and rows take a selection. */
export type SwipeItem = EditItem | DragItem

/** Every line of the rows list with the fixed height the list draws it at, top to bottom; an empty section's ghost row is a line too. */
export function swipeLines(items: readonly DragItem[]): SwipeLine[] {
  return items.map(item => ({ key: item.key, height: dragItemHeight(item) }))
}

/** The content y of a line's top edge, or -1 for a key the list does not show. */
export function lineTop(lines: readonly SwipeLine[], key: string): number {
  'worklet'
  let top = 0
  for (const line of lines) {
    if (line.key === key) {
      return top
    }
    top += line.height
  }
  return -1
}

/**
 * The key of the line at y from the top of the rows list: a row or a section
 * header (the range skips headers). Above the list is its first line and
 * below it its last line; an empty list has none.
 */
export function lineAt(lines: readonly SwipeLine[], y: number): string | null {
  'worklet'
  let bottom = 0
  for (const line of lines) {
    bottom += line.height
    if (y < bottom) {
      return line.key
    }
  }
  return lines.length > 0 ? lines[lines.length - 1]!.key : null
}

/** A pinned avatar's whole 96 pt column (avatar and name), relative to the pinned area's own top left. */
export interface PinCell {
  key: string
  x: number
  y: number
  width: number
  height: number
}

/** What `pinCells` needs to lay the pins out the way the pinned area's `Sortable.Flex` does. */
export interface PinAreaLayout {
  /** The pinned area's own outer width (its container's `onLayout`, padding included). */
  width: number
  /** The `Sortable.Flex`'s `paddingHorizontal`. */
  gutter: number
  /** A pin's own column width (`PIN_WIDTH` in `PinnedArea.tsx`). */
  cellWidth: number
  /** A pin's own column height (`PIN_CELL_HEIGHT` in `PinnedArea.tsx`). */
  cellHeight: number
  /** The `Sortable.Flex`'s `gap`, between columns on a line and, since `PinnedArea` sets no `rowGap`, between lines too. */
  gap: number
  /** The `Sortable.Flex`'s `paddingVertical`, above the first line. */
  paddingTop: number
}

/**
 * The pins' cells, laid out the way `flexDirection="row"`, `flexWrap="wrap"`
 * and `justifyContent="center"` place them in `PinnedArea`'s `Sortable.Flex`:
 * as many `cellWidth` columns as fit `width − 2·gutter` with `gap` between
 * them go on a line, each line centered on its own; a key past that count
 * wraps to the next line, `cellHeight + gap` further down. Pass the pins in
 * pin order; a pin drag reorders them, so call this again with the new order.
 */
export function pinCells(keys: readonly string[], layout: PinAreaLayout): PinCell[] {
  const { width, gutter, cellWidth, cellHeight, gap, paddingTop } = layout
  const available = width - 2 * gutter
  const perLine = Math.max(1, Math.floor((available + gap) / (cellWidth + gap)))
  const cells: PinCell[] = []
  for (let start = 0; start < keys.length; start += perLine) {
    const line = keys.slice(start, start + perLine)
    const lineWidth = line.length * cellWidth + (line.length - 1) * gap
    const x = gutter + (available - lineWidth) / 2
    const y = paddingTop + (start / perLine) * (cellHeight + gap)
    line.forEach((key, i) => cells.push({ key, x: x + i * (cellWidth + gap), y, width: cellWidth, height: cellHeight }))
  }
  return cells
}

/**
 * The key of the pin whose cell contains (x, y), or null between cells, on a
 * gap or past the pinned area's own edge. Unlike `lineAt`, this does not fall
 * back to the nearest cell: the pinned area's gesture keeps the pin it
 * already has when this returns null, the same way `lineAt`'s caller keeps
 * the rows list's last line once the finger is past its own edges.
 */
export function pinAt(cells: readonly PinCell[], x: number, y: number): string | null {
  'worklet'
  for (const cell of cells) {
    if (x >= cell.x && x < cell.x + cell.width && y >= cell.y && y < cell.y + cell.height) {
      return cell.key
    }
  }
  return null
}

function profileOf(item: SwipeItem | undefined): string | null {
  return item?.kind === 'pinned' || item?.kind === 'row' ? item.bot.profile : null
}

export function swipeMode(items: readonly SwipeItem[], selection: Selection, startKey: string): SwipeMode {
  const profile = profileOf(items.find(item => item.key === startKey))
  return profile !== null && selection.has(profile) ? 'deselect' : 'select'
}

/**
 * The selection while the finger is on `currentKey`: every row from the start
 * line to the current one, in either direction, selected or deselected by
 * `mode`; section headers and ghost rows in the range are skipped.
 * Everything else keeps its state from `base`, the selection when the swipe
 * started, so moving back returns a row to how it was. A key the list no
 * longer shows changes nothing.
 */
export function swipeSelection(items: readonly SwipeItem[], base: Selection, startKey: string, currentKey: string, mode: SwipeMode): Selection {
  const start = items.findIndex(item => item.key === startKey)
  const current = items.findIndex(item => item.key === currentKey)
  if (start === -1 || current === -1) {
    return base
  }
  const next = new Set(base)
  for (let i = Math.min(start, current); i <= Math.max(start, current); i++) {
    const profile = profileOf(items[i])
    if (profile === null) {
      continue
    }
    if (mode === 'select') {
      next.add(profile)
    } else {
      next.delete(profile)
    }
  }
  return next
}

/**
 * The auto-scroll speed in points per second for a finger `y` points below
 * the top of a list `height` points tall: negative scrolls up, positive down,
 * 0 away from both edges. It grows from 0 at `AUTO_SCROLL_EDGE` from an edge
 * to full speed at the edge and past it. In a list too short for two edge
 * zones, each zone takes half the list, so its middle stays still.
 */
export function autoScrollSpeed(y: number, height: number): number {
  'worklet'
  if (height <= 0) {
    return 0
  }
  const edge = Math.min(AUTO_SCROLL_EDGE, height / 2)
  const fromTop = y
  const fromBottom = height - y
  if (fromTop < edge && fromTop <= fromBottom) {
    return (-AUTO_SCROLL_MAX_SPEED * (edge - Math.max(fromTop, 0))) / edge
  }
  if (fromBottom < edge) {
    return (AUTO_SCROLL_MAX_SPEED * (edge - Math.max(fromBottom, 0))) / edge
  }
  return 0
}

/**
 * The scroll offset after one frame of auto-scroll at `speed` points per
 * second, kept between the list's top (0) and `maxOffset`, the offset that
 * shows its end (below 0 when the whole list fits: it does not scroll).
 */
export function autoScrollOffset(offset: number, speed: number, elapsedMs: number, maxOffset: number): number {
  'worklet'
  const next = offset + (speed * Math.min(elapsedMs, AUTO_SCROLL_MAX_FRAME)) / 1000
  return Math.min(Math.max(next, 0), Math.max(maxOffset, 0))
}
