import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import React from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { signOut, usePrimaryConnection } from '@/features/settings/connections'
import { useGateway, useGatewayRegistry } from '@/gateway/registry'
import { useDeviceStore } from '@/state/device-store'
import { useTheme } from '@/theme/provider'
import { listMobileThemes } from '@/theme/resolve'
import { useSkinStore } from '@/theme/skin-store'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { Icon } from '@/ui/icons'
import { Sheet } from '@/ui/Sheet'
import { SwitchRow } from '@/ui/SwitchRow'

const HERMES_PIN = 'd76856cc (v0.21.2)'

export default function SettingsScreen() {
  const router = useRouter()
  const connection = usePrimaryConnection()
  if (!connection) {
    return null
  }
  return <SettingsBody connection={connection} onClose={() => router.back()} />
}

function SettingsBody({ connection, onClose }: { connection: NonNullable<ReturnType<typeof usePrimaryConnection>>; onClose: () => void }) {
  const theme = useTheme()
  const router = useRouter()
  const registry = useGatewayRegistry()
  const gateway = useGateway(connection)
  const prefs = useDeviceStore(s => s.prefs)
  const setPrefs = useDeviceStore(s => s.setPrefs)
  const backend = useSkinStore(s => s.state.backend)
  const status = useQuery({ queryKey: ['status', connection.id], queryFn: () => gateway.status(), staleTime: 60_000 })
  const themes = listMobileThemes(backend)
  const appVersion = Constants.expoConfig?.version ?? '0.0.0'

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'This removes the gateway from this phone, including drafts and unsent messages. Your assistants and their history stay on the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut(registry, connection)
          router.replace('/connect')
        }
      }
    ])
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <Group title="Gateway" first>
        <View style={styles.identityRow} accessibilityLabel={`${connection.label}, ${connection.baseUrl}`}>
          <Avatar name={connection.label} size={44} />
          <View style={styles.identityText}>
            <Text style={[styles.rowLabel, { color: theme.colors.foreground }]} numberOfLines={1}>
              {connection.label}
            </Text>
            <Text style={[styles.rowValue, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
              {connection.baseUrl.replace(/^https?:\/\//, '')}
            </Text>
          </View>
        </View>
        <InfoRow label="Sign-in" value={connection.authMode === 'token' ? 'Session token (private loopback)' : 'Username and password'} />
        <InfoRow label="Backend" value={status.data ? `Hermes ${status.data.version}` : status.isError ? 'Unreachable' : 'Checking…'} />
      </Group>

      <Group title="Appearance">
        <View style={styles.segmentRow}>
          {(['system', 'light', 'dark'] as const).map(mode => {
            const selected = prefs.appearance === mode
            return (
              <Pressable
                key={mode}
                onPress={() => setPrefs({ appearance: mode })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Appearance ${mode}`}
                style={[styles.segment, { backgroundColor: selected ? theme.colors.primary : theme.colors.background, borderColor: theme.colors.border }]}
              >
                <Text style={{ color: selected ? theme.colors.primaryForeground : theme.colors.foreground, fontSize: 15 }}>{mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}</Text>
              </Pressable>
            )
          })}
        </View>
        <View style={styles.chips}>
          {themes.map(t => {
            const selected = prefs.themeName === t.name || (prefs.themeName === 'default' && t.name === 'nous')
            return (
              <Pressable
                key={t.name}
                onPress={() => setPrefs({ themeName: t.name })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Theme ${t.label}`}
                style={[styles.chip, selected ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.primary } : { borderColor: theme.colors.border }]}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 15 }}>{t.label}</Text>
              </Pressable>
            )
          })}
        </View>
        <SwitchRow label="Haptics" description="A light tap on send and on menus." value={prefs.haptics} onValueChange={v => setPrefs({ haptics: v })} />
      </Group>

      <Group title="Bots">
        <Pressable onPress={() => router.push('/hidden-bots')} accessibilityRole="button" accessibilityLabel="Hidden bots" style={styles.row}>
          <Text style={[styles.rowLabel, { color: theme.colors.foreground }]}>Hidden bots</Text>
          <Icon name="chevron-right" size={18} color={theme.colors.mutedForeground} />
        </Pressable>
      </Group>

      <Group title="About">
        <InfoRow label="Ergates" value={appVersion} />
        <InfoRow label="Hermes pin" value={HERMES_PIN} />
        <InfoRow label="Privacy" value="Chats live on your gateway. This phone keeps drafts and preferences only." />
      </Group>

      <View style={styles.signOut}>
        <Button label="Sign out" variant="destructive" onPress={confirmSignOut} />
      </View>
    </Sheet>
  )
}

function Group({ title, first, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={[styles.group, first ? styles.groupFirst : null]}>
      <Text style={[styles.groupTitle, { color: theme.colors.mutedForeground }]}>{title}</Text>
      <Card>{children}</Card>
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={styles.info} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.rowLabel, { color: theme.colors.foreground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: theme.colors.mutedForeground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { marginTop: 20, gap: 8 },
  groupFirst: { marginTop: 0 },
  groupTitle: { fontSize: 13, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16 },
  rowLabel: { fontSize: 17, flexShrink: 1 },
  rowValue: { fontSize: 15, lineHeight: 20 },
  info: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 10, gap: 2, justifyContent: 'center' },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  identityText: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  segment: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  signOut: { marginTop: 24, marginBottom: 40 }
})
