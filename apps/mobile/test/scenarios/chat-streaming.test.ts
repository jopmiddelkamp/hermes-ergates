import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'
import type { GatewayEventFrame } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'
import turnPong from '@test/fixtures/turn-pong.json'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

describe('chat streaming', () => {
  it('renders the pong turn as one user bubble and one assistant bubble', async () => {
    const gateway = new FakeGateway({ onSubmit: () => turnPong as GatewayEventFrame[] })
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()

    expect(controller.getView().phase).toBe('ready')
    expect(controller.getView().state.items).toHaveLength(0)

    await controller.send('Reply with exactly the single word: pong')
    await flush(20)

    const items = controller.getView().state.items
    const bubbles = items.filter(i => i.kind === 'user' || i.kind === 'assistant')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]).toMatchObject({ kind: 'user', delivery: 'acknowledged', text: 'Reply with exactly the single word: pong' })
    expect(bubbles[1]).toMatchObject({ kind: 'assistant', text: 'pong' })
    expect(controller.getView().state.live.streaming).toBe(false)
    expect(controller.getView().state.usage?.total).toBe(11898)
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })

  it('notifies subscribers on every change until they unsubscribe', async () => {
    const gateway = new FakeGateway({ onSubmit: () => turnPong as GatewayEventFrame[] })
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    const phases: string[] = []
    const unsubscribe = controller.subscribe(() => phases.push(controller.getView().phase))

    await controller.open()
    expect(phases[0]).toBe('opening')
    expect(phases.at(-1)).toBe('ready')

    unsubscribe()
    const seen = phases.length
    const before = controller.getView()
    await controller.send('ping')
    await flush(20)
    // The view still changes; the unsubscribed listener just no longer hears it.
    expect(controller.getView()).not.toBe(before)
    expect(phases).toHaveLength(seen)
  })
})
