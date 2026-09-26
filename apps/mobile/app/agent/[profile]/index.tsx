/**
 * Agent details (docs/10 "Settings and agent details"): Edit Bot first,
 * then Routines, Tools & connectors and Memory, with the same roster
 * overflow menu as Home behind the header's "more" button.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { deleteAgent, newSection, useAvatar, useHome, useSetHidden, type Bot } from '@/features/agents'
import { usePrimaryConnection } from '@/features/settings'
import { userMessage } from '@/gateway/errors'
import { useGateway } from '@/gateway/registry'
import { lightTap } from '@/lib/haptics'
import { useDeviceStore } from '@/state/device-store'
import { useTheme } from '@/theme/provider'
import type { AnchorRect } from '@/ui/ActionMenu'
import { Avatar } from '@/ui/Avatar'
import { BotActions } from '@/ui/BotActions'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { Icon } from '@/ui/icons'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'

export default function AgentDetailsScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const connection = usePrimaryConnection()
  if (!connection || !profile) {
    return null
  }
  return <AgentDetails connectionId={connection.id} connectionLabel={connection.label} profile={profile} />
}

function AgentDetails({ connectionId, connectionLabel, profile }: { connectionId: string; connectionLabel: string; profile: string }) {
  const theme = useTheme()
  const router = useRouter()
  const connection = useDeviceStore(s => s.connections.find(c => c.id === connectionId))!
  const gateway = useGateway(connection)
  const home = useHome(gateway, connectionId)
  // Per-action selectors, never `useDeviceStore()`: a whole-store subscription
  // re-rendered this screen on every unrelated store write.
  const pin = useDeviceStore(s => s.pin)
  const unpin = useDeviceStore(s => s.unpin)
  const markRead = useDeviceStore(s => s.markRead)
  const markUnread = useDeviceStore(s => s.markUnread)
  const moveRowsToSection = useDeviceStore(s => s.moveRowsToSection)
  const createSection = useDeviceStore(s => s.createSection)
  const forgetProfile = useDeviceStore(s => s.forgetProfile)
  const clearDraft = useDeviceStore(s => s.clearDraft)
  const haptics = useDeviceStore(s => s.prefs.haptics)
  const setHidden = useSetHidden(gateway, connectionId)
  const bot = home.byProfile.get(profile) ?? null
  const [menu, setMenu] = useState<{ bot: Bot; anchor: AnchorRect } | null>(null)
  const menuAnchorRef = useRef<View>(null)

  const openMenu = () => {
    if (!bot) {
      return
    }
    lightTap(haptics)
    menuAnchorRef.current?.measureInWindow((x, y, width, height) => setMenu({ bot, anchor: { x, y, width, height } }))
  }

  /** Device-local leftovers of a deleted profile, so recreating the name starts clean. */
  const forgetLocalState = (deleted: string) => {
    forgetProfile(connectionId, deleted, Date.now())
    clearDraft(connectionId, deleted)
  }

  const handlers = {
    edit: (b: Bot) => router.push({ pathname: '/agent/[profile]/edit', params: { profile: b.profile } }),
    toggleUnread: (b: Bot, unread: boolean) => (unread ? markUnread(connectionId, b.profile) : markRead(connectionId, b.profile, Date.now())),
    togglePin: (b: Bot, pinned: boolean) => (pinned ? pin(connectionId, b.profile) : unpin(connectionId, b.profile)),
    moveToSection: (b: Bot, sectionId: string | null) => moveRowsToSection(connectionId, [b.profile], sectionId),
    createSection: (b: Bot, name: string) => {
      const section = newSection(home.organization.sections, name)
      createSection(connectionId, section)
      moveRowsToSection(connectionId, [b.profile], section.id)
    },
    toggleHidden: (b: Bot, hidden: boolean) => setHidden.mutate({ bot: b, hidden }, { onError: err => Alert.alert('Could not update', userMessage(err)) }),
    remove: async (b: Bot) => {
      const result = await deleteAgent(gateway, b.profile, b.isDefault)
      if (result.error) {
        Alert.alert('Delete did not finish', `${result.error}\nRoutines removed: ${result.removedJobs.length}. Steps: ${Object.entries(result.steps).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
        return
      }
      forgetLocalState(b.profile)
      router.replace('/')
    }
  }

  if (!bot) {
    return (
      <Screen>
        <View style={styles.header}>
          <IconButton name="chevron-left" accessibilityLabel="Back" onPress={() => router.back()} />
        </View>
        {home.loading ? (
          <Text style={{ color: theme.colors.mutedForeground }}>Loading…</Text>
        ) : home.error ? (
          <View style={styles.errorBlock}>
            <Text style={{ color: theme.colors.destructive }} accessibilityRole="alert">
              Could not load this bot.
            </Text>
            <Button label="Retry" onPress={() => void home.refetch()} accessibilityLabel="Retry" />
          </View>
        ) : (
          <Text style={{ color: theme.colors.mutedForeground }}>This bot is not on the roster.</Text>
        )}
      </Screen>
    )
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton name="chevron-left" accessibilityLabel="Back" onPress={() => router.back()} />
        <View style={styles.headerSpacer} />
        <View ref={menuAnchorRef} collapsable={false}>
          <IconButton name="more-horizontal" accessibilityLabel="More actions" onPress={openMenu} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Identity bot={bot} gateway={gateway} connectionId={connectionId} />
        <Card>
          <MenuRow label="Edit Bot" onPress={() => router.push({ pathname: '/agent/[profile]/edit', params: { profile } })} />
          <MenuRow label="Routines" onPress={() => router.push({ pathname: '/agent/[profile]/routines', params: { profile } })} />
          <MenuRow label="Tools & connectors" onPress={() => router.push({ pathname: '/agent/[profile]/tools', params: { profile } })} />
          <MenuRow label="Memory" onPress={() => router.push({ pathname: '/agent/[profile]/memory', params: { profile } })} />
          <MenuRow label="Notifications" onPress={() => router.push({ pathname: '/notifications', params: { profile } })} />
        </Card>

        <Card>
          <View style={styles.info}>
            <InfoRow label="Profile id" value={profile} theme={theme} />
            <InfoRow label="Model" value={bot.model || '—'} theme={theme} />
            <InfoRow label="Provider" value={bot.provider || '—'} theme={theme} />
            <InfoRow label="Description" value={bot.description || '—'} theme={theme} />
          </View>
        </Card>
      </ScrollView>
      <BotActions
        bot={menu?.bot ?? null}
        anchor={menu?.anchor ?? null}
        unread={menu ? home.unread(menu.bot.profile) : false}
        pinned={menu ? home.isPinned(menu.bot.profile) : false}
        sections={home.organization.sections}
        currentSectionId={menu ? (home.sectionOf(menu.bot.profile)?.id ?? null) : null}
        connectionLabel={connectionLabel}
        handlers={handlers}
        onClose={() => setMenu(null)}
      />
    </Screen>
  )
}

function Identity({ bot, gateway, connectionId }: { bot: Bot; gateway: ReturnType<typeof useGateway>; connectionId: string }) {
  const theme = useTheme()
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  return (
    <View style={styles.identity} accessibilityRole="header" accessibilityLabel={[bot.name, bot.role].filter(Boolean).join(', ')}>
      <Avatar name={bot.name} color={bot.color} imageUri={avatar.data ?? null} size={88} />
      <Text style={[styles.identityName, { color: theme.colors.foreground }]} numberOfLines={1}>
        {bot.name}
      </Text>
      {bot.role ? (
        <Text style={[styles.identityRole, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
          {bot.role}
        </Text>
      ) : null}
    </View>
  )
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? theme.colors.accent : 'transparent' }]}
    >
      <Text style={[styles.menuRowLabel, { color: theme.colors.foreground }]}>{label}</Text>
      <Icon name="chevron-right" size={20} color={theme.colors.mutedForeground} />
    </Pressable>
  )
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: theme.colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: theme.colors.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginBottom: 8, gap: 8 },
  headerSpacer: { flex: 1 },
  identity: { alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 4 },
  identityName: { fontSize: 22, fontWeight: '600' },
  identityRole: { fontSize: 15 },
  errorBlock: { gap: 12, alignItems: 'flex-start', marginTop: 24 },
  content: { paddingTop: 8, paddingBottom: 40, gap: 24 },
  menuRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, gap: 12 },
  menuRowLabel: { fontSize: 17, flex: 1 },
  info: { gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  infoRow: { gap: 2 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 15, lineHeight: 20 }
})
