import { describe, expect, it } from 'vitest'

import { bottomPadding } from './safe-area'

describe('bottomPadding', () => {
  it('adds the device inset to the screen\'s own bottom padding', () => {
    expect(bottomPadding(24, 34, false)).toBe(58)
  })

  it('is just the inset for a fixed bar that has no padding of its own', () => {
    expect(bottomPadding(0, 34, false)).toBe(34)
  })

  it('changes nothing where the device reports no bottom inset (Android edge-to-edge, no gesture bar)', () => {
    expect(bottomPadding(24, 0, false)).toBe(24)
    expect(bottomPadding(0, 0, false)).toBe(0)
  })

  it('drops the inset while the keyboard is open, so it is not counted twice above it', () => {
    expect(bottomPadding(24, 34, true)).toBe(24)
    expect(bottomPadding(0, 34, true)).toBe(0)
  })
})
