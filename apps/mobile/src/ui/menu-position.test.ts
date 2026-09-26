import { describe, expect, it } from 'vitest'

import { menuPosition } from './menu-position'

// An iPhone 17 in portrait: 402 x 874 points, 62 at the top (status bar and
// Dynamic Island) and 34 at the bottom (home indicator).
const screen = { width: 402, height: 874 }
const insets = { top: 62, bottom: 34, left: 0, right: 0 }
const size = { width: 240, height: 440 }

const place = (anchorY: number, options: { keyboardHeight?: number; height?: number; insets?: typeof insets } = {}) =>
  menuPosition({
    anchor: { x: 20, y: anchorY, width: 362, height: 64 },
    screen,
    insets: options.insets ?? insets,
    keyboardHeight: options.keyboardHeight ?? 0,
    menu: { width: size.width, height: options.height ?? size.height },
    margin: 8
  })

describe('menuPosition', () => {
  it('opens below the row when the menu fits there', () => {
    expect(place(100).top).toBe(172)
  })

  it('opens above the row when it only fits there', () => {
    expect(place(700).top).toBe(700 - 8 - 440)
  })

  it('never reaches into the top safe area, even when neither side fits', () => {
    const { top } = place(370)
    expect(top).toBeGreaterThanOrEqual(62 + 8)
    expect(top + 440).toBeLessThanOrEqual(874 - 34 - 8)
  })

  it('never reaches into the bottom safe area', () => {
    const { top } = place(760, { height: 200 })
    expect(top + 200).toBeLessThanOrEqual(874 - 34 - 8)
  })

  it('keeps clear of the keyboard, which covers the bottom safe area', () => {
    const { top } = place(600, { height: 200, keyboardHeight: 336 })
    expect(top + 200).toBeLessThanOrEqual(874 - 336 - 8)
    expect(top).toBeGreaterThanOrEqual(62 + 8)
  })

  it('pins a menu taller than the safe area to its top', () => {
    expect(place(300, { height: 900 }).top).toBe(62 + 8)
  })

  it('keeps the menu inside the side insets', () => {
    const wide = { top: 0, bottom: 21, left: 59, right: 59 }
    const left = menuPosition({
      anchor: { x: 0, y: 100, width: 874, height: 64 },
      screen: { width: 874, height: 402 },
      insets: wide,
      keyboardHeight: 0,
      menu: { width: 240, height: 200 },
      margin: 8
    }).left
    expect(left).toBeGreaterThanOrEqual(59 + 8)
    const right = menuPosition({
      anchor: { x: 800, y: 100, width: 60, height: 64 },
      screen: { width: 874, height: 402 },
      insets: wide,
      keyboardHeight: 0,
      menu: { width: 240, height: 200 },
      margin: 8
    }).left
    expect(right + 240).toBeLessThanOrEqual(874 - 59 - 8)
  })
})
