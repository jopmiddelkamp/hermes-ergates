import { describe, expect, it } from 'vitest'

import { expired, pressSend, reconnect, recoverAfterRestart, submitResult, userRetry, type OutboxItem, UNSENT_RETENTION_MS } from './outbox'

const draft: OutboxItem = { localId: 'l1', connectionId: 'c1', profile: 'default', text: 'hi', createdAt: 1000, status: 'draft' }

describe('outbox', () => {
  it('sends when online and queues when offline', () => {
    expect(pressSend(draft, true).status).toBe('submitting')
    expect(pressSend(draft, false).status).toBe('queued_unsent')
    expect(pressSend({ ...draft, status: 'failed' }, true).status).toBe('failed')
  })

  it('only queued-unsent items go out on reconnect', () => {
    expect(reconnect({ ...draft, status: 'queued_unsent' }).status).toBe('submitting')
    expect(reconnect({ ...draft, status: 'unconfirmed' }).status).toBe('unconfirmed')
    expect(reconnect({ ...draft, status: 'failed' }).status).toBe('failed')
  })

  it('recovers an interrupted submission as unconfirmed, never queued', () => {
    expect(recoverAfterRestart({ ...draft, status: 'submitting' }).status).toBe('unconfirmed')
    expect(recoverAfterRestart({ ...draft, status: 'queued_unsent' }).status).toBe('queued_unsent')
  })

  it('maps submit outcomes', () => {
    const submitting: OutboxItem = { ...draft, status: 'submitting' }
    expect(submitResult(submitting, { ok: true }).status).toBe('acknowledged')
    expect(submitResult(submitting, { ok: false, definite: true, error: 'rejected' })).toMatchObject({ status: 'failed', error: 'rejected' })
    expect(submitResult(submitting, { ok: false, definite: false, error: 'timeout' })).toMatchObject({ status: 'unconfirmed', error: 'timeout' })
    expect(submitResult(draft, { ok: true }).status).toBe('draft')
  })

  it('returns to draft only through a deliberate retry', () => {
    expect(userRetry({ ...draft, status: 'unconfirmed' })).toMatchObject({ status: 'draft', attempts: 1 })
    expect(userRetry({ ...draft, status: 'failed', attempts: 1 })).toMatchObject({ status: 'draft', attempts: 2 })
    expect(userRetry({ ...draft, status: 'acknowledged' }).status).toBe('acknowledged')
  })

  it('expires unsent items after seven days', () => {
    expect(expired({ ...draft, status: 'queued_unsent' }, 1000 + UNSENT_RETENTION_MS + 1)).toBe(true)
    expect(expired({ ...draft, status: 'queued_unsent' }, 1000 + UNSENT_RETENTION_MS - 1)).toBe(false)
    expect(expired({ ...draft, status: 'acknowledged' }, 1000 + UNSENT_RETENTION_MS + 1)).toBe(false)
  })
})
