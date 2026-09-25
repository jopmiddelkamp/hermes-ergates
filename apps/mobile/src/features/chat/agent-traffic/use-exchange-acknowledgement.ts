/**
 * The acknowledgement state machine of the read-only exchange screen (spec 12.1), out of `app/`
 * (ADR-029 rule 1: screens wire only). The decision itself is pure and lives in `timeline.ts`
 * (`acknowledgementBatch`); this hook only holds the refs, the reveal state and the store call.
 *
 * Opening the screen acknowledges exactly what it presents at that opening; an "Older messages"
 * reveal acknowledges exactly what it exposed; records that arrive while the screen stays mounted
 * append after the latest entry and are never acknowledged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDeviceStore } from '@/state/device-store'

import { acknowledgementBatch, identitiesOf, type TranscriptEntry } from './timeline'

export interface ExchangeAcknowledgement {
  /** The entries the list renders: everything from the anchored entry on, until a reveal. */
  visibleEntries: TranscriptEntry[]
  /** Index of the first rendered entry; `> 0` means earlier entries are still hidden. */
  firstVisible: number
  /** Reveal the already-loaded earlier entries (and acknowledge them). */
  revealEarlier: () => void
  /** Page the REST window further back (and acknowledge what that exposes). */
  loadOlder: () => void
}

export function useExchangeAcknowledgement(opts: {
  entries: TranscriptEntry[]
  anchorIndex: number
  connectionId: string
  profile: string
  loadOlder: () => void | Promise<void>
}): ExchangeAcknowledgement {
  const { entries, anchorIndex, connectionId, profile } = opts
  const acknowledgeExchanges = useDeviceStore(s => s.acknowledgeExchanges)

  // The tapped set opens at the top of the screen (owner request 2026-09-14): the list simply
  // starts at the anchored entry and the earlier loaded entries sit behind "Older messages".
  const [revealedFrom, setRevealedFrom] = useState<number | null>(null)
  const firstVisible = revealedFrom ?? (anchorIndex === -1 ? 0 : anchorIndex)
  const visibleEntries = useMemo(() => (firstVisible > 0 ? entries.slice(firstVisible) : entries), [entries, firstVisible])

  const presentedRef = useRef<Set<string>>(new Set())
  const revealPendingRef = useRef(false)

  const present = useCallback(
    (batch: TranscriptEntry[]) => {
      if (batch.length === 0) return
      for (const entry of batch) presentedRef.current.add(entry.key)
      const ids = identitiesOf(batch)
      if (ids.length > 0) acknowledgeExchanges(connectionId, profile, ids)
    },
    [acknowledgeExchanges, connectionId, profile]
  )

  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true
    present(acknowledgementBatch(visibleEntries, presentedRef.current, { opening: true, revealPending: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!revealPendingRef.current) return
    const revealed = acknowledgementBatch(visibleEntries, presentedRef.current, { opening: false, revealPending: true })
    if (revealed.length === 0) return
    revealPendingRef.current = false
    present(revealed)
  }, [visibleEntries, present])

  const revealEarlier = useCallback(() => {
    revealPendingRef.current = true
    setRevealedFrom(0)
  }, [])

  const { loadOlder: pageOlder } = opts
  const loadOlder = useCallback(() => {
    revealPendingRef.current = true
    void pageOlder()
  }, [pageOlder])

  return { visibleEntries, firstVisible, revealEarlier, loadOlder }
}
