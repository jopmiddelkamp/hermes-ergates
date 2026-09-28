/**
 * Peer resolution for bot-to-bot traffic in chat.
 * Pure: no React or React Native imports (ADR-029 rule 1).
 */

import type { PeerRef, RosterPeer } from './types'

export const PEER_TARGET_RE = /^([a-z0-9][a-z0-9_-]{0,63})\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})$/
export const CONNECTION_TARGET_RE = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})@([a-zA-Z0-9][a-zA-Z0-9_.-]{0,63})$/

/** The local profile's own handle: the `default` profile answers to `hermes`. */
export function selfHandle(profile: string): string {
  return profile === 'default' ? 'hermes' : profile
}

/** Finds the roster entry for a handle: `hermes` maps to the `default` profile; otherwise a case-insensitive profile match. */
export function profileForHandle(handle: string, roster: RosterPeer[]): RosterPeer | undefined {
  const lower = handle.toLowerCase()
  if (lower === 'hermes') return roster.find(peer => peer.profile === 'default')
  return roster.find(peer => peer.profile.toLowerCase() === lower)
}

/** Resolves a handle against the roster, falling back to a display-only peer when unregistered. */
export function resolveHandle(handle: string, roster: RosterPeer[], fallbackName?: string): PeerRef {
  const bot = profileForHandle(handle, roster)
  if (!bot) return { handle, display: { name: fallbackName ?? handle } }

  const display: PeerRef['display'] = { name: bot.name, avatarProfile: bot.profile }
  if (bot.color !== undefined) display.color = bot.color
  return { handle, profile: bot.profile, display }
}

function remotePeerRef(handle: string, peer: string, agent?: string): PeerRef {
  const remote: PeerRef['remote'] = agent !== undefined ? { peer, agent } : { peer }
  const name = agent !== undefined ? `@${agent} on ${peer}` : `an agent on ${peer}`
  return { handle, remote, display: { name } }
}

/** Resolves a `bot send` target: `peer/agent`, `handle@connection`, a registered connection handle, or a roster handle. */
export function resolveTarget(target: string, roster: RosterPeer[], registeredPeers?: string[]): PeerRef {
  const stripped = target.startsWith('@') ? target.slice(1) : target

  const peerMatch = PEER_TARGET_RE.exec(stripped)
  if (peerMatch) return remotePeerRef(stripped, peerMatch[1]!, peerMatch[2]!)

  const connectionMatch = CONNECTION_TARGET_RE.exec(stripped)
  if (connectionMatch) return remotePeerRef(stripped, connectionMatch[2]!, connectionMatch[1]!)

  if (registeredPeers?.includes(stripped.toLowerCase())) return remotePeerRef(stripped, stripped.toLowerCase())

  return resolveHandle(stripped, roster)
}

/** A stable dedup/lookup key for a resolved peer. */
export function peerKey(peer: PeerRef): string {
  if (peer.profile !== undefined) return `local:${peer.profile}`
  if (peer.remote !== undefined) return `remote:${peer.remote.peer}/${peer.remote.agent ?? ''}`
  return `handle:${peer.handle}`
}
