/**
 * The fake gateway must fail the way the real client fails, or a scenario can
 * pass against a behavior the app never meets.
 */
import { describe, expect, it } from 'vitest'

import { FakeGateway, type FakeConnection } from './fake-gateway'

describe('FakeGateway', () => {
  it('rejects a request on a closed socket at once, as the vendored client does', async () => {
    // vendor/hermes/shared/json-rpc-gateway.ts `request`: a socket that is not
    // OPEN rejects before anything is sent; the adapter maps that to `network`.
    const gateway = new FakeGateway()
    const conn = (await gateway.connect('thijs')) as FakeConnection
    conn.simulateOffline()

    await expect(conn.request('prompt.submit', { session_id: 's1', text: 'hello' })).rejects.toMatchObject({ name: 'GatewayError', kind: 'network' })
    expect(conn.submitCalls).toBe(0)
    expect(conn.methods()).toEqual([])

    conn.simulateOnline()
    await expect(conn.request('prompt.submit', { session_id: 's1', text: 'hello' })).resolves.toEqual({ status: 'streaming' })
    expect(conn.submitCalls).toBe(1)
  })
})
