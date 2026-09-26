import { describe, expect, it } from 'vitest'

import { bleed, pagePadding } from './page-padding'

describe('pagePadding', () => {
  it('is the theme padding on an ordinary phone', () => {
    expect(pagePadding(390, 20)).toBe(20)
    expect(pagePadding(360, 20)).toBe(20)
  })

  it('is 16 on a phone narrower than 360 points', () => {
    expect(pagePadding(359, 20)).toBe(16)
    expect(pagePadding(320, 20)).toBe(16)
  })

  it('follows whatever padding the theme sets', () => {
    expect(pagePadding(430, 24)).toBe(24)
  })
})

describe('bleed', () => {
  it('cancels the page padding on both sides, so a list spans the screen width', () => {
    expect(bleed(20)).toEqual({ marginHorizontal: -20 })
    expect(bleed(16)).toEqual({ marginHorizontal: -16 })
  })
})
