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

/** Profile names are `[a-z0-9-]` (`PROFILE_NAME_RE`), so a comma never occurs inside one. */
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
