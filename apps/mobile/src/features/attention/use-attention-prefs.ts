/**
 * The notification settings of one profile (or `*`) through the Ergates route
 * (roadmap contract C3). React adapter only: the form rules live in `prefs.ts`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { GatewayPort } from '@/gateway/port'
import type { AttentionPrefs } from '@/gateway/types'

export const attentionPrefsKey = (connectionId: string, profile: string) => ['attention-prefs', connectionId, profile] as const

export function useAttentionPrefs(port: GatewayPort, connectionId: string, profile: string) {
  const client = useQueryClient()
  const prefs = useQuery({ queryKey: attentionPrefsKey(connectionId, profile), queryFn: () => port.ergates.attentionPrefs(profile), retry: false })
  const save = useMutation({
    mutationFn: (next: AttentionPrefs) => port.ergates.setAttentionPrefs(next),
    // `*` is every profile's fallback, so every profile's effective prefs may have changed.
    onSettled: () => client.invalidateQueries({ queryKey: ['attention-prefs', connectionId] })
  })
  return { prefs, save }
}
