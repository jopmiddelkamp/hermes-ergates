/**
 * Scenario: the durable refetch the reducer asks for after truncation or an
 * epoch change. A FAILED refetch must keep asking — clearing the flag in a
 * `finally` abandoned the recovery silently.
 */
import { describe, expect, it } from 'vitest'

import { historyRetryDelayMs, HISTORY_BACKOFF_MS } from '@/features/chat/session-sync'

import { FakeGateway, type FakeScript } from '../fake-gateway/fake-gateway'
import { runSession } from '../fake-gateway/scenarios'

describe('history refetch', () => {
  it('keeps needsHistoryRefetch raised when the refetch fails, and clears it on success', async () => {
    const script: FakeScript = { historyFailures: 1 }
    const gateway = new FakeGateway(script)
    const driver = await runSession(gateway, 'thijs')

    // A restarted gateway: a new epoch means the watermark is untrustworthy.
    script.replay = { epoch: 'epoch-2' }
    await driver.reconnect()
    expect(driver.getState().replay).toMatchObject({ epoch: 'epoch-2', needsHistoryRefetch: true })

    await expect(driver.refetchHistory()).rejects.toThrow()
    expect(driver.getState().replay.needsHistoryRefetch).toBe(true)

    await driver.refetchHistory()
    expect(driver.getState().replay.needsHistoryRefetch).toBe(false)
    expect(gateway.calls.history).toBe(2)
  })

  it('paces the retries instead of spinning', () => {
    expect(HISTORY_BACKOFF_MS).toEqual([2_000, 5_000, 10_000])
    expect([0, 1, 2, 3, 9].map(historyRetryDelayMs)).toEqual([2_000, 5_000, 10_000, 10_000, 10_000])
  })
})
