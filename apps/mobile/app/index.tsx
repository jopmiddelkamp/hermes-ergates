import { useFocusEffect, useRouter, Redirect } from 'expo-router'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import { deleteAgent } from '@/features/agents/delete'
import { useAvatar, useSetHidden, type Bot } from '@/features/agents/roster'
import { useHome } from '@/features/agents/use-home'
import { usePrimaryConnection } from '@/features/settings/connections'
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

function newSectionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
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
  // typed in the chat below it (I3). Action references are stable.
  const pin = useDeviceStore(s => s.pin)
  const unpin = useDeviceStore(s => s.unpin)
  const markRead = useDeviceStore(s => s.markRead)
  const markUnread = useDeviceStore(s => s.markUnread)
  const moveToSection = useDeviceStore(s => s.moveToSection)
  const createSection = useDeviceStore(s => s.createSection)
  const toggleCollapsed = useDeviceStore(s => s.toggleCollapsed)
  const clearDraft = useDeviceStore(s => s.clearDraft)
  const haptics = useDeviceStore(s => s.prefs.haptics)
  const setHidden = useSetHidden(gateway, connectionId)
  const setActiveConnection = useSkinStore(s => s.setActiveConnection)
  const [menu, setMenu] = useState<{ bot: Bot; anchor: AnchorRect } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useFocusEffect(
    useCallback(() => {
      setActiveConnection(connectionId)
      void gateway.restore().then(() => home.refetch())
    }, [connectionId, gateway, home.refetch, setActiveConnection])
  )

  // New installs pin the concierge only (docs/10 "Home"): once, when no organization exists for this connection.
  const hasOrganization = useDeviceStore(s => Boolean(s.organization[connectionId]))
  const defaultBot = home.bots.find(b => b.isDefault)
  useEffect(() => {
    if (!hasOrganization && defaultBot) {
      pin(connectionId, defaultBot.profile)
    }
  }, [hasOrganization, defaultBot, connectionId, pin])

  const openChat = (bot: Bot) => {
    markRead(connectionId, bot.profile, Date.now())
    router.push({ pathname: '/chat/[profile]', params: { profile: bot.profile } })
  }

  const openMenu = (bot: Bot, anchor: AnchorRect) => {
    lightTap(haptics)
    setMenu({ bot, anchor })
  }

  /** Device-local leftovers of a deleted profile, so recreating the name starts clean (M13). */
  const forgetLocalState = (profile: string) => {
    unpin(connectionId, profile)
    moveToSection(connectionId, profile, null)
    markRead(connectionId, profile, Date.now())
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
    moveToSection: (bot: Bot, sectionId: string | null) => moveToSection(connectionId, bot.profile, sectionId),
    createSection: (bot: Bot, name: string) => {
      const id = newSectionId()
      createSection(connectionId, { id, name, collapsed: false, order: home.organization.sections.length })
      moveToSection(connectionId, bot.profile, id)
    },
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

  const onRefresh = async () => {
    setRefreshing(true)
    await home.refetch()
    setRefreshing(false)
  }

  const renderRow = (bot: Bot) => (
    <BotRow key={bot.profile} bot={bot} gateway={gateway} connectionId={connectionId} unread={home.unread(bot.profile)} onPress={() => openChat(bot)} onLongPress={anchor => openMenu(bot, anchor)} />
  )

  const empty = !home.loading && home.bots.length === 0

  return (
    <Screen>
      <View style={styles.topBar}>
        <IconButton name="user" accessibilityLabel="Settings" outlined onPress={() => router.push('/settings')} />
        <View style={styles.spacer} />
        <IconButton name="search" accessibilityLabel="Search" outlined onPress={() => router.push('/search')} />
        <IconButton name="plus" accessibilityLabel="Add" outlined onPress={() => router.push('/new-agent')} />
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
            <SectionHeader name={section.name} expanded={!section.collapsed} onToggle={() => toggleCollapsed(connectionId, section.id)} />
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
        sections={home.organization.sections}
        currentSectionId={menu ? home.sectionOf(menu.bot.profile)?.id ?? null : null}
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
  list: { paddingBottom: 40 },
  pins: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 24, marginVertical: 20 },
  pin: { alignItems: 'center', gap: 8, width: 96 },
  pinLabel: { fontSize: 15 },
  pinDot: { position: 'absolute', top: 2, right: 10, width: 12, height: 12, borderRadius: 6 },
  line: { fontSize: 15, lineHeight: 22, paddingVertical: 24, textAlign: 'center' }
})
