/**
 * Scenario: the chat re-opens while a send is still in flight.
 *
 * The React binding re-opens the controller (close, then open) when the
 * canonical session pointer changes. The gateway hands back the same cached
 * socket, so a submit that was in flight stays in flight. ADR-027: every
 * attempt sends exactly one `prompt.submit`, so a re-open must never send an
 * in-flight item again, and a detached send queue must stop flushing.
 */
import { describe, expect, it, vi } from 'vitest'

import { createSessionController } from '@/features/chat/session-controller'
import type { GatewayEventFrame } from '@/gateway/types'
import type { OutboxItem } from '@/state/outbox'

import { flush } from '@test/fake-gateway/fake-websocket'
import turnPong from '@test/fixtures/turn-pong.json'

import { FakeGateway, type FakeConnection, type SubmitOutcome } from '../fake-gateway/fake-gateway'
import { memoryOutbox } from '../fake-gateway/memory-outbox'

/** A step the test releases by hand: a `prompt.submit` answer, or a held lookup. */
function held(): { promise: Promise<SubmitOutcome>; release: (outcome?: SubmitOutcome) => void } {
  let release: (outcome?: SubmitOutcome) => void = () => undefined
  const promise = new Promise<SubmitOutcome>(resolve => {
    release = (outcome = []) => resolve(outcome)
  })
  return { promise, release }
}

const submittedTexts = (conn: FakeConnection): string[] =>
  conn.requests.filter(r => r.method === 'prompt.submit').map(r => String(r.params.text))

describe('re-opening the chat', () => {
  it('never submits an in-flight send a second time', async () => {
    const answer = held()
    const gateway = new FakeGateway({ onSubmit: () => answer.promise })
    const outbox = memoryOutbox()
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox })
    await controller.open()
    const conn = gateway.connectionFor('thijs')

    const sending = controller.send('only once, please')
    await flush(1)
    expect(conn.submitCalls).toBe(1)

    // The canonical pointer changed: the binding closes and re-opens the controller.
    controller.close()
    await controller.open()
    await flush(1)
    answer.release(turnPong as GatewayEventFrame[])
    await sending
    await flush(20)

    expect(submittedTexts(conn)).toEqual(['only once, please'])
    expect(outbox.list()).toHaveLength(0)
    expect(controller.getView().state.items.filter(i => i.kind === 'user')).toMatchObject([{ text: 'only once, please', delivery: 'acknowledged' }])
  })

  it('submits each queued item once when a re-open lands during the outbox flush', async () => {
    const answers: Array<ReturnType<typeof held>> = []
    const gateway = new FakeGateway({
      onSubmit: () => {
        const answer = held()
        answers.push(answer)
        return answer.promise
      }
    })
    const seed: OutboxItem[] = [
      { localId: 'q1', connectionId: 'c-test', profile: 'thijs', text: 'first', createdAt: 1, status: 'queued_unsent' },
      { localId: 'q2', connectionId: 'c-test', profile: 'thijs', text: 'second', createdAt: 2, status: 'queued_unsent' }
    ]
    const outbox = memoryOutbox(seed)
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox })
    await controller.open() // the open flush sends `first` and waits for its answer
    await flush(1)
    const conn = gateway.connectionFor('thijs')
    expect(submittedTexts(conn)).toEqual(['first'])

    controller.close()
    await controller.open()
    // Answer every submit, including any the re-open or the old queue still start.
    for (let round = 0; round < 5; round += 1) {
      for (const answer of answers) {
        answer.release()
      }
      await flush(5)
    }

    expect(submittedTexts(conn).sort()).toEqual(['first', 'second'])
    expect(outbox.list()).toHaveLength(0)
  })

  it('stops the previous open\'s queue from flushing once the chat re-opens', async () => {
    const answers: Array<ReturnType<typeof held>> = []
    const gateway = new FakeGateway({
      onSubmit: () => {
        const answer = held()
        answers.push(answer)
        return answer.promise
      }
    })
    const seed: OutboxItem[] = [
      { localId: 'q1', connectionId: 'c-test', profile: 'thijs', text: 'first', createdAt: 1, status: 'queued_unsent' },
      { localId: 'q2', connectionId: 'c-test', profile: 'thijs', text: 'second', createdAt: 2, status: 'queued_unsent' }
    ]
    const outbox = memoryOutbox(seed)
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox })
    await controller.open() // the open flush sends `first` and waits for its answer
    await flush(1)
    const conn = gateway.connectionFor('thijs')

    // Hold the re-open between its connect and its session lookup.
    const lookup = held()
    const list = gateway.sessions.list
    vi.spyOn(gateway.sessions, 'list').mockImplementationOnce(async params => {
      await lookup.promise
      return list(params)
    })
    controller.close()
    const reopening = controller.open()
    await flush(1)

    // `first` settles while the re-open is still resolving the chat: the old
    // queue belongs to a dropped attempt and must not send `second`.
    answers[0]!.release()
    await flush(5)
    expect(submittedTexts(conn)).toEqual(['first'])

    lookup.release()
    await reopening
    await flush(5)
    for (const answer of answers) {
      answer.release()
    }
    await flush(5)
    expect(submittedTexts(conn)).toEqual(['first', 'second'])
    expect(outbox.list()).toHaveLength(0)
  })

  it('keeps the reducer state across re-opens', async () => {
    // A busy send the gateway parked: history does not show it yet, so only the reducer holds it.
    const gateway = new FakeGateway({ onSubmit: () => ({ status: 'queued' }) })
    const controller = createSessionController({ port: gateway, profile: 'thijs', connectionId: 'c-test', outbox: memoryOutbox() })
    await controller.open()
    const live = controller.getView().state.liveSessionId ?? ''
    // A pending clarify card lives only in the reducer too.
    gateway.connectionFor('thijs').emit({
      type: 'clarify.request',
      session_id: live,
      seq: 1,
      payload: { request_id: 'c1', questions: [{ qid: 'q0', question: 'Tea or coffee?', choices: ['A) tea', 'B) coffee'], multi_select: false }] }
    })
    await controller.send('remember me')
    await flush(20)
    expect(controller.getView().state.items.find(i => i.kind === 'user')).toMatchObject({ text: 'remember me', delivery: 'queued' })

    await controller.open()
    await controller.open()

    const items = controller.getView().state.items
    expect(items.filter(i => i.kind === 'clarify')).toMatchObject([{ requestId: 'c1', state: 'pending' }])
    expect(items.filter(i => i.kind === 'user')).toMatchObject([{ text: 'remember me', delivery: 'queued' }])
    expect(controller.getView().state.replay.lastSeq).toBe(1)
  })
})
