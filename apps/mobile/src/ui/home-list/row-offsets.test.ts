import { describe, expect, it } from 'vitest'

import { CIRCLE_COLUMN, CIRCLE_SIZE, HANDLE_WIDTH, handleOffset, rowOffsets } from './row-offsets'

const GUTTER = 20
/** An arbitrary row width; the invariants below hold for any width, since it cancels out of the comparison. */
const ROW_WIDTH = 400

/** The time and the unread dot's right edge, from the static layout's reserved right edge (only reserved while `layoutEditing`) plus the body's own shift and their own extra one. */
function timeRightEdge(p: number, layoutEditing: boolean): number {
  const staticRightEdge = ROW_WIDTH - GUTTER - (layoutEditing ? CIRCLE_COLUMN + HANDLE_WIDTH : 0)
  const { body, timeDot } = rowOffsets(p, GUTTER, layoutEditing)
  return staticRightEdge + body + timeDot
}

/** The ≡ box's left edge, flush against the row's own right edge in the static layout, shifted by its own offset. */
function handleLeftEdge(p: number, layoutEditing: boolean): number {
  const staticLeftEdge = ROW_WIDTH - GUTTER - HANDLE_WIDTH
  return staticLeftEdge + rowOffsets(p, GUTTER, layoutEditing).handle
}

describe('rowOffsets', () => {
  it('rests at 0 on every offset outside the Edit layout, whatever progress reads', () => {
    for (const p of [0, 0.5, 1]) {
      expect(rowOffsets(p, GUTTER, false)).toEqual({ body: 0, timeDot: 0, handle: 0 })
    }
  })

  it('rests at the normal-mode position when progress is 0 while the Edit layout is still in place (leaving Edit mode): no shift on the body, the full column on the time and the dot, and the handle off to the right', () => {
    expect(rowOffsets(0, GUTTER, true)).toEqual({ body: 0, timeDot: CIRCLE_COLUMN + HANDLE_WIDTH, handle: HANDLE_WIDTH + GUTTER })
  })

  it('rests at the Edit-mode position when progress is 1: the body shifted by the circle column, nothing extra on the time and the dot, and the handle at its own place', () => {
    expect(rowOffsets(1, GUTTER, true)).toEqual({ body: CIRCLE_COLUMN, timeDot: 0, handle: 0 })
  })

  it('matches the normal-mode and the Edit-mode row positions exactly at the ends, while the Edit layout is in place', () => {
    expect(timeRightEdge(0, true)).toBe(ROW_WIDTH - GUTTER)
    expect(timeRightEdge(1, true)).toBe(ROW_WIDTH - GUTTER - HANDLE_WIDTH)
    expect(handleLeftEdge(0, true)).toBe(ROW_WIDTH)
    expect(handleLeftEdge(1, true)).toBe(ROW_WIDTH - GUTTER - HANDLE_WIDTH)
  })

  it('never lets the handle draw over the time or the dot, at any progress, while the Edit layout is in place', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(handleLeftEdge(p, true)).toBeGreaterThanOrEqual(timeRightEdge(p, true))
    }
  })

  it('closes the gap between the handle and the time linearly, reaching 0 only at the very end', () => {
    const gaps = [0, 0.25, 0.5, 0.75, 1].map(p => handleLeftEdge(p, true) - timeRightEdge(p, true))
    expect(gaps).toEqual([GUTTER, GUTTER * 0.75, GUTTER * 0.5, GUTTER * 0.25, 0])
  })

  it("places the time's right edge correctly in both layouts, at rest and mid-toggle", () => {
    const W = 402
    const g = 20
    const rightEdge = (p: number, layoutEditing: boolean) => {
      const staticRightEdge = W - g - (layoutEditing ? CIRCLE_COLUMN + HANDLE_WIDTH : 0)
      const { body, timeDot } = rowOffsets(p, g, layoutEditing)
      return staticRightEdge + body + timeDot
    }
    for (const p of [0, 0.5, 1]) {
      expect(rightEdge(p, false)).toBe(W - g)
      expect(rightEdge(p, true)).toBe(W - g - p * HANDLE_WIDTH)
    }
  })
})

describe('handleOffset', () => {
  it('matches the handle value rowOffsets computes, for a row or a section header alike, while the Edit layout is in place', () => {
    for (const p of [0, 0.3, 0.6, 1]) {
      expect(handleOffset(p, GUTTER, true)).toBe(rowOffsets(p, GUTTER, true).handle)
    }
  })

  it('rests at 0 in Edit mode and at the full box width outside it, while the Edit layout is in place', () => {
    expect(handleOffset(1, GUTTER, true)).toBe(0)
    expect(handleOffset(0, GUTTER, true)).toBe(HANDLE_WIDTH + GUTTER)
  })

  it('rests at 0 outside the Edit layout, whatever progress reads', () => {
    for (const p of [0, 0.5, 1]) {
      expect(handleOffset(p, GUTTER, false)).toBe(0)
    }
  })
})

describe('CIRCLE_COLUMN', () => {
  it('equals the selection circle size plus 12', () => {
    expect(CIRCLE_COLUMN).toBe(CIRCLE_SIZE + 12)
  })
})
