/**
 * transcriptWindow: the REST transcript window a chat screen holds, driven
 * through the pure `window.ts` rules. `use-transcript.ts` keeps this window in
 * the TanStack Query cache and schedules the fetches from React effects; a test
 * asks for each fetch instead. Every merged page is reported to the real
 * session controller, exactly as the hook does (spec 5.8).
 */

import type { SessionController } from '@/features/chat/session-controller'
import {
  AUTO_PAGE_BUDGET,
  FIRST_PAGE_LIMIT,
  TAIL_LIMIT,
  emptyWindow,
  mergePage,
  olderQuery,
  reconciledIds,
  tailOverlaps,
  tailQuery,
  type PageKind,
  type TranscriptWindow
} from '@/features/chat/agent-traffic/window'
import type { GatewayPort } from '@/gateway/port'

export interface TranscriptWindowDriver {
  /** The window as it stands now. */
  current(): TranscriptWindow
  /** Chat open: the latest page (spec 5.5). */
  fetchInitial(): Promise<void>
  /** One tail run: `tailQuery(0)`, continuing backward until it reaches the loaded boundary (spec 5.8). */
  fetchTail(): Promise<void>
  /** One page further back (spec 5.5). */
  fetchOlder(): Promise<void>
}

export function transcriptWindow(port: GatewayPort, controller: SessionController, profile: string): TranscriptWindowDriver {
  let loaded = emptyWindow()

  const fetchPage = async (query: { limit: number; offset: number; order: 'latest' }, kind: PageKind) => {
    const storedSessionId = controller.getView().state.storedSessionId
    if (storedSessionId === null) {
      throw new Error('The chat is not bound yet.')
    }
    const page = await port.sessions.transcript(storedSessionId, { profile, ...query })
    loaded = mergePage(loaded, page, kind)
    controller.dispatchReconciled(reconciledIds(page))
    return page
  }

  return {
    current: () => loaded,
    fetchInitial: async () => {
      await fetchPage({ limit: FIRST_PAGE_LIMIT, offset: 0, order: 'latest' }, 'initial')
    },
    fetchTail: async () => {
      // The boundary is the window as it was BEFORE this run: merging a tail page
      // makes its own newest row the newest loaded one, which would make every
      // later page of the run look like an overlap (see `tailOverlaps`).
      const boundary = loaded
      let offset = 0
      for (let pages = 0; pages < AUTO_PAGE_BUDGET; pages += 1) {
        const page = await fetchPage(tailQuery(offset), 'tail')
        if (tailOverlaps(boundary, page)) {
          return
        }
        offset += TAIL_LIMIT
      }
    },
    fetchOlder: async () => {
      await fetchPage(olderQuery(loaded), 'older')
    }
  }
}
