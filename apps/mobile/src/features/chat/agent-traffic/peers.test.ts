import { describe, expect, it } from 'vitest'

import { peerKey, profileForHandle, resolveHandle, resolveTarget, selfHandle } from './peers'
import type { RosterPeer } from './types'

const roster: RosterPeer[] = [
  { profile: 'default', name: 'Hermes', hasAvatar: true },
  { profile: 'kevin', name: 'Kevin', color: '#3b82f6', hasAvatar: false },
]

describe('selfHandle / resolveHandle', () => {
  it('maps hermes to default and profiles case-insensitively', () => {
    expect(selfHandle('default')).toBe('hermes')
    expect(selfHandle('kevin')).toBe('kevin')
    expect(resolveHandle('hermes', roster)).toMatchObject({ handle: 'hermes', profile: 'default', display: { name: 'Hermes', avatarProfile: 'default' } })
    expect(resolveHandle('KEVIN', roster)).toMatchObject({ profile: 'kevin', display: { name: 'Kevin', color: '#3b82f6' } })
    expect(resolveHandle('zed', roster)).toEqual({ handle: 'zed', display: { name: 'zed' } })
  })

  it('falls back to fallbackName, never emitting a profile key, for an unresolved handle', () => {
    expect(resolveHandle('zed', roster, 'Zed the Bot')).toEqual({ handle: 'zed', display: { name: 'Zed the Bot' } })
  })

  it('reports no roster peer for an unknown handle', () => {
    expect(profileForHandle('zed', roster)).toBeUndefined()
  })
})

describe('resolveTarget', () => {
  it('resolves targets with backend semantics', () => {
    expect(resolveTarget('@kevin', roster)).toMatchObject({ profile: 'kevin' })
    expect(resolveTarget('kevin', roster, ['kevin'])).toMatchObject({ remote: { peer: 'kevin' }, display: { name: 'an agent on kevin' } })
    expect(resolveTarget('office/kevin', roster)).toMatchObject({ remote: { peer: 'office', agent: 'kevin' }, display: { name: '@kevin on office' } })
    expect(resolveTarget('kevin@laptop', roster)).toMatchObject({ remote: { peer: 'laptop', agent: 'kevin' } })
    expect(resolveTarget('zed', roster)).toEqual({ handle: 'zed', display: { name: 'zed' } })
    expect(peerKey(resolveTarget('kevin', roster))).toBe('local:kevin')
  })

  it('keys remote peers by peer/agent (agent defaulting to empty) and unresolved handles by handle', () => {
    expect(peerKey(resolveTarget('office/kevin', roster))).toBe('remote:office/kevin')
    expect(peerKey(resolveTarget('kevin', roster, ['kevin']))).toBe('remote:kevin/')
    expect(peerKey(resolveTarget('zed', roster))).toBe('handle:zed')
  })
})
