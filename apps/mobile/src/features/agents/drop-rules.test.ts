import { describe, expect, it } from 'vitest'

import type { Section } from '@/state/organization'

import {
  EDIT_ITEM_HEIGHT,
  NO_SECTION_DRAG,
  SPACER_KEY,
  dropMove,
  hasHandle,
  listPadding,
  nextOrder,
  nextSectionDrag,
  orderIsLegal,
  sectionDragItems,
  slotMeta,
  type SlotQuery
} from './drop-rules'
import { buildEditItems, type EditItem, type EditLayout } from './edit-mode'
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
const work: Section = { id: 'work', name: 'Work', collapsed: true, order: 1 }

/** Hermes (the concierge), Noor and Mia pinned; Otto and Zed without a section; Kevin and Linh in Prive; Work empty. */
function layout(): EditLayout {
  return {
    pinned: [bot('hermes', { isDefault: true }), bot('noor'), bot('mia')],
    ungrouped: [bot('otto'), bot('zed')],
    sections: [
      { section: prive, rows: [bot('kevin'), bot('linh')] },
      { section: work, rows: [] }
    ]
  }
}

const items = (l: EditLayout = layout()) => buildEditItems(l)
const keysOf = (list: readonly { key: string }[]) => list.map(i => i.key)

/** `order` with `key` taken out and put back at `to` (insert, as the drag list does). */
function moved(order: readonly string[], key: string, to: number): string[] {
  const rest = order.filter(k => k !== key)
  return [...rest.slice(0, to), key, ...rest.slice(to)]
}

const legal = (order: string[], list: EditItem[] = items()) => orderIsLegal(order, slotMeta(list))

describe('orderIsLegal', () => {
  const start = keysOf(items())

  it('accepts the list as it is drawn', () => {
    expect(start).toEqual([
      'caption:pinned',
      'pinned:hermes',
      'pinned:noor',
      'pinned:mia',
      'caption:none',
      'row:otto',
      'row:zed',
      'section:prive',
      'row:kevin',
      'row:linh',
      'section:work'
    ])
    expect(legal(start)).toBe(true)
  })

  it('lets a row move inside its group, into another section, into No section, and under an empty section header', () => {
    expect(legal(moved(start, 'row:zed', 5))).toBe(true)
    expect(legal(moved(start, 'row:otto', 8))).toBe(true)
    expect(legal(moved(start, 'row:linh', 5))).toBe(true)
    expect(legal(moved(start, 'row:otto', 10))).toBe(true)
  })

  it('keeps an unpinned row out of the Pinned group and away from the top', () => {
    expect(legal(moved(start, 'row:otto', 2))).toBe(false)
    expect(legal(moved(start, 'row:otto', 4))).toBe(false)
    expect(legal(moved(start, 'row:otto', 0))).toBe(false)
    const unpinned = items({ ...layout(), pinned: [] })
    expect(legal(moved(keysOf(unpinned), 'row:otto', 0), unpinned)).toBe(false)
  })

  it('keeps a pinned row inside the Pinned group, and nothing above a pinned concierge', () => {
    expect(legal(moved(start, 'pinned:mia', 2))).toBe(true)
    expect(legal(moved(start, 'pinned:mia', 5))).toBe(false)
    expect(legal(moved(start, 'pinned:noor', 8))).toBe(false)
    expect(legal(moved(start, 'pinned:mia', 1))).toBe(false)
    expect(legal(moved(start, 'pinned:hermes', 2))).toBe(false)
  })

  it('treats an unpinned concierge as an ordinary row, so any pin can go first', () => {
    const plain = items({ ...layout(), pinned: [bot('noor'), bot('mia')], ungrouped: [bot('hermes', { isDefault: true }), bot('otto')] })
    expect(legal(moved(keysOf(plain), 'pinned:mia', 1), plain)).toBe(true)
    expect(legal(moved(keysOf(plain), 'row:hermes', 7), plain)).toBe(true)
  })

  it('keeps a section header below the No section caption', () => {
    expect(legal(moved(start, 'section:work', 7))).toBe(true)
    expect(legal(moved(start, 'section:work', 3))).toBe(false)
    expect(legal(moved(start, 'section:work', 0))).toBe(false)
  })

  it('keeps the spacer first in the headers-only list', () => {
    const headers = keysOf(sectionDragItems(items(), 'section:work'))
    expect(legal(moved(headers, 'section:work', 1))).toBe(true)
    expect(legal(moved(headers, 'section:work', 0))).toBe(false)
  })

  it('skips keys it does not know', () => {
    expect(legal(['caption:pinned', 'pinned:gone', ...start.slice(1)])).toBe(true)
  })
})

describe('hasHandle', () => {
  it('gives a handle to rows, pins and section headers, not to captions or the pinned concierge', () => {
    expect(items().filter(hasHandle).map(i => i.key)).toEqual([
      'pinned:noor',
      'pinned:mia',
      'row:otto',
      'row:zed',
      'section:prive',
      'row:kevin',
      'row:linh',
      'section:work'
    ])
    expect(hasHandle({ kind: 'spacer', key: SPACER_KEY, height: 10 })).toBe(false)
  })
})

describe('nextOrder, the live rule while the finger moves', () => {
  const start = keysOf(items())
  const heights = Object.fromEntries(items().map(i => [i.key, EDIT_ITEM_HEIGHT[i.kind]]))
  /** Otto (index 5, 64 pt high) with its center at `centerY`. */
  const query = (centerY: number, extra: Partial<SlotQuery> = {}): SlotQuery => ({
    order: start,
    startOrder: start,
    activeKey: 'row:otto',
    activeIndex: 5,
    activeHeight: 64,
    centerY,
    heights,
    meta: slotMeta(items()),
    ...extra
  })

  it('keeps the order while the row is over its own slot', () => {
    expect(nextOrder(query(296))).toBeNull()
  })

  it('moves the row to the nearest legal slot', () => {
    // Slot centers after the other items: ... Kevin's slot is centered at 472.
    expect(nextOrder(query(472))).toEqual(moved(start, 'row:otto', 8))
  })

  it('refuses a slot in the Pinned group: the row stays, or slides back to where the drag started', () => {
    expect(nextOrder(query(132))).toBeNull()
    const away = moved(start, 'row:otto', 8)
    expect(nextOrder(query(132, { order: away, activeIndex: 8 }))).toEqual(start)
  })

  it('refuses a slot above the pinned concierge for a pin', () => {
    const mia = { activeKey: 'pinned:mia', activeIndex: 3 }
    expect(nextOrder(query(32, mia))).toBeNull()
    expect(nextOrder(query(132, mia))).toEqual(moved(start, 'pinned:mia', 2))
  })

  it('does not slide back to a start order whose items changed during the drag', () => {
    const away = moved(start, 'row:otto', 8)
    expect(nextOrder(query(132, { order: away, activeIndex: 8, startOrder: [...start, 'row:new'] }))).toBeNull()
  })

  it('reads one height for every item, and moves nothing before the list is measured', () => {
    expect(nextOrder(query(64 * 8 + 32, { heights: 64 }))).toEqual(moved(start, 'row:otto', 8))
    expect(nextOrder(query(472, { heights: null }))).toBeNull()
  })
})

describe('dropMove', () => {
  const start = keysOf(items())
  const drop = (key: string, to: number, list: EditItem[] = items()) => dropMove(list, moved(keysOf(list), key, to), key)

  it('reorders a row inside its group', () => {
    expect(drop('row:linh', 8)).toEqual({ kind: 'row', profile: 'linh', sectionId: 'prive', before: 'kevin' })
    expect(drop('row:otto', 6)).toEqual({ kind: 'row', profile: 'otto', sectionId: null, before: null })
  })

  it('moves a row into another section, into No section, and under an empty section header', () => {
    expect(drop('row:otto', 7)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'prive', before: 'kevin' })
    expect(drop('row:kevin', 5)).toEqual({ kind: 'row', profile: 'kevin', sectionId: null, before: 'otto' })
    expect(drop('row:otto', 10)).toEqual({ kind: 'row', profile: 'otto', sectionId: 'work', before: null })
  })

  it('returns null for a drop in the same place', () => {
    expect(drop('row:otto', 5)).toBeNull()
    expect(drop('pinned:noor', 2)).toBeNull()
    expect(dropMove(items(), start, 'section:prive')).toBeNull()
  })

  it('returns null for a drop the pinned rules forbid, so the row goes back', () => {
    expect(drop('row:otto', 2)).toBeNull()
    expect(drop('pinned:mia', 6)).toBeNull()
    expect(drop('pinned:mia', 1)).toBeNull()
  })

  it('reorders the pins', () => {
    expect(drop('pinned:mia', 2)).toEqual({ kind: 'pin', profile: 'mia', before: 'noor' })
    expect(drop('pinned:noor', 3)).toEqual({ kind: 'pin', profile: 'noor', before: null })
  })

  it('never moves a caption or the pinned concierge', () => {
    expect(dropMove(items(), start, 'caption:none')).toBeNull()
    expect(dropMove(items(), start, 'pinned:hermes')).toBeNull()
  })

  it('reads the new section order from the headers-only list', () => {
    const headers = keysOf(sectionDragItems(items(), 'section:work'))
    expect(dropMove(items(), moved(headers, 'section:work', 1), 'section:work')).toEqual({ kind: 'section', sectionId: 'work', before: 'prive' })
    const fromPrive = keysOf(sectionDragItems(items(), 'section:prive'))
    expect(dropMove(items(), moved(fromPrive, 'section:prive', 2), 'section:prive')).toEqual({ kind: 'section', sectionId: 'prive', before: null })
    expect(dropMove(items(), headers, 'section:work')).toBeNull()
  })

  it('reads the section order from the full list when the switch to headers came too late', () => {
    expect(drop('section:work', 7)).toEqual({ kind: 'section', sectionId: 'work', before: 'prive' })
  })

  it('returns null when the dragged agent disappeared during the drag, so the list redraws without it', () => {
    const without = items({ ...layout(), ungrouped: [bot('zed')] })
    expect(dropMove(without, moved(start, 'row:otto', 8), 'row:otto')).toBeNull()
  })

  it('ignores another agent that disappeared during the drag', () => {
    const withoutKevin = items({ ...layout(), sections: [{ section: prive, rows: [bot('linh')] }, { section: work, rows: [] }] })
    expect(dropMove(withoutKevin, moved(start, 'row:otto', 8), 'row:otto')).toEqual({ kind: 'row', profile: 'otto', sectionId: 'prive', before: 'linh' })
  })
})

describe('the headers-only list for a section drag', () => {
  it('shows only the section headers, under a spacer that keeps the dragged header where it was', () => {
    expect(sectionDragItems(items(), 'section:prive')).toEqual([
      { kind: 'spacer', key: SPACER_KEY, height: 392 },
      expect.objectContaining({ key: 'section:prive' }),
      expect.objectContaining({ key: 'section:work' })
    ])
    // 568 pt above Work, minus the one header (48 pt) that now sits above it.
    expect(sectionDragItems(items(), 'section:work')[0]).toEqual({ kind: 'spacer', key: SPACER_KEY, height: 520 })
  })

  it('shows the whole list for a key that is not a section', () => {
    expect(sectionDragItems(items(), 'section:gone')).toEqual(items())
  })

  it('pads the bottom so the list keeps its height and the scroll position does not jump', () => {
    expect(listPadding(items(), items())).toBe(40)
    expect(listPadding(items(), sectionDragItems(items(), 'section:prive'))).toBe(40 + 128)
    expect(listPadding(items(), sectionDragItems(items(), 'section:work'))).toBe(40)
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

  it('switches at the drag start when the touch arrived late, and ignores a row drag', () => {
    expect(nextSectionDrag(NO_SECTION_DRAG, { type: 'start', key: 'section:prive' })).toEqual({ key: 'section:prive', dragging: true })
    expect(nextSectionDrag(NO_SECTION_DRAG, { type: 'start', key: 'row:otto' })).toBe(NO_SECTION_DRAG)
    expect(nextSectionDrag(NO_SECTION_DRAG, { type: 'release' })).toBe(NO_SECTION_DRAG)
  })
})
