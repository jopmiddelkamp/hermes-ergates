/**
 * User-initiated agent creation (docs/10: direct authenticated profile
 * operations; docs/11 section 4.1 for the agent-proposed path, which is
 * server integration work). Each step is recorded so a failure reports
 * exactly where it stopped; there is no automatic cleanup.
 */

import { userMessage } from '@/gateway/errors'
import type { GatewayPort } from '@/gateway/port'

import { BOT_CHAT_TITLE } from '../chat/canonical-chat'

export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,31}$/

/**
 * Initials-avatar disc colors. A new agent picks one deterministically from its
 * profile name, so the roster is glanceable on Home and Hermes Desktop reads a
 * real `color` next to the `custom: true` it also writes (M11). Same hash as
 * the desktop profile rail; a fixed hex list instead of a computed hue because
 * the mobile Avatar measures contrast against it.
 */
export const AGENT_COLORS = [
  '#38bdf8',
  '#8b5cf6',
  '#f97316',
  '#10b981',
  '#f43f5e',
  '#eab308',
  '#6366f1',
  '#14b8a6'
] as const

export function colorForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length]!
}

export interface CreateAgentInput {
  name: string
  title: string
  role?: string
  description?: string
  soul?: string
  provider?: string
  model?: string
}

export type CreateStep = 'create' | 'metadata' | 'chat'

export interface CreateAgentResult {
  profile: string
  sessionId: string | null
  steps: Record<CreateStep, 'done' | 'failed' | 'skipped'>
  error?: string
}

export function validateCreate(input: CreateAgentInput): Partial<Record<'name' | 'title' | 'model', string>> {
  const errors: Partial<Record<'name' | 'title' | 'model', string>> = {}
  if (!PROFILE_NAME_RE.test(input.name)) {
    errors.name = 'Use 2–32 lowercase letters, digits or dashes, starting with a letter or digit.'
  }
  if (!input.title.trim()) {
    errors.title = 'Give the agent a display name.'
  }
  if ((input.provider && !input.model) || (!input.provider && input.model)) {
    errors.model = 'Choose both a provider and a model, or neither.'
  }
  return errors
}

export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export async function createAgent(port: GatewayPort, input: CreateAgentInput): Promise<CreateAgentResult> {
  const steps: CreateAgentResult['steps'] = { create: 'skipped', metadata: 'skipped', chat: 'skipped' }
  const name = input.name.trim()
  try {
    await port.profiles.create({
      name,
      description: input.description?.trim() || undefined,
      soul: input.soul?.trim() || undefined,
      ...(input.provider && input.model ? { provider: input.provider, model: input.model } : {}),
      mirror_credentials: false
    })
    steps.create = 'done'
  } catch (err) {
    steps.create = 'failed'
    return { profile: name, sessionId: null, steps, error: userMessage(err) }
  }
  try {
    const role = input.role?.trim()
    const result = await port.profiles.configure({
      name,
      ui_meta: {
        'hermes-bots': { title: input.title.trim(), hidden: false, custom: true, imageKind: 'initials', shape: 'circle', color: colorForName(name) },
        ...(role ? { ergates: { role } } : {})
      }
    })
    steps.metadata = result.applied?.ui_meta === false ? 'failed' : 'done'
  } catch (err) {
    steps.metadata = 'failed'
    return { profile: name, sessionId: null, steps, error: userMessage(err) }
  }
  try {
    // Same contract as `openCanonicalChat`: the Bot Chat always follows the
    // profile's current config (PR #97008), so a later model change in the
    // editor is not undone by the model pinned on the stored row.
    const chat = await port.sessions.create({ title: BOT_CHAT_TITLE, profile: name, hidden: true, follow_profile_config: true })
    // session.create is lazy: the eager title write materializes the row and
    // claims the canonical title, so the first open adopts this chat instead
    // of minting a second one (same rule as openCanonicalChat).
    try {
      await port.sessions.title(chat.session_id, BOT_CHAT_TITLE)
    } catch {
      // Older gateway or a title conflict: openCanonicalChat resolves it by name.
    }
    steps.chat = 'done'
    return { profile: name, sessionId: chat.stored_session_id, steps }
  } catch (err) {
    steps.chat = 'failed'
    return { profile: name, sessionId: null, steps, error: userMessage(err) }
  }
}
