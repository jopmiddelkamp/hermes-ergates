import { afterEach, describe, expect, it, vi } from 'vitest'

import { FakeWebSocket, fakeSocketFactory, flush, installFakeWebSocket } from '@test/fake-gateway/fake-websocket'

import { isGatewayError } from '../errors'
import { RealGateway } from './real-gateway'
import { MemorySecretStore } from './secrets'

const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket

afterEach(() => {
  ;(globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket
})

const KEYS = ['ergates.c1.mode', 'ergates.c1.token', 'ergates.c1.cookie']

/** A fetch double that answers per path. */
function routes(handlers: Record<string, { status: number; body?: unknown; headers?: Record<string, string> }>) {
  const seen: string[] = []
  const urls: string[] = []
  const impl = vi.fn(async (url: string | URL | Request) => {
    const full = String(url)
    urls.push(full)
    const path = new URL(full).pathname
    seen.push(path)
    const route = handlers[path] ?? { status: 404, body: { detail: 'not found' } }
    return new Response(route.body === undefined ? '' : JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json', ...(route.headers ?? {}) }
    })
  }) as unknown as typeof fetch
  return { impl, seen, urls }
}

function gatewayWith(handlers: Parameters<typeof routes>[0]) {
  const secrets = new MemorySecretStore()
  const { impl, seen, urls } = routes(handlers)
  const gateway = new RealGateway({ connectionId: 'c1', baseUrl: 'http://gw.local', secrets, fetchImpl: impl })
  return { gateway, secrets, seen, urls }
}

async function storedKeys(secrets: MemorySecretStore): Promise<string[]> {
  const found: string[] = []
  for (const key of KEYS) {
    if ((await secrets.get(key)) !== null) {
      found.push(key)
    }
  }
  return found
}

describe('token login', () => {
  it('persists the token after the probe succeeds', async () => {
    const { gateway, secrets } = gatewayWith({ '/api/profiles': { status: 200, body: { profiles: [] } } })
    await gateway.login({ mode: 'token', token: 'tok-1' })
    expect(gateway.authMode).toBe('token')
    expect(await storedKeys(secrets)).toEqual(['ergates.c1.mode', 'ergates.c1.token'])
  })

  it('rolls back the in-memory auth when the probe fails', async () => {
    const { gateway, secrets } = gatewayWith({ '/api/profiles': { status: 401, body: { detail: 'Unauthorized' } } })
    await expect(gateway.login({ mode: 'token', token: 'bad' })).rejects.toSatisfy((e: unknown) => isGatewayError(e) && e.kind === 'unauthorized')
    // A rejected token must not leave the client half-authenticated.
    expect(gateway.authMode).toBe('none')
    expect(await storedKeys(secrets)).toEqual([])
  })
})

describe('password login', () => {
  it('clears every secret when the login fails after a Set-Cookie', async () => {
    // `onSetCookie` writes any cookie it sees, including one from a login that
    // then fails. The caller discards this connection id, so an orphan entry
    // could never be targeted again.
    const { gateway, secrets } = gatewayWith({
      '/auth/password-login': { status: 200, body: { ok: false }, headers: { 'set-cookie': 'hermes_session_at=abc; Path=/' } }
    })
    await expect(gateway.login({ mode: 'password', provider: 'basic', username: 'u', password: 'p' })).rejects.toSatisfy(
      (e: unknown) => isGatewayError(e) && e.kind === 'unauthorized'
    )
    expect(await storedKeys(secrets)).toEqual([])
    expect(gateway.authMode).toBe('none')
  })

  it('clears every secret when whoAmI fails after a successful login', async () => {
    const { gateway, secrets } = gatewayWith({
      '/auth/password-login': { status: 200, body: { ok: true }, headers: { 'set-cookie': 'hermes_session_at=abc; Path=/' } },
      '/api/auth/me': { status: 500, body: { detail: 'boom' } }
    })
    await expect(gateway.login({ mode: 'password', provider: 'basic', username: 'u', password: 'p' })).rejects.toThrow()
    expect(await storedKeys(secrets)).toEqual([])
  })

  it('keeps the cookie when the login succeeds', async () => {
    const { gateway, secrets } = gatewayWith({
      '/auth/password-login': { status: 200, body: { ok: true }, headers: { 'set-cookie': 'hermes_session_at=abc; Path=/' } },
      '/api/auth/me': { status: 200, body: { user_id: 'u1' } }
    })
    const me = await gateway.login({ mode: 'password', provider: 'basic', username: 'u', password: 'p' })
    expect(me?.user_id).toBe('u1')
    expect(await storedKeys(secrets)).toEqual(['ergates.c1.mode', 'ergates.c1.cookie'])
  })
})

describe('socket cache', () => {
  it('drops a terminally failed socket so a later connect rebuilds it', async () => {
    const secrets = new MemorySecretStore()
    const { impl } = routes({ '/api/profiles': { status: 200, body: { profiles: [] } } })
    installFakeWebSocket({})
    const gateway = new RealGateway({ connectionId: 'c1', baseUrl: 'http://gw.local', secrets, fetchImpl: impl, socketFactory: fakeSocketFactory })
    await gateway.login({ mode: 'token', token: 'tok-1' })

    const first = await gateway.connect('thijs')
    expect(FakeWebSocket.instances).toHaveLength(1)

    // A socket that opened and then failed terminally used to stay cached, so
    // every later connect() handed out the same dead promise for the life of the
    // process - the connection stayed bricked even after a re-login.
    FakeWebSocket.instances[0]?.serverClose(4401, 'auth: ticket expired')
    await flush(20)
    expect(first.lastError).toMatchObject({ kind: 'unauthorized', terminal: true })

    const second = await gateway.connect('thijs')
    expect(second).not.toBe(first)
    expect(FakeWebSocket.instances).toHaveLength(2)
    gateway.disconnectAll()
  })
})

describe('sessions.transcript', () => {
  it('sends profile, limit, offset and order explicitly and returns the normalized rows', async () => {
    const { gateway, urls } = gatewayWith({
      '/api/sessions/20260914_1/messages': {
        status: 200,
        body: {
          session_id: '20260914_1',
          profile: 'default',
          messages: [
            { id: 1, role: 'user', content: 'hi', timestamp: 1 },
            { id: 2, role: 'assistant', content: 'hello', timestamp: 2 }
          ],
          pagination: { limit: 50, offset: 0, order: 'latest', returned: 2 }
        }
      }
    })
    const page = await gateway.sessions.transcript('20260914_1', { profile: 'default', limit: 50, order: 'latest' })

    expect(urls).toHaveLength(1)
    const requested = new URL(urls[0]!)
    expect(requested.pathname).toBe('/api/sessions/20260914_1/messages')
    expect(requested.searchParams.get('profile')).toBe('default')
    expect(requested.searchParams.get('limit')).toBe('50')
    expect(requested.searchParams.get('offset')).toBe('0')
    expect(requested.searchParams.get('order')).toBe('latest')

    expect(page.sessionId).toBe('20260914_1')
    expect(page.rows).toEqual([
      { id: 1, role: 'user', text: 'hi', content: 'hi', at: 1 },
      { id: 2, role: 'assistant', text: 'hello', content: 'hello', at: 2 }
    ])
    expect(page.page).toEqual({ limit: 50, offset: 0, returned: 2 })
  })
})

describe('logout', () => {
  it('revokes, then clears the cookie and all three secrets even when the revoke fails', async () => {
    const { gateway, secrets, seen } = gatewayWith({
      '/auth/password-login': { status: 200, body: { ok: true }, headers: { 'set-cookie': 'hermes_session_at=abc; Path=/' } },
      '/api/auth/me': { status: 200, body: { user_id: 'u1' } },
      '/auth/logout': { status: 500, body: { detail: 'offline' } }
    })
    await gateway.login({ mode: 'password', provider: 'basic', username: 'u', password: 'p' })
    await gateway.logout()
    expect(seen).toContain('/auth/logout')
    expect(await storedKeys(secrets)).toEqual([])
    expect(gateway.authMode).toBe('none')
  })
})
