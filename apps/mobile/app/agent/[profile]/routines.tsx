/**
 * Routines list for one profile (docs/02 section 3.6, docs/10 "Settings and
 * agent details"): this profile's Hermes cron jobs, newest schedule state
 * first, with finished one-shots hidden per FR-172.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'

import { displayName, isActive, isFinishedOneShot, nextRunLabel, useRoutines } from '@/features/routines/routines'
import { usePrimaryConnection } from '@/features/settings/connections'
import { useGateway } from '@/gateway/registry'
import { userMessage } from '@/gateway/errors'
import type { CronJob } from '@/gateway/types'
import { useTheme } from '@/theme/provider'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Screen } from '@/ui/Screen'

export default function RoutinesScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const connection = usePrimaryConnection()
  if (!connection || !profile) {
    return null
  }
  return (
    <Routines
      connection={connection}
      profile={profile}
      onBack={() => router.back()}
      onOpen={id => router.push({ pathname: '/agent/[profile]/routine', params: { profile, id } })}
    />
  )
}

function Routines({
  connection,
  profile,
  onBack,
  onOpen
}: {
  connection: NonNullable<ReturnType<typeof usePrimaryConnection>>
  profile: string
  onBack: () => void
  onOpen: (id: string) => void
}) {
  const theme = useTheme()
  const gateway = useGateway(connection)
  const routines = useRoutines(gateway, connection.id, profile)
  const [refreshing, setRefreshing] = useState(false)
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const jobs = (routines.data ?? []).filter(job => !isFinishedOneShot(job))

  const onRefresh = async () => {
    setRefreshing(true)
    await routines.refetch()
    setRefreshing(false)
  }

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-left" accessibilityLabel="Back" outlined onPress={onBack} />
        <Text style={[styles.headerTitle, { color: theme.colors.foreground }]} numberOfLines={1}>
          Routines
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        {routines.isError ? (
          <Text style={[styles.line, { color: theme.colors.destructive }]} accessibilityRole="alert">
            {userMessage(routines.error)}
          </Text>
        ) : null}
        {jobs.map(job => (
          <RoutineRow key={job.id} job={job} profile={profile} tz={tz} onPress={() => onOpen(job.id)} />
        ))}
        {routines.isSuccess && jobs.length === 0 ? (
          <Text style={[styles.line, { color: theme.colors.mutedForeground }]}>No routines yet. Add one to have this assistant check in on a schedule.</Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button label="New routine" accessibilityLabel="New routine" onPress={() => onOpen('new')} />
      </View>
    </Screen>
  )
}

function RoutineRow({ job, profile, tz, onPress }: { job: CronJob; profile: string; tz: string; onPress: () => void }) {
  const theme = useTheme()
  const name = displayName(job, profile)
  const paused = !isActive(job)
  const next = nextRunLabel(job, new Date(), tz)
  const label = `${name}, ${job.schedule}, ${next}${paused ? ', paused' : ''}`

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { minHeight: Math.max(theme.hit, 52), borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.muted : 'transparent' }
      ]}
    >
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowName, { color: theme.colors.foreground }]} numberOfLines={1}>
            {name}
          </Text>
          {paused ? (
            <View style={[styles.pausedBadge, { backgroundColor: theme.colors.muted }]}>
              <Text style={[styles.pausedText, { color: theme.colors.mutedForeground }]}>Paused</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.rowSchedule, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
          {job.schedule}
        </Text>
        <Text style={[styles.rowNext, { color: theme.colors.mutedForeground }]} numberOfLines={1}>
          {next}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginBottom: 8 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700' },
  list: { paddingBottom: 24, gap: 4 },
  footer: { paddingTop: 8, paddingBottom: 16 },
  row: { paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { flex: 1, fontSize: 17, fontWeight: '500' },
  rowSchedule: { fontSize: 15 },
  rowNext: { fontSize: 13 },
  pausedBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pausedText: { fontSize: 12 },
  line: { fontSize: 15, lineHeight: 22, paddingVertical: 16, textAlign: 'center' }
})
