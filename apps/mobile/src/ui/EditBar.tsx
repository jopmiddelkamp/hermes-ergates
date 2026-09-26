/**
 * The Home Edit mode bottom bar (docs/10 "Home edit mode"): Move to…,
 * Pin/Unpin, Hide and Mark read/Mark unread for every selected agent. The
 * labels come from `editBarLabels`; the screen owns the effects.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { EditBarLabels } from '@/features/agents'
import { useTheme } from '@/theme/provider'

import { useBottomInset } from './use-bottom-inset'

export interface EditBarProps {
  labels: EditBarLabels
  onMove(): void
  onPin(): void
  onHide(): void
  onRead(): void
}

export function EditBar({ labels, onMove, onPin, onHide, onRead }: EditBarProps) {
  const theme = useTheme()
  // A fixed bottom bar: it draws its background to the screen edge and pads
  // its own content by the inset, so the buttons sit above the home indicator.
  const bottomInset = useBottomInset()
  const actions = [
    { key: 'move', label: 'Move to…', onPress: onMove },
    { key: 'pin', label: labels.pin, onPress: onPin },
    { key: 'hide', label: 'Hide', onPress: onHide },
    { key: 'read', label: labels.read, onPress: onRead }
  ]
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset, borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
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
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '600' }
})
