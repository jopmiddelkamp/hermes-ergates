import { describe, expect, it } from 'vitest'

import type { CronJob } from '@/gateway/types'
import jobs from '@test/fixtures/cron-jobs.json'

import { belongsTo, displayName, isFinishedOneShot, nextRunLabel, routineName, validateRoutine } from './routines'

const job = (jobs as CronJob[])[0]!

describe('routine helpers', () => {
  it('strips the bot prefix for display', () => {
    expect(displayName(job, 'kevin')).toBe('Weekly check-in')
    expect(displayName({ ...job, name: '[bot:other] X' }, 'kevin')).toBe('X')
    expect(displayName({ ...job, name: '' }, 'kevin')).toBe('Untitled routine')
  })
  it('strips the reminder tag the server adds to a job name', () => {
    // integrations/ergates/ergates/reminders.py `routine_name`: `[bot:<profile>] <label> · <8 hex>`.
    expect(displayName({ ...job, name: '[bot:kevin] Invoices · 1a2b3c4d' }, 'kevin')).toBe('Invoices')
    expect(displayName({ ...job, name: '[bot:kevin] reminder · 0f9e8d7c' }, 'kevin')).toBe('reminder')
    expect(displayName({ ...job, name: '[bot:kevin] Tea · Coffee' }, 'kevin')).toBe('Tea · Coffee')
  })
  it('keeps the reminder tag when a routine is renamed', () => {
    expect(routineName('kevin', ' Leg day ', { ...job, name: '[bot:kevin] Invoices · 1a2b3c4d' })).toBe('[bot:kevin] Leg day · 1a2b3c4d')
    expect(routineName('kevin', 'Leg day', { ...job, name: '[bot:kevin] Weekly check-in' })).toBe('[bot:kevin] Leg day')
  })
  it('scopes jobs by profile field or name tag', () => {
    expect(belongsTo(job, 'kevin')).toBe(true)
    expect(belongsTo({ ...job, profile: undefined }, 'kevin')).toBe(true)
    expect(belongsTo({ ...job, profile: undefined, name: '[bot:linh] X' }, 'kevin')).toBe(false)
    expect(belongsTo({ id: 'j', name: 'Plain', schedule: '* * * * *' }, 'default')).toBe(true)
  })
  it('labels the next run in the given timezone', () => {
    const now = new Date('2026-09-14T06:00:00Z')
    // The fixture's next run is 2026-09-15T09:00+02:00, a Tuesday. Assert the
    // weekday/date prefix and the time so the en-US formatting path is really
    // checked, and read the same instant in a second zone.
    const label = nextRunLabel(job, now, 'Europe/Amsterdam')
    expect(label).toMatch(/^Tue, Sep 15\b/)
    expect(label).toContain('09:00')
    expect(nextRunLabel(job, now, 'America/New_York')).toMatch(/^Tue, Sep 15\b.*03:00/)
    expect(nextRunLabel({ ...job, paused: true }, now, 'Europe/Amsterdam')).toBe('Paused')
    expect(nextRunLabel({ ...job, next_run: null }, now, 'Europe/Amsterdam')).toBe('No next run')
    expect(nextRunLabel({ ...job, next_run: '2026-09-14T09:00:00+02:00' }, now, 'Europe/Amsterdam')).toMatch(/^Today/)
  })
  it('hides finished one-shots', () => {
    expect(isFinishedOneShot(job)).toBe(false)
    expect(isFinishedOneShot({ ...job, repeat: { times: 1 }, last_run: '2026-09-10T09:00:00Z', next_run: null })).toBe(true)
    expect(isFinishedOneShot({ ...job, state: 'completed' })).toBe(true)
  })
  it('validates a routine, with a name that fits the reminder label', () => {
    expect(validateRoutine({ title: '', instruction: '', schedule: '' })).toEqual({ title: expect.any(String), instruction: expect.any(String), schedule: expect.any(String) })
    expect(validateRoutine({ title: 'x'.repeat(65), instruction: 'Remind me', schedule: '0 9 * * *' })).toEqual({ title: 'Keep the name to 64 characters.' })
    expect(validateRoutine({ title: 'x'.repeat(64), instruction: 'Remind me', schedule: '0 9 * * *' })).toEqual({})
  })
})
