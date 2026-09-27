import { describe, expect, it } from 'vitest'

import { GatewayError } from '@/gateway/errors'
import type { ProfileSummary } from '@/gateway/types'
import { enqueue, type OrgChange, type OrgOutboxItem } from '@/state/org-outbox'
import { FakeGateway } from '@test/fake-gateway/fake-gateway'

import { flushOrgOutbox, oneAtATime, readyToFlush, refusedMessage } from './org-sender'

function ids() {
  let n = 0
  return () => `o${++n}`
}

/** The outbox as the device store keeps it, and the roster as Home last read it. */
async function harness(gateway: FakeGateway, changes: OrgChange[]) {
  let outbox: OrgOutboxItem[] = enqueue([], changes, ids())
  const roster = new Map<string, ProfileSummary>((await gateway.profiles.list()).profiles.map(p => [p.name, p]))
  const deps = {
    profiles: gateway.profiles,
    summaryOf: (profile: string) => roster.get(profile),
    outbox: { list: () => outbox, update: (fn: (list: OrgOutboxItem[]) => OrgOutboxItem[]) => (outbox = fn(outbox)) }
  }
  return { deps, outbox: () => outbox }
}

async function hermesBots(gateway: FakeGateway, name: string) {
  const profile = (await gateway.profiles.list()).profiles.find(p => p.name === name)
  return { meta: profile?.ui_meta?.['hermes-bots'], revision: profile?.ui_meta_revisions?.['hermes-bots'] }
}

const pinKevin: OrgChange = { profile: 'kevin', field: 'pinned', pinned: true }

describe('sending the organization outbox', () => {
  it('writes the agent current metadata with only the changed field replaced, unknown fields kept, and the revision it read', async () => {
    const gateway = new FakeGateway()
    gateway.desktopWrite('kevin', { groups: ['clients'] })
    const { deps, outbox } = await harness(gateway, [pinKevin])

    expect(await flushOrgOutbox(deps)).toEqual({ sent: 1, refused: [], waiting: false })
    expect(gateway.configureCalls).toEqual([
      {
        name: 'kevin',
        ui_meta: { 'hermes-bots': { shape: 'circle', color: '#4a84fe', imageKind: 'initials', title: 'Kevin', custom: true, hidden: false, pinned: true, groups: ['clients'] } },
        ui_meta_expected_revisions: { 'hermes-bots': 3 }
      }
    ])
    expect(outbox()).toEqual([{ id: 'o1', ...pinKevin, status: 'sent', revision: 4 }])
    expect((await gateway.profiles.list()).profiles.find(p => p.name === 'kevin')?.ui_meta?.ergates).toEqual({ role: 'Trainer' })
  })

  it('writes a section as its id and name, and No section as null for both', async () => {
    const gateway = new FakeGateway()
    const { deps } = await harness(gateway, [
      { profile: 'thijs', field: 'section', sectionId: 'sec-1', sectionName: 'Clients' },
      { profile: 'default', field: 'section', sectionId: null, sectionName: null }
    ])
    await flushOrgOutbox(deps)
    expect((await hermesBots(gateway, 'thijs')).meta).toMatchObject({ title: 'Thijs', sectionId: 'sec-1', sectionName: 'Clients' })
    expect((await hermesBots(gateway, 'default')).meta).toMatchObject({ title: 'Linh', pinned: true, sectionId: null, sectionName: null })
    expect(gateway.configureCalls.map(call => call.name)).toEqual(['thijs', 'default'])
  })

  it('writes the next change of the same agent on top of its own last write, without a conflict', async () => {
    const gateway = new FakeGateway()
    const { deps } = await harness(gateway, [pinKevin, { profile: 'kevin', field: 'section', sectionId: 'sec-1', sectionName: 'Clients' }])
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 2, refused: [], waiting: false })
    expect(gateway.configureCalls.map(call => call.ui_meta_expected_revisions)).toEqual([{ 'hermes-bots': 2 }, { 'hermes-bots': 3 }])
    expect(await hermesBots(gateway, 'kevin')).toMatchObject({ meta: { pinned: true, sectionId: 'sec-1', sectionName: 'Clients' }, revision: 4 })
  })

  it('after a conflict, reads the agent again and applies the same change once more', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    gateway.desktopWrite('kevin', { color: '#000000' })

    expect(await flushOrgOutbox(deps)).toEqual({ sent: 1, refused: [], waiting: false })
    expect(gateway.configureCalls.map(call => call.ui_meta_expected_revisions)).toEqual([{ 'hermes-bots': 2 }, { 'hermes-bots': 3 }])
    expect(await hermesBots(gateway, 'kevin')).toMatchObject({ meta: { color: '#000000', pinned: true }, revision: 4 })
    expect(outbox()[0]).toMatchObject({ status: 'sent', revision: 4 })
  })

  it('sends a newer change the owner made while the first was on the wire after it, so the newer value stays', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    const next = ids()
    gateway.beforeConfigure = () => {
      gateway.beforeConfigure = null
      deps.outbox.update(list => enqueue(list, [{ profile: 'kevin', field: 'pinned', pinned: false }], () => `later-${next()}`))
    }
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 2, refused: [], waiting: false })
    expect(gateway.configureCalls.map(call => call.ui_meta?.['hermes-bots']?.pinned)).toEqual([true, false])
    expect(await hermesBots(gateway, 'kevin')).toMatchObject({ meta: { pinned: false }, revision: 4 })
    expect(outbox()).toEqual([{ id: 'later-o1', profile: 'kevin', field: 'pinned', pinned: false, status: 'sent', revision: 4 }])
  })

  it('refuses a change after a second conflict and takes it out, so the agent shows what Hermes has', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin, { profile: 'thijs', field: 'pinned', pinned: true }])
    gateway.beforeConfigure = params => {
      if (params.name === 'kevin') {
        gateway.desktopWrite('kevin', { pinned: false })
      }
    }
    const result = await flushOrgOutbox(deps)
    expect(result.refused.map(item => item.profile)).toEqual(['kevin'])
    expect(result.sent).toBe(1)
    expect(outbox().map(item => [item.profile, item.status])).toEqual([['thijs', 'sent']])
    expect((await hermesBots(gateway, 'kevin')).meta?.pinned).toBe(false)
    expect(gateway.configureCalls.filter(call => call.name === 'kevin')).toHaveLength(2)
  })

  it('drops a change without an alert when a conflict re-read no longer finds the agent', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    gateway.beforeConfigure = params => {
      if (params.name === 'kevin') {
        gateway.desktopWrite('kevin', { pinned: false })
        void gateway.profiles.remove('kevin')
      }
    }
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: false })
    expect(outbox()).toEqual([])
    expect(gateway.configureCalls).toHaveLength(1)
  })

  it('drops a change without an alert when Hermes deletes the agent after the roster was read', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    await gateway.profiles.remove('kevin')
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: false })
    expect(outbox()).toEqual([])
    expect(gateway.configureCalls).toEqual([])
  })

  it.each([
    ['timeout', new GatewayError('timeout', 'The gateway did not answer in time.')],
    ['busy', new GatewayError('busy', 'The assistant is busy with another turn.')],
    ['rate_limited', new GatewayError('rate_limited', 'Too many attempts. Wait a moment and try again.')]
  ])('keeps a change queued when the gateway answers %s', async (_, error) => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    gateway.beforeConfigure = () => {
      throw error
    }
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: true })
    expect(outbox()).toEqual([{ id: 'o1', ...pinKevin, status: 'queued' }])
  })

  it.each([502, 503, 504])('keeps a change queued when a reverse proxy answers %i while Hermes restarts', async status => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    gateway.beforeConfigure = () => {
      throw new GatewayError('unknown', 'The gateway had an internal problem.', { status })
    }
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: true })
    expect(outbox()).toEqual([{ id: 'o1', ...pinKevin, status: 'queued' }])
  })

  it('keeps a change queued when the connection is lost, stops, and sends it on the next flush', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin, { profile: 'thijs', field: 'pinned', pinned: true }])
    gateway.profilesOffline = true
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: true })
    expect(outbox().map(item => item.status)).toEqual(['queued', 'queued'])

    gateway.profilesOffline = false
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 2, refused: [], waiting: false })
    expect(gateway.configureCalls.map(call => call.name)).toEqual(['kevin', 'thijs'])
  })

  it('keeps a change queued when sign-in has expired, and leaves the outbox untouched', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    gateway.beforeConfigure = () => {
      throw new GatewayError('unauthorized', 'Sign-in required.')
    }
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: true })
    expect(outbox()).toEqual([{ id: 'o1', ...pinKevin, status: 'queued' }])
  })

  it('refuses a change Hermes answers with an error that is not about the connection', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [pinKevin])
    gateway.beforeConfigure = () => {
      throw new GatewayError('rpc', 'ui_meta is too large')
    }
    expect((await flushOrgOutbox(deps)).refused).toMatchObject([pinKevin])
    expect(outbox()).toEqual([])
  })

  it('drops a change for an agent the roster no longer has, without naming it', async () => {
    const gateway = new FakeGateway()
    const { deps, outbox } = await harness(gateway, [{ profile: 'gone', field: 'pinned', pinned: true }])
    expect(await flushOrgOutbox(deps)).toEqual({ sent: 0, refused: [], waiting: false })
    expect(outbox()).toEqual([])
    expect(gateway.configureCalls).toEqual([])
  })
})

describe('when Home flushes', () => {
  it('waits for the first roster read after a start, so no queued change is mistaken for one whose agent is gone', () => {
    expect(readyToFlush(true, 0)).toBe(false)
    expect(readyToFlush(true, 1_700_000_000_000)).toBe(true)
    expect(readyToFlush(false, 1_700_000_000_000)).toBe(false)
  })
})

describe('one flush at a time', () => {
  it('runs a second request after the first instead of beside it, and only once for several requests', async () => {
    const order: string[] = []
    let release: () => void = () => undefined
    let runs = 0
    const flush = oneAtATime(async () => {
      runs++
      order.push(`start ${runs}`)
      if (runs === 1) {
        await new Promise<void>(resolve => (release = resolve))
      }
      order.push(`end ${runs}`)
    })
    const first = flush()
    void flush()
    void flush()
    release()
    await first
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
  })
})

describe('the refusal alert', () => {
  const names: Record<string, string> = { linh: 'Linh', kevin: 'Kevin', mia: 'Mia' }
  const nameOf = (profile: string) => names[profile] ?? profile

  it('names every agent once, with the action when all refusals share it', () => {
    expect(
      refusedMessage(
        [
          { profile: 'linh', field: 'section', sectionId: 'prive', sectionName: 'Prive' },
          { profile: 'kevin', field: 'section', sectionId: 'prive', sectionName: 'Prive' }
        ],
        nameOf
      )
    ).toBe('Could not move 2 agents: Linh and Kevin. They show what Hermes has.')
    expect(refusedMessage([pinKevin], nameOf)).toBe('Could not pin 1 agent: Kevin. It shows what Hermes has.')
    expect(refusedMessage([{ profile: 'mia', field: 'pinned', pinned: false }], nameOf)).toBe('Could not unpin 1 agent: Mia. It shows what Hermes has.')
  })

  it('says change for mixed actions', () => {
    expect(refusedMessage([pinKevin, { profile: 'kevin', field: 'section', sectionId: null, sectionName: null }, { profile: 'linh', field: 'pinned', pinned: true }], nameOf)).toBe(
      'Could not change 2 agents: Kevin and Linh. They show what Hermes has.'
    )
  })
})
