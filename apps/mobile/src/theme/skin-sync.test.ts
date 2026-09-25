import { describe, expect, it } from 'vitest'

import ready from '@test/fixtures/gateway-ready.json'

import { clearPendingApply, ingestSkin, initialSkinSyncState } from './skin-sync'

const readySkin = (ready as { payload: { skin: unknown } }).payload.skin
const custom = { name: 'ocean', colors: { background: '#0a1a2a', ui_text: '#e0f0ff', ui_accent: '#3fa9f5', ui_error: '#ff5566' } }

describe('ingestSkin', () => {
  it('ignores invalid payloads', () => {
    expect(ingestSkin(initialSkinSyncState, null, true)).toBe(initialSkinSyncState)
    expect(ingestSkin(initialSkinSyncState, { name: '  ' }, true)).toBe(initialSkinSyncState)
    expect(ingestSkin(initialSkinSyncState, { name: 'x', colors: 'nope' }, true)).toBe(initialSkinSyncState)
  })
  it('seeds without applying and never registers default', () => {
    const s = ingestSkin(initialSkinSyncState, readySkin, false)
    expect(s.pendingApply).toBeNull()
    expect(s.lastSynced).toEqual({ name: 'default', applied: false })
    expect(Object.keys(s.backend)).toEqual([])
  })
  it('registers a custom skin and applies on an explicit change', () => {
    const seeded = ingestSkin(initialSkinSyncState, custom, false)
    expect(seeded.backend.ocean?.colors.background).toBe('#0a1a2a')
    expect(seeded.pendingApply).toBeNull()
    const applied = ingestSkin(seeded, custom, true)
    expect(applied.pendingApply).toBe('ocean')
    expect(applied.lastSynced).toEqual({ name: 'ocean', applied: true })
    const again = ingestSkin(clearPendingApply(applied), custom, true)
    expect(again.pendingApply).toBeNull()
  })
  it('applies a built-in name without registering it', () => {
    const s = ingestSkin(initialSkinSyncState, { name: 'mono', colors: {} }, true)
    expect(s.pendingApply).toBe('mono')
    expect(s.backend.mono).toBeUndefined()
  })
  it('ignores explicit changes from an inactive connection', () => {
    const s = ingestSkin(initialSkinSyncState, custom, true, false)
    expect(s.pendingApply).toBeNull()
    expect(s.backend.ocean).toBeDefined()
  })
  it('applies a re-affirmed name after a seed-only baseline', () => {
    const seeded = ingestSkin(initialSkinSyncState, { name: 'slate', colors: {} }, false)
    const applied = ingestSkin(seeded, { name: 'slate', colors: {} }, true)
    expect(applied.pendingApply).toBe('slate')
  })
})
