/**
 * Mobile theme object consumed by components (docs/10 sections 2–4).
 * Colors are the vendored Hermes semantic tokens; geometry is the 10 section 4 contract.
 */

import type { DesktopThemeColors } from '@vendor/hermes/themes/types'

export type Appearance = 'system' | 'light' | 'dark'

export interface MobileTheme {
  name: string
  dark: boolean
  colors: DesktopThemeColors & { midground: string; userBubble: string }
  radius: { bubble: 22; composer: 24; group: 20; sheet: 28 }
  spacing: readonly [4, 8, 12, 16, 24, 32]
  /**
   * Horizontal page gutter. Applied by `Screen` and `Sheet` only — rows,
   * section headings and the chat list sit inside an already-padded page and
   * must not add it again (I2).
   */
  pagePadding: 20
  /** Minimum hit area for controls, in points. */
  hit: 44
}

export const RADIUS = { bubble: 22, composer: 24, group: 20, sheet: 28 } as const
export const SPACING = [4, 8, 12, 16, 24, 32] as const
export const PAGE_PADDING = 20
export const HIT = 44
