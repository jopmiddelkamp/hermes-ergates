import { describe, expect, it } from 'vitest'

import { GatewayError, mapHttpError, mapRpcError, mapSocketClose, redact, userMessage } from './errors'

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
