/**
 * Home section heading (docs/10 "Home sections and pinned members"): small
 * grey section name with a chevron; down when expanded, right when
 * collapsed. The whole heading is the toggle; a long-press, or the Edit
 * section action for screen readers, opens the Section page.
 */

import { Pressable, StyleSheet, Text } from 'react-native'

import { EDIT_SECTION_ACTION } from '@/features/agents'
import { useTheme } from '@/theme/provider'

import { Icon } from './icons'

export interface SectionHeaderProps {
  name: string
  expanded: boolean
  onToggle: () => void
  /** Opens the Section page (rename or delete). */
  onEdit: () => void
}

export function SectionHeader({ name, expanded, onToggle, onEdit }: SectionHeaderProps) {
  const theme = useTheme()

  return (
    <Pressable
      onPress={onToggle}
      onLongPress={onEdit}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${name} section`}
      accessibilityActions={[EDIT_SECTION_ACTION]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === EDIT_SECTION_ACTION.name) {
          onEdit()
        }
      }}
      // No horizontal padding: `Screen`/`Sheet` own the page gutter.
      style={[styles.header, { minHeight: theme.hit }]}
    >
      <Text style={[styles.name, { color: theme.colors.mutedForeground }]}>{name}</Text>
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={theme.colors.mutedForeground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  name: {
    fontSize: 13,
    fontWeight: '400'
  }
})
