/**
 * The pinned avatars at the top of Home, in both modes (docs/10 "Home",
 * "Home edit mode"): large avatars in pin order, wrapped and centered, a
 * pinned concierge first. With Edit mode's progress each avatar gets a
 * selection badge at its top left and, except a pinned concierge, a move
 * handle at its top right; the unread dot moves down to the bottom right,
 * clear of both. A tap toggles the selection in Edit mode; the move handle
 * drags the avatar left and right inside the pinned area, across wrapped
 * lines, and nothing drops in front of a pinned concierge (its `fixed-order`
 * handle keeps it in place). Screen readers get Move left and Move right
 * instead.
 */

import { useCallback, useRef } from 'react'
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native'
import Animated, { useAnimatedStyle, type AnimatedRef, type SharedValue } from 'react-native-reanimated'
import Sortable, { type SortableFlexDragEndParams } from 'react-native-sortables'

import { editRowLabel, moveActions, moveDirection, moveStep, pinDropMove, useAvatar, type Bot, type EditItem, type PinnedItem, type Selection } from '@/features/agents'
import { lightTap } from '@/lib/haptics'
import type { OrderMove } from '@/state/organization'
import { useTheme } from '@/theme/provider'

import type { AnchorRect } from '../ActionMenu'
import { Avatar } from '../Avatar'
import { Grip } from './Grip'
import { SelectionCircle } from './SelectionCircle'

const AVATAR_SIZE = 84
const PIN_WIDTH = 96
const PIN_GAP = 24
const BADGE_SIZE = 48
/** The move handle's touch area around its badge. */
const MOVE_TOUCH = 56
/** The ≡ glyph inside the move badge, scaled up from the rows' own 22 pt by the same factor as the badge (24 to 48 pt), so it keeps the same proportion inside its circle. */
const MOVE_GRIP_SIZE = 28
const DOT_SIZE = 12
/** How far the unread dot moves down, from its normal-mode spot near the top to clear of the selection badge and the move handle. */
const DOT_DROP = AVATAR_SIZE - DOT_SIZE - 4

/**
 * Two 48 pt badges at the avatar's square corners would overlap the next
 * pin's badge, so each one centers on the avatar's round edge at 45°
 * instead. The avatar is a circle of radius `AVATAR_RADIUS`, centered at
 * (`AVATAR_CENTER_X`, `AVATAR_CENTER_Y`) in the column (`styles.pin` centers
 * it there, top-aligned, so its top edge is the column's own origin). A
 * point on the circle at 45° is the center offset by `radius · cos45°` on
 * one axis and `radius · sin45°` on the other; `Math.SQRT1_2` is cos45° (=
 * sin45°). The selection badge centers on the top-left point, the move
 * badge on the top-right one.
 */
const AVATAR_RADIUS = AVATAR_SIZE / 2
const AVATAR_CENTER_X = PIN_WIDTH / 2
const AVATAR_CENTER_Y = AVATAR_RADIUS
const CORNER_OFFSET = AVATAR_RADIUS * Math.SQRT1_2
const BADGE_CENTER_Y = AVATAR_CENTER_Y - CORNER_OFFSET
const SELECTION_CENTER_X = AVATAR_CENTER_X - CORNER_OFFSET
const MOVE_CENTER_X = AVATAR_CENTER_X + CORNER_OFFSET

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
  // Stable across renders that do not change the pins or the handlers, for
  // the same reason `HomeList` memoizes its own `Sortable.Grid` props. Kept
  // above the empty-pins return below: every hook here must run every render.
  const onDragStart = useCallback(() => lightTap(haptics), [haptics])

  const onDragEnd = useCallback(
    ({ key, indexToKey }: SortableFlexDragEndParams) => {
      lightTap(haptics)
      const move = pinDropMove(pins, indexToKey, key)
      if (move) {
        onMove(move)
      }
    },
    [haptics, pins, onMove]
  )

  const act = useCallback(
    (item: PinnedItem) => (event: AccessibilityActionEvent) => {
      const direction = moveDirection(event.nativeEvent.actionName)
      const move = direction ? moveStep(items, item.key, direction) : null
      if (move) {
        onMove(move)
      }
    },
    [items, onMove]
  )

  if (pins.length === 0) {
    return null
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
      onDragStart={onDragStart}
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
  // The badge and the move handle sit at the avatar's top-left and top-right,
  // so the unread dot moves down to clear them both, the same way for every
  // avatar (the concierge included, even without a move handle) so it never
  // jumps between two rules.
  const dotPosition = useAnimatedStyle(() => ({ transform: [{ translateY: progress.get() * DOT_DROP }] }))
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
      {unread ? <Animated.View style={[styles.dot, { backgroundColor: theme.colors.primary }, dotPosition]} accessibilityLabel="Unread" /> : null}
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
            <View style={[styles.moveBadge, { backgroundColor: theme.colors.background, borderColor: theme.colors.mutedForeground }]}>
              <Grip size={MOVE_GRIP_SIZE} />
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
  dot: { position: 'absolute', top: 2, right: 10, width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  // The badge and the move handle center on the avatar's round edge at 45°, top left and top right (see the arithmetic above).
  badge: { position: 'absolute', top: BADGE_CENTER_Y - BADGE_SIZE / 2, left: SELECTION_CENTER_X - BADGE_SIZE / 2 },
  move: { position: 'absolute', top: BADGE_CENTER_Y - MOVE_TOUCH / 2, left: MOVE_CENTER_X - MOVE_TOUCH / 2 },
  moveTouch: { width: MOVE_TOUCH, height: MOVE_TOUCH, alignItems: 'center', justifyContent: 'center' },
  moveBadge: { width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: BADGE_SIZE / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }
})
