/**
 * The pinned avatars at the top of Home, in both modes (docs/10 "Home",
 * "Home edit mode"): large avatars in pin order, wrapped and centered, a
 * pinned concierge first. With Edit mode's progress each avatar gets a
 * selection badge at its top left and, except a pinned concierge, a move
 * handle at its top right. A tap toggles the selection in Edit mode; the
 * move handle drags the avatar left and right inside the pinned area, across
 * wrapped lines, and nothing drops in front of a pinned concierge (its
 * `fixed-order` handle keeps it in place). Screen readers get Move left and
 * Move right instead.
 */

import { useRef } from 'react'
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native'
import Animated, { useAnimatedStyle, type AnimatedRef, type SharedValue } from 'react-native-reanimated'
import Sortable, { type SortableFlexDragEndParams } from 'react-native-sortables'

import { editRowLabel, moveActions, moveDirection, moveStep, pinDropMove, useAvatar, type Bot, type EditItem, type PinnedItem, type Selection } from '@/features/agents'
import { lightTap } from '@/lib/haptics'
import type { OrderMove } from '@/state/organization'
import { useTheme } from '@/theme/provider'

import type { AnchorRect } from '../ActionMenu'
import { Avatar } from '../Avatar'
import { Icon } from '../icons'
import { SelectionCircle } from './SelectionCircle'

const AVATAR_SIZE = 84
const PIN_WIDTH = 96
const PIN_GAP = 24
const BADGE_SIZE = 24
/** The move handle's touch area around its badge. */
const MOVE_TOUCH = 40

export interface PinnedAreaProps {
  pins: PinnedItem[]
  /** The whole Home list, for Move left and Move right. */
  items: EditItem[]
  editing: boolean
  /** Edit mode's progress, 0 to 1. */
  progress: SharedValue<number>
  selection: Selection
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  /** The owner's Haptics setting: a light tap when a drag starts and when it drops. */
  haptics: boolean
  scrollRef: AnimatedRef<Animated.ScrollView>
  unread(profile: string): boolean
  /** Opens the chat, or toggles the selection in Edit mode. */
  onPress(bot: Bot): void
  onLongPress(bot: Bot, anchor: AnchorRect): void
  onMove(move: OrderMove): void
  gutter: number
}

export function PinnedArea({ pins, items, editing, progress, selection, gateway, connectionId, haptics, scrollRef, unread, onPress, onLongPress, onMove, gutter }: PinnedAreaProps) {
  if (pins.length === 0) {
    return null
  }

  const onDragEnd = ({ key, indexToKey }: SortableFlexDragEndParams) => {
    lightTap(haptics)
    const move = pinDropMove(pins, indexToKey, key)
    if (move) {
      onMove(move)
    }
  }

  const act = (item: PinnedItem) => (event: AccessibilityActionEvent) => {
    const direction = moveDirection(event.nativeEvent.actionName)
    const move = direction ? moveStep(items, item.key, direction) : null
    if (move) {
      onMove(move)
    }
  }

  return (
    <Sortable.Flex
      flexDirection="row"
      flexWrap="wrap"
      justifyContent="center"
      gap={PIN_GAP}
      paddingHorizontal={gutter}
      paddingVertical={20}
      customHandle
      sortEnabled={editing}
      scrollableRef={scrollRef}
      dragActivationDelay={0}
      activeItemScale={1.05}
      inactiveItemOpacity={1}
      onDragStart={() => lightTap(haptics)}
      onDragEnd={onDragEnd}
    >
      {pins.map(item => (
        <PinnedAvatar
          key={item.key}
          item={item}
          editing={editing}
          progress={progress}
          selected={selection.has(item.bot.profile)}
          unread={unread(item.bot.profile)}
          actions={editing ? moveActions(items, item.key) : []}
          onAction={act(item)}
          gateway={gateway}
          connectionId={connectionId}
          onPress={() => onPress(item.bot)}
          onLongPress={anchor => onLongPress(item.bot, anchor)}
        />
      ))}
    </Sortable.Flex>
  )
}

interface PinnedAvatarProps {
  item: PinnedItem
  editing: boolean
  progress: SharedValue<number>
  selected: boolean
  unread: boolean
  actions: ReturnType<typeof moveActions>
  onAction(event: AccessibilityActionEvent): void
  gateway: PinnedAreaProps['gateway']
  connectionId: string
  onPress(): void
  onLongPress(anchor: AnchorRect): void
}

function PinnedAvatar({ item, editing, progress, selected, unread, actions, onAction, gateway, connectionId, onPress, onLongPress }: PinnedAvatarProps) {
  const theme = useTheme()
  const { bot } = item
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  const ref = useRef<View>(null)
  const badge = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ scale: progress.get() }] }))
  const measure = () => ref.current?.measureInWindow((x, y, width, height) => onLongPress({ x, y, width, height }))
  const face = (
    <Pressable
      onPress={onPress}
      onLongPress={editing ? undefined : measure}
      accessibilityRole="button"
      accessibilityLabel={editing ? editRowLabel(bot, selected, unread) : `${bot.name}${unread ? ', unread' : ''}`}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      style={styles.pin}
    >
      <Avatar name={bot.name} color={bot.color} imageUri={avatar.data ?? null} size={AVATAR_SIZE} />
      <Text style={[styles.label, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
        {bot.name}
      </Text>
      {unread ? <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} accessibilityLabel="Unread" /> : null}
    </Pressable>
  )
  return (
    <View ref={ref} collapsable={false}>
      {/* A `fixed-order` handle keeps the pinned concierge first: it cannot be picked up, and no pin drops in front of it. */}
      {item.locked ? <Sortable.Handle mode="fixed-order">{face}</Sortable.Handle> : face}
      <Animated.View pointerEvents="none" style={[styles.badge, badge]}>
        <SelectionCircle selected={selected} size={BADGE_SIZE} onAvatar />
      </Animated.View>
      {item.locked ? null : (
        <Animated.View pointerEvents={editing ? 'auto' : 'none'} style={[styles.move, badge]}>
          <Sortable.Handle style={styles.moveTouch}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.moveBadge, { backgroundColor: theme.colors.background, borderColor: theme.colors.mutedForeground }]}>
              <Icon name="move" size={14} color={theme.colors.mutedForeground} />
            </View>
          </Sortable.Handle>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', gap: 8, width: PIN_WIDTH },
  label: { fontSize: 15 },
  dot: { position: 'absolute', top: 2, right: 10, width: 12, height: 12, borderRadius: 6 },
  // The badge and the move handle sit on the avatar's top corners (the avatar is centered in the 96 pt column).
  badge: { position: 'absolute', top: -2, left: 2 },
  move: { position: 'absolute', top: -2 - (MOVE_TOUCH - BADGE_SIZE) / 2, right: 2 - (MOVE_TOUCH - BADGE_SIZE) / 2 },
  moveTouch: { width: MOVE_TOUCH, height: MOVE_TOUCH, alignItems: 'center', justifyContent: 'center' },
  moveBadge: { width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: BADGE_SIZE / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }
})
