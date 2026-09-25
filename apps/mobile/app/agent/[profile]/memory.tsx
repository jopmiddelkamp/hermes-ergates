/**
 * Memory: read-only view of this profile's `MEMORY.md` and `USER.md`
 * (docs/02 section 3.10, docs/10 "Settings and agent details"). Hermes
 * writes these through the agent's `memory` tool; the app never edits them.
 */

import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'

import { userMessage } from '@/gateway/errors'
import { useGateway } from '@/gateway/registry'
import { usePrimaryConnection } from '@/features/settings/connections'
import { useTheme } from '@/theme/provider'
import { Card } from '@/ui/Card'
import { IconButton } from '@/ui/IconButton'
import { MarkdownText } from '@/ui/MarkdownText'
import { Screen } from '@/ui/Screen'

export default function MemoryScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const connection = usePrimaryConnection()
  if (!connection || !profile) {
    return null
  }
  return <Memory connection={connection} profile={profile} onBack={() => router.back()} />
}

function Memory({ connection, profile, onBack }: { connection: NonNullable<ReturnType<typeof usePrimaryConnection>>; profile: string; onBack: () => void }) {
  const theme = useTheme()
  const gateway = useGateway(connection)
  const query = useQuery({
    queryKey: ['memory-files', connection.id, profile],
    queryFn: () => gateway.profiles.memory(profile)
  })

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-left" accessibilityLabel="Back" outlined onPress={onBack} />
        <Text style={[styles.headerTitle, { color: theme.colors.foreground }]} numberOfLines={1}>
          Memory
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {query.isLoading ? <ActivityIndicator style={styles.spinner} /> : null}
        {query.isError ? (
          <Text style={[styles.line, { color: theme.colors.destructive }]} accessibilityRole="alert">
            {userMessage(query.error)}
          </Text>
        ) : null}
        {query.data && !query.data.available ? (
          <Text style={[styles.line, { color: theme.colors.mutedForeground }]}>Memory files are not readable through this gateway.</Text>
        ) : null}
        {query.data?.available ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>MEMORY.md</Text>
            <Card>
              <View style={styles.doc}>
                <MarkdownText>{query.data.memory.trim() ? query.data.memory : '_Empty._'}</MarkdownText>
              </View>
            </Card>
            <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>USER.md</Text>
            <Card>
              <View style={styles.doc}>
                <MarkdownText>{query.data.user.trim() ? query.data.user : '_Empty._'}</MarkdownText>
              </View>
            </Card>
          </>
        ) : null}
        <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>
          Ask the assistant in chat to remember or forget something; editing here is not supported.
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginBottom: 8 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700' },
  scroll: { paddingBottom: 40 },
  spinner: { marginVertical: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  doc: { paddingHorizontal: 16, paddingVertical: 12 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 24 },
  line: { fontSize: 15, lineHeight: 22, paddingVertical: 16, textAlign: 'center' }
})
