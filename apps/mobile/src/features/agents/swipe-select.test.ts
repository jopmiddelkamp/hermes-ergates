import { describe, expect, it } from 'vitest'

import type { Section } from '@/state/organization'

import { EDIT_ITEM_HEIGHT } from './drop-rules'
import { buildEditItems, type EditLayout, type Selection } from './edit-mode'
import type { Bot } from './roster'
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_SPEED,
  autoScrollOffset,
  autoScrollSpeed,
  lineAt,
  lineTop,
  swipeLines,
  swipeMode,
  swipeSelection
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
 * Hermes (the concierge), Noor and Mia pinned; Otto and Zed without a section;
 * Kevin and Linh in Prive; Work empty. Content y of each line, top to bottom:
 * Pinned caption 0, Hermes 36, Noor 100, Mia 164, No section caption 228,
 * Otto 264, Zed 328, Prive header 392, Kevin 440, Linh 504, Work header 568,
 * end 616.
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

const items = buildEditItems(layout())
const lines = swipeLines(items)
const set = (...profiles: string[]): Selection => new Set(profiles)
const sorted = (selection: Selection) => [...selection].sort()

describe('the lines the swipe measures', () => {
  it('lists every item with the fixed height the edit list draws it at', () => {
    expect(lines.map(l => l.key)).toEqual(items.map(i => i.key))
    expect(lines[0]).toEqual({ key: 'caption:pinned', height: EDIT_ITEM_HEIGHT.caption })
    expect(lines[1]).toEqual({ key: 'pinned:hermes', height: EDIT_ITEM_HEIGHT.pinned })
    expect(lines[5]).toEqual({ key: 'row:otto', height: EDIT_ITEM_HEIGHT.row })
    expect(lines[7]).toEqual({ key: 'section:prive', height: EDIT_ITEM_HEIGHT.section })
  })

  it('finds the top of a line, counting the captions and section headers above it', () => {
    expect(lineTop(lines, 'caption:pinned')).toBe(0)
    expect(lineTop(lines, 'pinned:hermes')).toBe(36)
    expect(lineTop(lines, 'row:otto')).toBe(264)
    expect(lineTop(lines, 'row:kevin')).toBe(440)
  })

  it('has no top for a key the list does not show', () => {
    expect(lineTop(lines, 'row:gone')).toBe(-1)
  })
})

describe('lineAt, the line under the finger', () => {
  it('finds the line at a content y, past the captions and section headers above it', () => {
    expect(lineAt(lines, 36)).toBe('pinned:hermes')
    expect(lineAt(lines, 99.5)).toBe('pinned:hermes')
    expect(lineAt(lines, 100)).toBe('pinned:noor')
    expect(lineAt(lines, 300)).toBe('row:otto')
    expect(lineAt(lines, 450)).toBe('row:kevin')
    expect(lineAt(lines, 567)).toBe('row:linh')
  })

  it('reports a caption or section header under the finger as itself; the range skips it', () => {
    expect(lineAt(lines, 10)).toBe('caption:pinned')
    expect(lineAt(lines, 240)).toBe('caption:none')
    expect(lineAt(lines, 400)).toBe('section:prive')
  })

  it('takes the first line above the list and the last line below it', () => {
    expect(lineAt(lines, -40)).toBe('caption:pinned')
    expect(lineAt(lines, 616)).toBe('section:work')
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
    expect(swipeMode(items, set('hermes'), 'pinned:hermes')).toBe('deselect')
  })
})

describe('swipeSelection', () => {
  it('selects the start row alone while the finger has not left it, as a tap would', () => {
    expect(sorted(swipeSelection(items, set(), 'row:otto', 'row:otto', 'select'))).toEqual(['otto'])
  })

  it('selects every row from the start row down to the row under the finger, skipping the section header', () => {
    expect(sorted(swipeSelection(items, set(), 'row:otto', 'row:kevin', 'select'))).toEqual(['kevin', 'otto', 'zed'])
  })

  it('selects upward too, pins and the pinned concierge included, skipping the caption', () => {
    expect(sorted(swipeSelection(items, set(), 'row:zed', 'pinned:hermes', 'select'))).toEqual(['hermes', 'mia', 'noor', 'otto', 'zed'])
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
