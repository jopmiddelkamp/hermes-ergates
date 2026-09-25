/**
 * Scenarios d/e/g: the durable outbox.
 *
 * ADR-027: `prompt.submit` is sent exactly once per attempt. An offline send
 * never reaches the wire and goes out on the next authenticated reconnect; an
 * uncertain send (timeout) is persisted and only ever resent by the user.
 */
import { describe, expect, it } from 'vitest'

import type { GatewayEventFrame } from '@/gateway/types'
import type { OutboxItem } from '@/state/outbox'

import { flush } from '@test/fake-gateway/fake-websocket'
import turnPong from '@test/fixtures/turn-pong.json'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { memoryOutbox, runSession } from '../fake-gateway/scenarios'

describe('offline send (scenario g)', () => {
  it('queues a send made with no connection and submits it exactly once on reconnect', async () => {
    const gateway = new FakeGateway({ onSubmit: () => turnPong as GatewayEventFrame[] })
    let online = false
    const outbox = memoryOutbox()
    const driver = await runSession(gateway, 'thijs', { outbox, online: () => online })

    await driver.send('are you there?')

    const conn = gateway.connectionFor('thijs')
    expect(conn.submitCalls).toBe(0)
    expect(driver.getState().items.find(i => i.kind === 'user')).toMatchObject({ delivery: 'queued_unsent' })
    expect(outbox.list()).toHaveLength(1)
    expect(outbox.list()[0]).toMatchObject({ status: 'queued_unsent', profile: 'thijs' })

    online = true
    conn.simulateDrop() // closed -> open: the hook's reconnect path
    await driver.settled()
    await flush(20)

    expect(conn.submitCalls).toBe(1)
    expect(driver.getState().items.find(i => i.kind === 'user')).toMatchObject({ delivery: 'acknowledged' })
    // Accepted items leave the outbox: only unsent or uncertain ones are persisted.
    expect(outbox.list()).toHaveLength(0)

    // A second reconnect must not re-send anything.
    conn.simulateDrop()
    await driver.settled()
    await flush(20)
    expect(conn.submitCalls).toBe(1)
  })

  it('keeps an uncertain send in the outbox and never resends it automatically', async () => {
    const gateway = new FakeGateway({ onSubmit: () => 'timeout' })
    const outbox = memoryOutbox()
    const driver = await runSession(gateway, 'thijs', { outbox })

    await driver.send('did that go through?')
    const conn = gateway.connectionFor('thijs')
    expect(conn.submitCalls).toBe(1)
    expect(outbox.list()[0]).toMatchObject({ status: 'unconfirmed' })
    expect(driver.getState().items.find(i => i.kind === 'user')).toMatchObject({ delivery: 'unconfirmed' })

    conn.simulateDrop()
    await driver.settled()
    await flush(20)
    // The reconnect flush only picks up items that never left the device.
    expect(conn.submitCalls).toBe(1)
    expect(outbox.list()[0]).toMatchObject({ status: 'unconfirmed' })
  })

  it('resends only on a deliberate user retry', async () => {
    const gateway = new FakeGateway({ onSubmit: () => 'timeout' })
    const outbox = memoryOutbox()
    const driver = await runSession(gateway, 'thijs', { outbox })
    await driver.send('one more time')
    const localId = outbox.list()[0]!.localId

    await driver.retry(localId)

    expect(gateway.connectionFor('thijs').submitCalls).toBe(2)
    expect(outbox.list()[0]).toMatchObject({ status: 'unconfirmed', attempts: 1 })
  })

  it('renders a persisted outbox after a restart without re-sending it', async () => {
    const gateway = new FakeGateway({ onSubmit: () => turnPong as GatewayEventFrame[] })
    // What `recoverAfterRestart` leaves behind: a submit whose outcome nobody knows.
    const seed: OutboxItem[] = [
      { localId: 'o1', connectionId: 'c-test', profile: 'thijs', text: 'before the crash', createdAt: 1, status: 'unconfirmed' }
    ]
    const outbox = memoryOutbox()
    const driver = await runSession(gateway, 'thijs', { outbox, seed })

    expect(driver.getState().items.find(i => i.kind === 'user' && i.localId === 'o1')).toMatchObject({ delivery: 'unconfirmed', text: 'before the crash' })
    expect(gateway.connectionFor('thijs').submitCalls).toBe(0)
  })
})
