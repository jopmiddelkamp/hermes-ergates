import { describe, expect, it } from 'vitest'

import { CIRCLE_COLUMN, HANDLE_WIDTH, handleOffset, rowOffsets } from './row-offsets'

const GUTTER = 20
/** An arbitrary row width; the invariants below hold for any width, since it cancels out of the comparison. */
const ROW_WIDTH = 400

/** The time and the unread dot's right edge, from the static layout's reserved right edge plus the body's own shift and their own extra one. */
function timeRightEdge(p: number): number {
  const staticRightEdge = ROW_WIDTH - GUTTER - CIRCLE_COLUMN - HANDLE_WIDTH
  const { body, timeDot } = rowOffsets(p, GUTTER)
  return staticRightEdge + body + timeDot
}

/** The ≡ box's left edge, flush against the row's own right edge in the static layout, shifted by its own offset. */
function handleLeftEdge(p: number): number {
  const staticLeftEdge = ROW_WIDTH - GUTTER - HANDLE_WIDTH
  return staticLeftEdge + rowOffsets(p, GUTTER).handle
}

describe('rowOffsets', () => {
  it('rests at the normal-mode position when progress is 0: no shift on the body, the full column on the time and the dot, and the handle off to the right', () => {
    expect(rowOffsets(0, GUTTER)).toEqual({ body: 0, timeDot: CIRCLE_COLUMN + HANDLE_WIDTH, handle: HANDLE_WIDTH + GUTTER })
  })

  it('rests at the Edit-mode position when progress is 1: the body shifted by the circle column, nothing extra on the time and the dot, and the handle at its own place', () => {
    expect(rowOffsets(1, GUTTER)).toEqual({ body: CIRCLE_COLUMN, timeDot: 0, handle: 0 })
  })

  it('matches the normal-mode and the Edit-mode row positions exactly at the ends', () => {
    expect(timeRightEdge(0)).toBe(ROW_WIDTH - GUTTER)
    expect(timeRightEdge(1)).toBe(ROW_WIDTH - GUTTER - HANDLE_WIDTH)
    expect(handleLeftEdge(0)).toBe(ROW_WIDTH)
    expect(handleLeftEdge(1)).toBe(ROW_WIDTH - GUTTER - HANDLE_WIDTH)
  })

  it('never lets the handle draw over the time or the dot, at any progress', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(handleLeftEdge(p)).toBeGreaterThanOrEqual(timeRightEdge(p))
    }
  })

  it('closes the gap between the handle and the time linearly, reaching 0 only at the very end', () => {
    const gaps = [0, 0.25, 0.5, 0.75, 1].map(p => handleLeftEdge(p) - timeRightEdge(p))
    expect(gaps).toEqual([GUTTER, GUTTER * 0.75, GUTTER * 0.5, GUTTER * 0.25, 0])
  })
})

describe('handleOffset', () => {
  it('matches the handle value rowOffsets computes, for a row or a section header alike', () => {
    for (const p of [0, 0.3, 0.6, 1]) {
      expect(handleOffset(p, GUTTER)).toBe(rowOffsets(p, GUTTER).handle)
    }
  })

  it('rests at 0 in Edit mode and at the full box width outside it', () => {
    expect(handleOffset(1, GUTTER)).toBe(0)
    expect(handleOffset(0, GUTTER)).toBe(HANDLE_WIDTH + GUTTER)
  })
})
