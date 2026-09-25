import { describe, expect, it } from 'vitest'

import type { ProfileDescribe, ProfileSummary } from '@/gateway/types'
import describeFixture from '@test/fixtures/profiles-describe.json'
import profilesList from '@test/fixtures/profiles-list.json'

import { applyResults, draftFromBase, friendlyName, isDirty, keepFailedSections, planSave, validate, type EditBotBase } from './editor'

const summary = (profilesList as { profiles: ProfileSummary[] }).profiles[1]! // kevin: title Kevin, role Trainer, revisions {hermes-bots:2, ergates:1}
const describe_ = describeFixture as unknown as ProfileDescribe
const base: EditBotBase = { describe: { ...describe_, name: 'kevin', model: { provider: 'openai-codex', default: 'gpt-5.6-sol' } }, summary, avatarDataUrl: null }

describe('draft and dirty tracking', () => {
  it('starts clean from the base', () => {
    const d = draftFromBase(base)
    expect(d.name).toBe('Kevin')
    expect(d.role).toBe('Trainer')
    expect(isDirty(d)).toBe(false)
    expect(planSave(d)).toEqual({})
  })
  it('derives friendly names', () => {
    expect(friendlyName({ name: 'default', is_default: true })).toBe('Hermes')
    expect(friendlyName({ name: 'dining-scout', is_default: false })).toBe('Dining Scout')
    expect(friendlyName({ name: 'x', is_default: false, display_name: 'Xavier' })).toBe('Xavier')
  })
})

describe('planSave', () => {
  it('writes the merged hermes-bots namespace with expected revisions on a name change', () => {
    const plan = planSave({ ...draftFromBase(base), name: 'Kev' })
    expect(plan.metadata).toEqual({
      name: 'kevin',
      ui_meta: { 'hermes-bots': { shape: 'circle', color: '#4a84fe', imageKind: 'initials', title: 'Kev', custom: true, hidden: false, pinned: false } },
      ui_meta_expected_revisions: { 'hermes-bots': 2 }
    })
    expect(plan.text).toBeUndefined()
  })
  it('keeps an inherited appearance on a rename and claims it only with an avatar change', () => {
    // `custom: false`/absent means Hermes Desktop derives the appearance; a
    // rename must not freeze it.
    const auto: EditBotBase = {
      ...base,
      summary: { ...summary, ui_meta: { 'hermes-bots': { title: 'Kevin', hidden: false } }, ui_meta_revisions: { 'hermes-bots': 3 } }
    }
    const renamed = planSave({ ...draftFromBase(auto), name: 'Kev' })
    expect(renamed.metadata?.ui_meta?.['hermes-bots']).toEqual({ title: 'Kev', hidden: false })
    const withPhoto = planSave({ ...draftFromBase(auto), name: 'Kev', avatar: { kind: 'set', dataUrl: 'data:image/jpeg;base64,QUJD' } })
    expect(withPhoto.metadata?.ui_meta?.['hermes-bots']).toEqual({ title: 'Kev', hidden: false, custom: true })
  })
  it('writes the ergates role namespace only when the role changed', () => {
    const plan = planSave({ ...draftFromBase(base), role: 'Coach' })
    expect(plan.metadata?.ui_meta?.ergates).toEqual({ role: 'Coach' })
    expect(plan.metadata?.ui_meta_expected_revisions).toEqual({ 'hermes-bots': 2, ergates: 1 })
    const cleared = planSave({ ...draftFromBase(base), role: '' })
    expect(cleared.metadata?.ui_meta?.ergates).toEqual({})
  })
  it('sends only touched text fields', () => {
    const plan = planSave({ ...draftFromBase(base), soul: 'New soul' })
    expect(plan.text).toEqual({ name: 'kevin', soul: 'New soul' })
  })
  it('sends provider and model together', () => {
    const plan = planSave({ ...draftFromBase(base), provider: 'anthropic', model: 'claude-sonnet-5' })
    expect(plan.model).toEqual({ name: 'kevin', provider: 'anthropic', model: 'claude-sonnet-5' })
  })
  it('never sends enabled_toolsets when untouched and clears the pin when all are on', () => {
    const d = draftFromBase(base)
    const skills = planSave({ ...d, disabledSkills: ['codex'] })
    expect(skills.capabilities).toEqual({ name: 'kevin', disabled_skills: ['codex'] })
    const all = base.describe.toolsets.map(t => t.name)
    expect(planSave({ ...d, enabledToolsets: all }).capabilities?.enabled_toolsets).toEqual([])
    expect(planSave({ ...d, enabledToolsets: all.slice(0, 2) }).capabilities?.enabled_toolsets).toEqual(all.slice(0, 2))
    expect(planSave({ ...d, enabledMcp: ['clickup'] }).capabilities?.enabled_mcp_servers).toEqual(['clickup'])
  })
  it('plans avatar set and clear', () => {
    expect(planSave({ ...draftFromBase(base), avatar: { kind: 'set', dataUrl: 'data:image/png;base64,AAAA' } }).avatar).toEqual({ dataUrl: 'data:image/png;base64,AAAA' })
    expect(planSave({ ...draftFromBase(base), avatar: { kind: 'clear' } }).avatar).toEqual({ dataUrl: null })
  })
})

describe('validate', () => {
  it('requires a name, paired model fields, at least one toolset and a small avatar', () => {
    const d = draftFromBase(base)
    expect(validate({ ...d, name: ' ' }).name).toBeTruthy()
    expect(validate({ ...d, provider: 'anthropic', model: '' }).model).toBeTruthy()
    expect(validate({ ...d, enabledToolsets: [] }).toolsets).toBeTruthy()
    expect(validate({ ...d, avatar: { kind: 'set', dataUrl: `data:image/png;base64,${'A'.repeat(2_700_000)}` } }).avatar).toBeTruthy()
    expect(validate(d)).toEqual({})
  })
})

describe('applyResults', () => {
  const plan = planSave({ ...draftFromBase(base), name: 'Kev', soul: 'S', provider: 'anthropic', model: 'claude-opus-5' })
  it('marks saved, confirm-required and conflicts per section', () => {
    const out = applyResults(plan, {
      metadata: { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 2, actual: 3 } }, ui_meta_revisions: { 'hermes-bots': 3 } } },
      text: { ok: true, applied: { soul: true } },
      model: { ok: true, applied: {}, confirm_required: true, confirm_message: 'Expensive model' }
    })
    expect(out.sections).toEqual({ metadata: 'conflict', text: 'saved', model: 'confirm_required', capabilities: 'skipped', avatar: 'skipped' })
    expect(out.confirmMessage).toBe('Expensive model')
    expect(out.errors.metadata).toMatch(/Someone else/)
  })
  it('marks thrown errors and partial applied maps as failed', () => {
    const out = applyResults(plan, { metadata: { error: 'network' }, text: { ok: false, applied: { soul: false } }, model: { ok: true, applied: { model: true } } })
    expect(out.sections.metadata).toBe('failed')
    expect(out.errors.metadata).toBe('network')
    expect(out.sections.text).toBe('failed')
    expect(out.errors.text).toMatch(/soul/)
    expect(out.sections.model).toBe('saved')
  })
  it('keeps only failed sections after a partial save', () => {
    const d = { ...draftFromBase(base), name: 'Kev', soul: 'S' }
    const out = applyResults(planSave(d), { metadata: { ok: true, applied: { ui_meta: true } }, text: { error: 'boom' } })
    const kept = keepFailedSections(d, out, base)
    expect(kept.name).toBe('Kevin')
    expect(kept.soul).toBe('S')
    expect(isDirty(kept)).toBe(true)
  })
})
