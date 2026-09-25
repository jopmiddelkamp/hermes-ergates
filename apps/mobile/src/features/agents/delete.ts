/**
 * Coordinated bot deletion (docs/10 "More > Delete", docs/11 section 4.1).
 * Refuses the default profile, then cleans up owned routines — pause first so
 * nothing fires mid-delete, remove second so the confirmation copy ("removes
 * the bot, its chat history, routines and workspace") stays true — and finally
 * deletes the profile. Every step is reported so an interruption is visible.
 */

import { userMessage } from '@/gateway/errors'
import type { GatewayPort } from '@/gateway/port'

import { belongsTo, isActive } from '../routines/routines'

export type DeleteStep = 'routines' | 'profile'

export interface DeleteAgentResult {
  profile: string
  steps: Record<DeleteStep, 'done' | 'failed' | 'skipped'>
  /** Owned routines that were paused (the active ones). */
  pausedJobs: string[]
  /** Owned routines that were deleted from the gateway's cron store. */
  removedJobs: string[]
  error?: string
}

export async function deleteAgent(port: GatewayPort, profile: string, isDefault: boolean): Promise<DeleteAgentResult> {
  const steps: DeleteAgentResult['steps'] = { routines: 'skipped', profile: 'skipped' }
  if (isDefault || profile === 'default') {
    return { profile, steps, pausedJobs: [], removedJobs: [], error: 'The default concierge cannot be deleted.' }
  }
  const pausedJobs: string[] = []
  const removedJobs: string[] = []
  try {
    const owned = (await port.routines.list(profile)).filter(j => belongsTo(j, profile))
    for (const job of owned) {
      if (isActive(job)) {
        await port.routines.pause(job.id, profile)
        pausedJobs.push(job.id)
      }
      await port.routines.remove(job.id, profile)
      removedJobs.push(job.id)
    }
    steps.routines = 'done'
  } catch (err) {
    steps.routines = 'failed'
    return { profile, steps, pausedJobs, removedJobs, error: `Could not clean up routines: ${userMessage(err)}` }
  }
  try {
    await port.profiles.remove(profile)
    steps.profile = 'done'
    return { profile, steps, pausedJobs, removedJobs }
  } catch (err) {
    steps.profile = 'failed'
    return { profile, steps, pausedJobs, removedJobs, error: userMessage(err) }
  }
}
