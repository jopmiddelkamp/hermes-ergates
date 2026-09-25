/**
 * Agent proposals as the chat receives them (docs/11 section 4.1). The UI
 * recognizes only the validated result of the `ergates_propose_agent` tool:
 * never Markdown, an attachment, or a clarify option that claims to be one.
 */

import { isGatewayError, userMessage } from '@/gateway/errors'
import { PROVISION_STEPS, type AgentProposal, type ProposalReceipt, type ProvisionStep } from '@/gateway/types'

import type { ProvisionOutcome } from './provision'

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

/** A chat item that may carry a tool result: the live `tool.complete` of the session reducer. */
export interface ToolItemLike {
  kind: string
  name?: string
  result?: unknown
}

/** A durable transcript row (REST): tool rows carry the tool name and the decoded result. */
export interface ToolRowLike {
  role: string
  toolName?: string
  result?: unknown
}

/**
 * The proposals a chat shows, once each and oldest first: the tool results in
 * the loaded transcript, then those only the live chat has seen, then setups
 * this device still holds (their tool row can be older than the window).
 */
export function collectProposals(items: readonly ToolItemLike[], rows: readonly ToolRowLike[], stored: readonly unknown[]): AgentProposal[] {
  const found = new Map<string, AgentProposal>()
  const add = (value: unknown) => {
    const proposal = parseAgentProposal(value)
    if (proposal && !found.has(proposal.proposal_id)) {
      found.set(proposal.proposal_id, proposal)
    }
  }
  rows.filter(row => row.role === 'tool' && row.toolName === PROPOSE_TOOL).forEach(row => add(row.result))
  items.filter(item => item.kind === 'tool' && item.name === PROPOSE_TOOL).forEach(item => add(item.result))
  stored.forEach(add)
  return [...found.values()]
}

const STEP_TEXT: Record<ProvisionStep | 'accept', string> = {
  accept: 'accepting the proposal',
  profile_created: 'creating its profile',
  plugin_enabled: 'turning on Ergates',
  configured: 'applying its role',
  bot_chat: 'opening its chat',
  briefing: 'sending its briefing'
}

export type ProposalAction = 'accept' | 'reject' | 'retry' | 'resend_briefing' | 'open_chat' | 'reload'

export interface ProposalView {
  /** Nothing to show: the proposal ended before this screen opened, or the server pruned it. */
  hidden: boolean
  status: 'loading' | 'proposed' | 'working' | 'complete' | 'confirm' | 'waiting' | 'failed' | 'closed'
  /** One line under the proposal's details, or null. */
  text: string | null
  actions: ProposalAction[]
}

export interface ProposalViewInput {
  proposal: AgentProposal
  receipt: ProposalReceipt | undefined
  receiptError: unknown
  /** The step a run is on right now. */
  step: ProvisionStep | null
  /** How the last run on this screen ended. */
  outcome: ProvisionOutcome | null
  /** An accept or reject call is in flight. */
  busy: boolean
}

const view = (status: ProposalView['status'], text: string | null, actions: ProposalAction[] = []): ProposalView => ({ hidden: false, status, text, actions })

/** What a proposal card says and offers. The server's receipt decides; a run on this screen refines it. */
export function proposalView({ proposal, receipt, receiptError, step, outcome, busy }: ProposalViewInput): ProposalView {
  const title = proposal.agent.title
  if (step) {
    return view('working', `Setting up ${title}: ${STEP_TEXT[step]} (${PROVISION_STEPS.indexOf(step) + 1} of ${PROVISION_STEPS.length}).`)
  }
  if (busy) {
    return view('working', 'Working…')
  }
  if (outcome) {
    switch (outcome.kind) {
      case 'complete':
        return view('complete', `${title} is ready.`, ['open_chat'])
      case 'confirm_briefing':
        return view('confirm', `The briefing may not have reached ${title}. Check its chat, and send it again only if it is not there.`, ['open_chat', 'resend_briefing'])
      case 'not_ready':
        return view('waiting', `Waiting for Hermes to load Ergates in ${title}.`, ['retry'])
      case 'failed': {
        if (outcome.terminal) {
          return view('closed', outcome.message)
        }
        const what = STEP_TEXT[outcome.step]
        return view('failed', `${what.charAt(0).toUpperCase()}${what.slice(1)} failed. ${outcome.message}`, ['retry'])
      }
    }
  }
  if (receiptError) {
    if (isGatewayError(receiptError) && receiptError.kind === 'not_found') {
      // With a C3 code the server pruned the receipt; without one the route itself is missing.
      return receiptError.code === 'not_found'
        ? { hidden: true, status: 'closed', text: null, actions: [] }
        : view('closed', 'Ergates is not installed on this gateway, so this proposal cannot be answered here.')
    }
    return view('failed', userMessage(receiptError), ['reload'])
  }
  if (!receipt) {
    return view('loading', null)
  }
  switch (receipt.state) {
    case 'proposed':
      return view('proposed', null, ['accept', 'reject'])
    case 'accepted':
      return view('working', `Setting up ${title}…`)
    default:
      return { hidden: true, status: 'closed', text: null, actions: [] }
  }
}
