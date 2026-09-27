/**
 * Swipe to select in Home Edit mode (the rules are in the agents feature's
 * `swipe-select.ts`). Each row's circle column carries a pan with no minimum
 * distance: it takes the touch at its first move, so the scroll view never
 * gets it, and it applies the range at once, the start row included, so a
 * slight move on a tap still toggles the row exactly once. A touch that does
 * not move stays the row's own tap. On the UI thread the pan follows the line
 * under the finger and tells the JS thread only when that line changes; a
 * frame callback scrolls the list while the finger is near its top or bottom
 * edge, and the range grows with the rows that scroll under the finger.
 *
 * The rows list starts below the pinned avatars, so every y here is measured
 * from the top of the rows list, and `onListLayout` tells the gesture where
 * that top sits in the scroll content.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { Gesture, type PanGesture } from 'react-native-gesture-handler'
import Animated, { scrollTo, useFrameCallback, useScrollOffset, useSharedValue, type AnimatedRef, type FrameInfo } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { autoScrollOffset, autoScrollSpeed, lineAt, lineTop, swipeLines, swipeMode, swipeSelection, type ListItem, type Selection, type SwipeLine, type SwipeMode } from '@/features/agents'

/** What a row's selection circle needs from swipe to select. */
export interface SwipeSelect {
  /** Builds the swipe gesture for the row with this key. */
  gestureFor(key: string): PanGesture
  /** The row with this key left the list; a swipe that started on it ends. */
  forget(key: string): void
}

/** The swipe in progress, on the JS thread: where it started, the selection before it, and whether it selects or deselects. */
interface SwipeStart {
  startKey: string
  base: Selection
  mode: SwipeMode
}

export function useSwipeSelect(scrollRef: AnimatedRef<Animated.ScrollView>, items: ListItem[], selection: Selection, onSelectionChange: (selection: Selection) => void) {
  const lines = useSharedValue<SwipeLine[]>([])
  useEffect(() => {
    lines.set(swipeLines(items))
  }, [items, lines])
  const scrollOffset = useScrollOffset(scrollRef)
  const viewportHeight = useSharedValue(0)
  const contentHeight = useSharedValue(0)
  /** Where the rows list starts in the scroll content: below the error line and the pinned avatars. */
  const listTop = useSharedValue(0)
  const active = useSharedValue(false)
  // The line under the finger, the finger's distance from the list's visible
  // top edge, and the scroll offset the swipe keeps itself while it scrolls
  // (the scroll events report a new offset only a frame later).
  const currentKey = useSharedValue<string | null>(null)
  const fingerY = useSharedValue(0)
  const offset = useSharedValue(0)

  // The gestures are built once per row, so the JS side reads the latest props from here.
  const latest = useRef({ items, selection, onSelectionChange })
  latest.current = { items, selection, onSelectionChange }
  const swipe = useRef<SwipeStart | null>(null)

  const showLine = useCallback((key: string) => {
    const start = swipe.current
    if (start) {
      latest.current.onSelectionChange(swipeSelection(latest.current.items, start.base, start.startKey, key, start.mode))
    }
  }, [])

  const track = useCallback(
    (listY: number) => {
      'worklet'
      const key = lineAt(lines.get(), listY)
      if (key !== null && key !== currentKey.get()) {
        currentKey.set(key)
        scheduleOnRN(showLine, key)
      }
    },
    [lines, currentKey, showLine]
  )

  const autoScroll = useFrameCallback(
    useCallback(
      (frame: FrameInfo) => {
        'worklet'
        if (!active.get()) {
          return
        }
        const speed = autoScrollSpeed(fingerY.get(), viewportHeight.get())
        if (speed === 0) {
          return
        }
        const next = autoScrollOffset(offset.get(), speed, frame.timeSincePreviousFrame ?? 0, contentHeight.get() - viewportHeight.get())
        if (next === offset.get()) {
          return
        }
        offset.set(next)
        scrollTo(scrollRef, 0, next, false)
        track(fingerY.get() + next - listTop.get())
      },
      [active, fingerY, viewportHeight, offset, contentHeight, scrollRef, track, listTop]
    ),
    false
  )

  const begin = useCallback(
    (key: string) => {
      const { items: now, selection: base, onSelectionChange: change } = latest.current
      const mode = swipeMode(now, base, key)
      swipe.current = { startKey: key, base, mode }
      autoScroll.setActive(true)
      change(swipeSelection(now, base, key, key, mode))
    },
    [autoScroll]
  )

  const finish = useCallback(() => {
    swipe.current = null
    autoScroll.setActive(false)
  }, [autoScroll])

  // A row that leaves the list mid-swipe (a roster refresh) takes its gesture
  // with it, and that gesture never reports its end: end the swipe here, or
  // the auto-scroll would keep running on a finger that is gone.
  const forget = useCallback(
    (key: string) => {
      if (swipe.current?.startKey === key) {
        active.set(false)
        currentKey.set(null)
        finish()
      }
    },
    [active, currentKey, finish]
  )

  const gestureFor = useCallback(
    (key: string) =>
      Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .onStart(event => {
          'worklet'
          const top = lineTop(lines.get(), key)
          if (top < 0) {
            return
          }
          // `event.y` is measured from the top of this row's circle column, which scrolls with the content.
          const now = scrollOffset.get()
          offset.set(now)
          fingerY.set(listTop.get() + top + event.y - now)
          currentKey.set(key)
          active.set(true)
          scheduleOnRN(begin, key)
        })
        .onUpdate(event => {
          'worklet'
          if (!active.get()) {
            return
          }
          const listY = lineTop(lines.get(), key) + event.y
          fingerY.set(listTop.get() + listY - offset.get())
          track(listY)
        })
        .onFinalize(() => {
          'worklet'
          if (!active.get()) {
            return
          }
          active.set(false)
          currentKey.set(null)
          scheduleOnRN(finish)
        }),
    [lines, scrollOffset, offset, fingerY, listTop, currentKey, active, begin, track, finish]
  )

  const select = useMemo<SwipeSelect>(() => ({ gestureFor, forget }), [gestureFor, forget])

  return {
    select,
    /** The scroll view's own layout: its height is the viewport the auto-scroll edges are measured in. */
    onLayout: (event: LayoutChangeEvent) => {
      viewportHeight.set(event.nativeEvent.layout.height)
    },
    onContentSizeChange: (_width: number, height: number) => {
      contentHeight.set(height)
    },
    /** The rows list's layout inside the scroll content. */
    onListLayout: (event: LayoutChangeEvent) => {
      listTop.set(event.nativeEvent.layout.y)
    }
  }
}
