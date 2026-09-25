import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'

import { flush } from '@test/fake-gateway/fake-websocket'

import { FakeGateway, type SubmitOutcome } from '../fake-gateway/fake-gateway'
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

  it('leaves the item unconfirmed when the socket closes mid-submit, and never resends it', async () => {
    // The gateway never answers: the socket closes first. The real client
    // rejects every in-flight request when its socket closes.
    const gateway = new FakeGateway({ onSubmit: () => new Promise<SubmitOutcome>(() => undefined) })
    const outbox = memoryOutbox()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox })
    await controller.open()
    const conn = gateway.connectionFor('thijs')

    const sending = controller.send('did that land?')
    await flush(1)
    expect(conn.submitCalls).toBe(1)

    conn.simulateDrop()
    await flush(20)

    expect(controller.getView().state.items.find(i => i.kind === 'user')).toMatchObject({ delivery: 'unconfirmed' })
    expect(outbox.list()).toMatchObject([{ status: 'unconfirmed' }])
    expect(conn.submitCalls).toBe(1)
    await sending

    // Later reconnects leave it to the user.
    conn.simulateDrop()
    await flush(20)
    expect(conn.submitCalls).toBe(1)
  })
})
