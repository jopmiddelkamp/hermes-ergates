import { describe, expect, it } from 'vitest'

import { listMobileThemes, resolvePalette } from './resolve'
import { softFill } from './fill'

describe('softFill', () => {
  it('falls back to muted when the surface cannot be parsed', () => {
    expect(softFill({ muted: '#112233', background: '#000000' }, 'not-a-color')).toBe('#112233')
  })

  it('falls back to muted when muted or background cannot be parsed', () => {
    expect(softFill({ muted: '#112233', background: 'not-a-color' }, '#ffffff')).toBe('#112233')
    expect(softFill({ muted: 'not-a-color', background: '#000000' }, '#ffffff')).toBe('not-a-color')
  })

  it('accepts #rgb, #rrggbb and #rrggbbaa for every color, with or without the leading #', () => {
    // #08f (no leading #) expands to #0088ff; muted (black) sits marginally farther from it than background (white).
    expect(softFill({ muted: '#000000', background: '#ffffff' }, '08f')).toBe('#000000')
    // Trailing alpha is dropped: #ffffff00 reads as plain white, so it sits right on top of a white background
    // (distance 0) and farther from black muted, which is why muted (the farther color) wins.
    expect(softFill({ muted: '#000000', background: '#ffffff' }, '#ffffff00')).toBe('#000000')
  })

  it('Nous dark: returns background on the popover surface, muted on the page surface', () => {
    const theme = resolvePalette({ themeName: 'nous', appearance: 'dark', systemDark: false })
    expect(theme.colors.muted).toBe('#1a1e24')
    expect(theme.colors.popover).toBe('#161b22')
    expect(softFill(theme.colors, theme.colors.popover)).toBe(theme.colors.background)
    expect(softFill(theme.colors, theme.colors.background)).toBe(theme.colors.muted)
  })

  it('differs from the surface it sits on, for every bundled theme in both light and dark', () => {
    const themes = listMobileThemes()
    expect(themes.length).toBeGreaterThan(0)

    for (const { name } of themes) {
      for (const appearance of ['light', 'dark'] as const) {
        const theme = resolvePalette({ themeName: name, appearance, systemDark: appearance === 'dark' })

        for (const surface of [theme.colors.popover, theme.colors.background]) {
          const fill = softFill(theme.colors, surface)
          expect(fill.toLowerCase(), `${name} ${appearance} on surface ${surface}`).not.toBe(surface.toLowerCase())
        }
      }
    }
  })
})
