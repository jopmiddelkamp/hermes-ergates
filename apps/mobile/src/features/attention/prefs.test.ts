/**
 * The notification settings form (docs/11 section 4.2): mute and quiet hours,
 * checked as the server checks them (`AttentionService.set_prefs` in
 * `ergates/attention.py`) so
 * Save never sends what the server would refuse.
 */
import { describe, expect, it } from 'vitest'

import { draftFromPrefs, normalizeClock, prefsFromDraft, scopeLabel } from './prefs'

describe('normalizeClock', () => {
  it('reads HH:MM and H:MM, and refuses anything past 23:59', () => {
    expect(normalizeClock('22:00')).toBe('22:00')
    expect(normalizeClock(' 7:05 ')).toBe('07:05')
    expect(normalizeClock('24:00')).toBeNull()
    expect(normalizeClock('07:60')).toBeNull()
    expect(normalizeClock('7pm')).toBeNull()
    expect(normalizeClock('')).toBeNull()
  })
})

describe('the prefs form', () => {
  it('starts from the server prefs, with an evening default when there are no quiet hours', () => {
    expect(draftFromPrefs({ profile: 'thijs', muted: false, quiet_start: null, quiet_end: null })).toEqual({ muted: false, quiet: false, start: '22:00', end: '07:00' })
    expect(draftFromPrefs({ profile: 'thijs', muted: true, quiet_start: '23:30', quiet_end: '06:00' })).toEqual({ muted: true, quiet: true, start: '23:30', end: '06:00' })
  })

  it('saves both quiet times or neither', () => {
    expect(prefsFromDraft('thijs', { muted: false, quiet: false, start: 'junk', end: '' })).toEqual({ prefs: { profile: 'thijs', muted: false, quiet_start: null, quiet_end: null } })
    expect(prefsFromDraft('*', { muted: true, quiet: true, start: '22:00', end: '7:00' })).toEqual({ prefs: { profile: '*', muted: true, quiet_start: '22:00', quiet_end: '07:00' } })
  })

  it('refuses a time the server would refuse, with the reason', () => {
    expect(prefsFromDraft('thijs', { muted: false, quiet: true, start: '25:00', end: '07:00' })).toEqual({ error: 'Use HH:MM, from 00:00 to 23:59.' })
    expect(prefsFromDraft('thijs', { muted: false, quiet: true, start: '07:00', end: '7:00' })).toEqual({ error: 'Quiet hours need a different start and end.' })
  })

  it('names the scope of the settings', () => {
    expect(scopeLabel('*')).toBe('All agents')
    expect(scopeLabel('thijs')).toBe('thijs')
  })
})
