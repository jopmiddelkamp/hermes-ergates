/**
 * The Home list in Edit mode (docs/10 "Home edit mode"): a drag list over the
 * flat `EditItem` list from `buildEditItems`. Rows, pins and section headers
 * carry a ≡ handle, and only the handle starts a drag: a tap on a row still
 * toggles its selection, a swipe on a row scrolls, and a long-press on a
 * section name opens the Section page. Every rule comes from the agents
 * feature's drop rules: the live slot rule in the sort strategy, each drop as
 * one `OrderMove` through `onMove`, and the headers-only list while a section
 * header is dragged. Screen readers get Move up and Move down instead, and
 * Edit section on a section header.
 */

import React, { useEffect, useMemo, useReducer } from 'react'
import { AppState, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native'
import Animated, { useAnimatedReaction, useAnimatedRef, useSharedValue, type SharedValue } from 'react-native-reanimated'
import Sortable, {
  useCommonValuesContext,
  type DragStartParams,
  type SortableGridDragEndParams,
  type SortableGridRenderItem,
  type SortStrategyFactory
} from 'react-native-sortables'

import {
  EDIT_ITEM_HEIGHT,
  EDIT_SECTION_ACTION,
  NO_SECTION_DRAG,
  dropMove,
  editRowLabel,
  hasHandle,
  listMinHeight,
  moveActions,
  moveStep,
  nextOrder,
  nextSectionDrag,
  sectionDragItems,
  slotMeta,
  useAvatar,
  type Bot,
  type DragItem,
  type EditItem,
  type MoveAction,
  type SectionDragEvent,
  type Selection,
  type SlotMeta
} from '@/features/agents'
import { lightTap } from '@/lib/haptics'
import type { OrderMove } from '@/state/organization'
import { useTheme } from '@/theme/provider'

import { Avatar } from './Avatar'
import { Icon } from './icons'
import { useBottomInset } from './use-bottom-inset'

const AVATAR_SIZE = 40
const HANDLE_WIDTH = 52
/**
 * A touch on a handle picks the item up at once, like the reorder control on
 * iOS: with a hold, a grab that moved straight away was cancelled and the list
 * scrolled instead. The library's 5 px margin before the pick-up lands stays:
 * a wider one let a fast flick scroll the list under the finger first, and the
 * pick-up then landed on another row. A flick on a handle still scrolls.
 */
const DRAG_ACTIVATION_DELAY = 0
/** Rows have a fixed height (the section drag anchors with it), so their text grows only this far with the system text size. */
const MAX_FONT_SCALE = 1.4

export interface EditListProps {
  items: EditItem[]
  selection: Selection
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  /** The owner's Haptics setting: a light tap when a drag starts and when it drops. */
  haptics: boolean
  unread(profile: string): boolean
  onToggle(profile: string): void
  /** Applies one reorder (a drop, or Move up / Move down) to the device store. */
  onMove(move: OrderMove): void
  /** Opens the Section page for a section header. */
  onEditSection(sectionId: string): void
  /**
   * A fixed bar sits below the list (the Edit mode bottom bar): the bar keeps
   * its own buttons above the home indicator, so the list adds no inset then.
   */
  barBelow?: boolean
}

/**
 * The one-column sort strategy with the drop rules applied while the finger
 * moves: a slot the rules forbid is refused, and the item slides back to where
 * the drag started. `meta` must keep its identity: a new strategy remounts the grid.
 */
function makeGuardedStrategy(meta: SharedValue<SlotMeta>): SortStrategyFactory {
  return function useGuardedStrategy() {
    const { indexToKey, itemHeights, activeItemKey } = useCommonValuesContext()
    const startOrder = useSharedValue<string[] | null>(null)
    useAnimatedReaction(
      () => activeItemKey.value,
      key => {
        if (key === null) {
          startOrder.value = null
        }
      }
    )
    return ({ activeIndex, activeKey, dimensions, position }) => {
      'worklet'
      const order = indexToKey.value
      const start = startOrder.value ?? order
      startOrder.value = start
      return nextOrder({ order, startOrder: start, activeKey, activeIndex, activeHeight: dimensions.height, centerY: position.y, heights: itemHeights.value, meta: meta.value })
    }
  }
}

const keyOf = (item: DragItem) => item.key

export function EditList({ items, selection, gateway, connectionId, haptics, unread, onToggle, onMove, onEditSection, barBelow = false }: EditListProps) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  // The list scrolls to the bottom edge of the phone: its content carries the
  // inset instead of the screen reserving a strip for it (added to the minimum
  // height too, or the minimum would swallow it). With a bar below, the list
  // ends at the bar, not at the bottom edge.
  const edgeInset = useBottomInset()
  const bottomInset = barBelow ? 0 : edgeInset
  // While a section handle is touched or dragged, the list shows only the section headers.
  const [sectionDrag, dispatch] = useReducer(nextSectionDrag, NO_SECTION_DRAG)
  const data = useMemo<DragItem[]>(() => (sectionDrag.key ? sectionDragItems(items, sectionDrag.key) : items), [items, sectionDrag.key])
  // A touch the system cancels (the app goes to the background, an alert
  // shows) never reaches the handle's touch-up, so show the whole list again
  // when the app is back: a list switched while the app is away draws blank.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        dispatch({ type: 'release' })
      }
    })
    return () => subscription.remove()
  }, [])

  // The live rule reads the slot kinds on the UI thread; keep them in step with the list it shows.
  const meta = useSharedValue<SlotMeta>({})
  useEffect(() => {
    meta.value = slotMeta(data)
  }, [data, meta])
  const strategy = useMemo(() => makeGuardedStrategy(meta), [meta])

  const onDragStart = ({ key }: DragStartParams) => {
    lightTap(haptics)
    dispatch({ type: 'start', key })
  }

  const onDragEnd = ({ key, data: dropped }: SortableGridDragEndParams<DragItem>) => {
    lightTap(haptics)
    dispatch({ type: 'drop' })
    const move = dropMove(items, dropped.map(keyOf), key)
    if (move) {
      onMove(move)
    }
  }

  const act = (item: EditItem) => (event: AccessibilityActionEvent) => {
    if (item.kind === 'section' && event.nativeEvent.actionName === EDIT_SECTION_ACTION.name) {
      onEditSection(item.section.id)
      return
    }
    const move = moveStep(items, item.key, event.nativeEvent.actionName === 'moveUp' ? 'up' : 'down')
    if (move) {
      onMove(move)
    }
  }

  const renderItem: SortableGridRenderItem<DragItem> = ({ item }) => {
    switch (item.kind) {
      case 'spacer':
        return <View style={{ height: item.height }} />
      case 'caption':
        return <Caption label={item.label} />
      case 'section':
        return (
          <SectionLine
            name={item.section.name}
            actions={[...moveActions(items, item.key), EDIT_SECTION_ACTION]}
            onAction={act(item)}
            onEdit={() => onEditSection(item.section.id)}
            onHandle={dispatch}
            sectionKey={item.key}
          />
        )
      default:
        return (
          <EditRow
            bot={item.bot}
            selected={selection.has(item.bot.profile)}
            unread={unread(item.bot.profile)}
            gateway={gateway}
            connectionId={connectionId}
            draggable={hasHandle(item)}
            actions={moveActions(items, item.key)}
            onAction={act(item)}
            onToggle={() => onToggle(item.bot.profile)}
          />
        )
    }
  }

  return (
    <Animated.ScrollView
      ref={scrollRef}
      // A swipe that starts on a section handle and scrolls is no drag: show the whole list again.
      onScrollBeginDrag={() => dispatch({ type: 'release' })}
      // Keeps the list as tall as the whole list while only headers show and while it comes back, so the scroll position holds.
      contentContainerStyle={{ minHeight: listMinHeight(items) + bottomInset, paddingBottom: bottomInset }}
    >
      <Sortable.Grid
        columns={1}
        data={data}
        keyExtractor={keyOf}
        renderItem={renderItem}
        customHandle
        strategy={strategy}
        scrollableRef={scrollRef}
        overDrag="vertical"
        dragActivationDelay={DRAG_ACTIVATION_DELAY}
        activeItemScale={1.02}
        inactiveItemOpacity={1}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </Animated.ScrollView>
  )
}

/** The ≡ glyph inside the drag trigger. Hidden from screen readers, which use Move up and Move down. */
function Grip() {
  const theme = useTheme()
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="menu" size={22} color={theme.colors.mutedForeground} />
    </View>
  )
}

function Caption({ label }: { label: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.caption, { backgroundColor: theme.colors.background }]}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.captionText, { color: theme.colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  )
}

interface SectionLineProps {
  name: string
  sectionKey: string
  actions: AccessibilityActionInfo[]
  onAction(event: AccessibilityActionEvent): void
  onEdit(): void
  onHandle(event: SectionDragEvent): void
}

/**
 * A section header: the name area opens the Section page on a long-press; the
 * handle drags. They are side by side, so the two gestures never overlap.
 * Touching the handle switches the list to headers only before the drag starts.
 */
function SectionLine({ name, sectionKey, actions, onAction, onEdit, onHandle }: SectionLineProps) {
  const theme = useTheme()
  return (
    <View style={[styles.sectionHeader, { backgroundColor: theme.colors.background }]}>
      <Pressable
        onLongPress={onEdit}
        accessibilityRole="header"
        accessibilityLabel={`${name} section`}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
        style={styles.sectionName}
      >
        <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionText, { color: theme.colors.mutedForeground }]}>
          {name}
        </Text>
      </Pressable>
      <Sortable.Handle style={styles.handle}>
        <Sortable.Touchable style={styles.handleFill} onTouchesDown={() => onHandle({ type: 'press', key: sectionKey })} onTouchesUp={() => onHandle({ type: 'release' })}>
          <Grip />
        </Sortable.Touchable>
      </Sortable.Handle>
    </View>
  )
}

interface EditRowProps {
  bot: Bot
  selected: boolean
  unread: boolean
  gateway: EditListProps['gateway']
  connectionId: string
  /** False for the pinned concierge: it never moves. */
  draggable: boolean
  actions: MoveAction[]
  onAction(event: AccessibilityActionEvent): void
  onToggle(): void
}

function EditRow({ bot, selected, unread, gateway, connectionId, draggable, actions, onAction, onToggle }: EditRowProps) {
  const theme = useTheme()
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  return (
    <View style={[styles.row, { backgroundColor: theme.colors.background }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        // The label ends in "selected" or "not selected"; a selected state would say it twice.
        accessibilityLabel={editRowLabel(bot, selected, unread)}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
        style={({ pressed }) => [styles.rowBody, { backgroundColor: pressed ? theme.colors.muted : 'transparent' }]}
      >
        <Icon name={selected ? 'check-circle' : 'circle'} size={24} color={selected ? theme.colors.primary : theme.colors.mutedForeground} />
        <Avatar name={bot.name} color={bot.color} imageUri={avatar.data ?? null} size={AVATAR_SIZE} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.colors.foreground }]}>
            {bot.name}
          </Text>
          {bot.role ? (
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.colors.mutedForeground }]}>
              {bot.role}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {draggable ? (
        <Sortable.Handle style={styles.handle}>
          <Grip />
        </Sortable.Handle>
      ) : (
        <View style={styles.handle} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  caption: { height: EDIT_ITEM_HEIGHT.caption, justifyContent: 'flex-end', paddingBottom: 4 },
  captionText: { fontSize: 13 },
  sectionHeader: { height: EDIT_ITEM_HEIGHT.section, flexDirection: 'row', alignItems: 'center' },
  sectionName: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  sectionText: { fontSize: 13 },
  row: { height: EDIT_ITEM_HEIGHT.row, flexDirection: 'row', alignItems: 'center' },
  rowBody: { flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '500' },
  role: { fontSize: 13 },
  // The drag gesture sits on the view that `Sortable.Handle` wraps around its
  // children, so that view gets this style: it fills the whole height of the
  // row or header, and a touch anywhere on the ≡ column picks the item up, not
  // only a touch on the 22 pt glyph (a touch beside it scrolled the list).
  handle: { width: HANDLE_WIDTH, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  handleFill: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }
})
