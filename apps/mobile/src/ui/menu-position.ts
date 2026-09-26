/**
 * Where the long-press menu's card goes (docs/10 "Bot actions"): next to the
 * pressed row, and never under the status bar, the Dynamic Island, the home
 * indicator, a side notch or the keyboard. Pure, so Node tests cover it.
 */

export interface MenuRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MenuInsets {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MenuPositionInput {
  anchor: MenuRect
  screen: { width: number; height: number }
  insets: MenuInsets
  /** Height of the open keyboard, 0 when closed. It covers the bottom safe area. */
  keyboardHeight: number
  menu: { width: number; height: number }
  margin: number
}

/**
 * Below the row when the card fits there, else above it. When neither side
 * fits, the side with more room, pulled back inside the safe area even if it
 * then covers part of the row. A card taller than the safe area pins to its top.
 */
export function menuPosition({ anchor, screen, insets, keyboardHeight, menu, margin }: MenuPositionInput): { top: number; left: number } {
  const minTop = insets.top + margin
  const maxBottom = screen.height - Math.max(insets.bottom, keyboardHeight) - margin
  const below = anchor.y + anchor.height + margin
  const above = anchor.y - margin - menu.height

  let top: number
  if (below + menu.height <= maxBottom) {
    top = below
  } else if (above >= minTop) {
    top = above
  } else {
    const roomBelow = maxBottom - below
    const roomAbove = anchor.y - margin - minTop
    top = roomBelow >= roomAbove ? maxBottom - menu.height : minTop
  }
  top = Math.max(Math.min(top, maxBottom - menu.height), minTop)

  const minLeft = insets.left + margin
  const maxLeft = Math.max(minLeft, screen.width - insets.right - margin - menu.width)
  const left = Math.min(Math.max(anchor.x, minLeft), maxLeft)
  return { top, left }
}
