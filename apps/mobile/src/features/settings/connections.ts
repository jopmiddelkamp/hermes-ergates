/**
 * Connection registry actions (docs/03 section 4, docs/05 section 3):
 * add a gateway, sign in, sign out with clearing, pick the primary.
 */

import { userMessage } from '@/gateway/errors'
import type { GatewayRegistry } from '@/gateway/registry'
import type { BackendStatus } from '@/gateway/types'
import { useDeviceStore, type Connection } from '@/state/device-store'

export type ConnectInput =
  | { label: string; baseUrl: string; mode: 'token'; token: string }
  | { label: string; baseUrl: string; mode: 'password'; provider: string; username: string; password: string }

export function newConnectionId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `c-${Date.now().toString(36)}-${rand}`
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

/** Discover auth mode before asking for credentials. */
export async function probeGateway(registry: GatewayRegistry, baseUrl: string): Promise<BackendStatus> {
  const gateway = registry.probe(newConnectionId(), normalizeBaseUrl(baseUrl))
  return gateway.status()
}

export async function connectGateway(registry: GatewayRegistry, input: ConnectInput): Promise<Connection> {
  const id = newConnectionId()
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const record: Connection = {
    id,
    label: input.label.trim() || baseUrl.replace(/^https?:\/\//, ''),
    baseUrl,
    authMode: input.mode,
    primary: true,
    createdAt: Date.now()
  }
  const gateway = registry.get(record)
  try {
    if (input.mode === 'token') {
      await gateway.login({ mode: 'token', token: input.token.trim() })
    } else {
      await gateway.login({ mode: 'password', provider: input.provider, username: input.username, password: input.password })
    }
  } catch (err) {
    registry.forget(id)
    throw new Error(userMessage(err))
  }
  const store = useDeviceStore.getState()
  store.addConnection(record)
  store.setPrimaryConnection(id)
  return record
}

/** Sign out: revoke on the server where supported, close sockets, clear secrets and device data for that connection. */
export async function signOut(registry: GatewayRegistry, connection: Connection): Promise<void> {
  const gateway = registry.get(connection)
  try {
    await gateway.logout()
  } finally {
    // Connection removal must not depend on the best-effort /auth/logout succeeding.
    await gateway.clearCookies().catch(() => undefined)
    registry.forget(connection.id)
    await useDeviceStore.getState().removeConnection(connection.id)
  }
}

export function usePrimaryConnection(): Connection | null {
  return useDeviceStore(s => s.connections.find(c => c.primary) ?? s.connections[0] ?? null)
}
