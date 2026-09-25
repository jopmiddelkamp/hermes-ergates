import { describe, expect, it } from 'vitest'

import type { GatewayEventFrame } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'
import turnPong from '@test/fixtures/turn-pong.json'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { runSession } from '../fake-gateway/scenarios'

describe('chat streaming (scenario a)', () => {
  it('renders the pong turn as one user bubble and one assistant bubble', async () => {
    const gateway = new FakeGateway({ onSubmit: () => turnPong as GatewayEventFrame[] })
    const driver = await runSession(gateway, 'thijs')

    expect(driver.getState().items).toHaveLength(0)

    await driver.send('Reply with exactly the single word: pong')
    await flush(20)

    const items = driver.getState().items
    const bubbles = items.filter(i => i.kind === 'user' || i.kind === 'assistant')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]).toMatchObject({ kind: 'user', delivery: 'acknowledged', text: 'Reply with exactly the single word: pong' })
    expect(bubbles[1]).toMatchObject({ kind: 'assistant', text: 'pong' })
    expect(driver.getState().live.streaming).toBe(false)
    expect(driver.getState().usage?.total).toBe(11898)
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })
})
