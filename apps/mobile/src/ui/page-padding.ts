/**
 * The page's horizontal padding (docs/10 section 4): the theme's padding, 16
 * on narrow phones. `Screen` pads every page with it. A full-bleed list (the
 * Home lists) cancels it with `bleed` and pads each of its own rows by the
 * same amount instead, so a row's tap highlight, a lifted row and the scroll
 * bar reach the screen edges while the row content stays in line with the
 * rest of the page.
 */

const NARROW_WIDTH = 360
const NARROW_PADDING = 16

export function pagePadding(windowWidth: number, themePadding: number): number {
  return windowWidth < NARROW_WIDTH ? NARROW_PADDING : themePadding
}

/** The style that stretches a list inside `Screen` to the screen edges. */
export function bleed(padding: number): { marginHorizontal: number } {
  return { marginHorizontal: -padding }
}
