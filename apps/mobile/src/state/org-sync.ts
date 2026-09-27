/**
 * Pins and sections shared with Hermes Desktop (docs/05 "Bot metadata
 * compatibility"), as pure functions. Hermes owns which agents are pinned
 * and which section each is in (`BotRow.pinned`, `sectionId`, `sectionName`);
 * this phone owns the pin order, the section list with its order and
 * collapse state, and the row order.
 *
 * - `sharedView` lays both over each other, with the organization outbox on
 *   top: a queued change shows until Hermes has it or refuses it.
 * - `organize` runs one `orgActions` action on that view, keeps the parts
 *   this phone owns, and queues the Hermes fields that changed.
 * - `syncWithHermes` runs on every roster read: it records new agents, the
 *   pin order and sections only Hermes knows, settles the outbox, and runs
 *   the one-time first sync (`firstSyncChanges`).
 */

import { enqueue, pendingValues, settle, type OrgChange } from './org-outbox'
import { byActivityDescending, emptyOrganization, memberSection, orgActions, type BotRow, type Organization, type Section } from './organization'

/** The name of a section Hermes knows only by id (an older client wrote no name). */
export const UNTITLED_SECTION = 'Untitled section'

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * The organization as Home shows it: pinned and section membership from
 * Hermes (a queued change wins), the pins in this phone's order with new
 * ones at the end (latest activity first), and this phone's sections with
 * every section only Hermes knows added at the end.
 */
export function sharedView(org: Organization, rows: BotRow[]): Organization {
  const pending = pendingValues(org.outbox)
  const pinned = new Set<string>()
  const membership: Record<string, string | null> = {}
  const names = new Map<string, string>()
  for (const row of rows) {
    const queued = pending[row.profile]
    if (queued?.pinned ?? row.pinned ?? false) {
      pinned.add(row.profile)
    }
    const section = queued?.section ?? { sectionId: row.sectionId ?? null, sectionName: row.sectionName ?? null }
    if (section.sectionId !== null) {
      membership[row.profile] = section.sectionId
      if (section.sectionName && !names.has(section.sectionId)) {
        names.set(section.sectionId, section.sectionName)
      }
    }
  }
  const ordered = new Set(org.pins)
  const pins = [...org.pins.filter(p => pinned.has(p)), ...byActivityDescending(rows.filter(r => pinned.has(r.profile) && !ordered.has(r.profile))).map(r => r.profile)]
  const known = new Set(org.sections.map(s => s.id))
  let order = org.sections.reduce((next, s) => Math.max(next, s.order + 1), 0)
  const added: Section[] = []
  for (const id of new Set(Object.values(membership))) {
    if (id !== null && !known.has(id)) {
      added.push({ id, name: names.get(id) ?? UNTITLED_SECTION, collapsed: false, order: order++ })
    }
  }
  return { ...org, pins, membership, sections: added.length > 0 ? [...org.sections, ...added] : org.sections }
}

function sectionName(org: Organization, sectionId: string | null): string | null {
  return sectionId === null ? null : (org.sections.find(s => s.id === sectionId)?.name ?? null)
}

/** The Hermes fields an action changed, per agent in `profiles` order: pinned, then section id and name. */
export function sharedChanges(before: Organization, after: Organization, profiles: string[]): OrgChange[] {
  const changes: OrgChange[] = []
  for (const profile of profiles) {
    const pinned = after.pins.includes(profile)
    if (pinned !== before.pins.includes(profile)) {
      changes.push({ profile, field: 'pinned', pinned })
    }
    const was = memberSection(before, profile)
    const now = memberSection(after, profile)
    const name = sectionName(after, now)
    if (was !== now || sectionName(before, was) !== name) {
      changes.push({ profile, field: 'section', sectionId: now, sectionName: name })
    }
  }
  return changes
}

/**
 * Runs one organizing action on the shared view. This phone keeps the pin
 * order, the row order and the section list; the pinned flags and section
 * membership that changed go to the outbox. Returns `org` when the action
 * changes nothing.
 */
export function organize(org: Organization, rows: BotRow[], action: (view: Organization) => Organization, newId: () => string): Organization {
  const view = sharedView(org, rows)
  const next = action(view)
  if (next === view) {
    return org
  }
  const changes = sharedChanges(view, next, rows.map(r => r.profile))
  return { ...org, pins: next.pins, rowOrder: next.rowOrder, sections: next.sections, outbox: enqueue(org.outbox, changes, newId) }
}

/**
 * The writes of the first roster read. On an organization this phone made
 * itself (`install`), only the concierge: pinned once when Hermes has no
 * pinned value for it. On one from before the update, every local pin and
 * section where Hermes has no value yet. A Hermes value is never overwritten.
 */
export function firstSyncChanges(org: Organization, rows: BotRow[]): OrgChange[] {
  if (org.firstSync === 'install') {
    const concierge = rows.find(r => r.isDefault)
    return concierge && concierge.pinned === undefined ? [{ profile: concierge.profile, field: 'pinned', pinned: true }] : []
  }
  if (org.firstSync === 'done') {
    return []
  }
  const changes: OrgChange[] = []
  for (const row of rows) {
    if (row.pinned === undefined && org.pins.includes(row.profile)) {
      changes.push({ profile: row.profile, field: 'pinned', pinned: true })
    }
    const local = memberSection(org, row.profile)
    if (row.sectionId === undefined && local !== null) {
      changes.push({ profile: row.profile, field: 'section', sectionId: local, sectionName: sectionName(org, local) })
    }
  }
  return changes
}

/**
 * On every roster read (`org` is undefined for a connection without an
 * organization yet): runs the first sync once, settles the outbox, records
 * new agents in the row order, and records the pin order and the sections
 * only Hermes knows. Returns `org` when nothing changes.
 */
export function syncWithHermes(org: Organization | undefined, rows: BotRow[], newId: () => string): Organization {
  let next = org ?? emptyOrganization()
  if (next.firstSync !== 'done') {
    next = { ...next, membership: {}, firstSync: 'done', outbox: enqueue(next.outbox, firstSyncChanges(next, rows), newId) }
  }
  const outbox = settle(next.outbox, rows)
  const rowOrder = orgActions.adoptProfiles(next, rows).rowOrder
  const view = sharedView({ ...next, outbox }, rows)
  const pins = sameList(view.pins, next.pins) ? next.pins : view.pins
  const sections = view.sections.length === next.sections.length ? next.sections : view.sections
  if (next === org && outbox === next.outbox && rowOrder === next.rowOrder && pins === next.pins && sections === next.sections) {
    return org
  }
  return { ...next, outbox, rowOrder, pins, sections }
}
