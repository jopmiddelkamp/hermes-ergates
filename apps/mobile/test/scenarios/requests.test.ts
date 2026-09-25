import { describe, expect, it } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

describe('approval and clarify requests', () => {
  it('resolves an approval request once answered with "once"', async () => {
    const gateway = new FakeGateway()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()
    const conn = gateway.connectionFor('thijs')
    const live = controller.getView().state.liveSessionId
    if (!live) throw new Error('no live session id')

    conn.emit({
      type: 'approval.request',
      session_id: live,
      seq: 1,
      payload: { request_id: 'ap1', command: 'rm -rf /tmp/x', description: 'delete temp files', choices: ['once', 'session', 'always', 'deny'] }
    })
    expect(controller.getView().state.items.find(i => i.kind === 'approval')).toMatchObject({ requestId: 'ap1', state: 'pending' })

    await controller.answerApproval('ap1', 'once')

    expect(controller.getView().state.items.find(i => i.kind === 'approval')).toMatchObject({ requestId: 'ap1', state: 'resolved', choice: 'once' })
  })

  it('answers a clarify request and expires only the matching request id', async () => {
    const gateway = new FakeGateway()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()
    const conn = gateway.connectionFor('thijs')
    const live = controller.getView().state.liveSessionId
    if (!live) throw new Error('no live session id')

    conn.emit({
      type: 'clarify.request',
      session_id: live,
      seq: 1,
      payload: { request_id: 'c1', questions: [{ qid: 'q0', question: 'Tea or coffee?', choices: ['A) tea', 'B) coffee'], multi_select: false }] }
    })
    conn.emit({
      type: 'clarify.request',
      session_id: live,
      seq: 2,
      payload: { request_id: 'c2', questions: [{ qid: 'q0', question: 'Sugar?', choices: ['A) yes', 'B) no'], multi_select: false }] }
    })

    await controller.answerClarify('c1', { q0: 'A' })
    conn.emit({ type: 'clarify.expire', session_id: live, seq: 3, payload: { request_id: 'c2' } })

    const state = controller.getView().state
    expect(state.items.find(i => i.kind === 'clarify' && i.requestId === 'c1')).toMatchObject({ state: 'answered', answers: { q0: 'A' } })
    expect(state.items.find(i => i.kind === 'clarify' && i.requestId === 'c2')).toMatchObject({ state: 'expired' })
  })
})
