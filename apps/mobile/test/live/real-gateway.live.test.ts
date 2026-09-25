/**
 * Live smoke check against a real `hermes serve` (docs/11 section 3).
 * Runs only when ERGATES_LIVE=1. Needs ERGATES_BASE_URL and either
 * ERGATES_TOKEN (loopback token mode) or ERGATES_USER/ERGATES_PASSWORD.
 *
 *   ERGATES_LIVE=1 ERGATES_BASE_URL=http://127.0.0.1:9119 ERGATES_TOKEN=... npx vitest run test/live
 */
import { describe, expect, it } from 'vitest'

import { RealGateway } from '@/gateway/real/real-gateway'
import { MemorySecretStore } from '@/gateway/real/secrets'
import { BOT_CHAT_TITLE, openCanonicalChat } from '@/features/chat/canonical-chat'

const live = process.env.ERGATES_LIVE === '1'
const baseUrl = process.env.ERGATES_BASE_URL ?? 'http://127.0.0.1:9119'

describe.runIf(live)('real gateway against a live backend', () => {
  it('signs in, lists the roster, opens the canonical chat and replays', async () => {
    const gateway = new RealGateway({ connectionId: 'live', baseUrl, secrets: new MemorySecretStore() })
    const status = await gateway.status()
    expect(status.version).toMatch(/^\d+\.\d+/)
    if (status.auth_required) {
      await gateway.login({ mode: 'password', provider: process.env.ERGATES_PROVIDER ?? 'basic', username: process.env.ERGATES_USER ?? '', password: process.env.ERGATES_PASSWORD ?? '' })
      const me = await gateway.me()
      expect(me?.user_id).toBeTruthy()
    } else {
      await gateway.login({ mode: 'token', token: process.env.ERGATES_TOKEN ?? '' })
    }

    const roster = await gateway.profiles.list()
    expect(roster.profiles.length).toBeGreaterThan(0)
    const first = roster.profiles[0]!
    // Never log friendly names or titles: they are the operator's own data.
    console.log('roster size:', roster.profiles.length, 'bot_mode_protocol:', roster.bot_mode_protocol ?? false)

    const conn = await gateway.connect(first.name)
    expect(conn.ready.replay_epoch).toBeTruthy()

    const opened = await openCanonicalChat(gateway, first.name, first)
    console.log('canonical chat:', { messages: opened.messages.length, created: opened.created, running: opened.running })
    expect(opened.storedSessionId).toBeTruthy()
    if (first.canonical_session?.id) {
      expect(opened.created).toBe(false)
    }

    // The reconnect rebind: session.activate must answer for this live session.
    const activated = await gateway.sessions.activate(opened.liveSessionId)
    expect(activated.session_id).toBe(opened.liveSessionId)
    expect(typeof activated.status).toBe('string')
    expect(typeof activated.running).toBe('boolean')
    expect(activated.messages_omitted).toBe(true)

    const history = await gateway.sessions.history(opened.liveSessionId)
    expect(history.messages.length).toBe(opened.messages.length)
    const replay = await conn.replay(opened.liveSessionId, 0)
    expect(replay.epoch).toBe(conn.ready.replay_epoch)
    console.log('replay:', { latest_seq: replay.latest_seq, truncated: replay.truncated, count: replay.count })

    const describe = await gateway.profiles.describe(first.name)
    expect(describe.model.provider).toBeTruthy()
    const options = await gateway.profiles.modelOptions(first.name)
    expect(options.providers.some(p => p.authenticated)).toBe(true)
    // `cron.manage {action:'list'}` answers `{success, count, jobs}`
    // (tools/cronjob_tools.py:601); `scoped` echoes the profile on modern gateways.
    const cronEnvelope = await conn.request<{ success?: boolean; count?: number; jobs?: unknown[]; scoped?: string }>('cron.manage', {
      action: 'list',
      include_disabled: true,
      profile: first.name
    })
    expect(cronEnvelope.success).toBe(true)
    expect(Array.isArray(cronEnvelope.jobs)).toBe(true)
    expect(cronEnvelope.count).toBe(cronEnvelope.jobs?.length)
    const routines = await gateway.routines.list(first.name)
    expect(routines.length).toBe(cronEnvelope.count)
    for (const job of routines) {
      expect(job.id).toBeTruthy()
      expect(typeof job.enabled).toBe('boolean')
    }
    const toolsets = await gateway.tools.toolsets(first.name)
    expect(toolsets.length).toBeGreaterThan(0)
    const memory = await gateway.profiles.memory(first.name)
    console.log('memory available:', memory.available, 'MEMORY.md bytes:', memory.memory.length)

    // The exact-title registry: at most one row, and it is the chat we opened.
    const lookup = await gateway.sessions.list({ profile: first.name, title: BOT_CHAT_TITLE, limit: 200, include_hidden: true })
    expect(lookup.sessions.length).toBeLessThanOrEqual(1)
    if (lookup.sessions.length === 1) {
      const row = lookup.sessions[0]!
      expect(row.title).toBe(BOT_CHAT_TITLE)
      expect([row.id, row.resolved_id].filter(Boolean)).toContain(opened.storedSessionId)
    } else {
      // A freshly created chat is titled eagerly, so the registry must know it.
      expect(opened.created).toBe(false)
    }

    gateway.disconnectAll()
  }, 60_000)
})
