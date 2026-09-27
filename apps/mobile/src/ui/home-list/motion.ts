/**
 * The Edit mode motion (docs/10 "Home edit mode"): a progress value from 0
 * to 1 that the circles, handles, badges and bars read, 250 ms ease in-out
 * both ways. Home keeps one for Edit mode and the bottom bar one for being
 * shown. With the system setting Reduce motion on, the value jumps
 * (`ReduceMotion.System`), so every change is instant.
 */

import { useEffect } from 'react'
import { Easing, ReduceMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'

export const EDIT_MOTION_MS = 250

const TIMING = { duration: EDIT_MOTION_MS, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System }

/** 1 while `shown`, 0 while not, and the 250 ms between them. */
export function useShowProgress(shown: boolean): SharedValue<number> {
  const progress = useSharedValue(shown ? 1 : 0)
  useEffect(() => {
    progress.set(withTiming(shown ? 1 : 0, TIMING))
  }, [shown, progress])
  return progress
}
