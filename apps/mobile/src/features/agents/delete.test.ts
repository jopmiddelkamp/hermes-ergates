import { describe, expect, it, vi } from 'vitest'

import type { GatewayPort } from '@/gateway/port'
import type { CronJob } from '@/gateway/types'

import { deleteAgent } from './delete'

const jobs: CronJob[] = [
  { id: 'j-active', name: '[bot:kevin] Weekly check-in', schedule: '0 9 * * 1', profile: 'kevin' },
  { id: 'j-paused', name: '[bot:kevin] Old briefing', schedule: '0 7 * * *', profile: 'kevin', paused: true },
  { id: 'j-other', name: '[bot:linh] Not mine', schedule: '0 8 * * *', profile: 'linh' }
]

function port(over: { list?: () => Promise<CronJob[]>; pause?: () => Promise<void>; remove?: () => Promise<void>; profileRemove?: () => Promise<unknown> } = {}) {
  const calls: string[] = []
  const p = {
    routines: {
      list: vi.fn(over.list ?? (async () => jobs)),
      pause: vi.fn(async (id: string) => {
        calls.push(`pause:${id}`)
        await (over.pause?.() ?? Promise.resolve())
      }),
      remove: vi.fn(async (id: string) => {
        calls.push(`remove:${id}`)
        await (over.remove?.() ?? Promise.resolve())
      })
    },
    profiles: {
      remove: vi.fn(async () => {
        calls.push('profile')
        return over.profileRemove ? over.profileRemove() : { ok: true }
      })
    }
  }
  return { port: p as unknown as GatewayPort, calls, spy: p }
}

describe('deleteAgent', () => {
  it('refuses the default concierge and touches nothing', async () => {
    const { port: p, spy } = port()
    const result = await deleteAgent(p, 'default', true)
    expect(result).toEqual({
      profile: 'default',
      steps: { routines: 'skipped', profile: 'skipped' },
      pausedJobs: [],
      removedJobs: [],
      error: 'The default concierge cannot be deleted.'
    })
    expect(spy.routines.list).not.toHaveBeenCalled()
    expect(spy.profiles.remove).not.toHaveBeenCalled()
  })

  it('pauses then removes every owned routine before deleting the profile', async () => {
    const { port: p, calls } = port()
    const result = await deleteAgent(p, 'kevin', false)
    // Pause first so nothing fires mid-delete, remove second so the
    // confirmation copy ("removes its routines") is true (I11). An
    // already-paused routine is only removed.
    expect(calls).toEqual(['pause:j-active', 'remove:j-active', 'remove:j-paused', 'profile'])
    expect(result).toEqual({
      profile: 'kevin',
      steps: { routines: 'done', profile: 'done' },
      pausedJobs: ['j-active'],
      removedJobs: ['j-active', 'j-paused']
    })
  })

  it('stops at the routine step and reports what it got through', async () => {
    const { port: p, spy } = port({ remove: async () => { throw new Error('cron store locked') } })
    const result = await deleteAgent(p, 'kevin', false)
    expect(result.steps).toEqual({ routines: 'failed', profile: 'skipped' })
    expect(result.pausedJobs).toEqual(['j-active'])
    expect(result.removedJobs).toEqual([])
    expect(result.error).toBe('Could not clean up routines: cron store locked')
    expect(spy.profiles.remove).not.toHaveBeenCalled()
  })

  it('reports a failed profile delete with the routines it already cleaned up', async () => {
    const { port: p } = port({ profileRemove: async () => { throw new Error('profile busy') } })
    const result = await deleteAgent(p, 'kevin', false)
    expect(result.steps).toEqual({ routines: 'done', profile: 'failed' })
    expect(result.removedJobs).toEqual(['j-active', 'j-paused'])
    expect(result.error).toBe('profile busy')
  })
})
