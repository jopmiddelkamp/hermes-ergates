import { describe, expect, it, vi } from 'vitest'

import type { GatewayPort } from '@/gateway/port'

import { AGENT_COLORS, colorForName, createAgent, slugFromTitle, validateCreate } from './create'

function port(over: { create?: () => Promise<unknown>; configure?: () => Promise<unknown>; sessionCreate?: () => Promise<unknown> } = {}): GatewayPort {
  return {
    profiles: {
      create: vi.fn(over.create ?? (async () => ({ ok: true }))),
      configure: vi.fn(over.configure ?? (async () => ({ ok: true, applied: { ui_meta: true } })))
    },
    sessions: {
      create: vi.fn(over.sessionCreate ?? (async () => ({ session_id: 'live', stored_session_id: 'stored', message_count: 0, messages: [], info: {} }))),
      title: vi.fn(async () => ({ ok: true }))
    }
  } as unknown as GatewayPort
}

describe('createAgent', () => {
  it('validates names, titles and model pairs', () => {
    expect(validateCreate({ name: 'Bad Name', title: 'X' }).name).toBeTruthy()
    expect(validateCreate({ name: 'ok-name', title: ' ' }).title).toBeTruthy()
    expect(validateCreate({ name: 'ok-name', title: 'X', provider: 'anthropic' }).model).toBeTruthy()
    expect(validateCreate({ name: 'ok-name', title: 'X' })).toEqual({})
    expect(slugFromTitle('Dining Scout!')).toBe('dining-scout')
    expect(slugFromTitle('Élodie')).toBe('elodie')
  })

  it('creates without credential mirroring, sets the title and role, then opens the Bot Chat', async () => {
    const p = port()
    const result = await createAgent(p, { name: 'thijs', title: 'Thijs', role: 'Bookkeeper', description: 'Reads invoices', provider: 'anthropic', model: 'claude-sonnet-5' })
    expect(p.profiles.create).toHaveBeenCalledWith({ name: 'thijs', description: 'Reads invoices', provider: 'anthropic', model: 'claude-sonnet-5', mirror_credentials: false })
    expect(p.profiles.configure).toHaveBeenCalledWith({
      name: 'thijs',
      ui_meta: {
        'hermes-bots': { title: 'Thijs', hidden: false, custom: true, imageKind: 'initials', shape: 'circle', color: colorForName('thijs') },
        ergates: { role: 'Bookkeeper' }
      }
    })
    expect(p.sessions.create).toHaveBeenCalledWith({ title: 'Bot Chat', profile: 'thijs', hidden: true, follow_profile_config: true })
    // session.create is lazy: the eager title write materializes the canonical row.
    expect(p.sessions.title).toHaveBeenCalledWith('live', 'Bot Chat')
    expect(result).toEqual({ profile: 'thijs', sessionId: 'stored', steps: { create: 'done', metadata: 'done', chat: 'done' } })
  })

  it('gives each new agent a stable palette color so they differ on Home', () => {
    expect(AGENT_COLORS).toContain(colorForName('thijs'))
    expect(colorForName('thijs')).toBe(colorForName('thijs'))
    expect(colorForName('thijs')).not.toBe(colorForName('kevin'))
  })

  it('reports the failed step without cleanup', async () => {
    const p = port({ configure: async () => { throw new Error('conflict') } })
    const result = await createAgent(p, { name: 'thijs', title: 'Thijs' })
    expect(result.steps).toEqual({ create: 'done', metadata: 'failed', chat: 'skipped' })
    expect(result.error).toBe('conflict')
    expect(p.sessions.create).not.toHaveBeenCalled()
  })
})
