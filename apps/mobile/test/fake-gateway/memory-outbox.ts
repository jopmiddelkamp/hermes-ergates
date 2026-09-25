/**
 * memoryOutbox: an in-memory stand-in for the device store's outbox slice, so a
 * scenario can inspect what the send queue persisted. It is a fake of the store,
 * not of the session: the session under test is always the real
 * `createSessionController` (ADR-029 rule 3).
 */

import type { OutboxStore } from '@/features/chat/session-controller'
import type { OutboxItem } from '@/state/outbox'

export function memoryOutbox(seed: OutboxItem[] = []): OutboxStore & { items: OutboxItem[] } {
  const items: OutboxItem[] = [...seed]
  return {
    items,
    list: () => [...items],
    add: item => {
      items.push(item)
    },
    update: (localId, patch) => {
      const index = items.findIndex(i => i.localId === localId)
      if (index >= 0) {
        items[index] = { ...items[index]!, ...patch }
      }
    },
    remove: localId => {
      const index = items.findIndex(i => i.localId === localId)
      if (index >= 0) {
        items.splice(index, 1)
      }
    }
  }
}
