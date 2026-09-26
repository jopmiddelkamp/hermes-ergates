/**
 * Swipe to select in Home Edit mode as pure functions (docs/10 "Home edit
 * mode"), the iOS Mail convention: a touch that starts on a row's selection
 * circle and moves up or down selects every row from the start row to the row
 * under the finger, or deselects them when the start row was selected. A row
 * the finger leaves again goes back to how it was before the swipe. While the
 * finger is near the list's top or bottom edge, the list scrolls by itself.
 * No React, React Native or Reanimated, so Node tests cover every rule. The
 * functions marked 'worklet' also run on the UI thread inside the edit list's
 * swipe gesture and its auto-scroll frame callback; they call no other function.
 */

import { EDIT_ITEM_HEIGHT } from './drop-rules'
import type { EditItem, Selection } from './edit-mode'

// Declared above the worklets that read them: the worklets Babel plugin
// evaluates each worklet's closure at module load (see drop-rules.ts).

/** How close to the list's top or bottom edge (points) the finger starts the list scrolling. */
export const AUTO_SCROLL_EDGE = 60
/** The auto-scroll speed with the finger at the edge or past it, in points per second. */
export const AUTO_SCROLL_MAX_SPEED = 1000
/** The longest frame the auto-scroll counts, in ms: after a stall the list moves one short step, not a jump. */
const AUTO_SCROLL_MAX_FRAME = 50

/** One line of the edit list as the swipe gesture reads it on the UI thread. */
export interface SwipeLine {
  key: string
  height: number
}

/** Starting on an unselected row selects; starting on a selected row deselects. */
export type SwipeMode = 'select' | 'deselect'

/** Every line of the edit list with the fixed height the list draws it at, top to bottom. */
export function swipeLines(items: readonly EditItem[]): SwipeLine[] {
  return items.map(item => ({ key: item.key, height: EDIT_ITEM_HEIGHT[item.kind] }))
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
 * The key of the line at content y: a row, a pin, a caption or a section
 * header (the range skips the last two). Above the list is its first line and
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

function profileOf(item: EditItem | undefined): string | null {
  return item?.kind === 'pinned' || item?.kind === 'row' ? item.bot.profile : null
}

export function swipeMode(items: readonly EditItem[], selection: Selection, startKey: string): SwipeMode {
  const profile = profileOf(items.find(item => item.key === startKey))
  return profile !== null && selection.has(profile) ? 'deselect' : 'select'
}

/**
 * The selection while the finger is on `currentKey`: every row and pin from
 * the start line to the current one, in either direction, selected or
 * deselected by `mode`; captions and section headers in the range are skipped.
 * Everything else keeps its state from `base`, the selection when the swipe
 * started, so moving back returns a row to how it was. A key the list no
 * longer shows changes nothing.
 */
export function swipeSelection(items: readonly EditItem[], base: Selection, startKey: string, currentKey: string, mode: SwipeMode): Selection {
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
