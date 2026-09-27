/**
 * Sends this connection's organization outbox (docs/05 "Organization
 * outbox") while Home is mounted: as soon as a change is queued, and again
 * after every roster read, which is how a connection that came back shows
 * itself; never before the first roster read, and never again after a flush
 * stalls until a newer roster read comes in, so a connection that stays down
 * does not turn into a retry loop (`readyToFlush`). One flush at a time
 * (`oneAtATime`). After a flush that sent or refused anything, the roster is
 * read again, so the sent changes settle and a refusal shows current names;
 * the agents whose change Hermes refused are named in one message, which the
 * screen shows as an alert (no React Native here, so the feature's index
 * stays importable in Node).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import type { GatewayPort } from '@/gateway/port'
import { useDeviceStore } from '@/state/device-store'

import { flushOrgOutbox, oneAtATime, readyToFlush, refusedMessage } from './org-sender'
import { nameOfRoster, rosterKey, summaryOfRoster, type Bot } from './roster'
import type { HomeModel } from './use-home'

export function useOrgSync(port: GatewayPort, connectionId: string, home: HomeModel, onRefused: (message: string) => void): void {
  const client = useQueryClient()
  const updateOrgOutbox = useDeviceStore(s => s.updateOrgOutbox)
  const queued = useDeviceStore(s => Boolean(s.organization[connectionId]?.outbox.some(item => item.status === 'queued')))
  // The alert callback the flush reads when it runs, not when it was created.
  const latest = useRef(onRefused)
  useEffect(() => {
    latest.current = onRefused
  }, [onRefused])

  // The roster read a stalled flush started from (readyToFlush): a ref, not
  // state, so recording a stall does not itself trigger a render. Nothing
  // flushes again until a newer roster read comes in, so a connection that
  // stays down does not turn into a retry loop. The value is kept per connection.
  const stalledAt = useRef<Record<string, number>>({})

  const flush = useMemo(
    () =>
      oneAtATime(async () => {
        // The flush's own connection roster, read fresh at call time: `home` can
        // belong to a different connection by the time a long flush runs (the
        // primary connection changed while Home stayed mounted).
        const rosterOf = () => client.getQueryData<Bot[]>(rosterKey(connectionId))
        const readAt = () => client.getQueryState(rosterKey(connectionId))?.dataUpdatedAt ?? 0
        const queuedNow = () => Boolean(useDeviceStore.getState().organization[connectionId]?.outbox.some(item => item.status === 'queued'))
        // `oneAtATime` can start this run right after one that just stalled
        // (a requeued item makes `queuedNow()` true again at once); it must
        // stop here too, not only in the effect below.
        if (!readyToFlush(queuedNow(), readAt(), stalledAt.current[connectionId] ?? 0)) {
          return
        }
        const result = await flushOrgOutbox({
          profiles: port.profiles,
          summaryOf: profile => summaryOfRoster(rosterOf(), profile),
          outbox: {
            list: () => useDeviceStore.getState().organization[connectionId]?.outbox ?? [],
            update: fn => updateOrgOutbox(connectionId, fn)
          }
        })
        if (result.waiting) {
          stalledAt.current[connectionId] = readAt()
        }
        if (result.sent > 0 || result.refused.length > 0) {
          void client.invalidateQueries({ queryKey: rosterKey(connectionId) })
        }
        if (result.refused.length > 0) {
          latest.current(refusedMessage(result.refused, profile => nameOfRoster(rosterOf(), profile)))
        }
      }),
    [port, connectionId, updateOrgOutbox, client]
  )

  const ready = readyToFlush(queued, home.updatedAt, stalledAt.current[connectionId] ?? 0)
  useEffect(() => {
    if (ready) {
      void flush()
    }
  }, [ready, home.updatedAt, flush])
}
