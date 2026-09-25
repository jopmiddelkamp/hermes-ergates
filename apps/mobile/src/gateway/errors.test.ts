import { describe, expect, it } from 'vitest'

import { GatewayError, mapErgatesError, mapHttpError, mapRpcError, mapSocketClose, redact, userMessage } from './errors'

describe('mapHttpError', () => {
  it('maps 401 to unauthorized', () => {
    expect(mapHttpError(401).kind).toBe('unauthorized')
  })
  it('maps 429 to rate_limited with a plain message', () => {
    const err = mapHttpError(429, { detail: 'Too many login attempts. Try again shortly.' })
    expect(err.kind).toBe('rate_limited')
    expect(err.status).toBe(429)
  })
  it('uses the body detail for other statuses', () => {
    expect(mapHttpError(404, { detail: 'Unknown provider' }).message).toBe('Unknown provider')
  })
})

describe('mapErgatesError', () => {
  it('keeps the C3 code and the safe message of an Ergates error body', () => {
    const err = mapErgatesError(409, { error: { code: 'out_of_order', message: "'configured' cannot be reported before 'plugin_enabled' is done" } })
    expect(err).toMatchObject({ kind: 'unknown', status: 409, code: 'out_of_order', message: "'configured' cannot be reported before 'plugin_enabled' is done" })
    expect(mapErgatesError(404, { error: { code: 'not_found', message: 'no proposal' } })).toMatchObject({ kind: 'not_found', code: 'not_found' })
  })
  it('maps an answer without a C3 body like any HTTP error', () => {
    const err = mapErgatesError(401, { detail: 'Unauthorized' })
    expect(err).toMatchObject({ kind: 'unauthorized', status: 401 })
    expect(err.code).toBeUndefined()
  })
  it('redacts secrets in a server message', () => {
    expect(mapErgatesError(400, { error: { code: 'invalid', message: 'bad token=abc' } }).message).toBe('bad token=<redacted>')
  })
})

describe('mapRpcError', () => {
  it('maps busy codes', () => {
    const err = Object.assign(new Error('session busy'), { name: 'JsonRpcGatewayError', code: 4090 })
    expect(mapRpcError(err).kind).toBe('busy')
  })
  it('maps session-not-found codes', () => {
    const err = Object.assign(new Error('session not found'), { name: 'JsonRpcGatewayError', code: 4007 })
    expect(mapRpcError(err).kind).toBe('not_found')
  })
  it('maps vendored client timeouts', () => {
    expect(mapRpcError(new Error('request timed out after 120s: prompt.submit')).kind).toBe('timeout')
  })
  it('maps closed sockets to network', () => {
    expect(mapRpcError(new Error('WebSocket closed')).kind).toBe('network')
    expect(mapRpcError(new Error('gateway not connected')).kind).toBe('network')
  })
  it('passes GatewayError through unchanged', () => {
    const original = new GatewayError('forbidden', 'x')
    expect(mapRpcError(original)).toBe(original)
  })
})

describe('mapSocketClose', () => {
  it('maps 4401 and 4403', () => {
    expect(mapSocketClose(4401).kind).toBe('unauthorized')
    expect(mapSocketClose(4403, 'host_mismatch').kind).toBe('forbidden')
    expect(mapSocketClose(1006).kind).toBe('network')
  })
})

describe('redaction', () => {
  it('strips query-style secrets', () => {
    expect(redact('ws://h/api/ws?profile=a&token=abc123&x=1')).toBe('ws://h/api/ws?profile=a&token=<redacted>&x=1')
    expect(redact('ticket=zzz expired')).toBe('ticket=<redacted> expired')
  })
  it('never leaks a token through userMessage', () => {
    const text = userMessage(new Error('bad url ws://h/api/ws?token=secret-value'))
    expect(text).not.toContain('secret-value')
  })
})
