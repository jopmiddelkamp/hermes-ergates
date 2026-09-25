/**
 * Scenario: the durable refetch the reducer asks for after truncation or an
 * epoch change. A FAILED refetch must keep asking - clearing the flag in a
 * `finally` abandoned the recovery silently - and the retries are paced.
 */
import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'
import { historyRetryDelayMs, HISTORY_BACKOFF_MS } from '@/features/chat/session-sync'

import { flush } from '@test/fake-gateway/fake-websocket'

import { FakeGateway, type FakeScript } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

/** Timers the test fires by hand, so a backoff is observable without waiting for it. */
function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>()
  let next = 0
  return {
    setTimer: (run: () => void, ms: number): unknown => {
      next += 1
      pending.set(next, { run, ms })
      return next
    },
    clearTimer: (timer: unknown): void => {
      pending.delete(timer as number)
    },
    delays: (): number[] => [...pending.values()].map(t => t.ms),
    fireAll: (): void => {
      const due = [...pending.values()]
      pending.clear()
      for (const t of due) {
        t.run()
      }
    }
  }
}

describe('history refetch', () => {
  it('keeps needsHistoryRefetch raised when the refetch fails, retries after the backoff, and clears it on success', async () => {
    const script: FakeScript = { historyFailures: 2 }
    const gateway = new FakeGateway(script)
    const timers = manualTimers()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox(), setTimer: timers.setTimer, clearTimer: timers.clearTimer })
    await controller.open()

    // A restarted gateway: a new epoch means the watermark is untrustworthy.
    script.replay = { epoch: 'epoch-2' }
    await controller.reconnect()
    await flush(20)

    // The first automatic refetch failed: the flag stays up and a retry waits.
    expect(gateway.calls.history).toBe(1)
    expect(controller.getView().state.replay).toMatchObject({ epoch: 'epoch-2', needsHistoryRefetch: true })
    expect(timers.delays()).toEqual([2_000])

    timers.fireAll()
    await flush(20)
    expect(gateway.calls.history).toBe(2)
    expect(controller.getView().state.replay.needsHistoryRefetch).toBe(true)
    expect(timers.delays()).toEqual([5_000])

    timers.fireAll()
    await flush(20)
    expect(gateway.calls.history).toBe(3)
    expect(controller.getView().state.replay.needsHistoryRefetch).toBe(false)
    expect(timers.delays()).toEqual([])
  })

  it('stops the retries when the chat is closed', async () => {
    const script: FakeScript = { historyFailures: 5 }
    const gateway = new FakeGateway(script)
    const timers = manualTimers()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox(), setTimer: timers.setTimer, clearTimer: timers.clearTimer })
    await controller.open()
    script.replay = { epoch: 'epoch-2' }
    await controller.reconnect()
    await flush(20)
    expect(timers.delays()).toEqual([2_000])

    controller.close()

    expect(timers.delays()).toEqual([])
    expect(gateway.calls.history).toBe(1)
  })

  it('paces the retries instead of spinning', () => {
    expect(HISTORY_BACKOFF_MS).toEqual([2_000, 5_000, 10_000])
    expect([0, 1, 2, 3, 9].map(historyRetryDelayMs)).toEqual([2_000, 5_000, 10_000, 10_000, 10_000])
  })
})
