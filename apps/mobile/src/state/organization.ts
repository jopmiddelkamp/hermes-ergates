/**
 * Home roster organization: pins, sections and reading state (docs/05 section 3,
 * docs/10 "Home sections and pinned members").
 *
 * Pure, device-local logic — no React/RN imports, no persistence. Never mixes in
 * Hermes-owned bot metadata (hidden/title/etc); callers pass that in via `BotRow`.
 *
 * Independence rules this module enforces:
 * - Pin state (`pins`) and section membership (`membership`) are separate fields;
 *   every action here touches at most one of them.
 * - Pinning/unpinning never rewrites `membership`. Moving sections never rewrites `pins`.
 * - A section stays in `sections` (and so keeps its header) until `removeSection`
 *   is called, even if every member is pinned or the section is empty.
 */

export interface Section {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface Organization {
  pins: string[]
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
}

export interface HomeLayout {
  /** Insertion order (docs/10: "pins keep insertion order"), never sorted by activity. */
  pinned: string[]
  /** Unpinned, unassigned rows, most recently active first. */
  ungrouped: string[]
  /** One entry per known section, in `order`, even when its `rows` is empty. */
  sections: { section: Section; rows: string[] }[]
}

function byActivityDescending(rows: BotRow[]): BotRow[] {
  return [...rows].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

/** Builds the Home layout from live bot rows and this connection's organization. */
export function deriveHome(rows: BotRow[], org: Organization): HomeLayout {
  const visible = rows.filter(r => !r.hidden)
  const visibleProfiles = new Set(visible.map(r => r.profile))

  // A pin only shows in the pinned area while its bot has a visible row.
  const pinned = org.pins.filter(p => visibleProfiles.has(p))
  const pinnedSet = new Set(pinned)

  const unpinnedVisible = visible.filter(r => !pinnedSet.has(r.profile))

  // Absorb bad stored data here rather than validating in the setters: membership
  // naming a section that no longer exists renders as ungrouped, so a bot can never
  // vanish from Home (it would otherwise be excluded from `ungrouped` because its
  // membership is non-null, and from every section because none matches).
  const knownSections = new Set(org.sections.map(s => s.id))
  const sectionOf = (profile: string): string | null => {
    const id = org.membership[profile] ?? null
    return id !== null && knownSections.has(id) ? id : null
  }

  const ungrouped = byActivityDescending(unpinnedVisible.filter(r => sectionOf(r.profile) === null)).map(r => r.profile)

  const sections = [...org.sections]
    .sort((a, b) => a.order - b.order)
    .map(section => ({
      section,
      rows: byActivityDescending(unpinnedVisible.filter(r => sectionOf(r.profile) === section.id)).map(r => r.profile)
    }))

  return { pinned, ungrouped, sections }
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

  moveToSection(org: Organization, profile: string, sectionId: string | null): Organization {
    return { ...org, membership: { ...org.membership, [profile]: sectionId } }
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
