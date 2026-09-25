/**
 * Edit Bot draft, save plan and result mapping (docs/10 "Edit Bot on
 * mobile", docs/06 section 4 "Mobile bot editor mapping"). Pure.
 *
 * Save is NOT atomic: metadata, text, model, capabilities and avatar are
 * independent operations with independent outcomes.
 */

import type { ConfigureParams, ConfigureResult, HermesBotsMeta, ProfileDescribe, ProfileSummary, UiMeta } from '@/gateway/types'

export interface EditBotBase {
  describe: ProfileDescribe
  summary: ProfileSummary
  avatarDataUrl: string | null
}

export type AvatarChange = { kind: 'keep' } | { kind: 'set'; dataUrl: string } | { kind: 'clear' }

export interface EditBotDraft {
  base: EditBotBase
  name: string
  role: string
  description: string
  soul: string
  provider: string
  model: string
  avatar: AvatarChange
  /** Skill names that are OFF. */
  disabledSkills: string[]
  /** null = untouched (never sends `enabled_toolsets`). */
  enabledToolsets: string[] | null
  /** null = untouched. */
  enabledMcp: string[] | null
}

export type SaveSection = 'metadata' | 'text' | 'model' | 'capabilities' | 'avatar'

export interface SavePlan {
  metadata?: ConfigureParams
  text?: ConfigureParams
  model?: ConfigureParams
  capabilities?: ConfigureParams
  avatar?: { dataUrl: string | null }
}

export type SectionOutcome = 'saved' | 'failed' | 'confirm_required' | 'conflict' | 'skipped'

export interface SaveOutcome {
  sections: Record<SaveSection, SectionOutcome>
  errors: Partial<Record<SaveSection, string>>
  confirmMessage?: string
}

export const AVATAR_MAX_BYTES = 2_000_000

export function botsMeta(summary: ProfileSummary): HermesBotsMeta {
  return { ...(summary.ui_meta?.['hermes-bots'] ?? {}) }
}

export function friendlyName(summary: ProfileSummary): string {
  const title = botsMeta(summary).title
  if (typeof title === 'string' && title.trim()) {
    return title.trim()
  }
  if (summary.display_name?.trim()) {
    return summary.display_name.trim()
  }
  if (summary.name === 'default') {
    return 'Hermes'
  }
  return summary.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function roleBadge(summary: ProfileSummary): string {
  const role = summary.ui_meta?.ergates?.role
  return typeof role === 'string' ? role.trim() : ''
}

export function draftFromBase(base: EditBotBase): EditBotDraft {
  return {
    base,
    name: friendlyName(base.summary),
    role: roleBadge(base.summary),
    description: base.describe.description ?? '',
    soul: base.describe.soul ?? '',
    provider: base.describe.model?.provider ?? '',
    model: base.describe.model?.default ?? '',
    avatar: { kind: 'keep' },
    disabledSkills: base.describe.skills.filter(s => !s.enabled).map(s => s.name),
    enabledToolsets: null,
    enabledMcp: null
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const s = new Set(a)
  return b.every(x => s.has(x))
}

export function changedSections(d: EditBotDraft): Set<SaveSection> {
  const out = new Set<SaveSection>()
  const baseName = friendlyName(d.base.summary)
  const baseRole = roleBadge(d.base.summary)
  if (d.name.trim() !== baseName || d.role.trim() !== baseRole) {
    out.add('metadata')
  }
  if (d.description !== (d.base.describe.description ?? '') || d.soul !== (d.base.describe.soul ?? '')) {
    out.add('text')
  }
  if (d.provider !== (d.base.describe.model?.provider ?? '') || d.model !== (d.base.describe.model?.default ?? '')) {
    out.add('model')
  }
  const baseDisabled = d.base.describe.skills.filter(s => !s.enabled).map(s => s.name)
  if (!sameSet(d.disabledSkills, baseDisabled) || d.enabledToolsets !== null || d.enabledMcp !== null) {
    out.add('capabilities')
  }
  if (d.avatar.kind !== 'keep') {
    out.add('avatar')
  }
  return out
}

export function isDirty(d: EditBotDraft): boolean {
  return changedSections(d).size > 0
}

export function validate(d: EditBotDraft): Partial<Record<'name' | 'model' | 'toolsets' | 'avatar', string>> {
  const errors: Partial<Record<'name' | 'model' | 'toolsets' | 'avatar', string>> = {}
  if (!d.name.trim()) {
    errors.name = 'Give the bot a name.'
  }
  if ((d.provider && !d.model) || (!d.provider && d.model)) {
    errors.model = 'Choose both a provider and a model, or neither.'
  }
  if (d.enabledToolsets !== null && d.enabledToolsets.length === 0) {
    errors.toolsets = 'Keep at least one toolset on. Turning every toolset off would restore the defaults, not deny all.'
  }
  if (d.avatar.kind === 'set' && decodedBytes(d.avatar.dataUrl) > AVATAR_MAX_BYTES) {
    errors.avatar = 'The photo is larger than 2 MB. Choose a smaller photo.'
  }
  return errors
}

export function decodedBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

/** Only touched sections; metadata sends the full merged namespaces with expected revisions. */
export function planSave(d: EditBotDraft): SavePlan {
  const plan: SavePlan = {}
  const sections = changedSections(d)
  const name = d.base.summary.name
  if (sections.has('metadata')) {
    // `custom` means "the user chose this bot's appearance", so it is only
    // claimed when the avatar or appearance actually changed; a rename must not
    // freeze the appearance Hermes Desktop derives automatically (M12).
    const existing = botsMeta(d.base.summary)
    const meta: HermesBotsMeta = { ...existing, title: d.name.trim() }
    if (d.avatar.kind !== 'keep') {
      meta.custom = true
    }
    const existingErgates = { ...(d.base.summary.ui_meta?.ergates ?? {}) }
    const role = d.role.trim()
    const ergates = role ? { ...existingErgates, role } : Object.fromEntries(Object.entries(existingErgates).filter(([k]) => k !== 'role'))
    const uiMeta: UiMeta = { 'hermes-bots': meta }
    const revisions = d.base.summary.ui_meta_revisions ?? {}
    const expected: Record<string, number> = { 'hermes-bots': revisions['hermes-bots'] ?? 0 }
    const roleChanged = role !== roleBadge(d.base.summary)
    if (roleChanged) {
      uiMeta.ergates = ergates
      expected.ergates = revisions.ergates ?? 0
    }
    plan.metadata = { name, ui_meta: uiMeta, ui_meta_expected_revisions: expected }
  }
  if (sections.has('text')) {
    const text: ConfigureParams = { name }
    if (d.description !== (d.base.describe.description ?? '')) {
      text.description = d.description
    }
    if (d.soul !== (d.base.describe.soul ?? '')) {
      text.soul = d.soul
    }
    plan.text = text
  }
  if (sections.has('model')) {
    plan.model = { name, provider: d.provider, model: d.model }
  }
  if (sections.has('capabilities')) {
    const caps: ConfigureParams = { name }
    const baseDisabled = d.base.describe.skills.filter(s => !s.enabled).map(s => s.name)
    if (!sameSet(d.disabledSkills, baseDisabled)) {
      caps.disabled_skills = [...d.disabledSkills]
    }
    if (d.enabledToolsets !== null) {
      const all = d.base.describe.toolsets.map(t => t.name)
      // All toolsets on clears the pin (desktop parity); a partial set pins it.
      caps.enabled_toolsets = sameSet(d.enabledToolsets, all) ? [] : [...d.enabledToolsets]
    }
    if (d.enabledMcp !== null) {
      caps.enabled_mcp_servers = [...d.enabledMcp]
    }
    plan.capabilities = caps
  }
  if (d.avatar.kind === 'set') {
    plan.avatar = { dataUrl: d.avatar.dataUrl }
  } else if (d.avatar.kind === 'clear') {
    plan.avatar = { dataUrl: null }
  }
  return plan
}

export type SectionResult = ConfigureResult | { error: string } | undefined

function outcomeOf(result: SectionResult): { outcome: SectionOutcome; error?: string; confirmMessage?: string } {
  if (result === undefined) {
    return { outcome: 'skipped' }
  }
  if ('error' in result && typeof result.error === 'string' && !('ok' in result)) {
    return { outcome: 'failed', error: result.error }
  }
  const r = result as ConfigureResult
  if (r.confirm_required) {
    return { outcome: 'confirm_required', confirmMessage: typeof r.confirm_message === 'string' ? r.confirm_message : undefined }
  }
  const applied = r.applied ?? {}
  if (applied.ui_meta === false && applied.ui_meta_conflicts) {
    return { outcome: 'conflict', error: 'Someone else changed this bot. Reload and try again.' }
  }
  const failed = Object.entries(applied).filter(([k, v]) => typeof v === 'boolean' && v === false && k !== 'ui_meta_conflicts')
  if (r.ok === false || failed.length > 0) {
    return { outcome: 'failed', error: failed.length ? `Not applied: ${failed.map(([k]) => k).join(', ')}` : (typeof r.error === 'string' ? r.error : 'The gateway did not apply the change.') }
  }
  return { outcome: 'saved' }
}

export function applyResults(plan: SavePlan, results: Partial<Record<SaveSection, SectionResult>>): SaveOutcome {
  const sections: Record<SaveSection, SectionOutcome> = { metadata: 'skipped', text: 'skipped', model: 'skipped', capabilities: 'skipped', avatar: 'skipped' }
  const errors: Partial<Record<SaveSection, string>> = {}
  let confirmMessage: string | undefined
  for (const section of ['metadata', 'text', 'model', 'capabilities', 'avatar'] as SaveSection[]) {
    if (!plan[section]) {
      continue
    }
    const { outcome, error, confirmMessage: cm } = outcomeOf(results[section])
    sections[section] = outcome
    if (error) {
      errors[section] = error
    }
    if (cm) {
      confirmMessage = cm
    }
  }
  return { sections, errors, confirmMessage }
}

/** After a partial save, keep only the sections that did not save so Cancel/retry work on them. */
export function keepFailedSections(d: EditBotDraft, outcome: SaveOutcome, fresh: EditBotBase): EditBotDraft {
  const next = draftFromBase(fresh)
  const keep = (s: SaveSection) => outcome.sections[s] !== 'saved' && outcome.sections[s] !== 'skipped'
  return {
    ...next,
    name: keep('metadata') ? d.name : next.name,
    role: keep('metadata') ? d.role : next.role,
    description: keep('text') ? d.description : next.description,
    soul: keep('text') ? d.soul : next.soul,
    provider: keep('model') ? d.provider : next.provider,
    model: keep('model') ? d.model : next.model,
    disabledSkills: keep('capabilities') ? d.disabledSkills : next.disabledSkills,
    enabledToolsets: keep('capabilities') ? d.enabledToolsets : null,
    enabledMcp: keep('capabilities') ? d.enabledMcp : null,
    avatar: keep('avatar') ? d.avatar : { kind: 'keep' }
  }
}
