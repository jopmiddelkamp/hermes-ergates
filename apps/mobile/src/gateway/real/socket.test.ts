import { afterEach, describe, expect, it, vi } from 'vitest'

import { FakeWebSocket, fakeSocketFactory, flush, installFakeWebSocket } from '@test/fake-gateway/fake-websocket'

import { GatewayError, isGatewayError } from '../errors'
import { buildSocketUrl } from './auth'
import { SocketSession } from './socket'

const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket

afterEach(() => {
  ;(globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket
})

describe('buildSocketUrl', () => {
  it('encodes profile and credential', () => {
    expect(buildSocketUrl('http://127.0.0.1:9119', 'default', { token: 'a b' })).toBe('ws://127.0.0.1:9119/api/ws?profile=default&token=a+b')
    expect(buildSocketUrl('https://gw.tail.net/', 'kevin', { ticket: 't1', token: 'ignored' })).toBe('wss://gw.tail.net/api/ws?profile=kevin&ticket=t1')
  })
})

describe('SocketSession', () => {
  it('opens, waits for gateway.ready and answers requests', async () => {
    installFakeWebSocket({ onRequest: method => (method === 'gateway.capabilities' ? { per_session_exclusive_submit: true } : {}) })
    const session = await SocketSession.open({ baseUrl: 'http://127.0.0.1:9119', profile: 'default', credential: async () => ({ token: 'tok' }), socketFactory: fakeSocketFactory })
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:9119/api/ws?profile=default&token=tok')
    expect(session.ready.replay_epoch).toBe('epoch-fake')
    expect(session.state).toBe('open')
    await expect(session.request('gateway.capabilities')).resolves.toEqual({ per_session_exclusive_submit: true })
    session.close()
    expect(session.state).toBe('closed')
  })

  it('delivers events and maps rpc errors', async () => {
    installFakeWebSocket({
      onRequest: method => {
        if (method === 'prompt.submit') {
          throw Object.assign(new Error('busy'), { code: 4090 })
        }
        return {}
      }
    })
    const session = await SocketSession.open({ baseUrl: 'http://127.0.0.1:9119', profile: 'default', credential: async () => ({ token: 'tok' }), socketFactory: fakeSocketFactory })
    const seen: string[] = []
    session.onEvent(e => seen.push(e.type))
    FakeWebSocket.instances[0]?.serverEvent({ type: 'message.start', session_id: 's1', seq: 1 })
    await flush()
    expect(seen).toContain('message.start')
    await expect(session.request('prompt.submit', { session_id: 's1', text: 'x' })).rejects.toSatisfy((e: unknown) => isGatewayError(e) && e.kind === 'busy')
    session.close()
  })

  it('surfaces a 4401 close as unauthorized and does not reconnect', async () => {
    installFakeWebSocket({ closeOnOpen: { code: 4401, reason: 'auth: token_mismatch' } })
    await expect(SocketSession.open({ baseUrl: 'http://127.0.0.1:9119', profile: 'default', credential: async () => ({ token: 'bad' }), socketFactory: fakeSocketFactory, readyTimeoutMs: 200 })).rejects.toSatisfy((e: unknown) => isGatewayError(e) && e.kind === 'unauthorized')
    await flush(20)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('reconnects with a fresh credential after a drop', async () => {
    installFakeWebSocket({})
    let mint = 0
    const session = await SocketSession.open({ baseUrl: 'http://127.0.0.1:9119', profile: 'default', credential: async () => ({ ticket: `t${++mint}` }), socketFactory: fakeSocketFactory, backoffMs: [5] })
    const states: string[] = []
    session.onState(s => states.push(s))
    FakeWebSocket.instances[0]?.serverClose(1006)
    // Wait for the reconnect itself: a fixed pause was too short on a busy machine.
    await vi.waitFor(() => expect(states).toEqual(['open', 'closed', 'connecting', 'open']))
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1]?.url).toContain('ticket=t2')
    expect(session.terminal).toBe(false)
    session.close()
  })

  it('keeps reconnecting after a plain drop instead of blaming a stale auth close', async () => {
    // A close error recorded during one dial must not be reported as the cause of
    // a later network drop, nor disarm the reconnect for the object's lifetime.
    installFakeWebSocket({})
    const session = await SocketSession.open({ baseUrl: 'http://127.0.0.1:9119', profile: 'default', credential: async () => ({ token: 'tok' }), socketFactory: fakeSocketFactory, backoffMs: [5] })
    FakeWebSocket.instances[0]?.serverClose(1006)
    // Wait for each reconnect itself: a fixed pause was too short on a busy machine.
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    await vi.waitFor(() => expect(session.state).toBe('open'))
    FakeWebSocket.instances[1]?.serverClose(1006)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(3))
    await vi.waitFor(() => expect(session.state).toBe('open'))
    expect(session.lastError).toBeNull()
    session.close()
  })

  it('goes terminal on a 4401 after a healthy open, reports it, and stops reconnecting', async () => {
    installFakeWebSocket({})
    const terminal: string[] = []
    const session = await SocketSession.open({
      baseUrl: 'http://127.0.0.1:9119',
      profile: 'default',
      credential: async () => ({ ticket: 't1' }),
      socketFactory: fakeSocketFactory,
      backoffMs: [5],
      onTerminal: err => terminal.push(err.kind)
    })
    FakeWebSocket.instances[0]?.serverClose(4401, 'auth: ticket expired')
    await flush(40)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(session.terminal).toBe(true)
    expect(session.state).toBe('error')
    expect(session.lastError).toMatchObject({ kind: 'unauthorized', terminal: true, code: 4401 })
    // The owner is told so it can drop this socket and let a re-login rebuild it.
    expect(terminal).toEqual(['unauthorized'])
    // A foreground nudge must not retry a dead credential either.
    await session.reconnectNow()
    expect(FakeWebSocket.instances).toHaveLength(1)
    session.close()
  })

  it('treats a failed ticket mint as terminal, before any socket exists', async () => {
    installFakeWebSocket({})
    const terminal: string[] = []
    await expect(
      SocketSession.open({
        baseUrl: 'http://127.0.0.1:9119',
        profile: 'default',
        credential: async () => {
          throw new GatewayError('unauthorized', 'Sign-in required.')
        },
        socketFactory: fakeSocketFactory,
        backoffMs: [5],
        onTerminal: err => terminal.push(err.kind)
      })
    ).rejects.toSatisfy((e: unknown) => isGatewayError(e) && e.kind === 'unauthorized')
    // Without this the app re-mints against a dead cookie every 10s forever.
    expect(terminal).toEqual(['unauthorized'])
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
