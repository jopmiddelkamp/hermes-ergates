/**
 * Agent proposals as the chat receives them (docs/11 section 4.1). The UI
 * recognizes only the validated result of the `ergates_propose_agent` tool:
 * never Markdown, an attachment, or a clarify option that claims to be one.
 */

import type { AgentProposal } from '@/gateway/types'

export const PROPOSE_TOOL = 'ergates_propose_agent'
export const PROPOSAL_KIND = 'ergates.agent-proposal.v1'

/** The integration's `validate_proposal` name rule. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,31}$/
const AGENT_FIELDS = ['name', 'title', 'role', 'description', 'template_id', 'provider', 'model'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The proposal when `value` is exactly an `ergates_propose_agent` result,
 * else null. It returns the same object, never a copy: the accept call sends
 * it back and the server compares hashes, so a field this app does not know
 * must survive.
 */
export function parseAgentProposal(value: unknown): AgentProposal | null {
  if (!isRecord(value) || value.kind !== PROPOSAL_KIND) {
    return null
  }
  const { proposal_id: id, expires_at: expires, briefing, source_session_id: source, agent } = value
  if (typeof id !== 'string' || !id || typeof expires !== 'string' || Number.isNaN(Date.parse(expires))) {
    return null
  }
  if (typeof briefing !== 'string' || (source !== null && typeof source !== 'string') || !isRecord(agent)) {
    return null
  }
  if (AGENT_FIELDS.some(field => typeof agent[field] !== 'string') || !NAME_RE.test(agent.name as string) || !(agent.title as string).trim()) {
    return null
  }
  return value as unknown as AgentProposal
}
