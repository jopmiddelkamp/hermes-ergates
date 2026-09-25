/**
 * Auth flows against `hermes serve` (docs/06 section 2).
 */

import { GatewayError, isGatewayError } from '../errors'
import type { AuthIdentity, BackendStatus } from '../types'
import type { HttpClient } from './http'

export async function readStatus(http: HttpClient): Promise<BackendStatus> {
  return http.get<BackendStatus>('/api/status')
}

export async function passwordLogin(http: HttpClient, p: { provider: string; username: string; password: string }): Promise<void> {
  const res = await http.post<{ ok?: boolean; next?: string }>('/auth/password-login', {
    provider: p.provider,
    username: p.username,
    password: p.password
  })
  if (!res || res.ok !== true) {
    throw new GatewayError('unauthorized', 'Sign-in was not accepted.')
  }
}

export async function whoAmI(http: HttpClient): Promise<AuthIdentity | null> {
  try {
    return await http.get<AuthIdentity>('/api/auth/me')
  } catch (err) {
    if (isGatewayError(err) && err.kind === 'unauthorized') {
      return null
    }
    throw err
  }
}

export async function mintTicket(http: HttpClient): Promise<string> {
  const res = await http.post<{ ticket?: string; ttl_seconds?: number }>('/api/auth/ws-ticket')
  if (!res?.ticket) {
    throw new GatewayError('unauthorized', 'The gateway did not mint a socket ticket.')
  }
  return res.ticket
}

export async function logoutRequest(http: HttpClient): Promise<void> {
  try {
    await http.post('/auth/logout')
  } catch (err) {
    // Best effort: the local secrets are cleared regardless.
    if (!isGatewayError(err) || err.kind === 'network' || err.kind === 'timeout') {
      return
    }
  }
}

/** Build the socket URL. Query values are encoded; never log the result. */
export function buildSocketUrl(baseUrl: string, profile: string, auth: { token?: string; ticket?: string }): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/ws`
  url.search = ''
  url.searchParams.set('profile', profile)
  if (auth.ticket) {
    url.searchParams.set('ticket', auth.ticket)
  } else if (auth.token) {
    url.searchParams.set('token', auth.token)
  }
  return url.toString()
}
