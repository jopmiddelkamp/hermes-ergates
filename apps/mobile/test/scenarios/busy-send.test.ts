/**
 * Scenario: a second message while the assistant is still replying.
 *
 * `display.busy_input_mode` defaults to `interrupt`, so a plain mid-turn
 * `prompt.submit` HARD-INTERRUPTS the live turn and comes back `redirected`.
 * The app sends `queued: true` while a turn is running, which forces the
 * server's queue mode, and branches on the status it gets back.
 */
import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'
import type { GatewayEventFrame } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

const RUNNING_TURN: GatewayEventFrame[] = [
  { type: 'message.start', seq: 1 },
  { type: 'message.delta', seq: 2, payload: { text: 'thinking out loud' } }
]

describe('sending while a turn is running', () => {
  it('marks a queued send queued, and acknowledges it when its turn starts', async () => {
    let sends = 0
    const gateway = new FakeGateway({
      onSubmit: () => {
        sends += 1
        return sends === 1 ? RUNNING_TURN : { status: 'queued' as const }
      }
    })
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()
    const live = controller.getView().state.liveSessionId ?? ''

    await controller.send('first')
    await flush(20)
    expect(controller.getView().state.live.streaming).toBe(true)

    await controller.send('and one more thing')
    const queued = controller.getView().state.items.filter(i => i.kind === 'user').at(-1)
    expect(queued).toMatchObject({ delivery: 'queued', text: 'and one more thing' })
    // The queue flag is what stops the gateway killing the live turn.
    const submits = gateway.connectionFor('thijs').requests.filter(r => r.method === 'prompt.submit')
    expect(submits).toHaveLength(2)
    expect(submits[1]?.params.queued).toBe(true)

    gateway.connectionFor('thijs').emit({ type: 'message.complete', session_id: live, seq: 3, payload: { text: 'thinking out loud', status: 'complete' } })
    gateway.connectionFor('thijs').emit({ type: 'message.start', session_id: live, seq: 4 })
    expect(controller.getView().state.items.filter(i => i.kind === 'user').at(-1)).toMatchObject({ delivery: 'acknowledged' })
  })

  it('renders a redirected send as a course correction, not a user bubble', async () => {
    let sends = 0
    const gateway = new FakeGateway({
      onSubmit: () => {
        sends += 1
        return sends === 1 ? RUNNING_TURN : { status: 'redirected' as const }
      }
    })
    const outbox = memoryOutbox()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox })
    await controller.open()
    await controller.send('first')
    await flush(20)

    await controller.send('no, use python')

    const users = controller.getView().state.items.filter(i => i.kind === 'user')
    expect(users.map(u => (u.kind === 'user' ? u.text : ''))).toEqual(['first'])
    // A redirected prompt never becomes a durable user row, so a bubble marked
    // "acknowledged" would flip to "unconfirmed" on the next history merge.
    expect(controller.getView().state.items.at(-1)).toMatchObject({ kind: 'event', text: 'Course correction: no, use python' })
    expect(outbox.list()).toHaveLength(0)
  })
})
