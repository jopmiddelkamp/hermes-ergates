/**
 * What Settings says about the look (docs/10 "Settings and agent details"):
 * the Appearance row's subtitle and which theme is checked. Pure, so Node
 * tests cover it.
 */

import type { Prefs } from '@/state/device-store'

export type AppearanceMode = Prefs['appearance']

export const APPEARANCE_LABELS: Record<AppearanceMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** The stored theme `default` is Nous. */
export function isSelectedTheme(themeName: string, candidate: string): boolean {
  return themeName === candidate || (themeName === 'default' && candidate === 'nous')
}

/** "System · Nous": the mode, then the theme, which falls back to Nous when this phone cannot show it. */
export function appearanceSummary(appearance: AppearanceMode, themeName: string, themes: { name: string; label: string }[]): string {
  const theme = themes.find(t => isSelectedTheme(themeName, t.name)) ?? themes.find(t => t.name === 'nous')
  return `${APPEARANCE_LABELS[appearance]} · ${theme?.label ?? 'Nous'}`
}
