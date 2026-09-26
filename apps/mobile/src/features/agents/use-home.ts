/**
 * Home view model: roster (Hermes-owned) + organization (device-owned)
 * combined into the pinned area, ungrouped rows and sections (FR-13D).
 */

import { useMemo } from 'react'

import type { GatewayPort } from '@/gateway/port'
import { deriveHome, emptyOrganization, isUnread, type BotRow, type Organization, type Section } from '@/state/organization'
import { useDeviceStore } from '@/state/device-store'

import { useRoster, type Bot } from './roster'

export interface HomeSection {
  section: Section
  rows: Bot[]
}

export interface HomeModel {
  bots: Bot[]
  /** The roster as the organization sees it; a new array only when the roster changes. */
  rows: BotRow[]
  byProfile: Map<string, Bot>
  pinned: Bot[]
  ungrouped: Bot[]
  sections: HomeSection[]
  hidden: Bot[]
  organization: Organization
  unread(profile: string): boolean
  isPinned(profile: string): boolean
  sectionOf(profile: string): Section | null
  loading: boolean
  error: unknown
  refetch(): Promise<unknown>
}

const EMPTY_ORG: Organization = emptyOrganization()

export function useHome(port: GatewayPort, connectionId: string): HomeModel {
  const roster = useRoster(port, connectionId)
  const organization = useDeviceStore(s => s.organization[connectionId]) ?? EMPTY_ORG
  const rows = useMemo(
    () => (roster.data ?? []).map(b => ({ profile: b.profile, hidden: b.hidden, lastActivityAt: b.lastActivityAt, isDefault: b.isDefault })),
    [roster.data]
  )
  return useMemo(() => {
    const bots = roster.data ?? []
    const byProfile = new Map(bots.map(b => [b.profile, b]))
    const layout = deriveHome(rows, organization)
    const pick = (profiles: string[]) => profiles.map(p => byProfile.get(p)).filter((b): b is Bot => Boolean(b))
    return {
      bots,
      rows,
      byProfile,
      pinned: pick(layout.pinned),
      ungrouped: pick(layout.ungrouped),
      sections: layout.sections.map(s => ({ section: s.section, rows: pick(s.rows) })),
      hidden: bots.filter(b => b.hidden),
      organization,
      unread: profile => {
        const bot = byProfile.get(profile)
        return bot ? isUnread(organization, profile, bot.lastActivityAt) : false
      },
      isPinned: profile => organization.pins.includes(profile),
      sectionOf: profile => {
        const id = organization.membership[profile]
        return id ? organization.sections.find(s => s.id === id) ?? null : null
      },
      loading: roster.isLoading,
      error: roster.error,
      refetch: roster.refetch
    }
  }, [roster.data, rows, roster.isLoading, roster.error, roster.refetch, organization])
}
