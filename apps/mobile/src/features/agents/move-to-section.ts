/**
 * The Move to Section page's rules (docs/10 "Bot actions"): which rows it
 * offers and checks, the route parameter that carries the agents, and the
 * new section it creates. Pure, so Node tests cover it.
 */

import { memberSection, type Organization, type Section } from '@/state/organization'

export interface SectionChoice {
  /** `null` is "No section". */
  id: string | null
  name: string
  /** Every given agent is already here. */
  checked: boolean
}

/** Profile names are `^[a-z0-9][a-z0-9_-]{0,63}$` (Hermes), so a comma never occurs inside one. */
export function profilesParam(profiles: string[]): string {
  return profiles.join(',')
}

export function parseProfiles(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  const profiles = text.split(',').map(p => p.trim()).filter(Boolean)
  return profiles.filter((p, i) => profiles.indexOf(p) === i)
}

/** No section first, then every section in its order; a check mark only where every given agent already is. */
export function sectionChoices(org: Organization, profiles: string[]): SectionChoice[] {
  const allIn = (id: string | null) => profiles.length > 0 && profiles.every(p => memberSection(org, p) === id)
  return [
    { id: null, name: 'No section', checked: allIn(null) },
    ...[...org.sections].sort((a, b) => a.order - b.order).map(s => ({ id: s.id, name: s.name, checked: allIn(s.id) }))
  ]
}

/** Where each profile sits, keyed by profile: `null` is "No section". */
export type MembershipSnapshot = Record<string, string | null>

/**
 * Captures where the given profiles sit, so a later call to `membershipChanged`
 * can tell whether Move to Section actually moved one of them. Backing out of
 * the page without picking anything is not a move, so the Home selection this
 * pairs with should survive that (docs/10 "Home edit mode": the selection
 * clears only after an action).
 */
export function membershipSnapshot(org: Organization, profiles: string[]): MembershipSnapshot {
  const snapshot: MembershipSnapshot = {}
  for (const profile of profiles) {
    snapshot[profile] = memberSection(org, profile)
  }
  return snapshot
}

/** Whether any profile in `before` now sits in a different section (or no section) than it did. */
export function membershipChanged(before: MembershipSnapshot, org: Organization): boolean {
  return Object.entries(before).some(([profile, sectionId]) => memberSection(org, profile) !== sectionId)
}

export function canCreateSection(name: string): boolean {
  return name.trim().length > 0
}

/** A new, expanded section after the last one. */
export function newSection(sections: Section[], name: string): Section {
  return {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    collapsed: false,
    order: sections.reduce((next, s) => Math.max(next, s.order + 1), 0)
  }
}
