/**
 * A Home section heading in both modes (docs/10 "Home sections and pinned
 * members"): small grey section name with a chevron, down when expanded,
 * right when collapsed. The name area is the toggle in both modes; a
 * long-press, or the Edit section action for screen readers, opens the
 * Section page. With Edit mode's progress a ≡ handle fades in on the right.
 * The name area and the handle sit side by side, so the two gestures never
 * overlap; touching the handle switches the rows list to headers only
 * before the drag starts.
 */

import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import Sortable from 'react-native-sortables'

import { EDIT_ITEM_HEIGHT, EDIT_SECTION_ACTION, type MoveAction, type SectionDragEvent } from '@/features/agents'
import { useTheme } from '@/theme/provider'

import { Icon } from '../icons'
import { Grip } from './Grip'
import { HANDLE_WIDTH, MAX_FONT_SCALE } from './HomeRow'

export interface HomeSectionHeaderProps {
  name: string
  expanded: boolean
  editing: boolean
  /** Edit mode's progress, 0 to 1. */
  progress: SharedValue<number>
  /** Move up and Move down, in Edit mode. */
  actions: MoveAction[]
  onAction(event: AccessibilityActionEvent): void
  onToggle(): void
  /** Opens the Section page (rename or delete). */
  onEdit(): void
  onHandle(event: SectionDragEvent): void
  sectionKey: string
  gutter: number
}

export function HomeSectionHeader({ name, expanded, editing, progress, actions, onAction, onToggle, onEdit, onHandle, sectionKey, gutter }: HomeSectionHeaderProps) {
  const theme = useTheme()
  const trailing = useAnimatedStyle(() => ({ width: gutter + progress.get() * HANDLE_WIDTH }))
  const handle = useAnimatedStyle(() => ({ opacity: progress.get() }))
  return (
    <View style={[styles.header, { backgroundColor: theme.colors.background }]}>
      <Pressable
        onPress={onToggle}
        onLongPress={onEdit}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${name} section`}
        accessibilityActions={[...(editing ? actions : []), EDIT_SECTION_ACTION]}
        onAccessibilityAction={onAction}
        style={[styles.name, { paddingLeft: gutter }]}
      >
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.colors.mutedForeground }]}>
          {name}
        </Text>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={theme.colors.mutedForeground} />
      </Pressable>
      <Animated.View pointerEvents={editing ? 'auto' : 'none'} style={[styles.trailing, trailing]}>
        <Animated.View style={[styles.fill, handle]}>
          <Sortable.Handle style={styles.fill}>
            {/* The touch area runs to the screen edge; the glyph stays in line with the rows' ≡. */}
            <Sortable.Touchable
              style={[styles.handleFill, { paddingRight: gutter }]}
              onTouchesDown={() => onHandle({ type: 'press', key: sectionKey })}
              onTouchesUp={() => onHandle({ type: 'release' })}
            >
              <Grip />
            </Sortable.Touchable>
          </Sortable.Handle>
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { height: EDIT_ITEM_HEIGHT.section, flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontSize: 13, fontWeight: '400' },
  trailing: { alignSelf: 'stretch', overflow: 'hidden' },
  fill: { flex: 1, alignSelf: 'stretch' },
  handleFill: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }
})
