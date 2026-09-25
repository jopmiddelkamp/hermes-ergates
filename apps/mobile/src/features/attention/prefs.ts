/**
 * Notification settings (docs/11 section 4.2): mute, and quiet hours that
 * hold routine pushes until they end. Approval pushes ignore quiet hours. The
 * server stores them per profile, with `*` as the default for every profile,
 * and reads the times in the time zone Hermes is configured for.
 *
 * Pure: the screen renders this; the checks match the server's, so Save never
 * sends what it would refuse.
 */

import type { AttentionPrefs } from '@/gateway/types'

/** What the form edits. The times are kept while quiet hours are off, so switching back restores them. */
export interface PrefsDraft {
  muted: boolean
  quiet: boolean
  start: string
  end: string
}

/** `HH:MM` for a valid `H:MM` or `HH:MM` from 00:00 to 23:59, else null. */
export function normalizeClock(text: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) {
    return null
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return null
  }
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

export function draftFromPrefs(prefs: AttentionPrefs): PrefsDraft {
  return { muted: prefs.muted, quiet: prefs.quiet_start !== null, start: prefs.quiet_start ?? '22:00', end: prefs.quiet_end ?? '07:00' }
}

export function prefsFromDraft(profile: string, draft: PrefsDraft): { prefs: AttentionPrefs } | { error: string } {
  if (!draft.quiet) {
    return { prefs: { profile, muted: draft.muted, quiet_start: null, quiet_end: null } }
  }
  const start = normalizeClock(draft.start)
  const end = normalizeClock(draft.end)
  if (!start || !end) {
    return { error: 'Use HH:MM, from 00:00 to 23:59.' }
  }
  if (start === end) {
    return { error: 'Quiet hours need a different start and end.' }
  }
  return { prefs: { profile, muted: draft.muted, quiet_start: start, quiet_end: end } }
}

export function scopeLabel(profile: string): string {
  return profile === '*' ? 'All agents' : profile
}
