import { describe, expect, it } from 'vitest'

import type { Section } from '@/state/organization'

import {
  EDIT_ITEM_HEIGHT,
  NO_SECTION_DRAG,
  SPACER_KEY,
  dragItemHeight,
  dropMove,
  listMinHeight,
  nextOrder,
  nextSectionDrag,
  orderIsLegal,
  pinDropMove,
  sectionDragItems,
  slotMeta,
  withSectionGhosts,
  type DragItem,
  type SlotQuery
} from './drop-rules'
import { buildEditItems, listItems, pinnedItems, type EditLayout, type ListItem } from './edit-mode'
import type { Bot } from './roster'

function bot(profile: string, extra: Partial<Bot> = {}): Bot {
  return {
    profile,
    name: profile[0]!.toUpperCase() + profile.slice(1),
    role: '',
    description: '',
    hidden: false,
    hasAvatar: false,
    isDefault: false,
    lastActivityAt: 0,
    preview: '',
    canonicalSessionId: null,
    summary: { name: profile, is_default: false },
    ...extra
  }
}

const prive: Section = { id: 'prive', name: 'Prive', collapsed: false, order: 0 }
const work: Section = { id: 'work', name: 'Work', collapsed: false, order: 1 }
const archive: Section = { id: 'archive', name: 'Archive', collapsed: true, order: 2 }

/**
 * Hermes (the concierge), Noor and Mia pinned; Otto and Zed without a section;
 * Kevin and Linh in Prive; Work empty; Ada and Bo in Archive, which is collapsed.
 */
function layout(): EditLayout {
  return {
    pinned: [bot('hermes', { isDefault: true }), bot('noor'), bot('mia')],
    ungrouped: [bot('otto'), bot('zed')],
    sections: [
      { section: prive, rows: [bot('kevin'), bot('linh')] },
      { section: work, rows: [] },
      { section: archive, rows: [bot('ada'), bot('bo')] }
    ]
  }
}

/** The rows list below the pinned avatars. */
const list = (l: EditLayout = layout()) => listItems(buildEditItems(l))
const pins = (l: EditLayout = layout()) => pinnedItems(buildEditItems(l))
const keysOf = (items: readonly { key: string }[]) => items.map(i => i.key)

/** `order` with `key` taken out and put back at `to` (insert, as the drag list does). */
function moved(order: readonly string[], key: string, to: number): string[] {
  const rest = order.filter(k => k !== key)
  return [...rest.slice(0, to), key, ...rest.slice(to)]
}

const legal = (order: string[], items: readonly DragItem[] = list()) => orderIsLegal(order, slotMeta(items))

describe('orderIsLegal', () => {
  const start = keysOf(list())

  it('draws the rows list without captions or pins', () => {
    expect(start).toEqual(['row:otto', 'row:zed', 'section:prive', 'row:kevin', 'row:linh', 'section:work', 'section:archive'])
    expect(legal(start)).toBe(true)
  })

  it('lets a row go anywhere: above the first header is No section, under a header is that section', () => {
    expect(legal(moved(start, 'row:kevin', 0))).toBe(true)
    expect(legal(moved(start, 'row:otto', 3))).toBe(true)
    expect(legal(moved(start, 'row:otto', 6))).toBe(true)
  })

  it('keeps the spacer first in the headers-only list', () => {
    const headers = keysOf(sectionDragItems(list(), 'section:work'))
    expect(headers).toEqual([SPACER_KEY, 'section:prive', 'section:work', 'section:archive'])
    expect(legal(moved(headers, 'section:work', 1))).toBe(true)
    expect(legal(moved(headers, 'section:work', 0))).toBe(false)
  })

  it('skips keys it does not know', () => {
    expect(legal(['row:gone', ...start])).toBe(true)
  })
})

describe('nextOrder, the live rule while the finger moves', () => {
  const start = keysOf(list())
  const heights = Object.fromEntries(list().map(i => [i.key, EDIT_ITEM_HEIGHT[i.kind]]))
  /** Otto (index 0, 64 pt high) with its center at `centerY`. */
  const query = (centerY: number, extra: Partial<SlotQuery> = {}): SlotQuery => ({
    order: start,
    startOrder: start,
    activeKey: 'row:otto',
    activeIndex: 0,
    activeHeight: 64,
    centerY,
    heights,
    meta: slotMeta(list()),
    ...extra
  })

  it('keeps the order while the row is over its own slot', () => {
    expect(nextOrder(query(32))).toBeNull()
  })

  it('takes the row to its nearest slot', () => {
    // Slot tops after the other items: Zed 0, Prive 64, Kevin 112, Linh 176, ... so slot 3 is centered at 208.
    expect(nextOrder(query(208))).toEqual(moved(start, 'row:otto', 3))
  })

  it('refuses a slot above the spacer: the header stays, or slides back to where the drag started', () => {
    const headers = sectionDragItems(list(), 'section:work')
    const order = keysOf(headers)
    const headerHeights = Object.fromEntries(headers.map(i => [i.key, dragItemHeight(i)]))
    const work = { order, startOrder: order, activeKey: 'section:work', activeIndex: 2, activeHeight: 48, heights: headerHeights, meta: slotMeta(headers) }
    expect(nextOrder(query(10, work))).toBeNull()
    const away = moved(order, 'section:work', 1)
    expect(nextOrder(query(10, { ...work, order: away, activeIndex: 1 }))).toEqual(order)
    expect(nextOrder(query(10, { ...work, order: away, activeIndex: 1, startOrder: [...order, 'section:new'] }))).toBeNull()
  })

  it('reads one height for every item, and moves nothing before the list is measured', () => {
    expect(nextOrder(query(64 * 3 + 32, { heights: 64 }))).toEqual(moved(start, 'row:otto', 3))
    expect(nextOrder(query(208, { heights: null }))).toBeNull()
  })
})

describe('dropMove', () => {
  const start = keysOf(list())
  const drop = (key: string, to: number, items: ListItem[] = list()) => dropMove(items, moved(keysOf(items), key, to), key)

  it('reorders a row inside its group', () => {
    expect(drop('row:linh', 3)).toEqual({ kind: 'row', profile: 'linh', sectionId: 'prive', before: 'kevin' })
    expect(drop('row:otto', 1)).toEqual({ kind: 'row', profile: 'otto', sectionId: null, before: null })
  })

  it('moves a row into another section, into No section, and under an empty section header', () => {
    expect(drop('row:otto', 2)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'prive', before: 'kevin' })
    expect(drop('row:kevin', 0)).toEqual({ kind: 'row', profile: 'kevin', sectionId: null, before: 'otto' })
    expect(drop('row:otto', 5)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'work', before: null })
  })

  it('moves a row to the end of a different, non-empty section', () => {
    // Otto dropped after Linh (Prive's last row) and before the Work header.
    expect(drop('row:otto', 4)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'prive', before: null })
  })

  it('puts a row dropped right under a collapsed section header at the top of that section', () => {
    expect(drop('row:otto', 6)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'archive', before: 'ada' })
    const closedEmpty = list({ ...layout(), sections: [{ section: { ...work, collapsed: true }, rows: [] }] })
    expect(drop('row:otto', 2, closedEmpty)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'work', before: null })
  })

  it('moves a row above the first section header while No section is empty', () => {
    const empty = list({ ...layout(), ungrouped: [] })
    // Kevin dropped at the very top, before the Prive header.
    expect(drop('row:kevin', 0, empty)).toEqual({ kind: 'row', profile: 'kevin', sectionId: null, before: null })
  })

  it('returns null for a drop in the same place, a pin, or a key it does not know', () => {
    expect(drop('row:otto', 0)).toBeNull()
    expect(dropMove(list(), start, 'section:prive')).toBeNull()
    expect(dropMove(list(), start, 'pinned:noor')).toBeNull()
    expect(dropMove(list(), start, 'row:gone')).toBeNull()
  })

  it('reads the new section order from the headers-only list', () => {
    const headers = keysOf(sectionDragItems(list(), 'section:work'))
    expect(dropMove(list(), moved(headers, 'section:work', 1), 'section:work')).toEqual({ kind: 'section', sectionId: 'work', before: 'prive' })
    const fromPrive = keysOf(sectionDragItems(list(), 'section:prive'))
    expect(dropMove(list(), moved(fromPrive, 'section:prive', 3), 'section:prive')).toEqual({ kind: 'section', sectionId: 'prive', before: null })
    expect(dropMove(list(), headers, 'section:work')).toBeNull()
  })

  it('reads the section order from the full list when the switch to headers came too late', () => {
    expect(drop('section:work', 2)).toEqual({ kind: 'section', sectionId: 'work', before: 'prive' })
  })

  it('returns null when the dragged agent disappeared during the drag, so the list redraws without it', () => {
    const without = list({ ...layout(), ungrouped: [bot('zed')] })
    expect(dropMove(without, moved(start, 'row:otto', 3), 'row:otto')).toBeNull()
  })

  it('ignores another agent that disappeared during the drag', () => {
    const withoutKevin = list({ ...layout(), sections: [{ section: prive, rows: [bot('linh')] }, { section: work, rows: [] }] })
    expect(dropMove(withoutKevin, moved(start, 'row:otto', 3), 'row:otto')).toEqual({ kind: 'row', profile: 'otto', sectionId: 'prive', before: 'linh' })
  })
})

describe('pinDropMove, a drop among the pinned avatars', () => {
  const order = keysOf(pins())
  const drop = (key: string, to: number) => pinDropMove(pins(), moved(order, key, to), key)

  it('reorders the pins, left and right across wrapped lines alike', () => {
    expect(drop('pinned:mia', 1)).toEqual({ kind: 'pin', profile: 'mia', before: 'noor' })
    expect(drop('pinned:noor', 2)).toEqual({ kind: 'pin', profile: 'noor', before: null })
  })

  it('returns null for a drop in the same place, or an unknown key', () => {
    expect(drop('pinned:noor', 1)).toBeNull()
    expect(pinDropMove(pins(), order, 'pinned:hermes')).toBeNull()
    expect(pinDropMove(pins(), order, 'row:otto')).toBeNull()
  })

  it('lets a drag move another pin in front of the default profile', () => {
    expect(drop('pinned:mia', 0)).toEqual({ kind: 'pin', profile: 'mia', before: 'hermes' })
  })

  it('lets any pin go first, default profile or not', () => {
    const plain = pins({ ...layout(), pinned: [bot('noor'), bot('mia')] })
    expect(pinDropMove(plain, moved(keysOf(plain), 'pinned:mia', 0), 'pinned:mia')).toEqual({ kind: 'pin', profile: 'mia', before: 'noor' })
  })

  it('ignores a pin that disappeared during the drag', () => {
    expect(pinDropMove(pins(), ['pinned:hermes', 'pinned:mia', 'pinned:gone', 'pinned:noor'], 'pinned:mia')).toEqual({ kind: 'pin', profile: 'mia', before: 'noor' })
  })
})

describe('the headers-only list for a section drag', () => {
  it('shows only the section headers, under a spacer that keeps the dragged header where it was', () => {
    expect(sectionDragItems(list(), 'section:prive')).toEqual([
      { kind: 'spacer', key: SPACER_KEY, height: 128 },
      expect.objectContaining({ key: 'section:prive' }),
      expect.objectContaining({ key: 'section:work' }),
      expect.objectContaining({ key: 'section:archive' })
    ])
    // 304 pt above Work, minus the one header (48 pt) that now sits above it.
    expect(sectionDragItems(list(), 'section:work')[0]).toEqual({ kind: 'spacer', key: SPACER_KEY, height: 256 })
  })

  it('shows the whole list for a key that is not a section', () => {
    expect(sectionDragItems(list(), 'section:gone')).toEqual(list())
  })

  it('keeps the rows list at least as tall as the whole list, so switching to the headers and back does not move the scroll position', () => {
    // Rows 4 × 64, headers 3 × 48.
    expect(listMinHeight(list())).toBe(256 + 144)
    expect(listMinHeight([])).toBe(0)
  })
})

describe('the drop skeleton under an empty section in Edit mode', () => {
  const shown = withSectionGhosts(list())

  it('puts one ghost row under each expanded section without rows, and none under a collapsed one', () => {
    expect(keysOf(shown)).toEqual(['row:otto', 'row:zed', 'section:prive', 'row:kevin', 'row:linh', 'section:work', 'ghost:work', 'section:archive'])
    expect(shown[6]).toEqual({ kind: 'ghost', key: 'ghost:work', sectionId: 'work' })
    const closedEmpty = list({ ...layout(), sections: [{ section: { ...work, collapsed: true }, rows: [] }] })
    expect(withSectionGhosts(closedEmpty)).toEqual(closedEmpty)
  })

  it('knows the ghost as its own slot kind', () => {
    expect(slotMeta(shown)['ghost:work']).toBe('ghost')
  })

  it('lets a row land right above or right below the ghost, and both join that section at its end', () => {
    const order = keysOf(shown)
    expect(dropMove(list(), moved(order, 'row:otto', 5), 'row:otto')).toEqual({ kind: 'row', profile: 'otto', sectionId: 'work', before: null })
    expect(dropMove(list(), moved(order, 'row:otto', 6), 'row:otto')).toEqual({ kind: 'row', profile: 'otto', sectionId: 'work', before: null })
  })

  it('leaves every other drop as it was with the ghost in the list', () => {
    const order = keysOf(shown)
    expect(dropMove(list(), moved(order, 'row:linh', 3), 'row:linh')).toEqual({ kind: 'row', profile: 'linh', sectionId: 'prive', before: 'kevin' })
    expect(dropMove(list(), moved(order, 'row:otto', 7), 'row:otto')).toEqual({ kind: 'row', profile: 'otto', sectionId: 'archive', before: 'ada' })
    expect(dropMove(list(), order, 'row:otto')).toBeNull()
  })

  it('lets the live rule move a row past the ghost', () => {
    const order = keysOf(shown)
    const heights = Object.fromEntries(shown.map(i => [i.key, dragItemHeight(i)]))
    // Tops without Otto: Zed 0, Prive 64, Kevin 112, Linh 176, Work 240, ghost 288, Archive 352; slot 6 (under the ghost) is centered at 384.
    const next = nextOrder({ order, startOrder: order, activeKey: 'row:otto', activeIndex: 0, activeHeight: 64, centerY: 384, heights, meta: slotMeta(shown) })
    expect(next).toEqual(moved(order, 'row:otto', 6))
  })

  it('counts the ghost in the list height and in the spacer of a section drag', () => {
    expect(listMinHeight(shown)).toBe(256 + 144 + 64)
    // Above Archive: 4 rows and the ghost (5 × 64) and 2 headers (2 × 48), 416 pt, minus the 2 headers that stay above it.
    expect(sectionDragItems(shown, 'section:archive')[0]).toEqual({ kind: 'spacer', key: SPACER_KEY, height: 416 - 96 })
    expect(keysOf(sectionDragItems(shown, 'section:archive'))).toEqual([SPACER_KEY, 'section:prive', 'section:work', 'section:archive'])
  })
})

describe('nextSectionDrag', () => {
  it('shows only headers from the touch on a section handle, and the whole list again after a release without a drag', () => {
    const pressed = nextSectionDrag(NO_SECTION_DRAG, { type: 'press', key: 'section:work' })
    expect(pressed).toEqual({ key: 'section:work', dragging: false })
    expect(nextSectionDrag(pressed, { type: 'release' })).toBe(NO_SECTION_DRAG)
  })

  it('keeps the headers through the drag and restores the list on the drop', () => {
    const pressed = nextSectionDrag(NO_SECTION_DRAG, { type: 'press', key: 'section:work' })
    const dragging = nextSectionDrag(pressed, { type: 'start', key: 'section:work' })
    expect(dragging).toEqual({ key: 'section:work', dragging: true })
    expect(nextSectionDrag(dragging, { type: 'release' })).toBe(dragging)
    expect(nextSectionDrag(dragging, { type: 'press', key: 'section:prive' })).toBe(dragging)
    expect(nextSectionDrag(dragging, { type: 'drop' })).toBe(NO_SECTION_DRAG)
  })

  it('switches at the drag start when the touch arrived late, and marks a row start as dragging without switching to headers only', () => {
    expect(nextSectionDrag(NO_SECTION_DRAG, { type: 'start', key: 'section:prive' })).toEqual({ key: 'section:prive', dragging: true })
    expect(nextSectionDrag(NO_SECTION_DRAG, { type: 'start', key: 'row:otto' })).toEqual({ key: null, dragging: true })
  })

  it('marks a row or pin start as a drag in progress, so a second finger on a section handle does not switch to headers only', () => {
    const rowDragging = nextSectionDrag(NO_SECTION_DRAG, { type: 'start', key: 'row:otto' })
    expect(rowDragging).toEqual({ key: null, dragging: true })
    // A second finger pressing or releasing on a section handle is ignored while the row drag is in progress.
    expect(nextSectionDrag(rowDragging, { type: 'press', key: 'section:work' })).toBe(rowDragging)
    expect(nextSectionDrag(rowDragging, { type: 'release' })).toBe(rowDragging)
    // Only the drop resets it, back to the whole list.
    expect(nextSectionDrag(rowDragging, { type: 'drop' })).toBe(NO_SECTION_DRAG)
    // A start while already marked dragging changes nothing.
    expect(nextSectionDrag(rowDragging, { type: 'start', key: 'pinned:linh' })).toBe(rowDragging)
  })
})
