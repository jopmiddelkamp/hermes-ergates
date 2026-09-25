/**
 * Wraps every `agent/[profile]/*` route in one `EditBotProvider` so Edit
 * Bot's basic form and its Instructions/Provider-Model/Capabilities
 * subpages share the same in-memory draft (docs/10 "Edit Bot on mobile").
 * Kept minimal: resolve the connection and gateway, provide the controller,
 * render the stack.
 */

import { Stack, useLocalSearchParams } from 'expo-router'
import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import { EditBotProvider } from '@/features/agents/editor-context'
import { usePrimaryConnection } from '@/features/settings/connections'
import { useGateway } from '@/gateway/registry'

/** Deep links to a subpage (Home long-press → Edit Bot) get the details page beneath them, so `edit` is always a real modal. */
export const unstable_settings = { initialRouteName: 'index' }

export default function AgentProfileLayout() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const connection = usePrimaryConnection()

  if (!connection || !profile) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return <AgentProfileStack connection={connection} profile={profile} />
}

function AgentProfileStack({ connection, profile }: { connection: NonNullable<ReturnType<typeof usePrimaryConnection>>; profile: string }) {
  const gateway = useGateway(connection)

  return (
    <EditBotProvider port={gateway} connectionId={connection.id} profile={profile}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routine" options={{ presentation: 'modal' }} />
      </Stack>
    </EditBotProvider>
  )
}
