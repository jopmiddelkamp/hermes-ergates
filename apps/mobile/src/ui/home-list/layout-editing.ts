/**
 * The static-layout switch behind Home's Edit mode motion (docs/10 "Home
 * edit mode"): whether a row or a section header should reserve its
 * Edit-mode space (the circle and the ≡ column) right now. No React or
 * React Native, so Node tests cover the rule; `useLayoutEditing` in
 * `motion.ts` supplies the two events it reacts to and holds the result in
 * state.
 *
 * Unlike `editing` (which flips the instant Done or Edit is tapped) this
 * switches to Edit layout at once, but back to normal layout only once the
 * leave animation's progress has actually reached 0 - never mid-animation,
 * so the layout never relayouts while anything is still moving, and never
 * if Edit mode turned back on again before the leave finished.
 */

/**
 * The next value: `editing` on its own always wins, even over a leave that
 * has already reached 0 (a re-entry after the leave). Otherwise, reaching 0
 * turns it off; short of that it keeps its current value, so a leave in
 * progress (not yet at 0) stays in Edit layout.
 */
export function nextLayoutEditing(current: boolean, editing: boolean, reachedZero: boolean): boolean {
  if (editing) {
    return true
  }
  if (reachedZero) {
    return false
  }
  return current
}
