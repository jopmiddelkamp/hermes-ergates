/**
 * Wraps every `chat/[profile]/*` route in one `ChatSessionProvider` so the
 * chat, Activity and the read-only transcript read the same socket session,
 * the same REST transcript window and the same timeline (spec 6: "Reads the
 * same Query data; no extra source"). Kept minimal: resolve the connection and
 * the profile, provide the session, render the stack (ADR-029).
 */

import { Stack, useLocalSearchParams } from 'expo-router'
import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import { ChatSessionProvider } from '@/features/chat'
import { usePrimaryConnection } from '@/features/settings'
import { useTheme } from '@/theme/provider'

/** A deep link straight to Activity or a transcript gets the chat beneath it, so Back always returns to the conversation. */
export const unstable_settings = { initialRouteName: 'index' }

export default function ChatProfileLayout() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const connection = usePrimaryConnection()
  const theme = useTheme()

  if (!connection || !profile) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <ChatSessionProvider connectionId={connection.id} profile={profile}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="activity" options={{ presentation: 'modal' }} />
        <Stack.Screen name="exchange" />
      </Stack>
    </ChatSessionProvider>
  )
}
