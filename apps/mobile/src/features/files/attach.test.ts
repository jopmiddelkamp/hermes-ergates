import { describe, expect, it, vi } from 'vitest'

import type { GatewayPort } from '@/gateway/port'

import {
  attachDocument,
  attachImage,
  AVATAR_QUALITY_STEPS,
  base64Bytes,
  composeOutgoingText,
  encodeUnderCap,
  guessMime,
  validateSize,
  type PendingAttachment
} from './attach'

describe('attachment helpers', () => {
  it('computes decoded bytes and validates sizes', () => {
    expect(base64Bytes('QUJD')).toBe(3)
    expect(base64Bytes('QUI=')).toBe(2)
    expect(validateSize(0, 10)).toMatch(/empty/)
    expect(validateSize(11, 10)).toMatch(/limit/)
    expect(validateSize(5, 10)).toBeNull()
    expect(guessMime('photos.ZIP')).toBe('application/zip')
    expect(guessMime('x.unknown')).toBe('application/octet-stream')
  })
  it('stops the avatar quality ladder at the first encoding under the cap', async () => {
    // 4 base64 chars = 3 bytes, so length is a stand-in for encoded size.
    const encode = vi.fn(async (quality: number) => 'A'.repeat(quality >= 0.8 ? 40 : 8))
    const fits = await encodeUnderCap(encode, AVATAR_QUALITY_STEPS, 20)
    expect(encode.mock.calls.map(c => c[0])).toEqual([0.8, 0.6])
    expect(fits).toMatchObject({ quality: 0.6, bytes: 6, underCap: true })

    const first = await encodeUnderCap(async () => 'AAAA', AVATAR_QUALITY_STEPS, 20)
    expect(first).toMatchObject({ quality: 0.8, bytes: 3, underCap: true })

    // Still over the cap at the lowest quality: report the last attempt so the
    // caller (Edit Bot's `validate`) can reject it with the size message.
    const tooBig = await encodeUnderCap(async () => 'A'.repeat(40), AVATAR_QUALITY_STEPS, 20)
    expect(tooBig).toMatchObject({ quality: 0.6, bytes: 30, underCap: false })

    const empty = await encodeUnderCap(async () => '', AVATAR_QUALITY_STEPS, 20)
    expect(empty).toMatchObject({ base64: '', bytes: 0, underCap: false })
  })
  it('appends file references after the user text', () => {
    const atts: PendingAttachment[] = [
      { id: '1', kind: 'file', name: 'a.zip', bytes: 1, refText: '@file:uploads/a.zip', state: 'attached' },
      { id: '2', kind: 'file', name: 'b.zip', bytes: 1, refText: '@file:uploads/b.zip', state: 'failed' }
    ]
    expect(composeOutgoingText('Look at this', atts)).toBe('Look at this\n\n@file:uploads/a.zip')
    expect(composeOutgoingText('', atts)).toBe('@file:uploads/a.zip')
    expect(composeOutgoingText('plain', [])).toBe('plain')
  })
  it('attaches an image through image.attach_bytes and reports failures', async () => {
    const port = { sessions: { attachImageBytes: vi.fn(async () => ({ attached: true })), attachFile: vi.fn(async () => ({ attached: true, name: 'a.zip', ref_text: '@file:a.zip' })) } } as unknown as GatewayPort
    const ok = await attachImage(port, 'live', { base64: 'QUJD', name: 'p.jpg', bytes: 3, previewUri: 'data:image/jpeg;base64,QUJD' })
    expect(ok.state).toBe('attached')
    expect(port.sessions.attachImageBytes).toHaveBeenCalledWith({ session_id: 'live', content_base64: 'QUJD', filename: 'p.jpg', ext: 'jpg' })
    const tooBig = await attachImage(port, 'live', { base64: 'QUJD', name: 'p.jpg', bytes: 30 * 1024 * 1024, previewUri: '' })
    expect(tooBig.state).toBe('failed')
    const doc = await attachDocument(port, 'live', { base64: 'QUJD', name: 'a.zip', bytes: 3, mime: 'application/zip' })
    expect(doc).toMatchObject({ state: 'attached', refText: '@file:a.zip' })
    expect(port.sessions.attachFile).toHaveBeenCalledWith({ session_id: 'live', data_url: 'data:application/zip;base64,QUJD', name: 'a.zip' })
  })
})
