/**
 * Routines = Hermes cron jobs scoped to a profile (docs/02 section 3.6).
 * Pure helpers plus TanStack Query hooks over the gateway port.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'

import type { GatewayPort } from '@/gateway/port'
import type { CronJob, CronRun } from '@/gateway/types'

import { ReminderAttempts } from './reminders'

export const routinePrefix = (profile: string) => `[bot:${profile}] `
const TAG_RE = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i
/**
 * The tag the Ergates reminder route appends to a job name:
 * `[bot:<profile>] <label> · <8 hex>` (integrations/ergates/ergates/reminders.py
 * `routine_name`). The server finds an uncertain create's job by that name.
 */
const REMINDER_TAG_RE = / · [0-9a-f]{8}$/

/** The reminder label the server accepts (its `LABEL_MAX_LEN`). */
export const ROUTINE_NAME_MAX_LEN = 64

export function displayName(job: CronJob, profile: string): string {
  const name = (job.name ?? '').trim().replace(REMINDER_TAG_RE, '')
  const stripped = name.startsWith(routinePrefix(profile)) ? name.slice(routinePrefix(profile).length) : name.replace(TAG_RE, '')
  return stripped.trim() || 'Untitled routine'
}

/** The job name for a renamed routine. A reminder keeps its tag, so the server can still find its job. */
export function routineName(profile: string, title: string, job: CronJob | null): string {
  const tag = REMINDER_TAG_RE.exec(job?.name ?? '')?.[0] ?? ''
  return `${routinePrefix(profile)}${title.trim()}${tag}`
}

export function belongsTo(job: CronJob, profile: string): boolean {
  if (job.profile && job.profile === profile) {
    return true
  }
  const m = TAG_RE.exec(job.name ?? '')
  if (m) {
    return m[1]?.toLowerCase() === profile.toLowerCase()
  }
  return !job.profile && profile === 'default'
}

export function isActive(job: CronJob): boolean {
  return job.enabled !== false && !job.paused
}

/** One-shots that already ran and have no next run are hidden (FR-172). */
export function isFinishedOneShot(job: CronJob): boolean {
  const repeat = job.repeat as { times?: number | null } | number | string | undefined
  const oneShot = typeof repeat === 'object' && repeat !== null ? repeat.times === 1 : repeat === 1 || repeat === '1' || job.state === 'completed'
  return Boolean(oneShot && job.last_run && !job.next_run) || job.state === 'completed'
}

export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function nextRunLabel(job: CronJob, now: Date, tz: string, locale = 'en-US'): string {
  if (!isActive(job)) {
    return 'Paused'
  }
  const next = toDate(job.next_run)
  if (!next) {
    return 'No next run'
  }
  const diffMs = next.getTime() - now.getTime()
  const sameDay = next.toLocaleDateString(locale, { timeZone: tz }) === now.toLocaleDateString(locale, { timeZone: tz })
  const time = next.toLocaleTimeString(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  if (diffMs < 0) {
    return `Due (${time})`
  }
  if (sameDay) {
    return `Today ${time}`
  }
  const day = next.toLocaleDateString(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} ${time}`
}

export interface RoutineDraft {
  title: string
  instruction: string
  schedule: string
}

export function validateRoutine(d: RoutineDraft): Partial<Record<keyof RoutineDraft, string>> {
  const errors: Partial<Record<keyof RoutineDraft, string>> = {}
  if (!d.title.trim()) {
    errors.title = 'Give the routine a name.'
  } else if (d.title.trim().length > ROUTINE_NAME_MAX_LEN) {
    errors.title = `Keep the name to ${ROUTINE_NAME_MAX_LEN} characters.`
  }
  if (!d.instruction.trim()) {
    errors.instruction = 'Say what the assistant should do.'
  }
  if (!d.schedule.trim()) {
    errors.schedule = 'Set a schedule, for example "every day at 09:00" or "0 9 * * 1".'
  }
  return errors
}

export const routinesKey = (connectionId: string, profile: string) => ['routines', connectionId, profile] as const

export function useRoutines(port: GatewayPort, connectionId: string, profile: string) {
  return useQuery({
    queryKey: routinesKey(connectionId, profile),
    queryFn: async () => (await port.routines.list(profile)).filter(j => belongsTo(j, profile)),
    staleTime: 8_000,
    refetchInterval: 20_000
  })
}

export function useRoutineRuns(port: GatewayPort, connectionId: string, profile: string, jobId: string | null) {
  return useQuery({
    queryKey: [...routinesKey(connectionId, profile), 'runs', jobId] as const,
    queryFn: async (): Promise<CronRun[]> => (jobId ? port.routines.runs(jobId, profile) : []),
    enabled: Boolean(jobId)
  })
}

/**
 * Creates a routine through the Ergates reminder route (docs/11 section 4.3).
 * One `ReminderAttempts` per form: saving the same routine again reuses its
 * request id. Never retried automatically.
 */
export function useCreateReminder(port: GatewayPort, connectionId: string, profile: string) {
  const client = useQueryClient()
  const attempts = useRef<ReminderAttempts | null>(null)
  return useMutation({
    mutationFn: ({ draft, timezone }: { draft: RoutineDraft; timezone: string }) => {
      attempts.current ??= new ReminderAttempts()
      return port.ergates.createReminder(attempts.current.requestFor(profile, draft, timezone))
    },
    retry: 0,
    onSettled: () => client.invalidateQueries({ queryKey: routinesKey(connectionId, profile) })
  })
}

export function useRoutineMutations(port: GatewayPort, connectionId: string, profile: string) {
  const client = useQueryClient()
  const invalidate = () => client.invalidateQueries({ queryKey: routinesKey(connectionId, profile) })
  const update = useMutation({
    mutationFn: ({ job, d }: { job: CronJob; d: RoutineDraft }) =>
      port.routines.update(job.id, { name: routineName(profile, d.title, job), schedule: d.schedule.trim(), prompt: d.instruction.trim() }, profile),
    onSettled: invalidate
  })
  const pause = useMutation({ mutationFn: (id: string) => port.routines.pause(id, profile), onSettled: invalidate })
  const resume = useMutation({ mutationFn: (id: string) => port.routines.resume(id, profile), onSettled: invalidate })
  const trigger = useMutation({ mutationFn: (id: string) => port.routines.trigger(id, profile), onSettled: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => port.routines.remove(id, profile), onSettled: invalidate })
  return { update, pause, resume, trigger, remove, invalidate }
}
