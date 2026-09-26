/**
 * The Home list in Edit mode (docs/10 "Home edit mode"). Draws the flat
 * `EditItem` list from `buildEditItems` with one component: captions, section
 * headers and rows with a selection circle. A tap toggles a row's selection;
 * screen readers get Move up and Move down on each row and section header.
 * A drag list can replace this component: it takes the same items and
 * reports each drop as an `OrderMove` through `onMove`.
 */

import { Pressable, ScrollView, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native'

import { editRowLabel, moveActions, moveStep, useAvatar, type Bot, type EditItem, type MoveAction, type Selection } from '@/features/agents'
import type { OrderMove } from '@/state/organization'
import { useTheme } from '@/theme/provider'

import { Avatar } from './Avatar'
import { Icon } from './icons'

const ROW_MIN_HEIGHT = 56
const AVATAR_SIZE = 40

export interface EditListProps {
  items: EditItem[]
  selection: Selection
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  unread(profile: string): boolean
  onToggle(profile: string): void
  /** Applies one step of the manual order to the device store. */
  onMove(move: OrderMove): void
}

export function EditList({ items, selection, gateway, connectionId, unread, onToggle, onMove }: EditListProps) {
  const theme = useTheme()
  const act = (key: string) => (event: AccessibilityActionEvent) => {
    const move = moveStep(items, key, event.nativeEvent.actionName === 'moveUp' ? 'up' : 'down')
    if (move) {
      onMove(move)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {items.map(item => {
        switch (item.kind) {
          case 'caption':
            return (
              <Text key={item.key} accessibilityRole="header" style={[styles.caption, { color: theme.colors.mutedForeground }]}>
                {item.label}
              </Text>
            )
          case 'section':
            return (
              <View
                key={item.key}
                accessible
                accessibilityRole="header"
                accessibilityLabel={`${item.section.name} section`}
                accessibilityActions={moveActions(items, item.key)}
                onAccessibilityAction={act(item.key)}
                style={[styles.sectionHeader, { minHeight: theme.hit }]}
              >
                <Text style={[styles.sectionName, { color: theme.colors.mutedForeground }]}>{item.section.name}</Text>
              </View>
            )
          default:
            return (
              <EditRow
                key={item.key}
                bot={item.bot}
                selected={selection.has(item.bot.profile)}
                unread={unread(item.bot.profile)}
                gateway={gateway}
                connectionId={connectionId}
                actions={moveActions(items, item.key)}
                onAction={act(item.key)}
                onToggle={() => onToggle(item.bot.profile)}
              />
            )
        }
      })}
    </ScrollView>
  )
}

interface EditRowProps {
  bot: Bot
  selected: boolean
  unread: boolean
  gateway: EditListProps['gateway']
  connectionId: string
  actions: MoveAction[]
  onAction(event: AccessibilityActionEvent): void
  onToggle(): void
}

function EditRow({ bot, selected, unread, gateway, connectionId, actions, onAction, onToggle }: EditRowProps) {
  const theme = useTheme()
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      // The label ends in "selected" or "not selected"; a selected state would say it twice.
      accessibilityLabel={editRowLabel(bot, selected, unread)}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.colors.muted : 'transparent' }]}
    >
      <Icon name={selected ? 'check-circle' : 'circle'} size={24} color={selected ? theme.colors.primary : theme.colors.mutedForeground} />
      <Avatar name={bot.name} color={bot.color} imageUri={avatar.data ?? null} size={AVATAR_SIZE} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.name, { color: theme.colors.foreground }]}>
          {bot.name}
        </Text>
        {bot.role ? (
          <Text numberOfLines={1} style={[styles.role, { color: theme.colors.mutedForeground }]}>
            {bot.role}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { paddingBottom: 40 },
  caption: { fontSize: 13, paddingTop: 16, paddingBottom: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  sectionName: { fontSize: 13 },
  row: { minHeight: ROW_MIN_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '500' },
  role: { fontSize: 13 }
})
