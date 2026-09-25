/**
 * In-memory skin sync state (docs/10 section 2). Fed by `gateway.ready`
 * (seed) and `skin.changed` (apply) events of the ACTIVE connection; the
 * app layout drains `pendingApply` into the theme preference.
 */

import { create } from 'zustand'

import { clearPendingApply, ingestSkin, initialSkinSyncState, type SkinSyncState } from './skin-sync'

interface SkinStore {
  state: SkinSyncState
  activeConnectionId: string | null
  setActiveConnection(id: string | null): void
  ingest(connectionId: string, skin: unknown, apply: boolean): void
  clearPending(): void
}

export const useSkinStore = create<SkinStore>((set, get) => ({
  state: initialSkinSyncState,
  activeConnectionId: null,
  setActiveConnection: id => set({ activeConnectionId: id }),
  ingest: (connectionId, skin, apply) => {
    const active = get().activeConnectionId === null || get().activeConnectionId === connectionId
    set(s => ({ state: ingestSkin(s.state, skin, apply, active) }))
  },
  clearPending: () => set(s => ({ state: clearPendingApply(s.state) }))
}))
