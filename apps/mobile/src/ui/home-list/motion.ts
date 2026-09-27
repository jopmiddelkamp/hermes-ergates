/**
 * The Edit mode motion (docs/10 "Home edit mode"): a progress value from 0
 * to 1 that the circles, handles, badges and bars read, 250 ms ease in-out
 * both ways. Home keeps one for Edit mode and the bottom bar one for being
 * shown. With the system setting Reduce motion on, the value jumps
 * (`ReduceMotion.System`), so every change is instant.
 *
 * Rows and section headers also need a one-time layout switch (their static
 * Edit-mode space), not an animated one: see `useLayoutEditing` and
 * `layout-editing.ts`'s `nextLayoutEditing` for the rule.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Easing, ReduceMotion, useAnimatedReaction, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { nextLayoutEditing } from './layout-editing'

const EDIT_MOTION_MS = 250

const TIMING = { duration: EDIT_MOTION_MS, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System }

/** 1 while `shown`, 0 while not, and the 250 ms between them. */
export function useShowProgress(shown: boolean): SharedValue<number> {
  const progress = useSharedValue(shown ? 1 : 0)
  useEffect(() => {
    progress.set(withTiming(shown ? 1 : 0, TIMING))
  }, [shown, progress])
  return progress
}

/**
 * Whether rows and section headers should reserve their static Edit-mode
 * space right now (`nextLayoutEditing`'s rule). It turns on in the same
 * render `editing` does (with Reduce motion on, `progress` jumps straight to
 * 0 or 1, so the same rule still applies, just without anything in between)
 * and turns off only once `progress` actually reaches 0 after a leave; a
 * `useAnimatedReaction` watches for that on the UI thread and reports it
 * back with `scheduleOnRN`. A ref holds the latest `editing`, so a leave
 * that finishes after Edit mode has already turned back on does not switch
 * the layout back to normal underneath it.
 */
export function useLayoutEditing(editing: boolean, progress: SharedValue<number>): boolean {
  const [layoutEditing, setLayoutEditing] = useState(editing)
  const applied = nextLayoutEditing(layoutEditing, editing, false)
  if (applied !== layoutEditing) {
    setLayoutEditing(applied)
  }

  const editingRef = useRef(editing)
  editingRef.current = editing
  const onLeaveReachedZero = useCallback(() => {
    setLayoutEditing(current => nextLayoutEditing(current, editingRef.current, true))
  }, [])

  useAnimatedReaction(
    () => progress.get(),
    (value, previous) => {
      if (value === 0 && previous !== null && previous !== 0) {
        scheduleOnRN(onLeaveReachedZero)
      }
    },
    [onLeaveReachedZero]
  )

  return layoutEditing
}
