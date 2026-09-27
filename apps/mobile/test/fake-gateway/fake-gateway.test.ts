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

describe('FakeGateway profile metadata', () => {
  const hermesBots = async (gateway: FakeGateway, name: string) => {
    const profile = (await gateway.profiles.list()).profiles.find(p => p.name === name)
    return { meta: profile?.ui_meta?.['hermes-bots'], revision: profile?.ui_meta_revisions?.['hermes-bots'] }
  }

  it('replaces a ui_meta namespace like profiles.configure, keeps the other namespaces, and counts its revision up', async () => {
    const gateway = new FakeGateway()
    const result = await gateway.profiles.configure({
      name: 'kevin',
      ui_meta: { 'hermes-bots': { title: 'Kevin', pinned: true, sectionId: 'sec-1', sectionName: 'Clients' } },
      ui_meta_expected_revisions: { 'hermes-bots': 2 }
    })
    expect(result).toEqual({ ok: true, applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots': 3 } } })
    expect(await hermesBots(gateway, 'kevin')).toEqual({ meta: { title: 'Kevin', pinned: true, sectionId: 'sec-1', sectionName: 'Clients' }, revision: 3 })
    expect((await gateway.profiles.list()).profiles.find(p => p.name === 'kevin')?.ui_meta?.ergates).toEqual({ role: 'Trainer' })
    expect(gateway.configureCalls.map(call => call.name)).toEqual(['kevin'])
  })

  it('refuses a write that names an old revision, and applies none of it', async () => {
    const gateway = new FakeGateway()
    gateway.desktopWrite('kevin', { pinned: true })
    expect(await hermesBots(gateway, 'kevin')).toMatchObject({ meta: { title: 'Kevin', pinned: true }, revision: 3 })
    const result = await gateway.profiles.configure({ name: 'kevin', ui_meta: { 'hermes-bots': { pinned: false } }, ui_meta_expected_revisions: { 'hermes-bots': 2 } })
    expect(result).toEqual({
      ok: false,
      applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 2, actual: 3 } }, ui_meta_revisions: { 'hermes-bots': 3 } }
    })
    expect(await hermesBots(gateway, 'kevin')).toMatchObject({ meta: { pinned: true }, revision: 3 })
  })

  it('fails profile calls like a lost connection while offline', async () => {
    const gateway = new FakeGateway()
    gateway.profilesOffline = true
    await expect(gateway.profiles.list()).rejects.toMatchObject({ name: 'GatewayError', kind: 'network' })
    await expect(gateway.profiles.configure({ name: 'kevin', ui_meta: {} })).rejects.toMatchObject({ kind: 'network' })
    gateway.profilesOffline = false
    await expect(gateway.profiles.configure({ name: 'nobody', ui_meta: {} })).rejects.toMatchObject({ kind: 'rpc' })
  })
})
