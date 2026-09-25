import { describe, expect, it } from 'vitest'

import { NodeCipher } from '@test/node-cipher'

import { createMemoryStateStorage } from './persistence'
import { createSealedStateStorage, SEALED_PREFIX } from './sealed-storage'

const NAME = 'ergates-device-v1'
const BLOB = JSON.stringify({ state: { drafts: { 'c1:linh': 'the invoice from Dirk' } }, version: 1 })

/** The raw ciphertext bytes of a stored value, decoded past the sealed prefix and its base64 wrapper. */
function sealedBytes(raw: string): Buffer {
  return Buffer.from(raw.slice(SEALED_PREFIX.length), 'base64')
}

function setup() {
  const inner = createMemoryStateStorage()
  const cipher = new NodeCipher()
  const errors: unknown[] = []
  const sealed = createSealedStateStorage(inner, cipher, { onError: error => errors.push(error) })
  return { inner, cipher, errors, sealed }
}

describe('sealed device storage', () => {
  it('stores only sealed text and reads the value back', async () => {
    const { inner, sealed } = setup()

    await sealed.setItem(NAME, BLOB)

    const raw = await inner.getItem(NAME)
    expect(raw?.startsWith(SEALED_PREFIX)).toBe(true)
    expect(sealedBytes(raw as string).includes('Dirk')).toBe(false)
    expect(await sealed.getItem(NAME)).toBe(BLOB)
  })

  it('reads nothing when nothing is stored', async () => {
    const { sealed, errors } = setup()
    expect(await sealed.getItem(NAME)).toBeNull()
    expect(errors).toEqual([])
  })

  it('reads a legacy plaintext blob once, unchanged, and rewrites it sealed at once', async () => {
    const { inner, sealed } = setup()
    await inner.setItem(NAME, BLOB)

    expect(await sealed.getItem(NAME)).toBe(BLOB)

    const raw = await inner.getItem(NAME)
    expect(raw?.startsWith(SEALED_PREFIX)).toBe(true)
    expect(sealedBytes(raw as string).includes('Dirk')).toBe(false)
    expect(await sealed.getItem(NAME)).toBe(BLOB)
  })

  it('still returns a legacy plaintext blob when sealing it fails, and says why', async () => {
    const { inner, cipher, sealed, errors } = setup()
    await inner.setItem(NAME, BLOB)
    cipher.seal = async () => {
      throw new Error('no key store')
    }

    expect(await sealed.getItem(NAME)).toBe(BLOB)
    expect(await inner.getItem(NAME)).toBe(BLOB)
    expect(errors).toHaveLength(1)
  })

  it('reads a blob whose key is gone as empty, and lets the next write replace it', async () => {
    const { inner, cipher, sealed, errors } = setup()
    await sealed.setItem(NAME, BLOB)
    cipher.forgetKey()

    expect(await sealed.getItem(NAME)).toBeNull()
    expect(errors).toHaveLength(1)

    await sealed.setItem(NAME, '{"state":{},"version":1}')
    expect(await sealed.getItem(NAME)).toBe('{"state":{},"version":1}')
    expect((await inner.getItem(NAME))?.startsWith(SEALED_PREFIX)).toBe(true)
  })

  it('never overwrites a blob it could not open, until a later read opens it', async () => {
    const { inner, cipher, sealed, errors } = setup()
    await sealed.setItem(NAME, BLOB)
    const before = await inner.getItem(NAME)
    cipher.openError = new Error('the keychain is locked')

    expect(await sealed.getItem(NAME)).toBeNull()
    await sealed.setItem(NAME, '{"state":{},"version":1}')
    expect(await inner.getItem(NAME)).toBe(before)
    expect(errors).toHaveLength(2)

    cipher.openError = null
    expect(await sealed.getItem(NAME)).toBe(BLOB)
    await sealed.setItem(NAME, '{"state":{"drafts":{}},"version":1}')
    expect(await sealed.getItem(NAME)).toBe('{"state":{"drafts":{}},"version":1}')
  })

  it('reads null and reports when the inner store rejects, and keeps the stored value', async () => {
    const { inner, sealed, errors } = setup()
    await sealed.setItem(NAME, BLOB)
    const before = await inner.getItem(NAME)
    const workingGetItem = inner.getItem
    inner.getItem = async () => {
      throw new Error('the device storage is unavailable')
    }

    expect(await sealed.getItem(NAME)).toBeNull() // resolves; a rejection would hang hydration forever
    expect(errors).toHaveLength(1)

    await sealed.setItem(NAME, '{"state":{},"version":1}')
    inner.getItem = workingGetItem
    expect(await inner.getItem(NAME)).toBe(before)
  })

  it('lands the newest value last even when an earlier seal is slower', async () => {
    const { sealed, cipher } = setup()
    cipher.sealDelayMs = plaintext => (plaintext === 'first' ? 30 : 0)

    const first = sealed.setItem(NAME, 'first')
    await new Promise(resolve => setTimeout(resolve, 5)) // the slow seal of 'first' is under way
    const later = [sealed.setItem(NAME, 'second'), sealed.setItem(NAME, 'third')]
    await Promise.all([first, ...later])

    expect(await sealed.getItem(NAME)).toBe('third')
    expect(cipher.sealCalls).toBe(2) // 'first', then only the newest waiting value
  })

  it('never rejects a write; a failed seal goes to onError', async () => {
    const { inner, cipher, sealed, errors } = setup()
    cipher.seal = async () => {
      throw new Error('no key store')
    }

    await sealed.setItem(NAME, BLOB) // resolves; a rejection would fail this test
    expect(await inner.getItem(NAME)).toBeNull()
    expect(errors).toHaveLength(1)
  })

  it('removes a stored blob', async () => {
    const { inner, sealed } = setup()
    await sealed.setItem(NAME, BLOB)
    await sealed.removeItem(NAME)
    expect(await inner.getItem(NAME)).toBeNull()
  })
})
