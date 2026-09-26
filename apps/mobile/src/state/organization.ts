/**
 * Home roster organization: pins, sections, the manual row order and reading
 * state (docs/05 section 3, docs/10 "Home sections and pinned members").
 *
 * Pure, device-local logic — no React/RN imports, no persistence. Never mixes in
 * Hermes-owned bot metadata (hidden/title/etc); callers pass that in via `BotRow`.
 *
 * Independence rules this module enforces:
 * - Pin state (`pins`) and section membership (`membership`) are separate fields;
 *   every action here except `forget` touches at most one of them. `forget` clears
 *   both because the profile itself is gone.
 * - Pinning/unpinning never rewrites `membership`. Moving sections never rewrites `pins`.
 * - A section stays in `sections` (and so keeps its header) until `removeSection`
 *   is called, even if every member is pinned or the section is empty.
 * - Rows move only when the owner moves them: `rowOrder` is one manual order for
 *   the whole connection, and activity never reorders it.
 */

export interface Section {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Organization {
  pins: string[]
  /**
   * One manual order of profile names for the whole connection. A group (no
   * section, or one section) shows its rows in the order they appear here.
   * Hidden profiles keep their place; names of deleted profiles are ignored.
   */
  rowOrder: string[]
  sections: Section[]
  /** profile -> section id, or null when ungrouped. Absent profiles are also ungrouped. */
  membership: Record<string, string | null>
  manualUnread: Record<string, boolean>
  /** profile -> last time the user opened that conversation (reading watermark). */
  lastOpenedAt: Record<string, number>
  /**
   * profile -> acknowledged exchange activity identities (spec 12.1). Device-local, no cap, never
   * evicted: an acknowledged identity must never turn back into new activity.
   */
  exchangeAcks: Record<string, string[]>
}

export interface BotRow {
  profile: string
  hidden: boolean
  lastActivityAt: number
  /** The Hermes concierge: while it is pinned it is always the first pin. */
  isDefault?: boolean
}

export interface HomeLayout {
  /** Pin order, with a pinned concierge always first. Never sorted by activity. */
  pinned: string[]
  /** Unpinned rows without a section, in the manual order. */
  ungrouped: string[]
  /** One entry per known section, in `order`, even when its `rows` is empty. */
  sections: { section: Section; rows: string[] }[]
}

/**
 * One step of the manual order: a row placed into a group, a pin or a section
 * moved. `before` names the item it lands in front of; `null` means the end.
 */
export type OrderMove =
  | { kind: 'row'; profile: string; sectionId: string | null; before: string | null }
  | { kind: 'pin'; profile: string; before: string | null }
  | { kind: 'section'; sectionId: string; before: string | null }

export function emptyOrganization(): Organization {
  return { pins: [], rowOrder: [], sections: [], membership: {}, manualUnread: {}, lastOpenedAt: {}, exchangeAcks: {} }
}

function byActivityDescending(rows: BotRow[]): BotRow[] {
  return [...rows].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

/**
 * The profile's section id, or null. Membership naming a section that no longer
 * exists counts as no section, so a bot can never vanish from Home.
 */
export function memberSection(org: Organization, profile: string): string | null {
  const id = org.membership[profile] ?? null
  return id !== null && org.sections.some(s => s.id === id) ? id : null
}

/**
 * Rows the manual order does not know yet come first, latest activity first;
 * the rest follow `rowOrder`.
 */
function inRowOrder(rows: BotRow[], org: Organization): string[] {
  const position = new Map(org.rowOrder.map((profile, index) => [profile, index]))
  const fresh = byActivityDescending(rows.filter(r => !position.has(r.profile)))
  const known = rows.filter(r => position.has(r.profile)).sort((a, b) => (position.get(a.profile) ?? 0) - (position.get(b.profile) ?? 0))
  return [...fresh, ...known].map(r => r.profile)
}

/** Builds the Home layout from live bot rows and this connection's organization. */
export function deriveHome(rows: BotRow[], org: Organization): HomeLayout {
  const visible = rows.filter(r => !r.hidden)
  const visibleProfiles = new Set(visible.map(r => r.profile))

  // A pin only shows in the pinned area while its bot has a visible row.
  const visiblePins = org.pins.filter(p => visibleProfiles.has(p))
  const concierge = visible.find(r => r.isDefault)?.profile
  const pinned = concierge && visiblePins.includes(concierge) ? [concierge, ...visiblePins.filter(p => p !== concierge)] : visiblePins
  const pinnedSet = new Set(pinned)

  const unpinnedVisible = visible.filter(r => !pinnedSet.has(r.profile))

  const ungrouped = inRowOrder(unpinnedVisible.filter(r => memberSection(org, r.profile) === null), org)

  const sections = [...org.sections]
    .sort((a, b) => a.order - b.order)
    .map(section => ({
      section,
      rows: inRowOrder(unpinnedVisible.filter(r => memberSection(org, r.profile) === section.id), org)
    }))

  return { pinned, ungrouped, sections }
}

/** `list` with `item` taken out and put back in front of `before`; at the end when `before` is null or not in the list. */
function placeBefore<T>(list: T[], item: T, keyOf: (value: T) => string, before: string | null): T[] {
  const key = keyOf(item)
  const rest = list.filter(value => keyOf(value) !== key)
  const at = before === null ? -1 : rest.findIndex(value => keyOf(value) === before)
  return at === -1 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)]
}

const same = (value: string) => value

/** True when both lists name the same items in the same order (a move that landed back where it started). */
function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function withoutSection(org: Organization, sectionId: string): Organization {
  const membership = { ...org.membership }
  for (const profile of Object.keys(membership)) {
    if (membership[profile] === sectionId) {
      membership[profile] = null
    }
  }
  return { ...org, membership }
}

export const orgActions = {
  pin(org: Organization, profile: string): Organization {
    if (org.pins.includes(profile)) {
      return org
    }
    return { ...org, pins: [...org.pins, profile] }
  },

  unpin(org: Organization, profile: string): Organization {
    if (!org.pins.includes(profile)) {
      return org
    }
    return { ...org, pins: org.pins.filter(p => p !== profile) }
  },

  /** Appends the ones not pinned yet, in the given order. */
  pinMany(org: Organization, profiles: string[]): Organization {
    const added = profiles.filter((p, i) => !org.pins.includes(p) && profiles.indexOf(p) === i)
    return added.length === 0 ? org : { ...org, pins: [...org.pins, ...added] }
  },

  unpinMany(org: Organization, profiles: string[]): Organization {
    const removed = new Set(profiles)
    return org.pins.some(p => removed.has(p)) ? { ...org, pins: org.pins.filter(p => !removed.has(p)) } : org
  },

  moveToSection(org: Organization, profile: string, sectionId: string | null): Organization {
    return { ...org, membership: { ...org.membership, [profile]: sectionId } }
  },

  /**
   * Moves the profiles into a section (or no section, `null`) at the end of that
   * group, keeping their relative order. Profiles already there keep their place.
   */
  moveRowsToSection(org: Organization, profiles: string[], sectionId: string | null): Organization {
    const moving = new Set(profiles.filter(p => memberSection(org, p) !== sectionId))
    if (moving.size === 0) {
      return org
    }
    const known = org.rowOrder.filter(p => moving.has(p))
    const unknown = [...moving].filter(p => !org.rowOrder.includes(p))
    const membership = { ...org.membership }
    for (const profile of moving) {
      membership[profile] = sectionId
    }
    return { ...org, rowOrder: [...org.rowOrder.filter(p => !moving.has(p)), ...known, ...unknown], membership }
  },

  /** Puts one row into a group (a section, or no section) in front of `before`, or at the group's end. */
  placeRow(org: Organization, profile: string, sectionId: string | null, before: string | null): Organization {
    if (before === profile) {
      return org
    }
    const rowOrder = placeBefore(org.rowOrder, profile, same, before)
    const sameSection = (org.membership[profile] ?? null) === sectionId
    if (sameSection && sameOrder(rowOrder, org.rowOrder)) {
      return org
    }
    return { ...org, rowOrder, membership: sameSection ? org.membership : { ...org.membership, [profile]: sectionId } }
  },

  movePin(org: Organization, profile: string, before: string | null): Organization {
    if (!org.pins.includes(profile) || before === profile) {
      return org
    }
    const pins = placeBefore(org.pins, profile, same, before)
    return sameOrder(pins, org.pins) ? org : { ...org, pins }
  },

  moveSection(org: Organization, sectionId: string, before: string | null): Organization {
    const sorted = [...org.sections].sort((a, b) => a.order - b.order)
    const moving = sorted.find(s => s.id === sectionId)
    if (!moving || before === sectionId) {
      return org
    }
    const sections = placeBefore(sorted, moving, s => s.id, before).map((s, order) => ({ ...s, order }))
    const unchanged = sections.length === sorted.length && sections.every((s, i) => s.id === sorted[i].id && s.order === sorted[i].order)
    return unchanged ? org : { ...org, sections }
  },

  applyMove(org: Organization, move: OrderMove): Organization {
    switch (move.kind) {
      case 'row':
        return orgActions.placeRow(org, move.profile, move.sectionId, move.before)
      case 'pin':
        return orgActions.movePin(org, move.profile, move.before)
      case 'section':
        return orgActions.moveSection(org, move.sectionId, move.before)
    }
  },

  /**
   * Records every profile the manual order does not know yet at its front,
   * latest activity first: where it already shows, so it never moves by itself.
   */
  adoptProfiles(org: Organization, rows: BotRow[]): Organization {
    const known = new Set(org.rowOrder)
    const fresh = byActivityDescending(rows.filter(r => !known.has(r.profile))).map(r => r.profile)
    return fresh.length === 0 ? org : { ...org, rowOrder: [...fresh, ...org.rowOrder] }
  },

  /** Device-local leftovers of a deleted profile, so a new profile with the same name starts clean, at the top. */
  forget(org: Organization, profile: string, now: number): Organization {
    const membership = { ...org.membership }
    delete membership[profile]
    const manualUnread = { ...org.manualUnread }
    delete manualUnread[profile]
    return {
      ...org,
      pins: org.pins.filter(p => p !== profile),
      rowOrder: org.rowOrder.filter(p => p !== profile),
      membership,
      manualUnread,
      lastOpenedAt: { ...org.lastOpenedAt, [profile]: now }
    }
  },

  createSection(org: Organization, section: Section): Organization {
    if (org.sections.some(s => s.id === section.id)) {
      return org
    }
    return { ...org, sections: [...org.sections, section] }
  },

  renameSection(org: Organization, sectionId: string, name: string): Organization {
    return { ...org, sections: org.sections.map(s => (s.id === sectionId ? { ...s, name } : s)) }
  },

  removeSection(org: Organization, sectionId: string): Organization {
    const cleared = withoutSection(org, sectionId)
    return { ...cleared, sections: cleared.sections.filter(s => s.id !== sectionId) }
  },

  /**
   * Deletes a section: its members move to the end of No section in their
   * manual order, the section and its collapse state go, and pins stay.
   */
  deleteSection(org: Organization, sectionId: string): Organization {
    if (!org.sections.some(s => s.id === sectionId)) {
      return org
    }
    const members = Object.keys(org.membership).filter(profile => memberSection(org, profile) === sectionId)
    return orgActions.removeSection(orgActions.moveRowsToSection(org, members, null), sectionId)
  },

  toggleCollapsed(org: Organization, sectionId: string): Organization {
    return { ...org, sections: org.sections.map(s => (s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s)) }
  },

  markUnread(org: Organization, profile: string): Organization {
    return { ...org, manualUnread: { ...org.manualUnread, [profile]: true } }
  },

  markRead(org: Organization, profile: string, now: number): Organization {
    const manualUnread = { ...org.manualUnread }
    delete manualUnread[profile]
    return { ...org, manualUnread, lastOpenedAt: { ...org.lastOpenedAt, [profile]: now } }
  },

  markManyUnread(org: Organization, profiles: string[]): Organization {
    return profiles.every(p => org.manualUnread[p]) ? org : profiles.reduce(orgActions.markUnread, org)
  },

  /**
   * A read only changes the watermark; when every named profile already has no
   * manual flag and is already read at exactly `now`, nothing would change.
   */
  markManyRead(org: Organization, profiles: string[], now: number): Organization {
    const alreadyRead = profiles.every(p => !org.manualUnread[p] && org.lastOpenedAt[p] === now)
    return alreadyRead ? org : profiles.reduce((next, profile) => orgActions.markRead(next, profile, now), org)
  },

  /** Opening the read-only screen or revealing older entries acknowledged exactly these identities (spec 12.1). */
  acknowledgeExchanges(org: Organization, profile: string, identities: string[]): Organization {
    const current = org.exchangeAcks[profile] ?? []
    const known = new Set(current)
    const added = identities.filter(id => !known.has(id) && (known.add(id), true))
    if (added.length === 0) {
      return org
    }
    return { ...org, exchangeAcks: { ...org.exchangeAcks, [profile]: [...current, ...added] } }
  }
}

/** Manual flag OR a new agent message since the reading watermark. */
export function isUnread(org: Organization, profile: string, lastAgentMessageAt: number): boolean {
  if (org.manualUnread[profile]) {
    return true
  }
  const lastOpened = org.lastOpenedAt[profile] ?? 0
  return lastAgentMessageAt > lastOpened
}
