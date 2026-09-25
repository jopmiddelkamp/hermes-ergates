/**
 * Attachments (docs/02 section 3.9, docs/06 section 4):
 *  - photos: base64 JPEG from the picker -> `image.attach_bytes`
 *  - documents: bytes -> data URL -> `file.attach {data_url, name}` (the
 *    gateway stores the file and returns `ref_text` for the prompt)
 *  - avatars: square crop -> resize -> JPEG under the 2,000,000-byte asset cap
 * Pure validation helpers are separated so they run in Node tests.
 */

import { AVATAR_MAX_BYTES } from '@/features/agents'
import { userMessage } from '@/gateway/errors'
import type { GatewayPort } from '@/gateway/port'

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024
/** Long side of a stored avatar, in pixels. */
export const AVATAR_MAX_DIMENSION = 512
/** JPEG quality ladder for the avatar: the first that fits the cap wins. */
export const AVATAR_QUALITY_STEPS = [0.8, 0.6] as const

export interface PendingAttachment {
  id: string
  kind: 'image' | 'file'
  name: string
  bytes: number
  /** Local preview for images (data URL). */
  previewUri?: string
  /** Text the gateway wants placed in the prompt (files only). */
  refText?: string
  state: 'attaching' | 'attached' | 'failed'
  error?: string
}

export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s+/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

export function validateSize(bytes: number, max: number): string | null {
  if (bytes <= 0) {
    return 'The file is empty.'
  }
  if (bytes > max) {
    return `The file is ${(bytes / (1024 * 1024)).toFixed(1)} MB; the limit is ${Math.round(max / (1024 * 1024))} MB.`
  }
  return null
}

export function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const table: Record<string, string> = {
    zip: 'application/zip',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    heic: 'image/heic',
    webp: 'image/webp'
  }
  return table[ext] ?? 'application/octet-stream'
}

export function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

let counter = 0
const nextId = () => `att-${Date.now().toString(36)}-${++counter}`

/** Open the photo library and return a JPEG (the picker converts HEIC) as base64, or null when cancelled. */
export async function pickImage(): Promise<{ base64: string; name: string; bytes: number; previewUri: string } | null> {
  const ImagePicker = await import('expo-image-picker')
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new Error('Photo access was not allowed.')
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85, allowsMultipleSelection: false })
  if (result.canceled || !result.assets?.[0]) {
    return null
  }
  const asset = result.assets[0]
  const base64 = asset.base64 ?? ''
  if (!base64) {
    throw new Error('The photo could not be read.')
  }
  const name = asset.fileName?.replace(/\.(heic|heif)$/i, '.jpg') ?? `photo-${Date.now()}.jpg`
  return { base64, name, bytes: base64Bytes(base64), previewUri: `data:image/jpeg;base64,${base64}` }
}

/** Open the document picker and return the file as base64, or null when cancelled. */
export async function pickDocument(): Promise<{ base64: string; name: string; bytes: number; mime: string } | null> {
  const DocumentPicker = await import('expo-document-picker')
  const { File } = await import('expo-file-system')
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
  if (result.canceled || !result.assets?.[0]) {
    return null
  }
  const asset = result.assets[0]
  const size = asset.size ?? 0
  const sizeError = validateSize(size || 1, DOCUMENT_MAX_BYTES)
  if (sizeError) {
    throw new Error(sizeError)
  }
  const file = new File(asset.uri)
  const base64 = await file.base64()
  return { base64, name: asset.name, bytes: base64Bytes(base64), mime: asset.mimeType ?? guessMime(asset.name) }
}

export interface EncodeAttempt {
  base64: string
  bytes: number
  quality: number
  /** False when even the last quality step stayed over the cap. */
  underCap: boolean
}

/**
 * Encodes at each quality in turn and stops at the first result within `max`.
 * The encoder is injected so the loop is testable without the native image
 * manipulator.
 */
export async function encodeUnderCap(
  encode: (quality: number) => Promise<string>,
  qualities: readonly number[],
  max: number
): Promise<EncodeAttempt> {
  let last: EncodeAttempt = { base64: '', bytes: 0, quality: qualities[0] ?? 1, underCap: false }
  for (const quality of qualities) {
    const base64 = await encode(quality)
    const bytes = base64Bytes(base64)
    last = { base64, bytes, quality, underCap: bytes > 0 && bytes <= max }
    if (last.underCap) {
      return last
    }
  }
  return last
}

export interface PickedAvatar {
  /** `data:image/jpeg;base64,…`, ready for `profiles.set_asset`. */
  dataUrl: string
  bytes: number
  quality: number
  name: string
}

/**
 * Avatar picker (docs/10 "Edit Bot on mobile"): square crop in
 * the system editor, downscale to `AVATAR_MAX_DIMENSION` on the long side,
 * then JPEG at 0.8 and, if that is still over the cap, 0.6. A full-resolution
 * photo would otherwise be rejected by `validate()` with no way to shrink it.
 */
export async function pickAvatar(): Promise<PickedAvatar | null> {
  const ImagePicker = await import('expo-image-picker')
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new Error('Photo access was not allowed.')
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // iOS always crops to a square; `aspect` is the Android equivalent.
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    allowsMultipleSelection: false
  })
  if (result.canceled || !result.assets?.[0]) {
    return null
  }
  const asset = result.assets[0]
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator')
  const context = ImageManipulator.manipulate(asset.uri)
  const width = asset.width ?? 0
  const height = asset.height ?? 0
  // Always resize: a picker that reports no dimensions must not hand a full-resolution photo to the quality ladder.
  // One dimension only: the other follows to preserve the ratio.
  context.resize(width >= height ? { width: AVATAR_MAX_DIMENSION } : { height: AVATAR_MAX_DIMENSION })
  const image = await context.renderAsync()
  const encoded = await encodeUnderCap(
    async quality => (await image.saveAsync({ compress: quality, format: SaveFormat.JPEG, base64: true })).base64 ?? '',
    AVATAR_QUALITY_STEPS,
    AVATAR_MAX_BYTES
  )
  if (!encoded.base64) {
    throw new Error('The photo could not be read.')
  }
  const name = asset.fileName?.replace(/\.(heic|heif|png|webp)$/i, '.jpg') ?? `avatar-${Date.now()}.jpg`
  return { dataUrl: toDataUrl('image/jpeg', encoded.base64), bytes: encoded.bytes, quality: encoded.quality, name }
}

export async function attachImage(port: GatewayPort, sessionId: string, picked: { base64: string; name: string; bytes: number; previewUri: string }): Promise<PendingAttachment> {
  const id = nextId()
  const sizeError = validateSize(picked.bytes, IMAGE_MAX_BYTES)
  if (sizeError) {
    return { id, kind: 'image', name: picked.name, bytes: picked.bytes, previewUri: picked.previewUri, state: 'failed', error: sizeError }
  }
  try {
    await port.sessions.attachImageBytes({ session_id: sessionId, content_base64: picked.base64, filename: picked.name, ext: 'jpg' })
    return { id, kind: 'image', name: picked.name, bytes: picked.bytes, previewUri: picked.previewUri, state: 'attached' }
  } catch (err) {
    return { id, kind: 'image', name: picked.name, bytes: picked.bytes, previewUri: picked.previewUri, state: 'failed', error: userMessage(err) }
  }
}

export async function attachDocument(port: GatewayPort, sessionId: string, picked: { base64: string; name: string; bytes: number; mime: string }): Promise<PendingAttachment> {
  const id = nextId()
  const sizeError = validateSize(picked.bytes, DOCUMENT_MAX_BYTES)
  if (sizeError) {
    return { id, kind: 'file', name: picked.name, bytes: picked.bytes, state: 'failed', error: sizeError }
  }
  try {
    const result = await port.sessions.attachFile({ session_id: sessionId, data_url: toDataUrl(picked.mime, picked.base64), name: picked.name })
    return { id, kind: 'file', name: result.name ?? picked.name, bytes: picked.bytes, refText: result.ref_text, state: 'attached' }
  } catch (err) {
    return { id, kind: 'file', name: picked.name, bytes: picked.bytes, state: 'failed', error: userMessage(err) }
  }
}

/** The text to submit: the user's words plus file references the gateway asked for. */
export function composeOutgoingText(text: string, attachments: PendingAttachment[]): string {
  const refs = attachments.filter(a => a.state === 'attached' && a.refText).map(a => a.refText as string)
  const body = text.trim()
  if (refs.length === 0) {
    return body
  }
  return body ? `${body}\n\n${refs.join('\n')}` : refs.join('\n')
}
