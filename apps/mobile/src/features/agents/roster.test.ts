import { describe, expect, it } from 'vitest'

import type { ProfileSummary, ProfilesListResult } from '@/gateway/types'
import profilesList from '@test/fixtures/profiles-list.json'

import { toBot } from './roster'

const recorded = (profilesList as ProfilesListResult).profiles

function withMeta(meta: Record<string, unknown> | undefined, revision?: number): ProfileSummary {
  return { name: 'mia', is_default: false, ...(meta ? { ui_meta: { 'hermes-bots': meta } } : {}), ...(revision === undefined ? {} : { ui_meta_revisions: { 'hermes-bots': revision } }) }
}

describe('reading pins and sections from Hermes metadata', () => {
  it('reads pinned and the metadata revision from a recorded roster', () => {
    expect(recorded.map(toBot).map(bot => [bot.profile, bot.pinned, bot.revision])).toEqual([
      ['default', true, 7],
      ['kevin', false, 2],
      ['thijs', false, 1]
    ])
  })

  it('reads the section id and name, and a null or empty section as No section', () => {
    expect(toBot(withMeta({ sectionId: 'sec-1', sectionName: ' Clients ' }, 4))).toMatchObject({ sectionId: 'sec-1', sectionName: 'Clients', revision: 4 })
    expect(toBot(withMeta({ sectionId: null, sectionName: null }))).toMatchObject({ sectionId: null, sectionName: null })
    expect(toBot(withMeta({ sectionId: '', sectionName: 7 }))).toMatchObject({ sectionId: null, sectionName: null })
  })

  it('tells a missing value apart from a set one, so the first sync writes only where Hermes has none', () => {
    const bot = toBot(withMeta(undefined))
    expect(bot.pinned).toBeUndefined()
    expect(bot.sectionId).toBeUndefined()
    expect(bot.sectionName).toBeUndefined()
    expect(bot.revision).toBe(0)
    expect(toBot(withMeta({ pinned: 'yes' })).pinned).toBeUndefined()
  })
})
