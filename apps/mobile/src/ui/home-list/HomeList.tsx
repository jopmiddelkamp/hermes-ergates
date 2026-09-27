/**
 * The one Home list, in both modes (docs/10 "Home", "Home edit mode"): the
 * pinned avatars, then the rows list with No section's rows and each
 * section's header and rows. Pressing Edit keeps this list; Edit mode's
 * progress slides the circles in and fades the handles in, and Done plays
 * it back. The rows list is a drag list over the rows list items; only a ≡
 * handle starts a drag, and only in Edit mode. Every rule comes from the
 * agents feature's drop rules: the live slot rule in the sort strategy, each
 * drop as one `OrderMove` through `onMove`, and the headers-only list while
 * a section header is dragged. Screen readers get Move up and Move down
 * instead, and Edit section on a section header.
 *
 * The list runs edge to edge: a lifted row is not clipped, the scroll bar
 * sits at the screen edge and a row's tap highlight spans the whole width.
 * Every row and header pads its own content by the page padding instead
 * (`page-padding.ts`). `layoutEditing` (`useLayoutEditing` in `motion.ts`)
 * carries the one-time static layout switch down to every row and header,
 * so it is computed once here, not per item. `renderItem` and the drag
 * callbacks passed to `Sortable.Grid` are wrapped in `useCallback`, but that
 * only keeps them stable while Home's own handlers are: Home passes new
 * `onOpen`, `onMenu`, `onToggle`, `onToggleCollapsed` and `onEditSection`
 * closures whenever its state changes, so `renderItem` is a new function on
 * most Home renders too. Do not chase full stability by wrapping those five
 * handlers in `useCallback` inside `index.tsx`.
 */

import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { AppState, RefreshControl, View, type AccessibilityActionEvent } from 'react-native'
import Animated, { useAnimatedReaction, useAnimatedRef, useSharedValue, type SharedValue } from 'react-native-reanimated'
import Sortable, { useCommonValuesContext, type DragStartParams, type SortableGridDragEndParams, type SortableGridRenderItem, type SortStrategyFactory } from 'react-native-sortables'

import {
  EDIT_SECTION_ACTION,
  NO_SECTION_DRAG,
  dropMove,
  listItems,
  listMinHeight,
  moveActions,
  moveDirection,
  moveStep,
  nextOrder,
  nextSectionDrag,
  pinnedItems,
  sectionDragItems,
  slotMeta,
  useAvatar,
  type Bot,
  type DragItem,
  type EditItem,
  type ListItem,
  type Selection,
  type SlotMeta
} from '@/features/agents'
import { lightTap } from '@/lib/haptics'
import type { OrderMove } from '@/state/organization'

import type { AnchorRect } from '../ActionMenu'
import { bleed } from '../page-padding'
import { usePagePadding } from '../Screen'
import { HomeRow } from './HomeRow'
import { HomeSectionHeader } from './HomeSectionHeader'
import { PinnedArea } from './PinnedArea'
import { useSwipeSelect } from './use-swipe-select'

/**
 * A touch on a handle picks the item up at once, like the reorder control on
 * iOS: with a hold, a grab that moved straight away was cancelled and the list
 * scrolled instead. The library's 5 px margin before the pick-up lands stays:
 * a wider one let a fast flick scroll the list under the finger first, and the
 * pick-up then landed on another row. A flick on a handle still scrolls.
 */
const DRAG_ACTIVATION_DELAY = 0

export interface HomeListProps {
  /** `buildEditItems` over the Home layout: the pins, then the rows list. */
  items: EditItem[]
  selection: Selection
  editing: boolean
  /** The static Edit-mode layout (`useLayoutEditing`): on the instant Edit mode starts, off only once a leave has fully finished. */
  layoutEditing: boolean
  /** Edit mode's progress, 0 to 1 (`useShowProgress`). */
  progress: SharedValue<number>
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  /** The owner's Haptics setting: a light tap when a drag starts and when it drops. */
  haptics: boolean
  unread(profile: string): boolean
  refreshing: boolean
  onRefresh(): void
  onOpen(bot: Bot): void
  /** The long-press menu, outside Edit mode. */
  onMenu(bot: Bot, anchor: AnchorRect): void
  onToggle(profile: string): void
  /** Sets the whole selection: a swipe across the selection circles selects or deselects several rows at once. */
  onSelectionChange(selection: Selection): void
  /** Applies one reorder or move: a drop, or Move up / Move down / Move left / Move right. */
  onMove(move: OrderMove): void
  onToggleCollapsed(sectionId: string): void
  /** Opens the Section page for a section header. */
  onEditSection(sectionId: string): void
  /** Shown above the pinned avatars (the load error line). */
  header?: ReactNode
  /** Shown below the rows (the empty Home line). */
  footer?: ReactNode
  /** Bottom padding of the scroll content, the home indicator inset included. */
  bottomPadding: number
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

export function HomeList(props: HomeListProps) {
  const { items, selection, editing, layoutEditing, progress, gateway, connectionId, haptics, unread, refreshing, onRefresh, onOpen, onMenu, onToggle, onSelectionChange, onMove, onToggleCollapsed, onEditSection, header, footer, bottomPadding } = props
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const gutter = usePagePadding()
  const pins = useMemo(() => pinnedItems(items), [items])
  const list = useMemo(() => listItems(items), [items])
  const swipe = useSwipeSelect(scrollRef, list, selection, onSelectionChange)
  // While a section handle is touched or dragged, the rows list shows only the section headers.
  const [sectionDrag, dispatch] = useReducer(nextSectionDrag, NO_SECTION_DRAG)
  const data = useMemo<DragItem[]>(() => (sectionDrag.key ? sectionDragItems(list, sectionDrag.key) : list), [list, sectionDrag.key])
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

  // `useCallback` here only helps across a Home render that keeps the same
  // `onOpen`, `onMenu`, `onToggle`, `onToggleCollapsed` and `onEditSection`
  // identities; Home passes new ones whenever its own state changes, so
  // `renderItem` is not stable across most Home renders. Without the
  // `useCallback` wrapper, `renderItem` and the drag callbacks would also be
  // new function literals on the renders where the handlers do stay put,
  // which doubled the work right at the Edit toggle (the moment `editing`
  // itself already forces a real redraw).
  const onDragStart = useCallback(
    ({ key }: DragStartParams) => {
      lightTap(haptics)
      dispatch({ type: 'start', key })
    },
    [haptics]
  )

  const onDragEnd = useCallback(
    ({ key, data: dropped }: SortableGridDragEndParams<DragItem>) => {
      lightTap(haptics)
      dispatch({ type: 'drop' })
      const move = dropMove(list, dropped.map(keyOf), key)
      if (move) {
        onMove(move)
      }
    },
    [haptics, list, onMove]
  )

  const act = useCallback(
    (item: ListItem) => (event: AccessibilityActionEvent) => {
      if (item.kind === 'section' && event.nativeEvent.actionName === EDIT_SECTION_ACTION.name) {
        onEditSection(item.section.id)
        return
      }
      const direction = moveDirection(event.nativeEvent.actionName)
      const move = direction ? moveStep(items, item.key, direction) : null
      if (move) {
        onMove(move)
      }
    },
    [items, onMove, onEditSection]
  )

  const renderItem: SortableGridRenderItem<DragItem> = useCallback(
    ({ item }) => {
      switch (item.kind) {
        case 'spacer':
          return <View style={{ height: item.height }} />
        case 'section':
          return (
            <HomeSectionHeader
              name={item.section.name}
              expanded={!item.section.collapsed}
              editing={editing}
              layoutEditing={layoutEditing}
              progress={progress}
              actions={editing ? moveActions(items, item.key) : []}
              onAction={act(item)}
              onToggle={() => onToggleCollapsed(item.section.id)}
              onEdit={() => onEditSection(item.section.id)}
              onHandle={dispatch}
              sectionKey={item.key}
              gutter={gutter}
            />
          )
        default:
          return (
            <HomeRow
              bot={item.bot}
              gateway={gateway}
              connectionId={connectionId}
              unread={unread(item.bot.profile)}
              editing={editing}
              layoutEditing={layoutEditing}
              progress={progress}
              selected={selection.has(item.bot.profile)}
              actions={editing ? moveActions(items, item.key) : []}
              onAction={act(item)}
              onPress={() => (editing ? onToggle(item.bot.profile) : onOpen(item.bot))}
              onLongPress={anchor => onMenu(item.bot, anchor)}
              rowKey={item.key}
              swipe={swipe.select}
              gutter={gutter}
            />
          )
      }
    },
    [editing, layoutEditing, progress, items, selection, gutter, act, onToggleCollapsed, onEditSection, gateway, connectionId, unread, onOpen, onToggle, onMenu, swipe.select]
  )

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={bleed(gutter)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onLayout={swipe.onLayout}
      onContentSizeChange={swipe.onContentSizeChange}
      // A swipe that starts on a section handle and scrolls is no drag: show the whole list again.
      onScrollBeginDrag={() => dispatch({ type: 'release' })}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
    >
      {header}
      <PinnedArea
        pins={pins}
        items={items}
        editing={editing}
        progress={progress}
        selection={selection}
        gateway={gateway}
        connectionId={connectionId}
        haptics={haptics}
        scrollRef={scrollRef}
        unread={unread}
        onPress={bot => (editing ? onToggle(bot.profile) : onOpen(bot))}
        onLongPress={onMenu}
        onMove={onMove}
        gutter={gutter}
      />
      {/* Keeps the rows list as tall as the whole list while only headers show and while it comes back, so the scroll position holds. */}
      <View onLayout={swipe.onListLayout} style={{ minHeight: listMinHeight(list) }}>
        <Sortable.Grid
          columns={1}
          data={data}
          keyExtractor={keyOf}
          renderItem={renderItem}
          customHandle
          sortEnabled={editing}
          strategy={strategy}
          scrollableRef={scrollRef}
          overDrag="vertical"
          dragActivationDelay={DRAG_ACTIVATION_DELAY}
          activeItemScale={1.02}
          inactiveItemOpacity={1}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </View>
      {footer}
    </Animated.ScrollView>
  )
}
