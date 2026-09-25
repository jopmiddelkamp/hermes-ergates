import { describe, expect, it, vi } from 'vitest'

import { createDeviceStore, defaultPrefs, draftKey, waitForHydration, type Connection, type PersistedDeviceState } from './device-store'
import { UNSENT_RETENTION_MS, type OutboxItem } from './outbox'
import type { ProvisioningRun } from './provisioning'
import { MemorySecretStore, createMemoryStorageJson, secretKey } from './persistence'

function newStore() {
  return createDeviceStore(createMemoryStorageJson<PersistedDeviceState>(), new MemorySecretStore())
}

const conn1: Connection = { id: 'c1', label: 'A', baseUrl: 'http://a.example', authMode: 'token', primary: true, createdAt: 1 }
const conn2: Connection = { id: 'c2', label: 'B', baseUrl: 'http://b.example', authMode: 'password', primary: false, createdAt: 2 }

describe('connections', () => {
  it('adds and updates connections', () => {
    const store = newStore()
    store.getState().addConnection(conn1)
    store.getState().updateConnection('c1', { label: 'Renamed', lastProfile: 'linh' })
    expect(store.getState().connections).toEqual([{ ...conn1, label: 'Renamed', lastProfile: 'linh' }])
  })

  it('setPrimaryConnection makes exactly one connection primary', () => {
    const store = newStore()
    store.getState().addConnection(conn1)
    store.getState().addConnection(conn2)
    store.getState().setPrimaryConnection('c2')
    expect(store.getState().connections.find(c => c.id === 'c1')?.primary).toBe(false)
    expect(store.getState().connections.find(c => c.id === 'c2')?.primary).toBe(true)
  })
})

describe('organization actions', () => {
  it('wraps orgActions, scoped per connection id', () => {
    const store = newStore()

    store.getState().createSection('c1', { id: 'prive', name: 'Prive', collapsed: false, order: 0 })
    store.getState().moveToSection('c1', 'linh', 'prive')
    store.getState().pin('c1', 'linh')

    let org = store.getState().organization.c1
    expect(org.sections).toEqual([{ id: 'prive', name: 'Prive', collapsed: false, order: 0 }])
    expect(org.membership.linh).toBe('prive')
    expect(org.pins).toEqual(['linh'])

    store.getState().unpin('c1', 'linh')
    org = store.getState().organization.c1
    expect(org.pins).toEqual([])
    expect(org.membership.linh).toBe('prive')

    store.getState().markUnread('c1', 'kevin')
    expect(store.getState().organization.c1.manualUnread.kevin).toBe(true)
    store.getState().markRead('c1', 'kevin', 500)
    expect(store.getState().organization.c1.manualUnread.kevin).toBeFalsy()
    expect(store.getState().organization.c1.lastOpenedAt.kevin).toBe(500)

    store.getState().toggleCollapsed('c1', 'prive')
    expect(store.getState().organization.c1.sections[0].collapsed).toBe(true)

    store.getState().renameSection('c1', 'prive', 'Private')
    expect(store.getState().organization.c1.sections[0].name).toBe('Private')

    store.getState().removeSection('c1', 'prive')
    expect(store.getState().organization.c1.sections).toEqual([])
    expect(store.getState().organization.c1.membership.linh).toBeNull()
  })

  it('never touches another connection organization', () => {
    const store = newStore()
    store.getState().pin('c1', 'linh')
    expect(store.getState().organization.c2).toBeUndefined()
  })
})

describe('drafts', () => {
  it('keys drafts by connectionId:profile and leaves others alone', () => {
    const store = newStore()
    store.getState().setDraft('c1', 'linh', 'hello')
    store.getState().setDraft('c1', 'kevin', 'hi')
    expect(store.getState().drafts[draftKey('c1', 'linh')]).toBe('hello')
    expect(store.getState().drafts[draftKey('c1', 'kevin')]).toBe('hi')

    store.getState().clearDraft('c1', 'linh')
    expect(store.getState().drafts[draftKey('c1', 'linh')]).toBeUndefined()
    expect(store.getState().drafts[draftKey('c1', 'kevin')]).toBe('hi')
  })
})

describe('removeConnection', () => {
  it('clears that connection organization, drafts, outbox and secure entries, keeping prefs and other connections', async () => {
    const secrets = new MemorySecretStore()
    await secrets.set(secretKey('c1', 'token'), 'tok')
    await secrets.set(secretKey('c1', 'cookie'), 'ck')
    await secrets.set(secretKey('c1', 'mode'), 'token')

    const store = createDeviceStore(createMemoryStorageJson<PersistedDeviceState>(), secrets)
    store.getState().addConnection(conn1)
    store.getState().addConnection(conn2)
    store.getState().pin('c1', 'linh')
    store.getState().setDraft('c1', 'linh', 'hi')
    store.getState().setDraft('c2', 'kevin', 'yo')
    store.getState().addOutboxItem({ localId: 'l1', connectionId: 'c1', profile: 'linh', text: 'x', createdAt: Date.now(), status: 'draft' })
    store.getState().addOutboxItem({ localId: 'l2', connectionId: 'c2', profile: 'kevin', text: 'y', createdAt: Date.now(), status: 'draft' })
    store.getState().setPrefs({ haptics: false })

    await store.getState().removeConnection('c1')

    const state = store.getState()
    expect(state.connections.map(c => c.id)).toEqual(['c2'])
    expect(state.organization.c1).toBeUndefined()
    expect(state.drafts[draftKey('c1', 'linh')]).toBeUndefined()
    expect(state.drafts[draftKey('c2', 'kevin')]).toBe('yo')
    expect(state.outbox.map(o => o.localId)).toEqual(['l2'])
    expect(state.prefs.haptics).toBe(false)

    expect(await secrets.get(secretKey('c1', 'token'))).toBeNull()
    expect(await secrets.get(secretKey('c1', 'cookie'))).toBeNull()
    expect(await secrets.get(secretKey('c1', 'mode'))).toBeNull()
  })
})

describe('persistence', () => {
  it('shares state across store instances backed by the same storage', async () => {
    const storage = createMemoryStorageJson<PersistedDeviceState>()
    const secrets = new MemorySecretStore()

    const store1 = createDeviceStore(storage, secrets)
    await waitForHydration(store1)
    store1.getState().addConnection(conn1)
    store1.getState().pin('c1', 'linh')
    store1.getState().setDraft('c1', 'linh', 'hello')
    store1.getState().setPrefs({ themeName: 'dark' })

    const store2 = createDeviceStore(storage, secrets)
    await waitForHydration(store2)
    const state2 = store2.getState()

    expect(state2.connections).toEqual([conn1])
    expect(state2.organization.c1.pins).toEqual(['linh'])
    expect(state2.drafts[draftKey('c1', 'linh')]).toBe('hello')
    expect(state2.prefs.themeName).toBe('dark')
  })

  it('recovers submitting outbox items as unconfirmed and drops expired ones on rehydrate', async () => {
    const storage = createMemoryStorageJson<PersistedDeviceState>()
    const secrets = new MemorySecretStore()
    const now = Date.now()

    const submitting: OutboxItem = { localId: 'l1', connectionId: 'c1', profile: 'linh', text: 'hi', createdAt: now, status: 'submitting' }
    const expiredUnsent: OutboxItem = { localId: 'l2', connectionId: 'c1', profile: 'linh', text: 'old', createdAt: now - UNSENT_RETENTION_MS - 1000, status: 'queued_unsent' }
    const freshDraft: OutboxItem = { localId: 'l3', connectionId: 'c1', profile: 'linh', text: 'draft', createdAt: now, status: 'draft' }

    const seeded: PersistedDeviceState = {
      connections: [],
      organization: {},
      prefs: defaultPrefs,
      drafts: {},
      outbox: [submitting, expiredUnsent, freshDraft],
      provisioning: []
    }
    await storage.setItem('ergates-device-v1', { state: seeded, version: 0 })

    const store = createDeviceStore(storage, secrets)
    await waitForHydration(store)

    const outbox = store.getState().outbox
    expect(outbox.find(i => i.localId === 'l1')?.status).toBe('unconfirmed')
    expect(outbox.find(i => i.localId === 'l2')).toBeUndefined()
    expect(outbox.find(i => i.localId === 'l3')?.status).toBe('draft')
  })
})

describe('exchange acknowledgements (spec 12.1, ADR-028)', () => {
  it('stores identities per connection and profile and round-trips through storage', async () => {
    const storage = createMemoryStorageJson<PersistedDeviceState>()
    const a = createDeviceStore(storage, new MemorySecretStore())
    a.getState().acknowledgeExchanges('c1', 'kevin', ['send:call_1', 'answer:31'])
    a.getState().acknowledgeExchanges('c1', 'kevin', ['answer:31', 'return:proc_1'])
    expect(a.getState().organization.c1.exchangeAcks).toEqual({ kevin: ['send:call_1', 'answer:31', 'return:proc_1'] })
    await new Promise(resolve => setTimeout(resolve, 0))

    const b = createDeviceStore(storage, new MemorySecretStore())
    await waitForHydration(b)
    expect(b.getState().organization.c1.exchangeAcks).toEqual({ kevin: ['send:call_1', 'answer:31', 'return:proc_1'] })
  })

  it('hydrates a persisted organization that predates the field with an empty acknowledgement map', async () => {
    const storage = createMemoryStorageJson<PersistedDeviceState>()
    await storage.setItem('ergates-device-v1', {
      state: {
        connections: [conn1],
        organization: { c1: { pins: ['kevin'], sections: [], membership: {}, manualUnread: {}, lastOpenedAt: {} } as never },
        prefs: defaultPrefs,
        drafts: {},
        outbox: [],
        provisioning: []
      },
      version: 1
    })
    const store = createDeviceStore(storage, new MemorySecretStore())
    await waitForHydration(store)
    expect(store.getState().organization.c1.exchangeAcks).toEqual({})
    expect(store.getState().organization.c1.pins).toEqual(['kevin'])
  })

  it('clears acknowledgements with the rest of the connection state on removal', async () => {
    const store = newStore()
    store.getState().addConnection(conn1)
    store.getState().acknowledgeExchanges('c1', 'kevin', ['send:call_1'])
    await store.getState().removeConnection('c1')
    expect(store.getState().organization.c1).toBeUndefined()
  })
})

describe('agent setup runs (docs/11 section 4.1)', () => {
  const run = (proposalId: string, connectionId = 'c1'): ProvisioningRun => ({
    proposalId,
    connectionId,
    sourceProfile: 'concierge',
    proposal: { proposal_id: proposalId, briefing: 'Seed facts.' },
    startedAt: 1
  })

  it('keeps an accepted agent setup across a restart until it is removed', async () => {
    const storage = createMemoryStorageJson<PersistedDeviceState>()
    const a = createDeviceStore(storage, new MemorySecretStore())
    await waitForHydration(a)
    a.getState().saveProvisioningRun(run('p-1'))
    a.getState().saveProvisioningRun({ ...run('p-1'), startedAt: 2 })

    const b = createDeviceStore(storage, new MemorySecretStore())
    await waitForHydration(b)
    expect(b.getState().provisioning).toEqual([{ ...run('p-1'), startedAt: 2 }])

    b.getState().removeProvisioningRun('p-1')
    expect(b.getState().provisioning).toEqual([])
  })

  it('reads a blob from before agent setups as having none', async () => {
    const storage = createMemoryStorageJson<PersistedDeviceState>()
    await storage.setItem('ergates-device-v1', { state: { connections: [conn1], organization: {}, prefs: defaultPrefs, drafts: {}, outbox: [] } as never, version: 1 })
    const store = createDeviceStore(storage, new MemorySecretStore())
    await waitForHydration(store)
    expect(store.getState().provisioning).toEqual([])
  })

  it('drops a connection agent setups with the connection', async () => {
    const store = newStore()
    store.getState().addConnection(conn1)
    store.getState().saveProvisioningRun(run('p-1', 'c1'))
    store.getState().saveProvisioningRun(run('p-2', 'c2'))
    await store.getState().removeConnection('c1')
    expect(store.getState().provisioning.map(r => r.proposalId)).toEqual(['p-2'])
  })
})

describe('default useDeviceStore', () => {
  it('is importable in Node with sane defaults and never touches AsyncStorage on import', async () => {
    vi.resetModules()
    const AsyncStorageModule = await import('@react-native-async-storage/async-storage')
    const getItemSpy = vi.spyOn(AsyncStorageModule.default, 'getItem')
    const setItemSpy = vi.spyOn(AsyncStorageModule.default, 'setItem')

    const mod = await import('./device-store')

    expect(mod.useDeviceStore.getState().connections).toEqual([])
    expect(mod.useDeviceStore.getState().prefs).toEqual(mod.defaultPrefs)
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })
})
