/**
 * Tools & connectors: read-only view of this profile's toolsets, MCP
 * connectors and skills (docs/02 section 3.7, docs/10 "Settings and agent
 * details"). Changes are made in Edit Bot › Capabilities; this screen only
 * inspects current/effective state and lets the user test a connector.
 */

import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useDescribe } from '@/features/agents'
import { usePrimaryConnection } from '@/features/settings'
import { userMessage } from '@/gateway/errors'
import { useGateway } from '@/gateway/registry'
import type { DescribeSkill, DescribeToolset, McpServerRow } from '@/gateway/types'
import { useTheme } from '@/theme/provider'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'

type TestState = 'testing' | 'ok' | 'failed'

export default function ToolsScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const connection = usePrimaryConnection()
  if (!connection || !profile) {
    return null
  }
  return (
    <Tools
      connection={connection}
      profile={profile}
      onBack={() => router.back()}
      // Edit goes through Edit Bot, not straight to the capabilities subpage:
      // Save and the dirty guard live on `edit.tsx`, so a direct push would
      // silently discard the staged change.
      onEditCapabilities={() => router.push({ pathname: '/agent/[profile]/edit', params: { profile } })}
    />
  )
}

function Tools({
  connection,
  profile,
  onBack,
  onEditCapabilities
}: {
  connection: NonNullable<ReturnType<typeof usePrimaryConnection>>
  profile: string
  onBack: () => void
  onEditCapabilities: () => void
}) {
  const theme = useTheme()
  const gateway = useGateway(connection)
  const describe = useDescribe(gateway, connection.id, profile)
  const toolsetsQuery = useQuery({
    queryKey: ['tool-catalog', connection.id, profile],
    queryFn: () => gateway.tools.toolsets(profile)
  })
  const mcpQuery = useQuery({
    queryKey: ['mcp-servers', connection.id, profile],
    queryFn: () => gateway.tools.mcpServers(profile)
  })
  const [testState, setTestState] = useState<Record<string, TestState>>({})

  const onTest = async (name: string) => {
    setTestState(s => ({ ...s, [name]: 'testing' }))
    try {
      const result = await gateway.tools.testMcp(name, profile)
      setTestState(s => ({ ...s, [name]: result.ok ? 'ok' : 'failed' }))
    } catch {
      setTestState(s => ({ ...s, [name]: 'failed' }))
    }
  }

  const toolNamesFor = (name: string): string[] | null => {
    if (!toolsetsQuery.isSuccess) {
      return null
    }
    return toolsetsQuery.data.find(t => t.name === name)?.tools ?? []
  }

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-left" accessibilityLabel="Back" onPress={onBack} />
        <Text style={[styles.headerTitle, { color: theme.colors.foreground }]} numberOfLines={1}>
          Tools & connectors
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>
          Changes take effect on the assistant&apos;s next session; a saved change is not an immediate revocation.
        </Text>

        {describe.isLoading ? <ActivityIndicator style={styles.spinner} /> : null}
        {describe.isError ? (
          <Text style={[styles.line, { color: theme.colors.destructive }]} accessibilityRole="alert">
            {userMessage(describe.error)}
          </Text>
        ) : null}

        <GroupHeader title="Toolsets" onEdit={onEditCapabilities} />
        <Card>
          {(describe.data?.toolsets ?? []).map(ts => (
            <ToolsetRow key={ts.name} toolset={ts} tools={toolNamesFor(ts.name)} />
          ))}
          {describe.isSuccess && (describe.data?.toolsets.length ?? 0) === 0 ? <EmptyRow text="No toolsets configured." /> : null}
        </Card>

        <GroupHeader title="Connectors" onEdit={onEditCapabilities} />
        <Card>
          {(mcpQuery.data ?? []).map(server => (
            <ConnectorRow key={server.name} server={server} state={testState[server.name]} onTest={() => void onTest(server.name)} />
          ))}
          {mcpQuery.isError ? <EmptyRow text={userMessage(mcpQuery.error)} /> : null}
          {mcpQuery.isSuccess && (mcpQuery.data?.length ?? 0) === 0 ? <EmptyRow text="No connectors configured." /> : null}
        </Card>

        <GroupHeader title="Skills" onEdit={onEditCapabilities} />
        <Card>
          {(describe.data?.skills ?? []).map(skill => (
            <SkillRow key={skill.name} skill={skill} />
          ))}
          {describe.isSuccess && (describe.data?.skills.length ?? 0) === 0 ? <EmptyRow text="No skills assigned." /> : null}
        </Card>
      </ScrollView>
    </Screen>
  )
}

function GroupHeader({ title, onEdit }: { title: string; onEdit: () => void }) {
  const theme = useTheme()
  return (
    <View style={styles.groupHeader}>
      <Text style={[styles.groupTitle, { color: theme.colors.foreground }]}>{title}</Text>
      <Button label="Edit" variant="ghost" accessibilityLabel={`Edit ${title} in Edit Bot capabilities`} onPress={onEdit} />
    </View>
  )
}

function EmptyRow({ text }: { text: string }) {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <Text style={[styles.rowMeta, { color: theme.colors.mutedForeground }]}>{text}</Text>
    </View>
  )
}

function ToolsetRow({ toolset, tools }: { toolset: DescribeToolset; tools: string[] | null }) {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <View style={styles.rowTitleLine}>
        <Text style={[styles.rowName, { color: theme.colors.foreground }]} numberOfLines={1}>
          {toolset.label}
        </Text>
        <Text style={[styles.stateBadge, { color: toolset.enabled ? theme.colors.primary : theme.colors.mutedForeground }]}>
          {toolset.enabled ? 'On' : 'Off'}
        </Text>
      </View>
      {/* Count plus the server's own summary; the full tool list lives on the Capabilities page. */}
      <Text style={[styles.rowMeta, { color: theme.colors.mutedForeground }]} numberOfLines={2}>
        {[`${toolset.tool_count} tool${toolset.tool_count === 1 ? '' : 's'}`, toolset.description].filter(Boolean).join(' · ')}
      </Text>
    </View>
  )
}

function ConnectorRow({ server, state, onTest }: { server: McpServerRow; state: TestState | undefined; onTest: () => void }) {
  const theme = useTheme()
  const enabled = server.enabled !== false
  const transport = typeof server.transport === 'string' ? server.transport : 'unknown transport'
  const resultText = state === 'testing' ? 'Testing…' : state === 'ok' ? 'Connected' : state === 'failed' ? 'Failed' : null
  const resultColor = state === 'ok' ? theme.colors.primary : state === 'failed' ? theme.colors.destructive : theme.colors.mutedForeground

  return (
    <View style={[styles.row, styles.connectorRow]}>
      <View style={styles.connectorInfo}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowName, { color: theme.colors.foreground }]} numberOfLines={1}>
            {server.name}
          </Text>
          <Text style={[styles.stateBadge, { color: enabled ? theme.colors.primary : theme.colors.mutedForeground }]}>{enabled ? 'On' : 'Off'}</Text>
        </View>
        <Text style={[styles.rowMeta, { color: theme.colors.mutedForeground }]}>{transport}</Text>
        {resultText ? <Text style={[styles.rowMeta, { color: resultColor }]}>{resultText}</Text> : null}
      </View>
      <Button label="Test" variant="secondary" loading={state === 'testing'} accessibilityLabel={`Test ${server.name}`} onPress={onTest} />
    </View>
  )
}

function SkillRow({ skill }: { skill: DescribeSkill }) {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <View style={styles.rowTitleLine}>
        <Text style={[styles.rowName, { color: theme.colors.foreground }]} numberOfLines={1}>
          {skill.name}
        </Text>
        <Text style={[styles.stateBadge, { color: skill.enabled ? theme.colors.primary : theme.colors.mutedForeground }]}>{skill.enabled ? 'On' : 'Off'}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginBottom: 8 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700' },
  scroll: { paddingBottom: 40 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  spinner: { marginVertical: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: 8, paddingLeft: 16 },
  groupTitle: { fontSize: 17, fontWeight: '600' },
  row: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { flex: 1, fontSize: 17, fontWeight: '500' },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  stateBadge: { fontSize: 13, fontWeight: '600' },
  toolNames: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  connectorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  connectorInfo: { flex: 1, gap: 2 },
  line: { fontSize: 15, lineHeight: 22, paddingVertical: 16, textAlign: 'center' }
})
