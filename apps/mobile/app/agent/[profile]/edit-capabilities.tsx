/**
 * Capabilities: Skills, Toolsets and Connectors, staged in the Edit Bot
 * draft (docs/10 "Edit Bot on mobile"). Shares the draft through
 * `EditBotProvider`; nothing here calls the gateway directly.
 */

import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { useEditBotContext } from '@/features/agents'
import { useTheme } from '@/theme/provider'
import { Card } from '@/ui/Card'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'
import { SwitchRow } from '@/ui/SwitchRow'
import { useBottomInset } from '@/ui/use-bottom-inset'

export default function EditCapabilitiesScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { draft, errors, update } = useEditBotContext()
  const [query, setQuery] = useState('')
  const bottomInset = useBottomInset(40)

  const header = (
    <View style={styles.header}>
      <IconButton name="chevron-left" accessibilityLabel="Back" onPress={() => router.back()} />
      <Text style={[styles.title, { color: theme.colors.foreground }]}>Capabilities</Text>
      <View style={styles.spacer} />
    </View>
  )

  if (!draft) {
    // This screen never had a top inset (its header sits flush with the
    // status bar, unchanged); only the old bottom-edge reservation goes.
    return (
      <Screen edges={[]}>
        {header}
        <ActivityIndicator style={styles.loading} color={theme.colors.foreground} />
      </Screen>
    )
  }

  const base = draft.base.describe
  const q = query.trim().toLowerCase()
  const matches = (...names: string[]) => q === '' || names.some(n => n.toLowerCase().includes(q))

  const skills = base.skills.filter(s => matches(s.name))
  const toolsets = base.toolsets.filter(t => matches(t.name, t.label))
  const mcpServers = base.mcp_servers.filter(m => matches(m.name))

  const enabledToolsets = draft.enabledToolsets ?? base.toolsets.filter(t => t.enabled).map(t => t.name)
  const enabledMcp = draft.enabledMcp ?? base.mcp_servers.filter(m => m.enabled !== false).map(m => m.name)

  const toggleSkill = (name: string, on: boolean) => {
    const disabled = new Set(draft.disabledSkills)
    if (on) {
      disabled.delete(name)
    } else {
      disabled.add(name)
    }
    update({ disabledSkills: [...disabled] })
  }

  const toggleToolset = (name: string, on: boolean) => {
    const set = new Set(enabledToolsets)
    if (on) {
      set.add(name)
    } else {
      set.delete(name)
    }
    update({ enabledToolsets: [...set] })
  }

  const toggleMcp = (name: string, on: boolean) => {
    const set = new Set(enabledMcp)
    if (on) {
      set.add(name)
    } else {
      set.delete(name)
    }
    update({ enabledMcp: [...set] })
  }

  return (
    <Screen edges={[]}>
      {header}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search skills, toolsets and connectors"
        placeholderTextColor={theme.colors.mutedForeground}
        accessibilityLabel="Search capabilities"
        style={[styles.search, { backgroundColor: theme.colors.input, borderColor: theme.colors.border, color: theme.colors.foreground }]}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>Skills</Text>
        {skills.length > 0 ? (
          <Card>
            {skills.map(s => (
              <SwitchRow key={s.name} label={s.name} value={!draft.disabledSkills.includes(s.name)} onValueChange={on => toggleSkill(s.name, on)} accessibilityLabel={`${s.name} skill`} />
            ))}
          </Card>
        ) : (
          <Text style={[styles.empty, { color: theme.colors.mutedForeground }]}>No matching skills.</Text>
        )}

        <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>Toolsets</Text>
        {toolsets.length > 0 ? (
          <Card>
            {toolsets.map(t => (
              <SwitchRow
                key={t.name}
                label={t.label}
                description={`${t.description} (${t.tool_count} tools)`}
                value={enabledToolsets.includes(t.name)}
                onValueChange={on => toggleToolset(t.name, on)}
                accessibilityLabel={`${t.label} toolset`}
              />
            ))}
          </Card>
        ) : (
          <Text style={[styles.empty, { color: theme.colors.mutedForeground }]}>No matching toolsets.</Text>
        )}
        {errors.toolsets ? <Text style={[styles.error, { color: theme.colors.destructive }]}>{errors.toolsets}</Text> : null}

        <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>Connectors</Text>
        {mcpServers.length > 0 ? (
          <Card>
            {mcpServers.map(m => (
              <SwitchRow key={m.name} label={m.name} value={enabledMcp.includes(m.name)} onValueChange={on => toggleMcp(m.name, on)} accessibilityLabel={`${m.name} connector`} />
            ))}
          </Card>
        ) : (
          <Text style={[styles.empty, { color: theme.colors.mutedForeground }]}>No matching connectors.</Text>
        )}

        <Text style={[styles.note, { color: theme.colors.mutedForeground }]}>Changes take effect on the assistant&apos;s next session.</Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginBottom: 8, gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  spacer: { width: 44 },
  loading: { marginTop: 40 },
  search: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, marginBottom: 8 },
  content: { gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  empty: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  error: { fontSize: 13, marginTop: 4 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 16 }
})
