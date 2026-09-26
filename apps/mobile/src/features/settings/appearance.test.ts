import { describe, expect, it } from 'vitest'

import { listMobileThemes } from '@/theme/resolve'

import { APPEARANCE_LABELS, appearanceSummary, isSelectedTheme } from './appearance'

const themes = listMobileThemes()

describe('the Appearance row', () => {
  it('names the mode and the theme, such as "System · Nous"', () => {
    expect(appearanceSummary('system', 'default', themes)).toBe('System · Nous')
    expect(appearanceSummary('dark', 'nous', themes)).toBe('Dark · Nous')
    expect(APPEARANCE_LABELS.light).toBe('Light')
  })

  it('falls back to Nous for a theme this phone cannot show, as the theme itself does', () => {
    expect(appearanceSummary('light', 'gone-skin', themes)).toBe('Light · Nous')
  })

  it('treats the stored default theme as Nous', () => {
    expect(isSelectedTheme('default', 'nous')).toBe(true)
    expect(isSelectedTheme('nous', 'nous')).toBe(true)
    expect(isSelectedTheme('default', 'midnight')).toBe(false)
  })
})
