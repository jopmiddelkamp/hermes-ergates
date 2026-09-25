import { describe, expect, it, vi } from 'vitest'

import { GatewayError } from '@/gateway/errors'
import type { GatewayPort } from '@/gateway/port'
import type { ProfileSummary, SessionRow } from '@/gateway/types'
import profilesList from '@test/fixtures/profiles-list.json'

import { BOT_CHAT_TITLE, decideCanonical, openCanonicalChat } from './canonical-chat'

const profiles = (profilesList as { profiles: ProfileSummary[] }).profiles
const linh = profiles[0]!
const thijs = profiles[2]!

describe('decideCanonical', () => {
  it('prefers the roster pointer', () => {
    expect(decideCanonical(linh, [])).toEqual({ action: 'resume', storedId: '20260912_160448_44e00d' })
  })
  it('uses resolved_id from the lookup row', () => {
    const rows: SessionRow[] = [{ id: 'root', resolved_id: 'tip', title: BOT_CHAT_TITLE, preview: '', started_at: 1, message_count: 3, source: 'desktop' }]
    expect(decideCanonical(thijs, rows)).toEqual({ action: 'resume', storedId: 'tip' })
  })
  it('creates only when the lookup succeeded and is empty', () => {
    expect(decideCanonical(thijs, [])).toEqual({ action: 'create' })
    expect(() => decideCanonical(thijs, null)).toThrow(/not starting a new chat/)
  })
  it('ignores rows with another title', () => {
    const rows: SessionRow[] = [{ id: 'x', title: 'Other', preview: '', started_at: 1, message_count: 0, source: 'tui' }]
    expect(decideCanonical(undefined, rows)).toEqual({ action: 'create' })
  })
  it('treats an empty lookup next to a reported canonical session as unconfirmed absence', () => {
    // hermes-agent#98383: a warming-up profile backend answers session.list
    // successfully with an EMPTY list. The roster reporting a canonical_session at
    // all is positive confirmation that this bot has one, so minting forks it.
    // (An id the roster did resolve resumes before this guard is reached.)
    const pointed = { ...thijs, canonical_session: { id: '', resolved_id: '', title: BOT_CHAT_TITLE, message_count: 12 } } as ProfileSummary
    expect(() => decideCanonical(pointed, [])).toThrow(/not starting a new chat/)
    const resolvable: ProfileSummary = { ...thijs, canonical_session: { id: '20260101_000000_aaa', resolved_id: '', title: BOT_CHAT_TITLE } }
    expect(decideCanonical(resolvable, [])).toEqual({ action: 'resume', storedId: '20260101_000000_aaa' })
  })
  it('mints only when the backend says there is no canonical session', () => {
    const none: ProfileSummary = { ...thijs, canonical_session: null }
    expect(decideCanonical(none, [])).toEqual({ action: 'create' })
  })
})

const CANONICAL_ROW: SessionRow = { id: 'stored-winner', title: BOT_CHAT_TITLE, preview: '', started_at: 1, message_count: 12, source: 'desktop' }

function stubPort(over: Partial<GatewayPort['sessions']>): GatewayPort {
  const sessions = {
    list: vi.fn(async () => ({ sessions: [] as SessionRow[] })),
    create: vi.fn(async () => ({ session_id: 'live-new', stored_session_id: 'stored-new', message_count: 0, messages: [], info: {} })),
    title: vi.fn(async (_id: string, title: string) => ({ pending: false, title })),
    resume: vi.fn(async () => ({ session_id: 'live-r', resumed: 's', session_key: 'stored-r', message_count: 1, messages: [{ role: 'user' as const, text: 'hi' }], info: {}, running: false, status: 'idle' })),
    ...over
  }
  return { sessions } as unknown as GatewayPort
}

describe('openCanonicalChat', () => {
  it('resumes through the pointer without a lookup', async () => {
    const port = stubPort({})
    const opened = await openCanonicalChat(port, 'default', linh)
    expect(port.sessions.list).not.toHaveBeenCalled()
    expect(port.sessions.resume).toHaveBeenCalledWith({ session_id: '20260912_160448_44e00d', profile: 'default' })
    expect(opened).toMatchObject({ liveSessionId: 'live-r', storedSessionId: 'stored-r', created: false })
  })

  it('carries the resume payload the idle snapshot reads, and none for a created chat', async () => {
    const port = stubPort({
      resume: vi.fn(async () => ({ session_id: 'live-r', resumed: 's', session_key: 'stored-r', message_count: 0, messages: [], info: {}, running: false, status: 'idle', hydrating: true }))
    })
    const opened = await openCanonicalChat(port, 'default', linh)
    expect(opened.snapshot).toEqual({ status: 'idle', running: false, inflight: null, hydrating: true, auto_continue: undefined })
    // A chat we just minted has no resume payload at all.
    expect((await openCanonicalChat(stubPort({}), 'thijs', thijs)).snapshot).toBeNull()
  })

  it('creates a hidden Bot Chat that follows the profile config, then titles it eagerly', async () => {
    const port = stubPort({})
    const opened = await openCanonicalChat(port, 'thijs', thijs)
    expect(port.sessions.list).toHaveBeenCalledWith({ profile: 'thijs', title: BOT_CHAT_TITLE, limit: 200, include_hidden: true })
    expect(port.sessions.create).toHaveBeenCalledWith({ title: BOT_CHAT_TITLE, profile: 'thijs', hidden: true, follow_profile_config: true })
    // session.create is lazy: without this write there is no "Bot Chat" row, so a
    // second open during the first turn mints a duplicate.
    expect(port.sessions.title).toHaveBeenCalledWith('live-new', BOT_CHAT_TITLE)
    expect(opened).toMatchObject({ liveSessionId: 'live-new', storedSessionId: 'stored-new', created: true })
  })

  it('fails closed when the lookup rejects', async () => {
    const port = stubPort({ list: vi.fn(async () => { throw new Error('boom') }) })
    await expect(openCanonicalChat(port, 'thijs', thijs)).rejects.toThrow(/not starting a new chat/)
    expect(port.sessions.create).not.toHaveBeenCalled()
  })

  it('adopts the winner when the title is already taken', async () => {
    let listCalls = 0
    const port = stubPort({
      list: vi.fn(async () => {
        listCalls += 1
        return { sessions: listCalls === 1 ? [] : [CANONICAL_ROW] }
      }),
      title: vi.fn(async () => {
        throw new GatewayError('rpc', "Title 'Bot Chat' is already in use by session stored-winner", { code: 4022 })
      })
    })
    const opened = await openCanonicalChat(port, 'thijs', thijs)
    // ADOPT-BEFORE-MINT: prompting into our own stray session would fork the chat.
    expect(port.sessions.resume).toHaveBeenCalledWith({ session_id: 'stored-winner', profile: 'thijs' })
    expect(opened).toMatchObject({ liveSessionId: 'live-r', created: false })
    expect(listCalls).toBe(2)
  })

  it('fails closed when the post-conflict lookup finds nothing', async () => {
    const port = stubPort({
      title: vi.fn(async () => {
        throw new GatewayError('rpc', "Title 'Bot Chat' is already in use by session other", { code: 4022 })
      })
    })
    await expect(openCanonicalChat(port, 'thijs', thijs)).rejects.toThrow(/not starting a new chat/)
    expect(port.sessions.resume).not.toHaveBeenCalled()
  })

  it('keeps the new session when an older gateway rejects the eager title write', async () => {
    const port = stubPort({
      title: vi.fn(async () => {
        throw new GatewayError('rpc', 'method not found: session.title', { code: -32601 })
      })
    })
    const opened = await openCanonicalChat(port, 'thijs', thijs)
    expect(opened).toMatchObject({ liveSessionId: 'live-new', created: true })
  })
})
