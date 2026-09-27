/**
 * The Home Edit mode bottom bar (docs/10 "Home edit mode"): Move to…,
 * Pin/Unpin, Hide and Mark read/Mark unread for every selected agent. It
 * slides up when at least one agent is selected and down when none is,
 * with the Edit mode motion; the list above it gets shorter or longer with
 * it, so the list always ends at the bar. The labels come from
 * `editBarLabels`; the screen owns the effects.
 */

import { Pressable, StyleSheet, Text } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'

import type { EditBarLabels } from '@/features/agents'
import { useTheme } from '@/theme/provider'

import { useBottomInset } from '../use-bottom-inset'
import { useShowProgress } from './motion'

const BAR_PADDING_TOP = 4

export interface EditBarProps {
  labels: EditBarLabels
  /** At least one agent is selected in Edit mode. */
  shown: boolean
  onMove(): void
  onPin(): void
  onHide(): void
  onRead(): void
}

export function EditBar({ labels, shown, onMove, onPin, onHide, onRead }: EditBarProps) {
  const theme = useTheme()
  // A fixed bottom bar: it draws its background to the screen edge and pads
  // its own content by the inset, so the buttons sit above the home indicator.
  const bottomInset = useBottomInset()
  const height = StyleSheet.hairlineWidth + BAR_PADDING_TOP + theme.hit + bottomInset
  const progress = useShowProgress(shown)
  const frame = useAnimatedStyle(() => ({ height: progress.get() * height }))
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.get()) * height }] }))
  const actions = [
    { key: 'move', label: 'Move to…', onPress: onMove },
    { key: 'pin', label: labels.pin, onPress: onPin },
    { key: 'hide', label: 'Hide', onPress: onHide },
    { key: 'read', label: labels.read, onPress: onRead }
  ]
  return (
    <Animated.View
      pointerEvents={shown ? 'auto' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      style={[styles.frame, frame]}
    >
      <Animated.View
        style={[styles.bar, { height, paddingBottom: bottomInset, borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }, slide]}
      >
        {actions.map(action => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [styles.action, { minHeight: theme.hit, opacity: pressed ? 0.65 : 1 }]}
          >
            <Text numberOfLines={1} style={[styles.label, { color: theme.colors.primary }]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: BAR_PADDING_TOP },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '600' }
})
