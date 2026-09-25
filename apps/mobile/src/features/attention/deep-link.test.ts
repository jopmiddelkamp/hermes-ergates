/**
 * The push deep link (roadmap contract C5). The server sends
 * `ergates://chat/<session_id>?connection=<id>&profile=<name>`
 * (integrations/ergates/ergates/delivery.py `deep_link`); the app must open the
 * chat of `profile` on connection `id`, never a chat named after the session.
 */
import { describe, expect, it } from 'vitest'

import { openTarget, rewriteDeepLink } from './deep-link'

const connections = [{ id: 'conn-1' }, { id: 'conn-2' }]

describe('rewriteDeepLink', () => {
  it('bug 7: a push link opens the chat of its profile, not a chat named after its session', () => {
    // Before the rewrite, Expo Router matched `chat/<session_id>` to
    // `app/chat/[profile]` and opened a chat for a "profile" called session-1.
    const path = rewriteDeepLink('ergates://chat/session-1?connection=conn-1&profile=thijs')
    expect(path).toBe('/open?connection=conn-1&profile=thijs&session=session-1')

    const params = Object.fromEntries(new URLSearchParams(path.split('?')[1]))
    expect(openTarget(connections, params)).toEqual({ kind: 'chat', connectionId: 'conn-1', profile: 'thijs' })
  })

  it('decodes the values the server encodes and encodes them again', () => {
    // delivery.py: the session is percent-encoded in the path, the query is form-encoded.
    const path = rewriteDeepLink('ergates://chat/sess%2Fwith%20slash?connection=conn+with+space&profile=name%26with%3Dchars')
    expect(path).toBe('/open?connection=conn%20with%20space&profile=name%26with%3Dchars&session=sess%2Fwith%20slash')
  })

  it('reads the path form as well as the full URL', () => {
    expect(rewriteDeepLink('/chat/s1?connection=conn-1&profile=thijs')).toBe('/open?connection=conn-1&profile=thijs&session=s1')
    expect(rewriteDeepLink('chat/s1?profile=thijs&connection=conn-1')).toBe('/open?connection=conn-1&profile=thijs&session=s1')
  })

  it('leaves every other link alone', () => {
    for (const path of [
      '/chat/thijs',
      'ergates://chat/thijs',
      '/settings',
      'exp+ergates://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081',
      'ergates://chat/s1?profile=thijs',
      'ergates://chat/s1/extra?connection=conn-1'
    ]) {
      expect(rewriteDeepLink(path)).toBe(path)
    }
  })
})

describe('openTarget', () => {
  it('sends an unknown connection to connection selection, never trusting the link', () => {
    expect(openTarget(connections, { connection: 'conn-9', profile: 'thijs' })).toEqual({ kind: 'connect' })
    expect(openTarget([], { connection: 'conn-1', profile: 'thijs' })).toEqual({ kind: 'connect' })
  })

  it('opens Home when the profile is missing or not a Hermes profile name', () => {
    expect(openTarget(connections, { connection: 'conn-2' })).toEqual({ kind: 'home', connectionId: 'conn-2' })
    expect(openTarget(connections, { connection: 'conn-2', profile: '../x' })).toEqual({ kind: 'home', connectionId: 'conn-2' })
  })

  it('opens the same chat however often the same push is tapped', () => {
    // Push is at least once: a repeated notification carries the same link.
    const link = 'ergates://chat/session-1?connection=conn-2&profile=kevin'
    const first = openTarget(connections, Object.fromEntries(new URLSearchParams(rewriteDeepLink(link).split('?')[1])))
    const again = openTarget(connections, Object.fromEntries(new URLSearchParams(rewriteDeepLink(link).split('?')[1])))
    expect(again).toEqual(first)
    expect(first).toEqual({ kind: 'chat', connectionId: 'conn-2', profile: 'kevin' })
  })
})
