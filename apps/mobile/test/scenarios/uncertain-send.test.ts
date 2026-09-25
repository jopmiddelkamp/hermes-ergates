import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

describe('uncertain send', () => {
  it('marks the item unconfirmed on a timeout, and never retries prompt.submit', async () => {
    const gateway = new FakeGateway({ onSubmit: () => 'timeout' })
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()

    await controller.send('are you there?')

    const item = controller.getView().state.items.find(i => i.kind === 'user')
    expect(item).toMatchObject({ kind: 'user', delivery: 'unconfirmed' })
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })

  it('marks the item failed on an rpc rejection', async () => {
    const gateway = new FakeGateway({ onSubmit: () => 'reject' })
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()

    await controller.send('do something risky')

    const item = controller.getView().state.items.find(i => i.kind === 'user')
    expect(item).toMatchObject({ kind: 'user', delivery: 'failed' })
    expect(controller.getView().state.lastError).toBeTruthy()
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })
})
