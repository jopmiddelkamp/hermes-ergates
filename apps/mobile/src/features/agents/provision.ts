/**
 * Provisioning an accepted agent (docs/11 section 4.1, roadmap decision D4,
 * ADR-032). The app runs each step through the public Hermes RPCs it already
 * uses and reports it to the server's receipt; the server enables the plugin
 * in the new profile and marks the proposal `complete` once it has checked it.
 *
 * Every run starts with the accept call: for a proposal that is already
 * accepted it answers the receipt and the template again, so a run the app
 * lost (killed, offline) resumes at the receipt's `next_step`. A step is
 * never repeated blindly (docs/05 section 5):
 *  - `profile_created` checks that the profile exists before it creates it;
 *  - `plugin_enabled` and `configured` set absolute values, so running them
 *    again leaves the same state;
 *  - `bot_chat` resolves the canonical chat, which never mints a second one;
 *  - `briefing` is marked `uncertain` on the server before the submit, so a
 *    later run knows it may have gone out. It then looks for the briefing in
 *    the chat and, when it is not there, asks the user (`confirm_briefing`)
 *    instead of sending it again.
 *
 * Framework-free: the React binding passes `provisionDeps(port, openCanonicalChat)` in.
 */

import { isGatewayError, userMessage } from '@/gateway/errors'
import type { ErgatesApi, GatewayPort } from '@/gateway/port'
import {
  PROVISION_STEPS,
  type AgentProposal,
  type ConfigureParams,
  type ConfigureResult,
  type CreateProfileParams,
  type HistoryMessage,
  type ProposalReceipt,
  type ProposalTemplate,
  type ProvisionStep,
  type SubmitResult
} from '@/gateway/types'

import { colorForName } from './create'

/** The Hermes and Ergates calls one run makes. */
export interface ProvisionDeps {
  ergates: Pick<ErgatesApi, 'acceptProposal' | 'recordProposalStep' | 'enablePlugin'>
  profileExists(name: string): Promise<boolean>
  createProfile(params: CreateProfileParams): Promise<unknown>
  configureProfile(params: ConfigureParams): Promise<ConfigureResult>
  /** The profile's canonical Bot Chat, created only when it has none. */
  openBotChat(profile: string): Promise<{ liveSessionId: string; running: boolean; messages: HistoryMessage[] }>
  submit(liveSessionId: string, text: string): Promise<SubmitResult>
}

/** How the app resolves a profile's Bot Chat: `openCanonicalChat` from the chat feature. */
export type OpenBotChat = (port: GatewayPort, profile: string) => Promise<{ liveSessionId: string; running: boolean; messages: HistoryMessage[] }>

export type ProvisionOutcome =
  | { kind: 'complete'; profile: string }
  /** Every step is done, but the server does not see the plugin in the profile yet. Running again is safe. */
  | { kind: 'not_ready'; profile: string }
  /** The briefing may have gone out and the chat does not show it: only the user may send it again. */
  | { kind: 'confirm_briefing'; profile: string }
  /** `terminal`: running again cannot help (the accept was refused, or the profile was deleted). */
  | { kind: 'failed'; step: ProvisionStep | 'accept'; message: string; code?: string | number; terminal: boolean }

export interface ProvisionOptions {
  /** Called before each step runs. */
  onStep?: (step: ProvisionStep) => void
  /** The user checked the new agent's chat and chose to send the briefing again. */
  resendBriefing?: boolean
}

const ACCEPT_REFUSALS: Record<string, (name: string) => string> = {
  not_found: () => 'This proposal is no longer on the server.',
  hash_mismatch: () => 'This is not the proposal the agent made. Ask it to propose the agent again.',
  not_acceptable: () => 'This proposal was rejected.',
  expired: () => 'This proposal expired. Ask the agent to propose it again.',
  name_taken: name => `An agent named "${name}" already exists.`,
  unknown_template: () => 'The server has no template for this role. Ask the operator to install it.'
}

/** The deps over the gateway port the app uses. */
export function provisionDeps(port: GatewayPort, openChat: OpenBotChat): ProvisionDeps {
  return {
    ergates: port.ergates,
    profileExists: async name => (await port.profiles.list()).profiles.some(p => p.name === name),
    createProfile: params => port.profiles.create(params),
    configureProfile: params => port.profiles.configure(params),
    openBotChat: async profile => {
      const chat = await openChat(port, profile)
      return { liveSessionId: chat.liveSessionId, running: chat.running, messages: chat.messages }
    },
    // A fresh Bot Chat is idle; `queued` only matters if a turn already runs there.
    submit: (liveSessionId, text) => port.sessions.submit(liveSessionId, text, { queued: true })
  }
}

/** Accept (or resume) the proposal and run its remaining steps. Never throws. */
export async function provisionAgent(deps: ProvisionDeps, proposal: AgentProposal, options: ProvisionOptions = {}): Promise<ProvisionOutcome> {
  const id = proposal.proposal_id
  const name = proposal.agent.name
  let receipt: ProposalReceipt
  try {
    receipt = await deps.ergates.acceptProposal(id, proposal)
  } catch (err) {
    const code = isGatewayError(err) ? err.code : undefined
    const refusal = typeof code === 'string' ? ACCEPT_REFUSALS[code] : undefined
    return { kind: 'failed', step: 'accept', message: refusal ? refusal(name) : userMessage(err), code, terminal: Boolean(refusal) }
  }
  if (receipt.state === 'complete') {
    return { kind: 'complete', profile: name }
  }
  const template = receipt.template
  if (!template) {
    return { kind: 'failed', step: 'accept', message: 'The server did not send the role template for this agent.', terminal: false }
  }
  try {
    if (receipt.completed_steps.includes('profile_created') && !(await deps.profileExists(name))) {
      return deleted(name)
    }
  } catch (err) {
    return { kind: 'failed', step: 'profile_created', message: userMessage(err), terminal: false }
  }

  // At most one pass per step: each report must move `next_step` on.
  for (let pass = 0; pass < PROVISION_STEPS.length && receipt.next_step !== null; pass += 1) {
    const step: ProvisionStep = receipt.next_step
    options.onStep?.(step)
    const outcome = await runStep(step, deps, proposal, template, receipt, options)
    if (outcome) {
      return outcome
    }
    try {
      receipt = await deps.ergates.recordProposalStep(id, step, 'done')
    } catch (err) {
      return reportFailure(step, err, name)
    }
  }
  if (receipt.next_step !== null) {
    return { kind: 'failed', step: receipt.next_step, message: 'The server did not record the last step.', terminal: false }
  }
  if (receipt.state !== 'complete') {
    // Every step is done, but an earlier run heard `not_ready`: asking again is safe.
    try {
      receipt = await deps.ergates.recordProposalStep(id, 'briefing', 'done')
    } catch (err) {
      return reportFailure('briefing', err, name)
    }
  }
  return receipt.state === 'complete' ? { kind: 'complete', profile: name } : { kind: 'not_ready', profile: name }
}

const running = new Map<string, Promise<ProvisionOutcome>>()

/** One run per proposal at a time in this process: a second caller shares the first run. */
export function provisionOnce(proposalId: string, run: () => Promise<ProvisionOutcome>): Promise<ProvisionOutcome> {
  const existing = running.get(proposalId)
  if (existing) {
    return existing
  }
  const started = run().finally(() => running.delete(proposalId))
  running.set(proposalId, started)
  return started
}

/** Runs one step. `undefined` when it is done, else the outcome that ends this run. */
async function runStep(
  step: ProvisionStep,
  deps: ProvisionDeps,
  proposal: AgentProposal,
  template: ProposalTemplate,
  receipt: ProposalReceipt,
  options: ProvisionOptions
): Promise<ProvisionOutcome | undefined> {
  const { agent } = proposal
  try {
    switch (step) {
      case 'profile_created':
        if (!(await deps.profileExists(agent.name))) {
          await deps.createProfile({
            name: agent.name,
            description: agent.description.trim() || undefined,
            provider: agent.provider,
            model: agent.model,
            mirror_credentials: false
          })
        }
        return undefined
      case 'plugin_enabled':
        await deps.ergates.enablePlugin(agent.name)
        return undefined
      case 'configured': {
        const result = await deps.configureProfile({
          name: agent.name,
          soul: template.soul,
          enabled_toolsets: template.enabled_toolsets,
          enabled_mcp_servers: template.enabled_mcp_servers,
          ui_meta: {
            'hermes-bots': { title: agent.title, hidden: false, custom: true, imageKind: 'initials', shape: 'circle', color: colorForName(agent.name) },
            ergates: { role: agent.role }
          }
        })
        // A transport success is not a configured agent: every section must say it applied.
        const refused = Object.entries(result.applied ?? {})
          .filter(([, applied]) => applied === false)
          .map(([section]) => section)
        if (result.ok !== true || refused.length > 0) {
          await report(deps, proposal, step, 'failed')
          return { kind: 'failed', step, message: `Hermes did not apply: ${refused.join(', ') || 'the role settings'}.`, terminal: false }
        }
        return undefined
      }
      case 'bot_chat':
        await deps.openBotChat(agent.name)
        return undefined
      case 'briefing':
        return await sendBriefing(deps, proposal, receipt, options)
    }
  } catch (err) {
    if (isGatewayError(err) && err.code === 'unknown_profile') {
      return deleted(agent.name)
    }
    const uncertain = isGatewayError(err) && (err.kind === 'timeout' || err.kind === 'network')
    // The briefing is already marked uncertain before its submit; a definite failure clears that.
    if (step !== 'briefing' || !uncertain) {
      await report(deps, proposal, step, uncertain ? 'uncertain' : 'failed')
    }
    return { kind: 'failed', step, message: userMessage(err), code: isGatewayError(err) ? err.code : undefined, terminal: false }
  }
}

async function sendBriefing(deps: ProvisionDeps, proposal: AgentProposal, receipt: ProposalReceipt, options: ProvisionOptions): Promise<ProvisionOutcome | undefined> {
  const name = proposal.agent.name
  const chat = await deps.openBotChat(name)
  if (receipt.step_status.briefing === 'uncertain' && !options.resendBriefing) {
    const briefing = proposal.briefing.trim()
    const seen = chat.running || chat.messages.some(m => m.role === 'user' && typeof m.text === 'string' && m.text.trim() === briefing)
    return seen ? undefined : { kind: 'confirm_briefing', profile: name }
  }
  // Recorded before the submit, so a run that dies after it knows the briefing may be out.
  await deps.ergates.recordProposalStep(proposal.proposal_id, 'briefing', 'uncertain')
  await deps.submit(chat.liveSessionId, proposal.briefing)
  return undefined
}

/** Best effort: the server's step status only guides the next run. */
async function report(deps: ProvisionDeps, proposal: AgentProposal, step: ProvisionStep, status: 'uncertain' | 'failed'): Promise<void> {
  await deps.ergates.recordProposalStep(proposal.proposal_id, step, status).catch(() => undefined)
}

function reportFailure(step: ProvisionStep, err: unknown, name: string): ProvisionOutcome {
  if (isGatewayError(err) && err.code === 'not_ready') {
    return { kind: 'not_ready', profile: name }
  }
  return { kind: 'failed', step, message: userMessage(err), code: isGatewayError(err) ? err.code : undefined, terminal: false }
}

/**
 * The profile was deleted before its setup finished. The accepted proposal
 * still reserves the name and the server has no operation that releases it,
 * so neither a new profile nor this setup can finish from the app.
 */
function deleted(name: string): ProvisionOutcome {
  return {
    kind: 'failed',
    step: 'profile_created',
    message: `The profile "${name}" was deleted before its setup finished. This proposal still reserves the name, so the app cannot set it up again.`,
    terminal: true
  }
}
