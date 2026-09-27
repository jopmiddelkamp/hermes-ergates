/**
 * A Home conversation row in both modes (docs/10 "Home", "Home edit mode"):
 * avatar, name, role badge, time, one-line preview and unread dot, the same
 * look in and out of Edit mode. With Edit mode's progress the selection
 * circle slides in from the left while the content moves right, and the ≡
 * handle fades in on the right; the time and unread dot stay, left of it.
 *
 * The row runs edge to edge (`page-padding.ts`): its tap highlight spans the
 * whole width, the ≡ column too, and its content is padded by the page
 * padding. Only the part left of the ≡ column opens the chat or toggles the
 * selection; the ≡ column only drags. A touch that starts on the circle and
 * moves belongs to swipe to select. The row has a fixed height (the section
 * drag and swipe to select measure with it), so its text grows with the
 * system text size only up to 1.4 times.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import Sortable from 'react-native-sortables'

import { EDIT_ITEM_HEIGHT, editRowLabel, useAvatar, type Bot, type MoveAction } from '@/features/agents'
import { formatRowTime } from '@/lib/time'
import { useTheme } from '@/theme/provider'

import type { AnchorRect } from '../ActionMenu'
import { Avatar } from '../Avatar'
import { Grip } from './Grip'
import { CIRCLE_SIZE, SelectionCircle } from './SelectionCircle'
import type { SwipeSelect } from './use-swipe-select'

const AVATAR_SIZE = 48
/** The circle column: the circle and the space up to the avatar. With the page padding it is over 44 pt wide and the full row high. */
export const CIRCLE_COLUMN = CIRCLE_SIZE + 12
/** The ≡ column, added right of the content in Edit mode. */
export const HANDLE_WIDTH = 52
const BADGE_MAX_WIDTH = 113
const UNREAD_DOT_SIZE = 8
export const MAX_FONT_SCALE = 1.4

export interface HomeRowProps {
  bot: Bot
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  unread: boolean
  editing: boolean
  /** Edit mode's progress, 0 to 1. */
  progress: SharedValue<number>
  selected: boolean
  /** Move up and Move down, in Edit mode. */
  actions: MoveAction[]
  onAction(event: AccessibilityActionEvent): void
  /** Opens the chat, or toggles the selection in Edit mode. */
  onPress(): void
  /** The long-press menu, outside Edit mode; gets the row's window rectangle. */
  onLongPress(anchor: AnchorRect): void
  rowKey: string
  swipe: SwipeSelect
  gutter: number
}

export function HomeRow({ bot, gateway, connectionId, unread, editing, progress, selected, actions, onAction, onPress, onLongPress, rowKey, swipe, gutter }: HomeRowProps) {
  const theme = useTheme()
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  const ref = useRef<View>(null)
  const swipeGesture = useMemo(() => swipe.gestureFor(rowKey).enabled(editing), [swipe, rowKey, editing])
  useEffect(() => () => swipe.forget(rowKey), [swipe, rowKey])
  const [pressed, setPressed] = useState(false)

  const leading = useAnimatedStyle(() => ({ width: gutter + progress.get() * CIRCLE_COLUMN }))
  const circle = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ translateX: (progress.get() - 1) * CIRCLE_COLUMN }] }))
  const trailing = useAnimatedStyle(() => ({ width: gutter + progress.get() * HANDLE_WIDTH }))
  const handle = useAnimatedStyle(() => ({ opacity: progress.get() }))

  const time = formatRowTime(bot.lastActivityAt)
  const preview = bot.preview || bot.description
  // The label ends in "selected" or "not selected" in Edit mode; a selected state would say it twice.
  const label = editing ? editRowLabel(bot, selected, unread) : [bot.name, bot.role, unread ? 'unread' : '', time, preview].filter(Boolean).join(', ')
  const measure = () => ref.current?.measureInWindow((x, y, width, height) => onLongPress({ x, y, width, height }))

  return (
    <View ref={ref} collapsable={false} style={[styles.row, { backgroundColor: pressed ? theme.colors.muted : theme.colors.background }]}>
      <Pressable
        onPress={onPress}
        onLongPress={editing ? undefined : measure}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={editing ? actions : []}
        onAccessibilityAction={onAction}
        style={styles.body}
      >
        {/* A touch that starts here and moves belongs to swipe to select, not to scrolling. */}
        <GestureDetector gesture={swipeGesture}>
          <Animated.View pointerEvents={editing ? 'auto' : 'none'} style={[styles.leading, leading]}>
            <Animated.View style={[styles.circleColumn, { width: gutter + CIRCLE_COLUMN, paddingLeft: gutter }, circle]}>
              <SelectionCircle selected={selected} />
            </Animated.View>
          </Animated.View>
        </GestureDetector>
        <Avatar name={bot.name} color={bot.color} imageUri={avatar.data ?? null} size={AVATAR_SIZE} />
        <View style={styles.text}>
          <View style={styles.line}>
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.colors.foreground }]}>
              {bot.name}
            </Text>
            {bot.role ? (
              <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badge, { color: theme.colors.mutedForeground, backgroundColor: theme.colors.muted }]}>
                {bot.role}
              </Text>
            ) : null}
            {time ? (
              <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.colors.mutedForeground }]}>
                {time}
              </Text>
            ) : null}
          </View>
          <View style={styles.line}>
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.preview, { color: theme.colors.mutedForeground }]}>
              {preview}
            </Text>
            {/* Decorative: the row's own label says "unread". */}
            {unread ? <View accessible={false} style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} /> : null}
          </View>
        </View>
      </Pressable>
      <Animated.View pointerEvents={editing ? 'auto' : 'none'} style={[styles.trailing, trailing]}>
        <Animated.View style={[styles.fill, handle]}>
          {/* The drag gesture sits on the view `Sortable.Handle` wraps: it fills the ≡ column, so a touch anywhere on it picks the row up. */}
          <Sortable.Handle style={[styles.handle, { paddingRight: gutter }]}>
            <Grip />
          </Sortable.Handle>
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { height: EDIT_ITEM_HEIGHT.row, flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' },
  leading: { alignSelf: 'stretch', overflow: 'hidden' },
  circleColumn: { flex: 1, justifyContent: 'center' },
  text: { flex: 1, gap: 2, marginLeft: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: '500' },
  badge: { fontSize: 12, borderRadius: 6, maxWidth: BADGE_MAX_WIDTH, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  time: { fontSize: 12 },
  preview: { flex: 1, fontSize: 15 },
  unreadDot: { width: UNREAD_DOT_SIZE, height: UNREAD_DOT_SIZE, borderRadius: UNREAD_DOT_SIZE / 2 },
  trailing: { alignSelf: 'stretch', overflow: 'hidden' },
  fill: { flex: 1, alignSelf: 'stretch' },
  handle: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }
})
