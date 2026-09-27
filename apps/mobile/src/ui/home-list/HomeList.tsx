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
 *
 * Edit mode also shows drop skeletons: a ghost row under every expanded
 * section without rows (`withSectionGhosts`; an item of the rows list), and
 * the pinned area's skeleton when nothing is pinned (`PinnedArea`). Both are
 * there while `layoutEditing` is, and fade with Edit mode's progress. The
 * pinned skeleton adds one line of pins above the rows list at once, so
 * while Edit mode starts and ends the rows list and the footer slide by it
 * (`below`), from where they were to where they now sit.
 *
 * A row dragged out of the rows list and dropped over the pinned area is
 * pinned at that spot, and a pin dragged into the rows list is unpinned
 * there (`useCrossDrag`). While a row is over the pinned area the rows list
 * keeps the order the drag started with, so its gap stays where it was
 * (`returnToStart` in the sort strategy), and the lifted row fades so the
 * avatars and the marker show through it. Auto-scroll reaches the other
 * area: a row dragged up scrolls the list up to its very top, the pinned
 * area included, and a pin dragged down scrolls down to the end of the list.
 */

import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { AppState, RefreshControl, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native'
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'
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
  returnToStart,
  sectionDragItems,
  slotMeta,
  useAvatar,
  withSectionGhosts,
  type Bot,
  type CrossSlot,
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
import { RowsMarker } from './CrossMarkers'
import { HomeRow } from './HomeRow'
import { HomeSectionHeader } from './HomeSectionHeader'
import { PINNED_SKELETON_HEIGHT, PinnedArea, pinAreaGeometry } from './PinnedArea'
import { SectionGhostRow } from './SectionGhostRow'
import { useCrossDrag } from './use-cross-drag'
import { useSwipeSelect } from './use-swipe-select'

/**
 * A touch on a handle picks the item up at once, like the reorder control on
 * iOS: with a hold, a grab that moved straight away was cancelled and the list
 * scrolled instead. The library's 5 px margin before the pick-up lands stays:
 * a wider one let a fast flick scroll the list under the finger first, and the
 * pick-up then landed on another row. A flick on a handle still scrolls.
 */
const DRAG_ACTIVATION_DELAY = 0

/**
 * The library's own auto-scroll overscroll (50 pt), kept where the drag
 * does not need to reach the other area: under the rows list and above the
 * pins. Toward the other area each list gets the exact distance to the
 * content's end instead; a larger value would let the list scroll past its
 * content into blank space.
 */
const OVERSCROLL = 50

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
  /** How much of the list's bottom an overlay covers (the Edit bar while it shows): a drag between the pinned area and the list does not land there. */
  bottomCover: number
}

/**
 * The one-column sort strategy with the drop rules applied while the finger
 * moves: a slot the rules forbid is refused, and the item slides back to where
 * the drag started. While the dragged row is over the pinned area (`cross`),
 * the list shows the order the drag started with. `meta` and `cross` must keep
 * their identity: a new strategy remounts the grid.
 */
function makeGuardedStrategy(meta: SharedValue<SlotMeta>, cross: SharedValue<CrossSlot>): SortStrategyFactory {
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
      if (cross.value?.area === 'pinned') {
        return returnToStart(order, start)
      }
      return nextOrder({ order, startOrder: start, activeKey, activeIndex, activeHeight: dimensions.height, centerY: position.y, heights: itemHeights.value, meta: meta.value })
    }
  }
}

const keyOf = (item: DragItem) => item.key

export function HomeList(props: HomeListProps) {
  const { items, selection, editing, layoutEditing, progress, gateway, connectionId, haptics, unread, refreshing, onRefresh, onOpen, onMenu, onToggle, onSelectionChange, onMove, onToggleCollapsed, onEditSection, header, footer, bottomPadding, bottomCover } = props
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const gutter = usePagePadding()
  const pins = useMemo(() => pinnedItems(items), [items])
  const list = useMemo(() => listItems(items), [items])
  // The rows list as it shows: in Edit mode with a ghost row under each empty section.
  const shown = useMemo<DragItem[]>(() => (layoutEditing ? withSectionGhosts(list) : list), [layoutEditing, list])
  const swipe = useSwipeSelect(scrollRef, shown, selection, onSelectionChange)
  // While a section handle is touched or dragged, the rows list shows only the section headers.
  const [sectionDrag, dispatch] = useReducer(nextSectionDrag, NO_SECTION_DRAG)
  const data = useMemo<DragItem[]>(() => (sectionDrag.key ? sectionDragItems(shown, sectionDrag.key) : shown), [shown, sectionDrag.key])
  // The pinned skeleton's line appears and leaves at once; the rows below slide by it instead of jumping.
  const pinnedSkeleton = layoutEditing && pins.length === 0
  const below = useAnimatedStyle(() => ({ transform: [{ translateY: pinnedSkeleton ? (progress.get() - 1) * PINNED_SKELETON_HEIGHT : 0 }] }))

  // Where the rows list starts in the scroll content (right under the pinned
  // area), and the content's height: the auto-scroll reach of both drag lists.
  const [listTop, setListTop] = useState(0)
  const [contentHeight, setContentHeight] = useState(0)
  const { onListLayout, onContentSizeChange } = swipe
  const onRowsLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onListLayout(event)
      setListTop(event.nativeEvent.layout.y)
    },
    [onListLayout]
  )
  const onContentSize = useCallback(
    (width: number, height: number) => {
      onContentSizeChange(width, height)
      setContentHeight(height)
    },
    [onContentSizeChange]
  )
  // A row dragged up may scroll the list to its very top, where the pinned area shows.
  const rowsOverscroll = useMemo<[number, number]>(() => [listTop, OVERSCROLL], [listTop])
  // A pin dragged down may scroll to the end of the content, past the rows on the first screen.
  const pinsOverscroll = useMemo<[number, number]>(() => [OVERSCROLL, Math.max(0, contentHeight - listTop)], [contentHeight, listTop])
  const pinGeometry = useMemo(() => pinAreaGeometry(gutter), [gutter])
  const cross = useCrossDrag({ scrollRef, pins, shown, lines: swipe.lines, pinGeometry, bottomCover, onMove })
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
  const strategy = useMemo(() => makeGuardedStrategy(meta, cross.slot), [meta, cross.slot])

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
      cross.begin(key)
      dispatch({ type: 'start', key })
    },
    [haptics, cross]
  )

  const onDragEnd = useCallback(
    ({ key, data: dropped }: SortableGridDragEndParams<DragItem>) => {
      lightTap(haptics)
      dispatch({ type: 'drop' })
      // Dropped over the pinned area: pinned there, so the rows list keeps its order.
      if (cross.end(key)) {
        return
      }
      const move = dropMove(list, dropped.map(keyOf), key)
      if (move) {
        onMove(move)
      }
    },
    [haptics, list, onMove, cross]
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
        case 'ghost':
          return <SectionGhostRow progress={progress} gutter={gutter} />
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
              hovering={cross.hovering}
            />
          )
      }
    },
    [editing, layoutEditing, progress, items, selection, gutter, act, onToggleCollapsed, onEditSection, gateway, connectionId, unread, onOpen, onToggle, onMenu, swipe.select, cross.hovering]
  )

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={bleed(gutter)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onLayout={swipe.onLayout}
      onContentSizeChange={onContentSize}
      // A swipe that starts on a section handle and scrolls is no drag: show the whole list again.
      onScrollBeginDrag={() => dispatch({ type: 'release' })}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
    >
      {header}
      <PinnedArea
        pins={pins}
        items={items}
        editing={editing}
        layoutEditing={layoutEditing}
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
        onSelectionChange={onSelectionChange}
        gutter={gutter}
        cross={cross}
        overscroll={pinsOverscroll}
      />
      {/* Keeps the rows list as tall as the whole list while only headers show and while it comes back, so the scroll position holds. */}
      <Animated.View ref={cross.rowsRef} collapsable={false} onLayout={onRowsLayout} style={[{ minHeight: listMinHeight(shown) }, below]}>
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
          activeItemOpacity={cross.rowOpacity}
          activeItemShadowOpacity={cross.rowShadow}
          inactiveItemOpacity={1}
          autoScrollMaxOverscroll={rowsOverscroll}
          onDragStart={onDragStart}
          onDragMove={cross.onDragMove}
          onDragEnd={onDragEnd}
          onActiveItemDropped={cross.dropped}
        />
        <RowsMarker slot={cross.slot} gutter={gutter} />
      </Animated.View>
      {footer ? <Animated.View style={below}>{footer}</Animated.View> : null}
    </Animated.ScrollView>
  )
}
