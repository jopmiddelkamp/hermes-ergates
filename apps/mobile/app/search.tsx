/**
 * Focused roster search (docs/10 "Home"): close at left, the field opens
 * focused and states its scope, results reuse the Home row so avatars match.
 */

import { useRouter } from 'expo-router'
import React, { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { searchBots, useRoster } from '@/features/agents/roster'
import { usePrimaryConnection } from '@/features/settings/connections'
import { useGateway } from '@/gateway/registry'
import { useDeviceStore } from '@/state/device-store'
import { useTheme } from '@/theme/provider'
import { BotRow } from '@/ui/BotRow'
import { Icon } from '@/ui/icons'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'

export default function SearchScreen() {
  const router = useRouter()
  const connection = usePrimaryConnection()
  const [query, setQuery] = useState('')
  if (!connection) {
    return null
  }
  return <SearchBody connectionId={connection.id} query={query} setQuery={setQuery} onClose={() => router.back()} />
}

function SearchBody({ connectionId, query, setQuery, onClose }: { connectionId: string; query: string; setQuery: (q: string) => void; onClose: () => void }) {
  const theme = useTheme()
  const router = useRouter()
  // The parent guards on the connection existing, so this is always found; the
  // `!` keeps the hook order stable without a fabricated `baseUrl: ''` record.
  const saved = useDeviceStore(s => s.connections.find(c => c.id === connectionId))!
  const gateway = useGateway(saved)
  const roster = useRoster(gateway, connectionId)
  const results = useMemo(() => searchBots((roster.data ?? []).filter(b => !b.hidden), query), [roster.data, query])

  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="x" accessibilityLabel="Close search" outlined onPress={onClose} />
        <View style={[styles.field, { backgroundColor: theme.colors.input, borderColor: theme.colors.border }]}>
          <Icon name="search" size={18} color={theme.colors.mutedForeground} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, role or description"
            placeholderTextColor={theme.colors.mutedForeground}
            accessibilityLabel="Search assistants by name, role or description. Roster only."
            style={[styles.input, { color: theme.colors.foreground }]}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {results.map(bot => (
          <BotRow key={bot.profile} bot={bot} gateway={gateway} connectionId={connectionId} showTime={false} preview="description" onPress={() => router.replace({ pathname: '/chat/[profile]', params: { profile: bot.profile } })} />
        ))}
        {query.trim() && results.length === 0 ? <Text style={[styles.empty, { color: theme.colors.mutedForeground }]}>No assistant matches “{query.trim()}”. Conversation search comes later.</Text> : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 16 },
  input: { flex: 1, fontSize: 17, paddingVertical: 10 },
  list: { paddingBottom: 40 },
  empty: { fontSize: 15, lineHeight: 22, paddingVertical: 24, textAlign: 'center' }
})
