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
 * p=1, with nothing else moving in between.
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

/** The circle's own box: the circle (`SelectionCircle.CIRCLE_SIZE`, 22 pt) and the space up to the avatar. */
export const CIRCLE_COLUMN = 34
/** The ≡ box, right of a row's or a header's content. */
export const HANDLE_WIDTH = 52

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

/** A section header's ≡ box translateX at progress `p` (0 to 1) and page gutter `g`; the same slide as a row's. */
export function handleOffset(p: number, gutter: number): number {
  'worklet'
  return (1 - p) * (HANDLE_WIDTH + gutter)
}

/** A row's three Edit-mode transforms at progress `p` (0 to 1) and page gutter `g`. */
export function rowOffsets(p: number, gutter: number): RowOffsets {
  'worklet'
  return {
    body: p * CIRCLE_COLUMN,
    timeDot: (1 - p) * (CIRCLE_COLUMN + HANDLE_WIDTH),
    handle: handleOffset(p, gutter)
  }
}
