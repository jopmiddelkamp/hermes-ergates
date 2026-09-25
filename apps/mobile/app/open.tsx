/**
 * Where a push deep link lands (roadmap contract C5): after the device store
 * has hydrated, a known connection becomes the primary one and the app opens
 * the profile's chat; an unknown connection goes to connection selection. The
 * chat itself authenticates and reads the current state of every request.
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { openTarget } from '@/features/attention'
import { useDeviceStore, waitForHydration } from '@/state/device-store'
import { useTheme } from '@/theme/provider'

export default function OpenScreen() {
  const { connection, profile } = useLocalSearchParams<{ connection?: string; profile?: string; session?: string }>()
  const router = useRouter()
  const theme = useTheme()

  useEffect(() => {
    let cancelled = false
    void waitForHydration(useDeviceStore).then(() => {
      if (cancelled) {
        return
      }
      const store = useDeviceStore.getState()
      const target = openTarget(store.connections, { connection, profile })
      if (target.kind === 'connect') {
        router.replace('/connect')
        return
      }
      store.setPrimaryConnection(target.connectionId)
      if (target.kind === 'home') {
        router.replace('/')
        return
      }
      router.replace({ pathname: '/chat/[profile]', params: { profile: target.profile } })
    })
    return () => {
      cancelled = true
    }
  }, [connection, profile, router])

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
      <ActivityIndicator />
    </View>
  )
}
