/**
 * Sends this connection's organization outbox (docs/05 "Organization
 * outbox") while Home is mounted: as soon as a change is queued, and again
 * after every roster read, which is how a connection that came back shows
 * itself; never before the first roster read (`readyToFlush`). One flush at a time (`oneAtATime`). After a flush that wrote
 * something the roster is read again, so the sent changes settle; the
 * agents whose change Hermes refused are named in one message, which the
 * screen shows as an alert (no React Native here, so the feature's index
 * stays importable in Node).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import type { GatewayPort } from '@/gateway/port'
import { useDeviceStore } from '@/state/device-store'

import { flushOrgOutbox, oneAtATime, readyToFlush, refusedMessage } from './org-sender'
import { rosterKey } from './roster'
import type { HomeModel } from './use-home'

export function useOrgSync(port: GatewayPort, connectionId: string, home: HomeModel, onRefused: (message: string) => void): void {
  const client = useQueryClient()
  const updateOrgOutbox = useDeviceStore(s => s.updateOrgOutbox)
  const queued = useDeviceStore(s => Boolean(s.organization[connectionId]?.outbox.some(item => item.status === 'queued')))
  // The flush reads the roster when it runs, not when it was created.
  const latest = useRef({ home, onRefused })
  useEffect(() => {
    latest.current = { home, onRefused }
  }, [home, onRefused])

  const flush = useMemo(
    () =>
      oneAtATime(async () => {
        const result = await flushOrgOutbox({
          profiles: port.profiles,
          summaryOf: profile => latest.current.home.byProfile.get(profile)?.summary,
          outbox: {
            list: () => useDeviceStore.getState().organization[connectionId]?.outbox ?? [],
            update: fn => updateOrgOutbox(connectionId, fn)
          }
        })
        if (result.sent > 0) {
          void client.invalidateQueries({ queryKey: rosterKey(connectionId) })
        }
        if (result.refused.length > 0) {
          latest.current.onRefused(refusedMessage(result.refused, profile => latest.current.home.byProfile.get(profile)?.name ?? profile))
        }
      }),
    [port, connectionId, updateOrgOutbox, client]
  )

  const ready = readyToFlush(queued, home.updatedAt)
  useEffect(() => {
    if (ready) {
      void flush()
    }
  }, [ready, home.updatedAt, flush])
}
