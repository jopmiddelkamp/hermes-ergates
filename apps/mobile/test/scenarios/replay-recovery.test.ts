import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'
import type { GatewayEventFrame } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'
import turnPong from '@test/fixtures/turn-pong.json'

import { FakeGateway, type FakeScript } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

const LIVE = 'live0001' // matches test/fixtures/session-create.json

describe('replay recovery', () => {
  it('replays the gap once after a drop with the same epoch, without duplicating bubbles', async () => {
    const script: FakeScript = { onSubmit: () => turnPong as GatewayEventFrame[] }
    const gateway = new FakeGateway(script)
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()

    await controller.send('ping')
    await flush(20)

    const before = controller.getView().state
    expect(before.items.filter(i => i.kind === 'assistant')).toHaveLength(1)
    expect(before.replay.lastSeq).toBe(11)
    expect(before.replay.epoch).toBe('epoch-fake')

    const conn = gateway.connectionFor('thijs')
    conn.simulateDrop()
    await flush(20)
    expect(controller.getView().state.connection).toBe('open')

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
    await controller.reconnect()
    await controller.reconnect() // calling it twice must still not duplicate anything

    const after = controller.getView().state
    const bubbles = after.items.filter(i => i.kind === 'user' || i.kind === 'assistant')
    expect(bubbles).toHaveLength(2)
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })

  it('refetches durable history by itself after an epoch change and rebuilds the items', async () => {
    const script: FakeScript = { onSubmit: () => turnPong as GatewayEventFrame[] }
    const gateway = new FakeGateway(script)
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()

    await controller.send('ping')
    await flush(20)
    expect(controller.getView().state.items.some(i => i.kind === 'assistant' && i.text === 'pong')).toBe(true)
    expect(gateway.calls.history).toBe(0)

    // The gateway restarted: a fresh replay epoch means the client's watermark
    // is no longer trustworthy, so the reducer asks for a full history refetch
    // and the controller runs it without being told.
    script.replay = { epoch: 'epoch-2' }
    await controller.reconnect()
    await flush(20)

    const state = controller.getView().state
    expect(state.replay.epoch).toBe('epoch-2')
    expect(gateway.calls.history).toBe(1)
    expect(state.replay.needsHistoryRefetch).toBe(false)
    // The refetch is authoritative: it rebuilds from durable history rather than
    // appending, so it is built from the fixture's recorded turns. But the
    // unrelated fixture carries no new input row the live "pong" answer could
    // anchor to (spec 12.3): the match is ambiguous, so the live bubble
    // is retained rather than silently dropped.
    expect(state.items.some(i => i.kind === 'assistant' && i.text === 'pong')).toBe(true)
    expect(state.items.some(i => i.kind === 'tool' && i.name === 'vision_analyze')).toBe(true)
    expect(state.items.some(i => i.kind === 'assistant' && i.text.includes('receipt'))).toBe(true)
  })
})
