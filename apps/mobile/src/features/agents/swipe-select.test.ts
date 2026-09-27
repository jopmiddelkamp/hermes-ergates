import { describe, expect, it } from 'vitest'

import type { Section } from '@/state/organization'

import { EDIT_ITEM_HEIGHT } from './drop-rules'
import { buildEditItems, listItems, pinnedItems, type EditLayout, type Selection } from './edit-mode'
import type { Bot } from './roster'
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_SPEED,
  autoScrollOffset,
  autoScrollSpeed,
  lineAt,
  lineTop,
  pinAt,
  swipeLines,
  swipeMode,
  swipeSelection,
  type PinCell
} from './swipe-select'

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

/**
 * Hermes (the concierge), Noor and Mia pinned above the rows list; Otto and
 * Zed without a section; Kevin and Linh in Prive; Work empty. The y of each
 * line from the top of the rows list: Otto 0, Zed 64, Prive header 128,
 * Kevin 176, Linh 240, Work header 304, end 352.
 */
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

const items = listItems(buildEditItems(layout()))
const lines = swipeLines(items)
const pins = pinnedItems(buildEditItems(layout()))
const set = (...profiles: string[]): Selection => new Set(profiles)
const sorted = (selection: Selection) => [...selection].sort()

/**
 * Hermes, Noor wrapped on the pinned area's first line (96 pt columns, 24 pt
 * gap, so Noor starts at x 120); Mia alone on the second line, 24 pt below.
 */
const pinCells: PinCell[] = [
  { key: 'pinned:hermes', x: 0, y: 0, width: 96, height: 116 },
  { key: 'pinned:noor', x: 120, y: 0, width: 96, height: 116 },
  { key: 'pinned:mia', x: 0, y: 140, width: 96, height: 116 }
]

describe('the lines the swipe measures', () => {
  it('lists every row and section header with the fixed height the rows list draws it at, and no pin', () => {
    expect(lines.map(l => l.key)).toEqual(['row:otto', 'row:zed', 'section:prive', 'row:kevin', 'row:linh', 'section:work'])
    expect(lines[0]).toEqual({ key: 'row:otto', height: EDIT_ITEM_HEIGHT.row })
    expect(lines[2]).toEqual({ key: 'section:prive', height: EDIT_ITEM_HEIGHT.section })
  })

  it('finds the top of a line, counting the section headers above it', () => {
    expect(lineTop(lines, 'row:otto')).toBe(0)
    expect(lineTop(lines, 'row:kevin')).toBe(176)
    expect(lineTop(lines, 'section:work')).toBe(304)
  })

  it('has no top for a key the list does not show', () => {
    expect(lineTop(lines, 'row:gone')).toBe(-1)
    expect(lineTop(lines, 'pinned:noor')).toBe(-1)
  })
})

describe('lineAt, the line under the finger', () => {
  it('finds the line at a y in the rows list, past the section headers above it', () => {
    expect(lineAt(lines, 0)).toBe('row:otto')
    expect(lineAt(lines, 63.5)).toBe('row:otto')
    expect(lineAt(lines, 64)).toBe('row:zed')
    expect(lineAt(lines, 200)).toBe('row:kevin')
    expect(lineAt(lines, 303)).toBe('row:linh')
  })

  it('reports a section header under the finger as itself; the range skips it', () => {
    expect(lineAt(lines, 140)).toBe('section:prive')
  })

  it('takes the first line above the list and the last line below it', () => {
    expect(lineAt(lines, -40)).toBe('row:otto')
    expect(lineAt(lines, 352)).toBe('section:work')
    expect(lineAt(lines, 5000)).toBe('section:work')
  })

  it('finds nothing in an empty list', () => {
    expect(lineAt([], 10)).toBeNull()
  })
})

describe('swipeMode', () => {
  it('selects when the swipe starts on a row that is not selected', () => {
    expect(swipeMode(items, set('zed'), 'row:otto')).toBe('select')
  })

  it('deselects when the swipe starts on a selected row', () => {
    expect(swipeMode(items, set('otto'), 'row:otto')).toBe('deselect')
  })
})

describe('swipeSelection', () => {
  it('selects the start row alone while the finger has not left it, as a tap would', () => {
    expect(sorted(swipeSelection(items, set(), 'row:otto', 'row:otto', 'select'))).toEqual(['otto'])
  })

  it('selects every row from the start row down to the row under the finger, skipping the section header', () => {
    expect(sorted(swipeSelection(items, set(), 'row:otto', 'row:kevin', 'select'))).toEqual(['kevin', 'otto', 'zed'])
  })

  it('selects upward too, and leaves the pins as they were', () => {
    expect(sorted(swipeSelection(items, set('noor'), 'row:linh', 'row:zed', 'select'))).toEqual(['kevin', 'linh', 'noor', 'zed'])
  })

  it('stops at the header under the finger: the rows below it and down to the start row', () => {
    expect(sorted(swipeSelection(items, set(), 'row:linh', 'section:prive', 'select'))).toEqual(['kevin', 'linh'])
    expect(sorted(swipeSelection(items, set(), 'row:otto', 'section:prive', 'select'))).toEqual(['otto', 'zed'])
  })

  it('deselects the range in deselect mode', () => {
    const base = set('otto', 'zed', 'kevin', 'linh')
    expect(sorted(swipeSelection(items, base, 'row:zed', 'row:linh', 'deselect'))).toEqual(['otto'])
  })

  it('keeps every row outside the range as it was, and a selected row inside it selected', () => {
    expect(sorted(swipeSelection(items, set('mia', 'zed'), 'row:otto', 'row:kevin', 'select'))).toEqual(['kevin', 'mia', 'otto', 'zed'])
  })

  it('gives a row the finger leaves again its state from before the swipe', () => {
    const base = set('kevin')
    expect(sorted(swipeSelection(items, base, 'row:otto', 'row:linh', 'select'))).toEqual(['kevin', 'linh', 'otto', 'zed'])
    expect(sorted(swipeSelection(items, base, 'row:otto', 'row:zed', 'select'))).toEqual(['kevin', 'otto', 'zed'])
    const all = set('otto', 'zed', 'kevin', 'linh')
    expect(sorted(swipeSelection(items, all, 'row:zed', 'row:linh', 'deselect'))).toEqual(['otto'])
    expect(sorted(swipeSelection(items, all, 'row:zed', 'row:zed', 'deselect'))).toEqual(['kevin', 'linh', 'otto'])
  })

  it('does not change the selection it starts from', () => {
    const base = set('mia')
    swipeSelection(items, base, 'row:otto', 'row:linh', 'select')
    expect(sorted(base)).toEqual(['mia'])
  })

  it('changes nothing for a key the list no longer shows', () => {
    const base = set('mia')
    expect(swipeSelection(items, base, 'row:gone', 'row:otto', 'select')).toBe(base)
    expect(swipeSelection(items, base, 'row:otto', 'row:gone', 'select')).toBe(base)
  })
})

describe('pinAt, the pin under the finger', () => {
  it('finds the pin whose cell contains the point', () => {
    expect(pinAt(pinCells, 48, 58)).toBe('pinned:hermes')
    expect(pinAt(pinCells, 140, 58)).toBe('pinned:noor')
  })

  it('finds nothing in the gap between cells', () => {
    expect(pinAt(pinCells, 108, 58)).toBeNull()
    expect(pinAt(pinCells, 48, 128)).toBeNull()
  })

  it('finds the pin on the second wrapped line', () => {
    expect(pinAt(pinCells, 48, 200)).toBe('pinned:mia')
  })
})

describe('swipeSelection over the pinned avatars', () => {
  it('selects from the start pin to a pin on the next wrapped line', () => {
    expect(sorted(swipeSelection(pins, set(), 'pinned:hermes', 'pinned:mia', 'select'))).toEqual(['hermes', 'mia', 'noor'])
  })

  it('gives a pin the finger leaves again its state from before the swipe', () => {
    expect(sorted(swipeSelection(pins, set(), 'pinned:hermes', 'pinned:noor', 'select'))).toEqual(['hermes', 'noor'])
  })

  it('deselects the range when the swipe starts on a selected pin', () => {
    const base = set('hermes', 'noor', 'mia')
    expect(sorted(swipeSelection(pins, base, 'pinned:hermes', 'pinned:mia', 'deselect'))).toEqual([])
  })

  it('leaves the rows selection in base untouched', () => {
    const base = set('otto')
    expect(sorted(swipeSelection(pins, base, 'pinned:hermes', 'pinned:mia', 'select'))).toEqual(['hermes', 'mia', 'noor', 'otto'])
  })
})

describe('autoScrollSpeed', () => {
  const height = 600

  it('is 0 while the finger is away from both edges', () => {
    expect(autoScrollSpeed(300, height)).toBe(0)
    expect(autoScrollSpeed(AUTO_SCROLL_EDGE, height)).toBe(0)
    expect(autoScrollSpeed(height - AUTO_SCROLL_EDGE, height)).toBe(0)
  })

  it('scrolls up near the top edge and down near the bottom edge', () => {
    expect(autoScrollSpeed(30, height)).toBeLessThan(0)
    expect(autoScrollSpeed(height - 30, height)).toBeGreaterThan(0)
  })

  it('is faster closer to the edge, full speed at the edge and past it', () => {
    expect(Math.abs(autoScrollSpeed(10, height))).toBeGreaterThan(Math.abs(autoScrollSpeed(40, height)))
    expect(autoScrollSpeed(30, height)).toBe(-AUTO_SCROLL_MAX_SPEED / 2)
    expect(autoScrollSpeed(0, height)).toBe(-AUTO_SCROLL_MAX_SPEED)
    expect(autoScrollSpeed(-25, height)).toBe(-AUTO_SCROLL_MAX_SPEED)
    expect(autoScrollSpeed(height, height)).toBe(AUTO_SCROLL_MAX_SPEED)
    expect(autoScrollSpeed(height + 25, height)).toBe(AUTO_SCROLL_MAX_SPEED)
  })

  it('keeps a still middle in a list shorter than both edge zones together', () => {
    expect(autoScrollSpeed(50, 100)).toBe(0)
    expect(autoScrollSpeed(20, 100)).toBeLessThan(0)
    expect(autoScrollSpeed(80, 100)).toBeGreaterThan(0)
  })

  it('is 0 before the list is measured', () => {
    expect(autoScrollSpeed(0, 0)).toBe(0)
  })
})

describe('autoScrollOffset', () => {
  it('moves the offset by the speed over the frame time', () => {
    expect(autoScrollOffset(100, 1000, 16, 2000)).toBe(116)
    expect(autoScrollOffset(100, -1000, 16, 2000)).toBe(84)
  })

  it('stops at the list ends', () => {
    expect(autoScrollOffset(5, -1000, 16, 2000)).toBe(0)
    expect(autoScrollOffset(1995, 1000, 16, 2000)).toBe(2000)
  })

  it('does not scroll a list that fits on the screen', () => {
    expect(autoScrollOffset(0, 1000, 16, -120)).toBe(0)
  })

  it('caps a long frame, so a stall does not jump the list', () => {
    expect(autoScrollOffset(100, 1000, 500, 5000)).toBe(150)
  })
})
