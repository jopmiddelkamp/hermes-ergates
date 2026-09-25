/**
 * Compact anchored action menu (docs/10 "Bot actions"): a transparent modal
 * with an outside-tap backdrop and an opaque `popover` card positioned next
 * to a measured anchor rect, kept within the window. Android back dismisses
 * via `onRequestClose`.
 */

import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'

import { useTheme } from '@/theme/provider'

import { Icon, type IconName } from './icons'

const MENU_WIDTH = 220
const MENU_RADIUS = 16
const MARGIN = 8

export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ActionMenuItem {
  key: string
  label: string
  icon?: IconName
  destructive?: boolean
  /** Announced as selected by the screen reader; never drawn into the label. */
  selected?: boolean
  onPress: () => void
}

export interface ActionMenuProps {
  visible: boolean
  anchor: AnchorRect | null
  items: ActionMenuItem[]
  onClose: () => void
}

/** Keeps the menu's card within the window, preferring below the anchor. */
function computePosition(anchor: AnchorRect, windowWidth: number, windowHeight: number, menuHeight: number) {
  const fitsBelow = anchor.y + anchor.height + MARGIN + menuHeight <= windowHeight - MARGIN
  let top = fitsBelow ? anchor.y + anchor.height + MARGIN : Math.max(MARGIN, anchor.y - MARGIN - menuHeight)
  // A tall menu placed above a low anchor can still overshoot the bottom edge; pull it back up.
  top = Math.min(top, windowHeight - menuHeight - MARGIN)
  const maxLeft = Math.max(MARGIN, windowWidth - MENU_WIDTH - MARGIN)
  const left = Math.min(Math.max(anchor.x, MARGIN), maxLeft)
  return { top, left }
}

export function ActionMenu({ visible, anchor, items, onClose }: ActionMenuProps) {
  const theme = useTheme()
  const { width, height } = useWindowDimensions()

  const menuHeight = items.length * theme.hit + MARGIN * 2
  const position = anchor ? computePosition(anchor, width, height, menuHeight) : null

  return (
    <Modal transparent visible={visible && !!position} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
      />
      {position ? (
        <View
          style={[
            styles.shadowWrapper,
            { top: position.top, left: position.left, width: MENU_WIDTH, shadowColor: theme.colors.foreground }
          ]}
        >
          <View style={[styles.surface, { backgroundColor: theme.colors.popover }]}>
            {items.map(item => (
              <Pressable
                key={item.key}
                // The item decides whether the menu closes: submenu items only
                // change level, and terminal items close themselves (C1).
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: item.selected }}
                style={({ pressed }) => [
                  styles.row,
                  { minHeight: theme.hit, backgroundColor: pressed ? theme.colors.muted : 'transparent' }
                ]}
              >
                {item.icon ? (
                  <Icon name={item.icon} size={18} color={item.destructive ? theme.colors.destructive : theme.colors.foreground} />
                ) : null}
                <Text
                  numberOfLines={1}
                  style={[styles.label, { color: item.destructive ? theme.colors.destructive : theme.colors.foreground }]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    // Explicit exception (task-8 rules): only literal color allowed in src/ui.
    backgroundColor: 'rgba(0,0,0,0.25)'
  },
  shadowWrapper: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8
  },
  surface: {
    borderRadius: MENU_RADIUS,
    paddingVertical: MARGIN,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14
  },
  label: {
    fontSize: 15,
    flexShrink: 1
  }
})
