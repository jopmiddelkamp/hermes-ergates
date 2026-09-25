/**
 * Rewrites a push deep link before Expo Router matches it:
 * `ergates://chat/<session>?connection=…&profile=…` goes to `/open`, never to
 * `app/chat/[profile]` with the session id as the profile.
 * The rules and their tests live in `src/features/attention/deep-link.ts`.
 */

import { rewriteDeepLink } from '@/features/attention'

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return rewriteDeepLink(path)
  } catch {
    // Expo Router: a throw here can crash the app on launch. Keep the link as it came.
    return path
  }
}
