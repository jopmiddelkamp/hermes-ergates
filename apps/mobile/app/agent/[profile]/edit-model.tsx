/**
 * Provider / Model picker (docs/10 "Edit Bot on mobile"): only providers the
 * server is authenticated for are selectable; others are listed as needing
 * sign-in on the server. Shares the Edit Bot draft through `EditBotProvider`.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useEditBotContext, useModelOptions } from '@/features/agents'
import { usePrimaryConnection } from '@/features/settings'
import { useGateway } from '@/gateway/registry'
import type { ModelProvider } from '@/gateway/types'
import { useTheme } from '@/theme/provider'
import { Field } from '@/ui/Field'
import { Icon } from '@/ui/icons'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'

export default function EditModelScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const connection = usePrimaryConnection()
  if (!connection || !profile) {
    return null
  }
  return <EditModel connection={connection} profile={profile} />
}

function EditModel({ connection, profile }: { connection: NonNullable<ReturnType<typeof usePrimaryConnection>>; profile: string }) {
  const theme = useTheme()
  const router = useRouter()
  const gateway = useGateway(connection)
  const { draft, update } = useEditBotContext()
  const options = useModelOptions(gateway, connection.id, profile)
  const [expandedSlug, setExpandedSlug] = useState<string | null>(draft?.provider || null)
  const [customFor, setCustomFor] = useState<string | null>(null)

  const header = (
    <View style={styles.header}>
      <IconButton name="chevron-left" accessibilityLabel="Back" outlined onPress={() => router.back()} />
      <Text style={[styles.title, { color: theme.colors.foreground }]}>Provider / Model</Text>
      <IconButton name="refresh-cw" outlined accessibilityLabel="Refresh providers" onPress={() => void options.refetch()} />
    </View>
  )

  if (!draft) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <ActivityIndicator style={styles.loading} color={theme.colors.foreground} />
      </Screen>
    )
  }

  const providers = options.data?.providers ?? []
  const authenticated = providers.filter(p => p.authenticated)
  const unauthenticated = providers.filter(p => !p.authenticated)

  const isCustomOpen = (p: ModelProvider) =>
    customFor === p.slug || (draft.provider === p.slug && draft.model !== '' && !p.models.includes(draft.model))

  return (
    <Screen edges={['bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        {options.isLoading ? <ActivityIndicator style={styles.loading} color={theme.colors.foreground} /> : null}
        {options.isError ? <Text style={[styles.note, { color: theme.colors.destructive }]}>Could not load providers. Tap Refresh to try again.</Text> : null}

        <PickRow
          label="Inherit from server default"
          selected={!draft.provider && !draft.model}
          onPress={() => {
            setCustomFor(null)
            update({ provider: '', model: '' })
          }}
        />

        {authenticated.map(p => (
          <View key={p.slug}>
            <ExpandRow label={p.name} expanded={expandedSlug === p.slug} onPress={() => setExpandedSlug(s => (s === p.slug ? null : p.slug))} />
            {expandedSlug === p.slug ? (
              <View style={styles.indent}>
                {p.models.map(m => (
                  <PickRow
                    key={m}
                    label={m}
                    selected={draft.provider === p.slug && draft.model === m}
                    // Clear the custom row too, or both rows read as selected
                    // and the custom field stays open.
                    onPress={() => {
                      setCustomFor(null)
                      update({ provider: p.slug, model: m })
                    }}
                  />
                ))}
                <PickRow label="Custom model…" selected={isCustomOpen(p)} onPress={() => setCustomFor(p.slug)} />
                {isCustomOpen(p) ? (
                  <Field
                    label="Custom model id"
                    value={draft.provider === p.slug ? draft.model : ''}
                    onChangeText={text => update({ provider: p.slug, model: text })}
                    placeholder="e.g. gpt-5-custom"
                    accessibilityLabel="Custom model id"
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ))}

        {unauthenticated.length > 0 ? (
          <Text style={[styles.note, { color: theme.colors.mutedForeground }]}>Sign in on the server to use: {unauthenticated.map(p => p.name).join(', ')}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

function ExpandRow({ label, expanded, onPress }: { label: string; expanded: boolean; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.colors.accent : 'transparent' }]}
    >
      <Text style={[styles.rowLabel, { color: theme.colors.foreground }]}>{label}</Text>
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={20} color={theme.colors.mutedForeground} />
    </Pressable>
  )
}

function PickRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.colors.accent : 'transparent' }]}
    >
      <Text style={[styles.rowLabel, { color: theme.colors.foreground }]}>{label}</Text>
      {selected ? <Icon name="check" size={20} color={theme.colors.primary} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginBottom: 8, gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  loading: { marginTop: 40 },
  content: { paddingBottom: 40 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 0, gap: 12 },
  rowLabel: { fontSize: 17, flex: 1 },
  indent: { paddingLeft: 16 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 12 }
})
