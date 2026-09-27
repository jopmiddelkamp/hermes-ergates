import { describe, expect, it } from 'vitest'

import { createDeviceStore, type PersistedDeviceState } from '@/state/device-store'
import { sharedView } from '@/state/org-sync'
import { deriveHome, emptyOrganization, memberSection, type BotRow, type Organization } from '@/state/organization'
import { MemorySecretStore, createMemoryStorageJson } from '@/state/persistence'
import { FakeGateway } from '@test/fake-gateway/fake-gateway'

import { crossDrop, withSectionGhosts, type CrossSlot } from './drop-rules'
import { buildEditItems, listItems, pinnedItems } from './edit-mode'
import { flushOrgOutbox } from './org-sender'
import { connectionOrganizer, createOrganizer, type OrganizeAction } from './organizer'
import { summaryOfRoster, toBot, type Bot } from './roster'

/** Runs every action on one view, as the device store runs it on the shared view. */
function harness() {
  let view: Organization = {
    ...emptyOrganization(),
    pins: ['linh'],
    rowOrder: ['linh', 'kevin', 'mia'],
    sections: [{ id: 'prive', name: 'Prive', collapsed: false, order: 0 }],
    membership: { mia: 'prive' }
  }
  const organizer = createOrganizer((action: OrganizeAction) => {
    view = action(view)
  })
  return { organizer, view: () => view }
}

describe('the organizer', () => {
  it('pins and unpins several agents', () => {
    const { organizer, view } = harness()
    organizer.pin(['kevin', 'mia'])
    expect(view().pins).toEqual(['linh', 'kevin', 'mia'])
    organizer.unpin(['linh', 'mia'])
    expect(view().pins).toEqual(['kevin'])
  })

  it('moves agents to a section or No section, and into a new section after the last one', () => {
    const { organizer, view } = harness()
    organizer.moveToSection(['kevin'], 'prive')
    expect(memberSection(view(), 'kevin')).toBe('prive')
    organizer.moveToSection(['mia', 'kevin'], null)
    expect(view().membership).toEqual({ mia: null, kevin: null })
    organizer.createSectionWith(['linh', 'mia'], ' Clients ')
    const created = view().sections[1]
    expect(created).toMatchObject({ name: 'Clients', collapsed: false, order: 1 })
    expect([memberSection(view(), 'linh'), memberSection(view(), 'mia')]).toEqual([created.id, created.id])
  })

  it('renames and deletes a section, and applies a drop or a Move up', () => {
    const { organizer, view } = harness()
    organizer.renameSection('prive', 'Private')
    expect(view().sections[0].name).toBe('Private')
    organizer.applyMove({ kind: 'row', profile: 'mia', sectionId: null, before: 'linh' })
    expect(view().rowOrder).toEqual(['mia', 'linh', 'kevin'])
    expect(memberSection(view(), 'mia')).toBeNull()
    organizer.deleteSection('prive')
    expect(view().sections).toEqual([])
  })
})

/**
 * Home as it runs against a gateway: the roster, the device store, the
 * organizer Home builds (`useOrganizer`), and the outbox sender (`useOrgSync`).
 */
async function liveHome() {
  const gateway = new FakeGateway()
  let n = 0
  const store = createDeviceStore(createMemoryStorageJson<PersistedDeviceState>(), new MemorySecretStore(), { newId: () => `o${++n}` })
  const connectionId = 'c1'
  let bots: Bot[] = []
  let rows: BotRow[] = []
  const read = async () => {
    bots = (await gateway.profiles.list()).profiles.map(toBot)
    // As `useHome` maps the roster.
    rows = bots.map(b => ({ profile: b.profile, hidden: b.hidden, lastActivityAt: b.lastActivityAt, isDefault: b.isDefault, pinned: b.pinned, sectionId: b.sectionId, sectionName: b.sectionName, revision: b.revision }))
    store.getState().syncWithHermes(connectionId, rows)
  }
  await read()
  /** The Home list's pins and rows as the screen shows them. */
  const shown = () => {
    const layout = deriveHome(rows, sharedView(store.getState().organization[connectionId] ?? emptyOrganization(), rows))
    const pick = (profiles: string[]) => profiles.map(p => bots.find(b => b.profile === p)!)
    const items = buildEditItems({ pinned: pick(layout.pinned), ungrouped: pick(layout.ungrouped), sections: layout.sections.map(s => ({ section: s.section, rows: pick(s.rows) })) })
    return { pins: pinnedItems(items), list: withSectionGhosts(listItems(items)) }
  }
  /** A drag that ended with the finger over the other area at `slot`, handled the way the drag lists' `onDragEnd` hands it to Home's `onMove`. */
  const drop = (key: string, slot: CrossSlot) => {
    const { pins, list } = shown()
    const ended = crossDrop(key, key, slot, pins, list)
    if (ended?.move) {
      connectionOrganizer(store.getState().organize, connectionId, rows).applyMove(ended.move)
    }
    return ended
  }
  const outbox = () => store.getState().organization[connectionId]?.outbox ?? []
  const flush = () =>
    flushOrgOutbox({
      profiles: gateway.profiles,
      summaryOf: profile => summaryOfRoster(bots, profile),
      outbox: { list: outbox, update: fn => store.getState().updateOrgOutbox(connectionId, fn) }
    })
  const hermes = async (profile: string) => (await gateway.profiles.list()).profiles.find(p => p.name === profile)?.ui_meta?.['hermes-bots']
  return { drop, outbox, flush, read, shown, hermes, desktop: gateway.desktopWrite.bind(gateway) }
}

describe('a drag between the pinned area and the list, from the drop to Hermes', () => {
  it('pins a row dropped over the pinned area in Hermes too, not only on the phone', async () => {
    const home = await liveHome()
    expect(home.shown().pins.map(p => p.key)).toEqual(['pinned:default'])

    expect(home.drop('row:kevin', { area: 'pinned', index: 0, x: 0, y: 0 })).toEqual({ over: true, move: { kind: 'pinAt', profile: 'kevin', before: 'default' } })
    expect(home.outbox().map(item => [item.profile, item.field, item.field === 'pinned' && item.pinned, item.status])).toEqual([['kevin', 'pinned', true, 'queued']])
    expect(home.shown().pins.map(p => p.key)).toEqual(['pinned:kevin', 'pinned:default'])

    expect(await home.flush()).toEqual({ sent: 1, refused: [], waiting: false })
    expect(await home.hermes('kevin')).toMatchObject({ pinned: true })
    await home.read()
    expect(home.outbox()).toEqual([])
    expect(home.shown().pins.map(p => p.key)).toEqual(['pinned:kevin', 'pinned:default'])
  })

  it('unpins a pin dropped over the list in Hermes, and moves it into the section it landed in', async () => {
    const home = await liveHome()
    home.desktop('kevin', { sectionId: 'sec-1', sectionName: 'Clients' })
    await home.read()
    expect(home.shown().list.map(item => item.key)).toEqual(['section:sec-1', 'row:kevin'])

    // The default pin dropped under Kevin: the end of Clients.
    expect(home.drop('pinned:default', { area: 'rows', index: 2, y: 112 })).toEqual({ over: true, move: { kind: 'unpinAt', profile: 'default', sectionId: 'sec-1', before: null } })
    expect(home.outbox().map(item => [item.profile, item.field])).toEqual([
      ['default', 'pinned'],
      ['default', 'section']
    ])
    await home.flush()
    expect(await home.hermes('default')).toMatchObject({ pinned: false, sectionId: 'sec-1', sectionName: 'Clients' })
  })

  it('unpins a pin dropped into the group it already has, and writes only pinned', async () => {
    const home = await liveHome()
    expect(home.drop('pinned:default', { area: 'rows', index: 0, y: 0 })).toEqual({ over: true, move: { kind: 'unpinAt', profile: 'default', sectionId: null, before: 'kevin' } })
    expect(home.outbox().map(item => [item.profile, item.field])).toEqual([['default', 'pinned']])
    await home.flush()
    expect(await home.hermes('default')).toMatchObject({ pinned: false })
  })
})
