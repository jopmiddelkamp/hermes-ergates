/**
 * Provisioning an accepted agent (docs/11 section 4.1, roadmap D4): the app
 * runs each step through the public Hermes RPCs and reports it to the server's
 * receipt. The server side is `FakeErgates` (roadmap contract C3); Hermes is a
 * small in-memory model of the profile and chat RPCs the steps use.
 */
import { describe, expect, it } from 'vitest'

import { FakeGateway } from '@test/fake-gateway/fake-gateway'
import { FakeErgates, PROPOSAL_TEMPLATE } from '@test/fake-gateway/fake-ergates'
import { flush } from '@test/fake-gateway/fake-websocket'

import { openCanonicalChat } from '@/features/chat/canonical-chat'
import { GatewayError } from '@/gateway/errors'
import type { AgentProposal, ConfigureParams, CreateProfileParams, HistoryMessage } from '@/gateway/types'

import { parseAgentProposal } from './proposal'
import { provisionAgent, provisionDeps, provisionOnce, type ProvisionDeps } from './provision'

const PROPOSAL: AgentProposal = {
  kind: 'ergates.agent-proposal.v1',
  proposal_id: 'p-pim',
  expires_at: '2999-01-01T00:00:00Z',
  source_session_id: 'concierge-1',
  agent: { name: 'pim', title: 'Pim', role: 'Bookkeeper', description: 'Keeps the books.', template_id: 'bookkeeper-readonly', provider: 'p', model: 'm' },
  briefing: 'You are Pim. Start with the unpaid invoices.'
}

/** Never settles: the app was killed while it waited for this answer. */
const killed = <T>(): Promise<T> => new Promise<T>(() => undefined)

/** Hermes's profiles and Bot Chats, as the provisioning steps see them. */
function hermes() {
  const profiles = new Set(['default', 'concierge'])
  const chats = new Map<string, { live: string; messages: HistoryMessage[]; running: boolean }>()
  const calls = { create: [] as CreateProfileParams[], configure: [] as ConfigureParams[], openChat: [] as string[], submit: [] as string[] }
  const ergates = new FakeErgates({ hasProfile: name => profiles.has(name) })
  ergates.record(PROPOSAL)
  const deps: ProvisionDeps = {
    ergates,
    profileExists: async name => profiles.has(name),
    createProfile: async params => {
      calls.create.push(params)
      if (profiles.has(params.name)) {
        throw new GatewayError('rpc', `Profile '${params.name}' already exists`, { code: 4062 })
      }
      profiles.add(params.name)
      return { ok: true }
    },
    configureProfile: async params => {
      calls.configure.push(params)
      return { ok: true, applied: { soul: true, toolsets: true, mcp_servers: true, ui_meta: true } }
    },
    openBotChat: async profile => {
      calls.openChat.push(profile)
      let chat = chats.get(profile)
      if (!chat) {
        chat = { live: `live-${profile}`, messages: [], running: false }
        chats.set(profile, chat)
      }
      return { liveSessionId: chat.live, running: chat.running, messages: [...chat.messages] }
    },
    submit: async (liveSessionId, text) => {
      calls.submit.push(text)
      const chat = [...chats.values()].find(c => c.live === liveSessionId)!
      chat.messages.push({ role: 'user', text })
      chat.running = true
      return { status: 'streaming' }
    }
  }
  return { deps, ergates, profiles, chats, calls }
}

const steps = (ergates: FakeErgates) =>
  ergates.calls.filter(c => c.op === 'recordProposalStep').map(c => `${String(c.args[1])}:${String(c.args[2])}`)

describe('provisionAgent', () => {
  it('runs every step in order, reports each one, and completes the proposal', async () => {
    const { deps, ergates, profiles, calls } = hermes()
    const seen: string[] = []

    const outcome = await provisionAgent(deps, PROPOSAL, { onStep: step => seen.push(step) })

    expect(outcome).toEqual({ kind: 'complete', profile: 'pim' })
    expect(seen).toEqual(['profile_created', 'plugin_enabled', 'configured', 'bot_chat', 'briefing'])
    expect(steps(ergates)).toEqual(['profile_created:done', 'plugin_enabled:done', 'configured:done', 'bot_chat:done', 'briefing:uncertain', 'briefing:done'])
    expect(calls.create).toEqual([{ name: 'pim', description: 'Keeps the books.', provider: 'p', model: 'm', mirror_credentials: false }])
    expect(calls.configure).toEqual([
      {
        name: 'pim',
        soul: PROPOSAL_TEMPLATE.soul,
        enabled_toolsets: PROPOSAL_TEMPLATE.enabled_toolsets,
        enabled_mcp_servers: PROPOSAL_TEMPLATE.enabled_mcp_servers,
        ui_meta: {
          'hermes-bots': { title: 'Pim', hidden: false, custom: true, imageKind: 'initials', shape: 'circle', color: expect.stringMatching(/^#[0-9a-f]{6}$/) },
          ergates: { role: 'Bookkeeper' }
        }
      }
    ])
    expect(calls.submit).toEqual([PROPOSAL.briefing])
    expect(profiles.has('pim')).toBe(true)
    expect(ergates.enabledPlugins.has('pim')).toBe(true)
    expect((await ergates.getProposal('p-pim')).state).toBe('complete')
  })

  it('Review Focus 4: killed after the profile exists, it resumes without a second profile or briefing', async () => {
    const { deps, ergates, calls } = hermes()
    const createProfile = deps.createProfile
    // The profile is created, then the app dies before it hears back.
    void provisionAgent({ ...deps, createProfile: async params => (await createProfile(params), killed()) }, PROPOSAL)
    await flush(5)
    expect(calls.create).toHaveLength(1)
    expect((await ergates.getProposal('p-pim')).next_step).toBe('profile_created')

    const outcome = await provisionAgent(deps, PROPOSAL)

    expect(outcome).toEqual({ kind: 'complete', profile: 'pim' })
    expect(calls.create).toHaveLength(1)
    expect(calls.submit).toEqual([PROPOSAL.briefing])
  })

  it('Review Focus 4: killed after the briefing went out, it resumes without a second briefing', async () => {
    const { deps, ergates, calls } = hermes()
    const submit = deps.submit
    void provisionAgent({ ...deps, submit: async (live, text) => (await submit(live, text), killed()) }, PROPOSAL)
    await flush(5)
    expect(calls.submit).toHaveLength(1)
    expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('uncertain')

    const outcome = await provisionAgent(deps, PROPOSAL)

    expect(outcome).toEqual({ kind: 'complete', profile: 'pim' })
    expect(calls.submit).toHaveLength(1)
    expect(calls.create).toHaveLength(1)
  })

  it('counts the briefing as sent when the chat has it but the turn is not running (an interrupted stale turn)', async () => {
    const { deps, chats, calls } = hermes()
    const submit = deps.submit
    void provisionAgent({ ...deps, submit: async (live, text) => (await submit(live, text), killed()) }, PROPOSAL)
    await flush(5)
    expect(calls.submit).toHaveLength(1)
    // The turn that carried the briefing was interrupted and is no longer running,
    // but the message itself is still there.
    chats.get('pim')!.running = false

    const outcome = await provisionAgent(deps, PROPOSAL)

    expect(outcome).toEqual({ kind: 'complete', profile: 'pim' })
    expect(calls.submit).toHaveLength(1)
  })

  it('Review Focus 4: killed after the server recorded a step, it continues at the next step', async () => {
    const { deps, ergates, calls } = hermes()
    ergates.fail('recordProposalStep', 'hang', 'after')
    void provisionAgent(deps, PROPOSAL)
    await flush(5)
    expect((await ergates.getProposal('p-pim')).completed_steps).toEqual(['profile_created'])

    await provisionAgent(deps, PROPOSAL)

    expect(calls.create).toHaveLength(1)
    expect(ergates.calls.filter(c => c.op === 'enablePlugin')).toHaveLength(1)
    expect(calls.submit).toHaveLength(1)
  })

  it('asks before it sends a briefing that may already have gone out', async () => {
    const { deps, ergates, chats, calls } = hermes()
    // Killed between marking the briefing uncertain and the submit: nothing in the chat.
    const submit = deps.submit
    void provisionAgent({ ...deps, submit: () => killed() }, PROPOSAL)
    await flush(5)
    expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('uncertain')

    const outcome = await provisionAgent({ ...deps, submit }, PROPOSAL)
    expect(outcome).toEqual({ kind: 'confirm_briefing', profile: 'pim' })
    expect(calls.submit).toEqual([])

    const confirmed = await provisionAgent({ ...deps, submit }, PROPOSAL, { resendBriefing: true })
    expect(confirmed).toEqual({ kind: 'complete', profile: 'pim' })
    expect(calls.submit).toEqual([PROPOSAL.briefing])
    expect(chats.get('pim')!.messages).toHaveLength(1)
  })

  it('a reconcile that cannot even open the chat never turns the uncertain briefing mark into failed', async () => {
    const { deps, ergates, calls } = hermes()
    // Run 1: the submit is attempted (and recorded) but the app is killed before
    // it learns whether Hermes received it.
    void provisionAgent({ ...deps, submit: async (live, text) => (calls.submit.push(text), killed()) }, PROPOSAL)
    await flush(5)
    expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('uncertain')

    // Run 2: Hermes is busy (still resuming the session) and the reconcile cannot
    // even open the chat to look for evidence.
    const busy = await provisionAgent({ ...deps, openBotChat: () => Promise.reject(new GatewayError('busy', 'The assistant is busy with another turn.', { code: 4009 })) }, PROPOSAL)
    expect(busy).toMatchObject({ kind: 'failed', step: 'briefing', terminal: false })
    // The bug: this used to overwrite `uncertain` with `failed`, which then skips
    // the evidence check on the next run and resends blindly.
    expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('uncertain')

    // Run 3: healthy again. The chat still shows nothing, so it asks instead of resending.
    const outcome = await provisionAgent(deps, PROPOSAL)
    expect(outcome).toEqual({ kind: 'confirm_briefing', profile: 'pim' })
    expect(calls.submit).toHaveLength(1)
  })

  it('clears the uncertain briefing mark to failed when Hermes refuses the submit, and a later run sends it once more', async () => {
    const { deps, ergates, calls } = hermes()
    const refusing: ProvisionDeps = {
      ...deps,
      submit: async (_live, text) => {
        calls.submit.push(text)
        throw new GatewayError('rpc', 'session not found', { code: 4004 })
      }
    }

    const first = await provisionAgent(refusing, PROPOSAL)
    expect(first).toMatchObject({ kind: 'failed', step: 'briefing', code: 4004, terminal: false })
    expect(steps(ergates).slice(-2)).toEqual(['briefing:uncertain', 'briefing:failed'])
    expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('failed')

    // A definite refusal means the briefing never reached the chat: the next
    // run (a deliberate tap) sends it again without asking.
    expect(await provisionAgent(deps, PROPOSAL)).toEqual({ kind: 'complete', profile: 'pim' })
    expect(calls.submit).toEqual([PROPOSAL.briefing, PROPOSAL.briefing])
  })

  for (const kind of ['timeout', 'network'] as const) {
    it(`keeps the uncertain briefing mark when the submit ends in a ${kind} error, and never sends it again unasked`, async () => {
      const { deps, ergates, calls } = hermes()
      const lost: ProvisionDeps = {
        ...deps,
        submit: async (_live, text) => {
          calls.submit.push(text)
          throw new GatewayError(kind, 'The gateway did not answer.')
        }
      }

      const first = await provisionAgent(lost, PROPOSAL)
      expect(first).toMatchObject({ kind: 'failed', step: 'briefing', terminal: false })
      expect(steps(ergates).slice(-1)).toEqual(['briefing:uncertain'])
      expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('uncertain')

      // The chat does not show the briefing: the next run asks the user.
      expect(await provisionAgent(deps, PROPOSAL)).toEqual({ kind: 'confirm_briefing', profile: 'pim' })
      expect(calls.submit).toEqual([PROPOSAL.briefing])
      expect((await ergates.getProposal('p-pim')).step_status.briefing).toBe('uncertain')
    })
  }

  it('marks a timed-out step uncertain and reconciles it on the next run', async () => {
    const { deps, ergates, calls } = hermes()
    const createProfile = deps.createProfile
    const flaky: ProvisionDeps = {
      ...deps,
      createProfile: async params => {
        await createProfile(params)
        throw new GatewayError('timeout', 'The gateway did not answer in time.')
      }
    }

    const first = await provisionAgent(flaky, PROPOSAL)
    expect(first).toMatchObject({ kind: 'failed', step: 'profile_created', terminal: false })
    expect((await ergates.getProposal('p-pim')).step_status.profile_created).toBe('uncertain')

    expect(await provisionAgent(deps, PROPOSAL)).toEqual({ kind: 'complete', profile: 'pim' })
    expect(calls.create).toHaveLength(1)
  })

  it('stops after one pass when a step report succeeds but its receipt still names the same step', async () => {
    const { deps, ergates } = hermes()
    let profileChecks = 0
    const stale: ProvisionDeps = {
      ...deps,
      profileExists: async name => {
        profileChecks += 1
        return deps.profileExists(name)
      },
      ergates: {
        acceptProposal: (id, proposal) => ergates.acceptProposal(id, proposal),
        enablePlugin: profile => ergates.enablePlugin(profile),
        recordProposalStep: async (id, step, status) => {
          const receipt = await ergates.recordProposalStep(id, step, status)
          // A stale/incorrect echo: the server did record it, but this answer does not show that.
          return { ...receipt, next_step: step }
        }
      }
    }

    const outcome = await provisionAgent(stale, PROPOSAL)

    expect(outcome).toMatchObject({ kind: 'failed', step: 'profile_created', message: 'The server did not record the last step.', terminal: false })
    expect(profileChecks).toBe(1)
  })

  it('fails the configure step when Hermes did not apply a section', async () => {
    const { deps, ergates } = hermes()
    const partial: ProvisionDeps = { ...deps, configureProfile: async () => ({ ok: false, applied: { soul: true, toolsets: false, mcp_servers: true, ui_meta: true } }) }

    const outcome = await provisionAgent(partial, PROPOSAL)

    expect(outcome).toMatchObject({ kind: 'failed', step: 'configured', message: 'Hermes did not apply: toolsets.', terminal: false })
    expect((await ergates.getProposal('p-pim')).step_status.configured).toBe('failed')
  })

  it('waits while the server does not see the plugin yet, then completes on the next run', async () => {
    const { deps, ergates } = hermes()
    // The plugin route answers, but Hermes does not list the plugin in the profile yet.
    const slow: ProvisionDeps = {
      ...deps,
      ergates: {
        acceptProposal: (id, proposal) => ergates.acceptProposal(id, proposal),
        recordProposalStep: (id, step, status) => ergates.recordProposalStep(id, step, status),
        enablePlugin: async profile => ({ profile, enabled: true })
      }
    }

    expect(await provisionAgent(slow, PROPOSAL)).toEqual({ kind: 'not_ready', profile: 'pim' })
    await ergates.enablePlugin('pim')
    expect(await provisionAgent(deps, PROPOSAL)).toEqual({ kind: 'complete', profile: 'pim' })
  })

  it('stops for good when the accept is refused', async () => {
    const { deps, profiles } = hermes()
    profiles.add('pim')

    expect(await provisionAgent(deps, PROPOSAL)).toMatchObject({ kind: 'failed', step: 'accept', code: 'name_taken', terminal: true })
  })

  it('stops for good when the half-built profile was deleted', async () => {
    const { deps, profiles } = hermes()
    const createProfile = deps.createProfile
    await provisionAgent({ ...deps, configureProfile: () => Promise.reject(new GatewayError('network', 'No connection to the gateway.')) }, PROPOSAL)
    profiles.delete('pim')

    const outcome = await provisionAgent({ ...deps, createProfile }, PROPOSAL)

    expect(outcome).toMatchObject({ kind: 'failed', step: 'profile_created', terminal: true })
    expect(outcome.kind === 'failed' ? outcome.message : '').toContain('deleted')
  })

  it('shows a create that Hermes refused as a failed first step', async () => {
    const { deps, ergates } = hermes()
    const refusing: ProvisionDeps = { ...deps, createProfile: () => Promise.reject(new GatewayError('rpc', "profile name 'pim' is reserved", { code: 4062 })) }

    expect(await provisionAgent(refusing, PROPOSAL)).toMatchObject({ kind: 'failed', step: 'profile_created', terminal: false })
    expect((await ergates.getProposal('p-pim')).step_status.profile_created).toBe('failed')
  })
})

describe('provisionOnce', () => {
  it('shares one run between two callers for the same proposal', async () => {
    const { deps, calls } = hermes()

    const [a, b] = await Promise.all([provisionOnce('p-pim', () => provisionAgent(deps, PROPOSAL)), provisionOnce('p-pim', () => provisionAgent(deps, PROPOSAL))])

    expect(a).toBe(b)
    expect(calls.create).toHaveLength(1)
  })
})

describe('provisionDeps', () => {
  it('provisions through the gateway port: profile, plugin, Bot Chat and a queued briefing', async () => {
    const gateway = new FakeGateway()
    gateway.ergates.record(PROPOSAL)

    const outcome = await provisionAgent(provisionDeps(gateway, openCanonicalChat), PROPOSAL)

    expect(outcome).toEqual({ kind: 'complete', profile: 'pim' })
    expect(gateway.profileNames.has('pim')).toBe(true)
    const submits = gateway.connectionFor('pim').requests.filter(r => r.method === 'prompt.submit')
    expect(submits.map(r => r.params)).toEqual([expect.objectContaining({ text: PROPOSAL.briefing, queued: true })])
  })
})

describe('parseAgentProposal', () => {
  it('accepts exactly the tool result and keeps the object as it came', () => {
    const raw = JSON.parse(JSON.stringify(PROPOSAL)) as unknown
    expect(parseAgentProposal(raw)).toBe(raw)
  })

  it.each([
    ['a tool error', { error: 'name must match ^[a-z0-9][a-z0-9-]{1,31}$' }],
    ['another kind', { ...PROPOSAL, kind: 'ergates.agent-proposal.v2' }],
    ['no briefing', { ...PROPOSAL, briefing: undefined }],
    ['a bad name', { ...PROPOSAL, agent: { ...PROPOSAL.agent, name: '../x' } }],
    ['a bad expiry', { ...PROPOSAL, expires_at: 'soon' }],
    ['a missing agent field', { ...PROPOSAL, agent: { ...PROPOSAL.agent, model: 7 } }],
    ['text', 'here is a proposal'],
    ['nothing', null]
  ])('refuses %s', (_label, value) => {
    expect(parseAgentProposal(value)).toBeNull()
  })
})
