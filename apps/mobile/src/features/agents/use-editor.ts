/**
 * useEditBot: loads the editor base (describe + summary + avatar), stages a
 * draft, saves touched sections independently and reports per-section
 * outcomes (docs/10 "Edit Bot on mobile").
 */

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { userMessage } from '@/gateway/errors'
import type { GatewayPort } from '@/gateway/port'
import type { ConfigureResult } from '@/gateway/types'

import { applyResults, draftFromBase, isDirty, keepFailedSections, planSave, validate, type EditBotBase, type EditBotDraft, type SaveOutcome, type SaveSection, type SectionResult } from './editor'
import { avatarKey, describeKey, rosterKey, toBot, type Bot } from './roster'

export type EditorPhase = 'loading' | 'ready' | 'saving' | 'error'

export interface EditBotController {
  phase: EditorPhase
  draft: EditBotDraft | null
  errors: ReturnType<typeof validate>
  dirty: boolean
  loadError: string | null
  outcome: SaveOutcome | null
  update(patch: Partial<Omit<EditBotDraft, 'base'>>): void
  reload(): Promise<void>
  save(): Promise<SaveOutcome | null>
  /** Resend only the model section after the user confirmed an expensive model. */
  confirmModel(): Promise<SaveOutcome | null>
  discard(): void
}

async function loadBase(port: GatewayPort, profile: string): Promise<EditBotBase> {
  const [list, describe] = await Promise.all([port.profiles.list(), port.profiles.describe(profile)])
  const summary = list.profiles.find(p => p.name === profile)
  if (!summary) {
    throw new Error('This bot no longer exists on the gateway.')
  }
  let avatarDataUrl: string | null = null
  if (summary.has_avatar) {
    try {
      const asset = await port.profiles.getAsset(profile)
      avatarDataUrl = asset.found && asset.data ? asset.data : null
    } catch {
      avatarDataUrl = null
    }
  }
  return { describe, summary, avatarDataUrl }
}

async function runSection(fn: () => Promise<ConfigureResult>): Promise<SectionResult> {
  try {
    return await fn()
  } catch (err) {
    return { error: userMessage(err) }
  }
}

export function useEditBot(port: GatewayPort, connectionId: string, profile: string): EditBotController {
  const client = useQueryClient()
  const [phase, setPhase] = useState<EditorPhase>('loading')
  const [draft, setDraft] = useState<EditBotDraft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)

  const reload = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const base = await loadBase(port, profile)
      setDraft(draftFromBase(base))
      setOutcome(null)
      setPhase('ready')
    } catch (err) {
      setLoadError(userMessage(err))
      setPhase('error')
    }
  }, [port, profile])

  useEffect(() => {
    void reload()
  }, [reload])

  const update = useCallback((patch: Partial<Omit<EditBotDraft, 'base'>>) => {
    setDraft(d => (d ? { ...d, ...patch } : d))
  }, [])

  const invalidate = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: rosterKey(connectionId) }),
      client.invalidateQueries({ queryKey: describeKey(connectionId, profile) }),
      client.invalidateQueries({ queryKey: avatarKey(connectionId, profile) })
    ])
  }, [client, connectionId, profile])

  const executePlan = useCallback(
    async (d: EditBotDraft, sections: Partial<Record<SaveSection, boolean>> = {}, confirmModel = false): Promise<SaveOutcome> => {
      const plan = planSave(d)
      const only = Object.keys(sections).length > 0
      const wanted = (s: SaveSection) => (only ? sections[s] === true : true) && Boolean(plan[s])
      const results: Partial<Record<SaveSection, SectionResult>> = {}
      if (wanted('metadata')) {
        results.metadata = await runSection(() => port.profiles.configure(plan.metadata!))
      }
      if (wanted('text')) {
        results.text = await runSection(() => port.profiles.configure(plan.text!))
      }
      if (wanted('model')) {
        results.model = await runSection(() => port.profiles.configure({ ...plan.model!, ...(confirmModel ? { confirm_expensive_model: true } : {}) }))
      }
      if (wanted('capabilities')) {
        results.capabilities = await runSection(() => port.profiles.configure(plan.capabilities!))
      }
      if (wanted('avatar')) {
        results.avatar = await runSection(async () => {
          await port.profiles.setAsset(d.base.summary.name, plan.avatar!.dataUrl)
          return { ok: true, applied: { avatar: true } }
        })
      }
      return applyResults(plan, results)
    },
    [port]
  )

  const finish = useCallback(
    async (d: EditBotDraft, out: SaveOutcome) => {
      setOutcome(out)
      await invalidate()
      try {
        const fresh = await loadBase(port, profile)
        setDraft(keepFailedSections(d, out, fresh))
      } catch {
        // Keep the current draft; the user can reload.
      }
      setPhase('ready')
    },
    [invalidate, port, profile]
  )

  const save = useCallback(async () => {
    if (!draft || phase === 'saving') {
      return null
    }
    const errors = validate(draft)
    if (Object.keys(errors).length > 0) {
      return null
    }
    setPhase('saving')
    const out = await executePlan(draft)
    await finish(draft, out)
    return out
  }, [draft, phase, executePlan, finish])

  const confirmModel = useCallback(async () => {
    if (!draft || phase === 'saving') {
      return null
    }
    setPhase('saving')
    const out = await executePlan(draft, { model: true }, true)
    await finish(draft, out)
    return out
  }, [draft, phase, executePlan, finish])

  const discard = useCallback(() => {
    setDraft(d => (d ? draftFromBase(d.base) : d))
    setOutcome(null)
  }, [])

  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft])
  const dirty = useMemo(() => (draft ? isDirty(draft) : false), [draft])

  return { phase, draft, errors, dirty, loadError, outcome, update, reload, save, confirmModel, discard }
}

export function botFromDraft(d: EditBotDraft): Bot {
  return toBot(d.base.summary)
}
