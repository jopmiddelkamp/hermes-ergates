/**
 * Settings > Gateway (docs/10 "Settings and agent details"): how this phone
 * signs in, which Hermes answers, and the connection id push links name.
 */

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import React from 'react'

import { usePrimaryConnection } from '@/features/settings'
import { useGateway } from '@/gateway/registry'
import { Group } from '@/ui/Group'
import { ListRow } from '@/ui/ListRow'
import { Page } from '@/ui/Page'

export default function GatewaySettingsScreen() {
  const router = useRouter()
  const connection = usePrimaryConnection()
  if (!connection) {
    return null
  }
  return <GatewaySettings connection={connection} onBack={() => router.back()} />
}

function GatewaySettings({ connection, onBack }: { connection: NonNullable<ReturnType<typeof usePrimaryConnection>>; onBack: () => void }) {
  const gateway = useGateway(connection)
  const status = useQuery({ queryKey: ['status', connection.id], queryFn: () => gateway.status(), staleTime: 60_000 })
  return (
    <Page title="Gateway" onBack={onBack}>
      <Group>
        <ListRow title="Sign-in" subtitle={connection.authMode === 'token' ? 'Session token (private loopback)' : 'Username and password'} icon="key" />
        <ListRow title="Backend" subtitle={status.data ? `Hermes ${status.data.version}` : status.isError ? 'Unreachable' : 'Checking…'} icon="cpu" />
        {/* Push links name this id; the operator sets it as `ntfy.connection_id` on the server. */}
        <ListRow title="Connection id (for push links)" subtitle={connection.id} icon="hash" />
      </Group>
    </Page>
  )
}
