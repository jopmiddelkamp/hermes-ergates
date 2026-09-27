/**
 * The insertion markers of a drag between the pinned area and the rows list
 * (docs/10 "Home edit mode"). While a dragged row is over the pinned
 * avatars, a thin vertical `primary` bar stands in the gap where it would be
 * pinned (`PinsMarker`); while a dragged pin is over the rows list, a thin
 * horizontal `primary` line lies between the rows where it would land
 * (`RowsMarker`). The empty pinned area's skeleton marks its middle ghost
 * avatar instead (`PinnedArea.tsx`). Each reads the slot `use-cross-drag.ts`
 * keeps on the UI thread, only moves and fades (transform and opacity), and
 * hides as soon as the finger leaves its area, and on the drop.
 */

import { StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import type { CrossSlot } from '@/features/agents'
import { useTheme } from '@/theme/provider'

/** The marker's thickness. */
const MARKER = 3

/** The line between two rows, inset by the page padding; it sits in the rows list's outer view, over the rows. */
export function RowsMarker({ slot, gutter }: { slot: SharedValue<CrossSlot>; gutter: number }) {
  const theme = useTheme()
  const style = useAnimatedStyle(() => {
    const at = slot.get()
    return at?.area === 'rows' ? { opacity: 1, transform: [{ translateY: at.y - MARKER / 2 }] } : { opacity: 0, transform: [{ translateY: 0 }] }
  })
  return <Animated.View pointerEvents="none" style={[styles.line, { left: gutter, right: gutter, backgroundColor: theme.colors.primary }, style]} />
}

/** The bar between two pinned avatars, `height` high from the top of their line; it sits in the pinned area's outer view. */
export function PinsMarker({ slot, height }: { slot: SharedValue<CrossSlot>; height: number }) {
  const theme = useTheme()
  const style = useAnimatedStyle(() => {
    const at = slot.get()
    return at?.area === 'pinned'
      ? { opacity: 1, transform: [{ translateX: at.x - MARKER / 2 }, { translateY: at.y }] }
      : { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] }
  })
  return <Animated.View pointerEvents="none" style={[styles.bar, { height, backgroundColor: theme.colors.primary }, style]} />
}

const styles = StyleSheet.create({
  line: { position: 'absolute', top: 0, height: MARKER, borderRadius: MARKER / 2 },
  bar: { position: 'absolute', top: 0, left: 0, width: MARKER, borderRadius: MARKER / 2 }
})
