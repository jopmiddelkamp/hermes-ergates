import { describe, expect, it } from 'vitest'

import type { GatewayEventFrame } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'
import turnPong from '@test/fixtures/turn-pong.json'

import { FakeGateway, type FakeScript } from '../fake-gateway/fake-gateway'
import { runSession } from '../fake-gateway/scenarios'

const LIVE = 'live0001' // matches test/fixtures/session-create.json

describe('replay recovery (scenarios b, c)', () => {
  it('replays the gap once after a drop with the same epoch, without duplicating bubbles', async () => {
    const script: FakeScript = { onSubmit: () => turnPong as GatewayEventFrame[] }
    const gateway = new FakeGateway(script)
    const driver = await runSession(gateway, 'thijs')

    await driver.send('ping')
    await flush(20)

    const before = driver.getState()
    expect(before.items.filter(i => i.kind === 'assistant')).toHaveLength(1)
    expect(before.replay.lastSeq).toBe(11)
    expect(before.replay.epoch).toBe('epoch-fake')

    const conn = gateway.connectionFor('thijs')
    conn.simulateDrop()
    expect(driver.getState().connection).toBe('open')

    // The gateway re-sends the tail of the stream it believes the client may
    // have missed. Some of it (seq 10, 11) was already applied live; only the
    // watermark - not a second send - must keep this from duplicating a bubble.
    script.replay = {
      events: [
        { type: 'message.complete', session_id: LIVE, seq: 10, payload: { text: 'pong', status: 'complete' } },
        { type: 'session.info', session_id: LIVE, seq: 11, payload: {} }
      ],
      latest_seq: 11
    }
    await driver.reconnect()
    await driver.reconnect() // calling it twice must still not duplicate anything

    const after = driver.getState()
    const bubbles = after.items.filter(i => i.kind === 'user' || i.kind === 'assistant')
    expect(bubbles).toHaveLength(2)
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })

  it('sets needsHistoryRefetch on an epoch change, and refetching history rebuilds the items', async () => {
    const script: FakeScript = { onSubmit: () => turnPong as GatewayEventFrame[] }
    const gateway = new FakeGateway(script)
    const driver = await runSession(gateway, 'thijs')

    await driver.send('ping')
    await flush(20)
    expect(driver.getState().items.some(i => i.kind === 'assistant' && i.text === 'pong')).toBe(true)

    // The gateway restarted: a fresh replay epoch means the client's watermark
    // is no longer trustworthy, so a full history refetch is required.
    script.replay = { epoch: 'epoch-2' }
    await driver.reconnect()
    expect(driver.getState().replay).toMatchObject({ epoch: 'epoch-2', needsHistoryRefetch: true })

    await driver.refetchHistory()
    const state = driver.getState()
    expect(state.replay.needsHistoryRefetch).toBe(false)
    // The refetch is authoritative: it rebuilds from durable history rather than
    // appending, so it is built from the fixture's recorded turns. But the
    // unrelated fixture carries no new input row the live "pong" answer could
    // anchor to (spec 12.3, ruling 5): the match is ambiguous, so the live bubble
    // is retained rather than silently dropped.
    expect(state.items.some(i => i.kind === 'assistant' && i.text === 'pong')).toBe(true)
    expect(state.items.some(i => i.kind === 'tool' && i.name === 'vision_analyze')).toBe(true)
    expect(state.items.some(i => i.kind === 'assistant' && i.text.includes('receipt'))).toBe(true)
  })
})
