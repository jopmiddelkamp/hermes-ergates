import { useFocusEffect, useRouter, Redirect } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import {
  NO_SELECTION,
  buildEditItems,
  deleteAgent,
  editBarLabels,
  hideEach,
  hideFailureMessage,
  liveSelection,
  profilesParam,
  selectedInListOrder,
  selectionTitle,
  toggleSelected,
  useAvatar,
  useHome,
  useSetHidden,
  type Bot,
  type Selection
} from '@/features/agents'
import { usePrimaryConnection } from '@/features/settings'
import { userMessage } from '@/gateway/errors'
import { useGateway } from '@/gateway/registry'
import { lightTap } from '@/lib/haptics'
import { useDeviceStore } from '@/state/device-store'
import { useTheme } from '@/theme/provider'
import { useSkinStore } from '@/theme/skin-store'
import type { AnchorRect } from '@/ui/ActionMenu'
import { Avatar } from '@/ui/Avatar'
import { BotActions } from '@/ui/BotActions'
import { BotRow } from '@/ui/BotRow'
import { Button } from '@/ui/Button'
import { EditBar } from '@/ui/EditBar'
import { EditList } from '@/ui/EditList'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'
import { SectionHeader } from '@/ui/SectionHeader'

export default function HomeScreen() {
  const connection = usePrimaryConnection()
  if (!connection) {
    return <Redirect href="/connect" />
  }
  return <Home connectionId={connection.id} connectionLabel={connection.label} />
}

function Home({ connectionId, connectionLabel }: { connectionId: string; connectionLabel: string }) {
  const theme = useTheme()
  const router = useRouter()
  // Guarded by `HomeScreen`, which redirects to /connect without a connection.
  const connection = useDeviceStore(s => s.connections.find(c => c.id === connectionId))!
  const gateway = useGateway(connection)
  const home = useHome(gateway, connectionId)
  // Per-action selectors, never `useDeviceStore()`: the whole-store selector
  // re-rendered this screen (and its whole roster list) on every keystroke
  // typed in the chat below it. Action references are stable.
  const pin = useDeviceStore(s => s.pin)
  const unpin = useDeviceStore(s => s.unpin)
  const pinMany = useDeviceStore(s => s.pinMany)
  const unpinMany = useDeviceStore(s => s.unpinMany)
  const markRead = useDeviceStore(s => s.markRead)
  const markUnread = useDeviceStore(s => s.markUnread)
  const markManyRead = useDeviceStore(s => s.markManyRead)
  const markManyUnread = useDeviceStore(s => s.markManyUnread)
  const applyMove = useDeviceStore(s => s.applyMove)
  const toggleCollapsed = useDeviceStore(s => s.toggleCollapsed)
  const adoptProfiles = useDeviceStore(s => s.adoptProfiles)
  const forgetProfile = useDeviceStore(s => s.forgetProfile)
  const clearDraft = useDeviceStore(s => s.clearDraft)
  const haptics = useDeviceStore(s => s.prefs.haptics)
  const setHidden = useSetHidden(gateway, connectionId)
  const setActiveConnection = useSkinStore(s => s.setActiveConnection)
  const [menu, setMenu] = useState<{ bot: Bot; anchor: AnchorRect } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Edit mode (docs/10 "Home edit mode"). Every change applies at once, so
  // leaving only clears the selection; there is nothing to cancel.
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<Selection>(NO_SELECTION)
  const items = useMemo(() => buildEditItems(home), [home])
  const selection = liveSelection(picked, items)
  const selected = selectedInListOrder(items, selection)
  const labels = editBarLabels(selected, { isPinned: home.isPinned, isUnread: home.unread })

  const startEditing = (profile?: string) => {
    setPicked(profile ? new Set([profile]) : NO_SELECTION)
    setEditing(true)
  }
  const stopEditing = () => {
    setEditing(false)
    setPicked(NO_SELECTION)
  }

  // Android Back leaves Edit mode instead of leaving Home.
  useFocusEffect(
    useCallback(() => {
      if (!editing) {
        return
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setEditing(false)
        setPicked(NO_SELECTION)
        return true
      })
      return () => subscription.remove()
    }, [editing])
  )

  const refetchHome = home.refetch
  useFocusEffect(
    useCallback(() => {
      setActiveConnection(connectionId)
      void gateway.restore().then(() => refetchHome())
    }, [connectionId, gateway, refetchHome, setActiveConnection])
  )

  // New installs pin the concierge only (docs/10 "Home"): once, when no organization exists for this connection.
  // Then the manual order records every profile it does not know yet, where it
  // shows now, so a row never moves by itself (docs/05 section 3). One effect,
  // so the pin always comes first: adoption creates the organization.
  const hasOrganization = useDeviceStore(s => Boolean(s.organization[connectionId]))
  const defaultBot = home.bots.find(b => b.isDefault)
  const rows = home.rows
  useEffect(() => {
    if (rows.length === 0) {
      return
    }
    if (!hasOrganization && defaultBot) {
      pin(connectionId, defaultBot.profile)
    }
    adoptProfiles(connectionId, rows)
  }, [rows, hasOrganization, defaultBot, connectionId, pin, adoptProfiles])

  const openChat = (bot: Bot) => {
    markRead(connectionId, bot.profile, Date.now())
    router.push({ pathname: '/chat/[profile]', params: { profile: bot.profile } })
  }

  const editSection = (sectionId: string) => router.push({ pathname: '/section', params: { id: sectionId } })

  const openMenu = (bot: Bot, anchor: AnchorRect) => {
    lightTap(haptics)
    setMenu({ bot, anchor })
  }

  /** Device-local leftovers of a deleted profile, so recreating the name starts clean. */
  const forgetLocalState = (profile: string) => {
    forgetProfile(connectionId, profile, Date.now())
    clearDraft(connectionId, profile)
  }

  const handlers = {
    edit: (bot: Bot) => {
      // Details first, so the editor is a real sheet with the bot's page beneath it.
      router.push({ pathname: '/agent/[profile]', params: { profile: bot.profile } })
      router.push({ pathname: '/agent/[profile]/edit', params: { profile: bot.profile } })
    },
    toggleUnread: (bot: Bot, unread: boolean) => (unread ? markUnread(connectionId, bot.profile) : markRead(connectionId, bot.profile, Date.now())),
    togglePin: (bot: Bot, pinned: boolean) => (pinned ? pin(connectionId, bot.profile) : unpin(connectionId, bot.profile)),
    moveToSection: (bot: Bot) => router.push({ pathname: '/move-to-section', params: { profiles: profilesParam([bot.profile]) } }),
    select: (bot: Bot) => startEditing(bot.profile),
    toggleHidden: (bot: Bot, hidden: boolean) => setHidden.mutate({ bot, hidden }, { onError: err => Alert.alert('Could not update', userMessage(err)) }),
    remove: async (bot: Bot) => {
      const result = await deleteAgent(gateway, bot.profile, bot.isDefault)
      if (result.error) {
        Alert.alert('Delete did not finish', `${result.error}\nRoutines removed: ${result.removedJobs.length}. Steps: ${Object.entries(result.steps).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
      } else {
        forgetLocalState(bot.profile)
      }
      await home.refetch()
    }
  }

  // After each bottom bar action the selection clears and Edit mode stays open.
  const bar = {
    move: () => {
      router.push({ pathname: '/move-to-section', params: { profiles: profilesParam(selected) } })
      setPicked(NO_SELECTION)
    },
    pin: () => {
      if (labels.pin === 'Unpin') {
        unpinMany(connectionId, selected)
      } else {
        pinMany(connectionId, selected)
      }
      setPicked(NO_SELECTION)
    },
    hide: async () => {
      const bots = selected.map(profile => home.byProfile.get(profile)).filter((bot): bot is Bot => Boolean(bot))
      setPicked(NO_SELECTION)
      const failed = await hideEach(bots, bot => setHidden.mutateAsync({ bot, hidden: true }))
      if (failed.length > 0) {
        Alert.alert('Could not hide', hideFailureMessage(failed))
      }
    },
    read: () => {
      if (labels.read === 'Mark read') {
        markManyRead(connectionId, selected, Date.now())
      } else {
        markManyUnread(connectionId, selected)
      }
      setPicked(NO_SELECTION)
    }
  }

  const onRefresh = async () => {
    setRefreshing(true)
    await home.refetch()
    setRefreshing(false)
  }

  const renderRow = (bot: Bot) => (
    <BotRow key={bot.profile} bot={bot} gateway={gateway} connectionId={connectionId} unread={home.unread(bot.profile)} onPress={() => openChat(bot)} onLongPress={anchor => openMenu(bot, anchor)} />
  )

  const empty = !home.loading && home.bots.length === 0

  if (editing) {
    return (
      <Screen>
        <View style={styles.topBar}>
          {Platform.OS === 'ios' ? (
            <>
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centered]}>
                <Text accessibilityRole="header" style={[styles.editTitle, { color: theme.colors.foreground }]}>
                  {selectionTitle(selection.size)}
                </Text>
              </View>
              <Button label="Done" variant="ghost" compact onPress={stopEditing} />
            </>
          ) : (
            <>
              <IconButton name="x" accessibilityLabel="Leave edit mode" onPress={stopEditing} />
              <Text accessibilityRole="header" style={[styles.editTitle, { color: theme.colors.foreground }]}>
                {selectionTitle(selection.size)}
              </Text>
            </>
          )}
        </View>
        <EditList
          items={items}
          selection={selection}
          gateway={gateway}
          connectionId={connectionId}
          haptics={haptics}
          unread={home.unread}
          onToggle={profile => setPicked(toggleSelected(selection, profile))}
          onMove={move => applyMove(connectionId, move)}
          onEditSection={editSection}
        />
        {selection.size > 0 ? <EditBar labels={labels} onMove={bar.move} onPin={bar.pin} onHide={() => void bar.hide()} onRead={bar.read} /> : null}
      </Screen>
    )
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <IconButton name="user" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
        <View style={styles.spacer} />
        {Platform.OS === 'ios' ? (
          <Button label="Edit" variant="ghost" compact onPress={() => startEditing()} />
        ) : (
          <IconButton name="edit-2" accessibilityLabel="Edit" onPress={() => startEditing()} />
        )}
        <IconButton name="search" accessibilityLabel="Search" onPress={() => router.push('/search')} />
        <IconButton name="plus" accessibilityLabel="Add" onPress={() => router.push('/new-agent')} />
      </View>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} contentContainerStyle={styles.list}>
        {home.error ? (
          <Text style={[styles.line, { color: theme.colors.destructive }]} accessibilityRole="alert">
            Could not load your assistants. Pull to retry.
          </Text>
        ) : null}
        {home.pinned.length > 0 ? (
          <View style={styles.pins}>
            {home.pinned.map(bot => (
              <PinnedAvatar key={bot.profile} bot={bot} gateway={gateway} connectionId={connectionId} unread={home.unread(bot.profile)} onPress={() => openChat(bot)} onLongPress={anchor => openMenu(bot, anchor)} />
            ))}
          </View>
        ) : null}
        {home.ungrouped.map(renderRow)}
        {home.sections.map(({ section, rows }) => (
          <View key={section.id}>
            <SectionHeader name={section.name} expanded={!section.collapsed} onToggle={() => toggleCollapsed(connectionId, section.id)} onEdit={() => editSection(section.id)} />
            {section.collapsed ? null : rows.map(renderRow)}
          </View>
        ))}
        {empty ? <Text style={[styles.line, { color: theme.colors.mutedForeground }]}>No assistants yet. Tap + to create one.</Text> : null}
      </ScrollView>
      <BotActions
        bot={menu?.bot ?? null}
        anchor={menu?.anchor ?? null}
        unread={menu ? home.unread(menu.bot.profile) : false}
        pinned={menu ? home.isPinned(menu.bot.profile) : false}
        inSection={menu ? home.sectionOf(menu.bot.profile) !== null : false}
        connectionLabel={connectionLabel}
        handlers={handlers}
        onClose={() => setMenu(null)}
      />
    </Screen>
  )
}

function useAnchor() {
  const ref = useRef<View>(null)
  const measure = (cb: (rect: AnchorRect) => void) => {
    ref.current?.measureInWindow((x, y, width, height) => cb({ x, y, width, height }))
  }
  return { ref, measure }
}

function PinnedAvatar({ bot, gateway, connectionId, unread, onPress, onLongPress }: { bot: Bot; gateway: ReturnType<typeof useGateway>; connectionId: string; unread: boolean; onPress: () => void; onLongPress: (anchor: AnchorRect) => void }) {
  const theme = useTheme()
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  const { ref, measure } = useAnchor()
  return (
    <View ref={ref} collapsable={false}>
      <Pressable onPress={onPress} onLongPress={() => measure(onLongPress)} accessibilityRole="button" accessibilityLabel={`${bot.name}${unread ? ', unread' : ''}`} style={styles.pin}>
        <Avatar name={bot.name} color={bot.color} imageUri={avatar.data ?? null} size={84} />
        <Text style={[styles.pinLabel, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
          {bot.name}
        </Text>
        {unread ? <View style={[styles.pinDot, { backgroundColor: theme.colors.primary }]} accessibilityLabel="Unread" /> : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginBottom: 12 },
  spacer: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  editTitle: { fontSize: 17, fontWeight: '600' },
  list: { paddingBottom: 40 },
  pins: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 24, marginVertical: 20 },
  pin: { alignItems: 'center', gap: 8, width: 96 },
  pinLabel: { fontSize: 15 },
  pinDot: { position: 'absolute', top: 2, right: 10, width: 12, height: 12, borderRadius: 6 },
  line: { fontSize: 15, lineHeight: 22, paddingVertical: 24, textAlign: 'center' }
})
