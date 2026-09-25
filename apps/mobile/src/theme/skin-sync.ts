/**
 * Pure port of the desktop's backend skin sync (vendor source:
 * apps/desktop/src/themes/backend-sync.ts at the pin), without nanostores
 * or localStorage. `gateway.ready.skin` seeds (apply=false); `skin.changed`
 * applies (apply=true) — only from the active connection.
 */

import type { HermesSkin } from '@vendor/hermes/shared/skin'
import { BUILTIN_THEMES } from '@vendor/hermes/themes/presets'
import { skinToDesktopTheme } from '@vendor/hermes/themes/skin'
import { isValidTheme, type DesktopTheme } from '@vendor/hermes/themes/types'

export interface SkinSyncState {
  backend: Record<string, DesktopTheme>
  lastSynced: { name: string; applied: boolean } | null
  pendingApply: string | null
}

export const initialSkinSyncState: SkinSyncState = { backend: {}, lastSynced: null, pendingApply: null }

function skinName(skin: unknown): string {
  if (!skin || typeof skin !== 'object') {
    return ''
  }
  const name = (skin as { name?: unknown }).name
  return typeof name === 'string' ? name.trim() : ''
}

export function ingestSkin(state: SkinSyncState, skin: unknown, apply: boolean, connectionIsActive = true): SkinSyncState {
  const name = skinName(skin)
  if (!name) {
    return state
  }
  let next = state
  if (name !== 'default' && !BUILTIN_THEMES[name]) {
    const theme = skinToDesktopTheme(skin as HermesSkin)
    if (!theme || !isValidTheme(theme)) {
      return state
    }
    if (JSON.stringify(state.backend[name]) !== JSON.stringify(theme)) {
      next = { ...next, backend: { ...state.backend, [name]: theme } }
    }
  }
  if (!apply) {
    if (next.lastSynced?.name !== name || !next.lastSynced.applied) {
      next = { ...next, lastSynced: { name, applied: false } }
    }
    return next
  }
  if (!connectionIsActive) {
    return next
  }
  if (name !== next.lastSynced?.name || !next.lastSynced.applied) {
    next = { ...next, lastSynced: { name, applied: true }, pendingApply: name }
  }
  return next
}

/** The provider drains the pending apply after switching the preference. */
export function clearPendingApply(state: SkinSyncState): SkinSyncState {
  return state.pendingApply === null ? state : { ...state, pendingApply: null }
}
