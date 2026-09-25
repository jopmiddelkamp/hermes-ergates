/**
 * The push deep link (roadmap contract C5, docs/11 section 4.2).
 *
 * The server's ntfy `Click` URL is
 * `ergates://chat/<session_id>?connection=<connection_id>&profile=<profile>`
 * (integrations/ergates/ergates/delivery.py `deep_link`: the session is
 * percent-encoded in the path, the query is form-encoded). Expo Router would
 * match `chat/<session_id>` to `app/chat/[profile]` and open a chat for a
 * profile named like the session (roadmap bug 7), so `app/+native-intent.tsx`
 * rewrites the link to `/open`, and `app/open.tsx` picks the connection and
 * the chat. The session id is kept for the record only: the app opens the
 * profile's Bot Chat, which shows its pending requests itself.
 *
 * Pure: no React, React Native or Expo, so both steps are tested in Node.
 */

/** `<scheme>://chat/<session>?<query>`, or the same without the scheme. */
const CHAT_LINK = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?chat\/([^/?#]+)\?([^#]*)$/i
/** Hermes profile ids at the pin (hermes_cli/profiles.py `_PROFILE_ID_RE`). */
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function decodePart(value: string, form: boolean): string | null {
  try {
    return decodeURIComponent(form ? value.replace(/\+/g, ' ') : value)
  } catch {
    return null
  }
}

/**
 * `/open?connection=…&profile=…&session=…` for a push chat link; any other
 * path, or a malformed link, comes back unchanged.
 */
export function rewriteDeepLink(path: string): string {
  const match = CHAT_LINK.exec(path)
  if (!match) {
    return path
  }
  const session = decodePart(match[1]!, false)
  const query = new Map<string, string>()
  for (const part of match[2]!.split('&').filter(Boolean)) {
    const eq = part.indexOf('=')
    const key = decodePart(eq < 0 ? part : part.slice(0, eq), true)
    const value = decodePart(eq < 0 ? '' : part.slice(eq + 1), true)
    if (key === null || value === null) {
      return path
    }
    query.set(key, value)
  }
  const connection = query.get('connection')
  if (!session || !connection) {
    return path
  }
  const params: [string, string | undefined][] = [
    ['connection', connection],
    ['profile', query.get('profile')],
    ['session', session]
  ]
  return `/open?${params
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`
}

export type OpenTarget = { kind: 'connect' } | { kind: 'home'; connectionId: string } | { kind: 'chat'; connectionId: string; profile: string }

/**
 * Where `/open` goes. An unknown connection leads to connection selection:
 * the link only names a connection this phone already has, and the app never
 * trusts anything else it carries (docs/11 section 4.2).
 */
export function openTarget(connections: readonly { id: string }[], params: { connection?: string; profile?: string }): OpenTarget {
  const known = connections.find(c => c.id === params.connection)
  if (!known) {
    return { kind: 'connect' }
  }
  if (!params.profile || !PROFILE_RE.test(params.profile)) {
    return { kind: 'home', connectionId: known.id }
  }
  return { kind: 'chat', connectionId: known.id, profile: params.profile }
}
