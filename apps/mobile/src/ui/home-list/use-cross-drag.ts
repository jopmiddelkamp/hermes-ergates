/**
 * Dragging an agent between the pinned area and the rows list in Home Edit
 * mode (docs/10 "Home edit mode"; the rules are the agents feature's
 * `crossSlot` and `crossMove`): a row dragged by its ≡ and dropped over the
 * pinned area is pinned at that spot, and a pin dragged by its move handle
 * and dropped over the rows list is unpinned and placed there.
 *
 * react-native-sortables 1.10 cannot hand an item from one drag list to
 * another, so each area keeps its own drag and this hook follows the finger:
 * both lists' `onDragMove` record it on the UI thread, and one reaction over
 * the finger and the scroll offset measures both areas and keeps `slot`, the
 * slot under the finger in the other area, current. It listens to the scroll
 * offset too because `onDragMove` is silent while the list auto-scrolls
 * under a still finger. `slot` drives the insertion markers
 * (`CrossMarkers.tsx`) and, while a row is over the pinned area, the rows
 * list's sort strategy. At the drop, each area's `onDragEnd` asks `end`
 * first: over the other area, the move goes to Home and the area skips its
 * own drop.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import Animated, { measure, useAnimatedReaction, useAnimatedRef, useScrollOffset, useSharedValue, type AnimatedRef, type MeasuredDimensions, type SharedValue } from 'react-native-reanimated'
import type { DragMoveParams } from 'react-native-sortables'

import { crossMove, crossSlot, pinCells, type CrossSlot, type DragItem, type PinAreaLayout, type PinnedItem, type Point, type Rect, type SwipeLine } from '@/features/agents'
import type { OrderMove } from '@/state/organization'

/**
 * When a drop over the other area is applied. False: at the release, while
 * the library still flies the dragged item back to its old slot (300 ms);
 * the data change takes it out on the way, so it fades out, and the new
 * avatar or row grows in at the drop spot: the hand-off the owner accepted.
 * True: after that drop animation (`onActiveItemDropped`); the item then
 * lands back in its old slot first and moves over afterwards, a clean but
 * clearly two-step look. Turn this on if the release version shows the
 * item snapping back before it disappears.
 */
const APPLY_AFTER_DROP_ANIMATION = false

export interface CrossDrag {
  /** On the pinned area's outer view, pins or skeleton. */
  pinnedRef: AnimatedRef<Animated.View>
  /** On the rows list's outer view. */
  rowsRef: AnimatedRef<Animated.View>
  /** The slot under the finger in the other area while a drag hovers there, else null. */
  slot: SharedValue<CrossSlot>
  /** Both drag lists' `onDragMove`, on the UI thread: records the finger. */
  onDragMove(params: DragMoveParams): void
  /**
   * The first step of both drag lists' `onDragEnd`: true when the drag ended
   * over the other area. Its move is then applied (or held for the drop
   * animation) and the caller skips its own drop.
   */
  end(key: string): boolean
  /** Both drag lists' `onActiveItemDropped`: applies a move held for the drop animation. */
  dropped(): void
}

interface CrossDragOptions {
  scrollRef: AnimatedRef<Animated.ScrollView>
  pins: readonly PinnedItem[]
  /** The rows list as it shows, ghost rows included: what `lines` holds the heights of. */
  shown: readonly DragItem[]
  /** The rows list's lines, kept by swipe to select (`useSwipeSelect`). */
  lines: SharedValue<SwipeLine[]>
  /** The pinned area's fixed geometry (`pinAreaGeometry`); its width comes from measuring it. */
  pinGeometry: Omit<PinAreaLayout, 'width'>
  onMove(move: OrderMove): void
}

function rectOf(measured: MeasuredDimensions | null): Rect | null {
  'worklet'
  return measured ? { x: measured.pageX, y: measured.pageY, width: measured.width, height: measured.height } : null
}

/** Whether two slots put the marker in the same place, so an unchanged slot is not written again on every frame. */
function sameSlot(a: CrossSlot, b: CrossSlot): boolean {
  'worklet'
  if (a === null || b === null) {
    return a === b
  }
  if (a.area === 'pinned' && b.area === 'pinned') {
    return a.index === b.index && a.x === b.x && a.y === b.y
  }
  return a.area === b.area && a.index === b.index && a.y === b.y
}

export function useCrossDrag({ scrollRef, pins, shown, lines, pinGeometry, onMove }: CrossDragOptions): CrossDrag {
  const pinnedRef = useAnimatedRef<Animated.View>()
  const rowsRef = useAnimatedRef<Animated.View>()
  const scrollOffset = useScrollOffset(scrollRef)
  /** The key of the item whose finger is followed; one drag at a time. */
  const dragKey = useSharedValue<string | null>(null)
  const finger = useSharedValue<Point | null>(null)
  const slot = useSharedValue<CrossSlot>(null)
  const pinKeys = useSharedValue<string[]>([])
  useEffect(() => {
    pinKeys.set(pins.map(pin => pin.key))
  }, [pins, pinKeys])

  // The drop reads the latest props from here; a move held for the drop animation waits here.
  const latest = useRef({ pins, shown, onMove })
  latest.current = { pins, shown, onMove }
  const held = useRef<OrderMove | null>(null)

  const onDragMove = useCallback(
    ({ key, touchData }: DragMoveParams) => {
      'worklet'
      // A second finger dragging in the other area at the same time is not followed.
      const current = dragKey.get()
      if (current !== null && current !== key) {
        return
      }
      dragKey.set(key)
      finger.set({ x: touchData.absoluteX, y: touchData.absoluteY })
    },
    [dragKey, finger]
  )

  useAnimatedReaction(
    () => ({ key: dragKey.get(), point: finger.get(), offset: scrollOffset.get() }),
    ({ key, point }) => {
      let next: CrossSlot = null
      if (key !== null && point !== null) {
        const pinnedArea = rectOf(measure(pinnedRef))
        next = crossSlot({
          key,
          finger: point,
          pinnedArea,
          rowsList: rectOf(measure(rowsRef)),
          cells: pinnedArea ? pinCells(pinKeys.get(), { ...pinGeometry, width: pinnedArea.width }) : [],
          pinGap: pinGeometry.gap,
          lines: lines.get()
        })
      }
      if (!sameSlot(next, slot.get())) {
        slot.set(next)
      }
    },
    [pinGeometry]
  )

  const end = useCallback(
    (key: string) => {
      const current = dragKey.get()
      if (current !== null && current !== key) {
        return false
      }
      const over = slot.get()
      dragKey.set(null)
      finger.set(null)
      slot.set(null)
      if (over === null) {
        return false
      }
      const move = crossMove(over, key, latest.current.pins, latest.current.shown)
      if (move && APPLY_AFTER_DROP_ANIMATION) {
        held.current = move
      } else if (move) {
        latest.current.onMove(move)
      }
      return true
    },
    [dragKey, finger, slot]
  )

  const dropped = useCallback(() => {
    const move = held.current
    held.current = null
    if (move) {
      latest.current.onMove(move)
    }
  }, [])

  // Stable, so the drag lists' `onDragEnd` callbacks that name it stay stable too.
  return useMemo(() => ({ pinnedRef, rowsRef, slot, onDragMove, end, dropped }), [pinnedRef, rowsRef, slot, onDragMove, end, dropped])
}
