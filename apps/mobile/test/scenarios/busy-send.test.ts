/**
 * Scenario: a second message while the assistant is still replying.
 *
 * `display.busy_input_mode` defaults to `interrupt`, so a plain mid-turn
 * `prompt.submit` HARD-INTERRUPTS the live turn and comes back `redirected`.
 * The app sends `queued: true` while a turn is running, which forces the
 * server's queue mode, and branches on the status it gets back.
 */
import { describe, expect, it } from 'vitest'

import type { GatewayEventFrame } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { runSession } from '../fake-gateway/scenarios'

const RUNNING_TURN: GatewayEventFrame[] = [
  { type: 'message.start', seq: 1 },
  { type: 'message.delta', seq: 2, payload: { text: 'thinking out loud' } }
]

describe('sending while a turn is running (scenario i1)', () => {
  it('marks a queued send queued, and acknowledges it when its turn starts', async () => {
    let sends = 0
    const gateway = new FakeGateway({
      onSubmit: () => {
        sends += 1
        return sends === 1 ? RUNNING_TURN : { status: 'queued' as const }
      }
    })
    const driver = await runSession(gateway, 'thijs')

    await driver.send('first')
    await flush(20)
    expect(driver.getState().live.streaming).toBe(true)

    await driver.send('and one more thing')
    const queued = driver.getState().items.filter(i => i.kind === 'user').at(-1)
    expect(queued).toMatchObject({ delivery: 'queued', text: 'and one more thing' })
    // The queue flag is what stops the gateway killing the live turn.
    const submits = gateway.connectionFor('thijs').requests.filter(r => r.method === 'prompt.submit')
    expect(submits).toHaveLength(2)
    expect(submits[1]?.params.queued).toBe(true)

    gateway.connectionFor('thijs').emit({ type: 'message.complete', session_id: driver.liveSessionId, seq: 3, payload: { text: 'thinking out loud', status: 'complete' } })
    gateway.connectionFor('thijs').emit({ type: 'message.start', session_id: driver.liveSessionId, seq: 4 })
    expect(driver.getState().items.filter(i => i.kind === 'user').at(-1)).toMatchObject({ delivery: 'acknowledged' })
  })

  it('renders a redirected send as a course correction, not a user bubble', async () => {
    let sends = 0
    const gateway = new FakeGateway({
      onSubmit: () => {
        sends += 1
        return sends === 1 ? RUNNING_TURN : { status: 'redirected' as const }
      }
    })
    const driver = await runSession(gateway, 'thijs')
    await driver.send('first')
    await flush(20)

    await driver.send('no, use python')

    const users = driver.getState().items.filter(i => i.kind === 'user')
    expect(users.map(u => (u.kind === 'user' ? u.text : ''))).toEqual(['first'])
    // A redirected prompt never becomes a durable user row, so a bubble marked
    // "acknowledged" would flip to "unconfirmed" on the next history merge.
    expect(driver.getState().items.at(-1)).toMatchObject({ kind: 'event', text: 'Course correction: no, use python' })
    expect(driver.outbox()).toHaveLength(0)
  })
})
