/**
 * A row or section header's Edit-mode transforms as pure numbers (docs/10
 * "Home edit mode"). No React or React Native, so Node tests cover the
 * geometry; the functions carry the 'worklet' directive because
 * `HomeRow.tsx` and `HomeSectionHeader.tsx` call them from inside
 * `useAnimatedStyle`, on the UI thread.
 *
 * The static layout (see `useLayoutEditing` in `motion.ts`) reserves
 * `gutter + CIRCLE_COLUMN + HANDLE_WIDTH` on the right for the whole Edit
 * session, entering to leaving, so it never relayouts mid-animation. These
 * transforms make that reservation look, at every progress `p` from 0 to 1,
 * exactly like the tighter normal layout at p=0 and the full Edit layout at
 * p=1, with nothing else moving in between. `layoutEditing` says which of
 * the two layouts is actually in place; while it is false there is no
 * reservation to compensate for, so every offset is 0.
 *
 * With row width `W` and page gutter `g`: the row body's left edge sits at
 * `g + p*C`; the time and the unread dot's right edge sits at `W - g - p*H`;
 * the ≡ box's left edge sits at `W - g - H + (1-p)*(H+g)`, sliding in from
 * the right. The body already sits at `g` in the static layout, so
 * `translateX: p*C` (`body`) alone gives it that position. The time and dot
 * sit flush against the body's static right edge, `W - g - C - H`; reaching
 * `W - g - p*H` from there takes the body's own `p*C` plus their own
 * `(1-p)*(C+H)` (`timeDot`): `(W-g-C-H) + p*C + (1-p)*(C+H) = W-g-p*H`. The
 * ≡ box sits flush against the row's own right edge, `W - g - H`, in the
 * static layout, so reaching `W-g-H+(1-p)*(H+g)` from there takes
 * `(1-p)*(H+g)` (`handleOffset`). At every `p` the ≡'s left edge is at or
 * right of the time's right edge: the difference works out to `g*(1-p)`,
 * which is never negative.
 */

/** The selection circle's own size, on a row (`SelectionCircle` imports this). */
export const CIRCLE_SIZE = 22
/** The circle's own box: the circle (`CIRCLE_SIZE`) and the space up to the avatar. */
export const CIRCLE_COLUMN = CIRCLE_SIZE + 12
/** The ≡ box, right of a row's or a header's content. */
export const HANDLE_WIDTH = 44

export interface RowOffsets {
  /** The row body's translateX (avatar, name, preview). */
  body: number
  /** The extra translateX on the time and the unread dot, on top of the body's own shift. */
  timeDot: number
  /** The ≡ box's translateX; it slides in from the right as `p` grows. */
  handle: number
}

// Declared above `rowOffsets`, which closes over it: the worklets Babel
// plugin turns a 'worklet' function into a factory evaluated at module load
// (see `drop-rules.ts`), and a function declared below the one that closes
// over it crashes on device with a temporal-dead-zone error, though it
// passes the Node tests either way.

/** A section header's ≡ box translateX at progress `p` (0 to 1) and page gutter `g`, while the static Edit layout (`layoutEditing`) is in place; 0 while it is not. The same slide as a row's. */
export function handleOffset(p: number, gutter: number, layoutEditing: boolean): number {
  'worklet'
  return layoutEditing ? (1 - p) * (HANDLE_WIDTH + gutter) : 0
}

/** A row's three Edit-mode transforms at progress `p` (0 to 1) and page gutter `g`, while the static Edit layout (`layoutEditing`) is in place; all 0 while it is not. */
export function rowOffsets(p: number, gutter: number, layoutEditing: boolean): RowOffsets {
  'worklet'
  return {
    body: layoutEditing ? p * CIRCLE_COLUMN : 0,
    timeDot: layoutEditing ? (1 - p) * (CIRCLE_COLUMN + HANDLE_WIDTH) : 0,
    handle: handleOffset(p, gutter, layoutEditing)
  }
}
