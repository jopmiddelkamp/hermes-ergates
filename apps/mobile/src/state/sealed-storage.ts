/**
 * The device blob at rest, encrypted (docs/05 section 3, docs/04 section 6).
 *
 * `createSealedStateStorage(inner, cipher)` wraps a string key-value store
 * (AsyncStorage on the phone, a Map in tests) so every value it writes is
 * sealed by `cipher` and every value it reads is opened again. The cipher is
 * an adapter: `persistence.ts` passes AES-GCM from expo-crypto with its key in
 * SecureStore, and Node tests pass their own. This module imports neither, so
 * it runs unchanged in Node.
 *
 * - A stored value without `SEALED_PREFIX` is a plaintext blob from an app
 *   version before encryption. It is returned as is, so nothing is lost, and
 *   rewritten sealed at once.
 * - A sealed value whose key no longer exists (the app data was restored onto
 *   another phone, where the key cannot follow) can never be read again: it
 *   reads as empty, and the next write replaces it.
 * - A sealed value that cannot be opened now (the key store refused, or the
 *   data is damaged) also reads as empty, but nothing is written under that
 *   name until a later read opens it: the stored blob waits for the next
 *   launch instead of being overwritten with an empty store.
 * - Writes run one at a time, in call order, and each writes the newest value
 *   of its name, so a slow seal never lets an older state land last.
 * - Nothing here rejects. A failure goes to `onError`, which gets the error,
 *   never a stored value.
 */
import type { StateStorage } from 'zustand/middleware'

/** Marks a sealed value. A value without it is plaintext from before encryption. */
export const SEALED_PREFIX = 'ergates-sealed-v1:'

export interface BlobCipher {
  /** Encrypts `plaintext` into printable text; creates the key on first use. */
  seal(plaintext: string): Promise<string>
  /** Decrypts what `seal` returned. Resolves `null` when no key exists any more; rejects when the key or the data cannot be read now. */
  open(sealed: string): Promise<string | null>
}

export interface SealedStorageOptions {
  onError?: (error: unknown) => void
}

export function createSealedStateStorage(inner: StateStorage, cipher: BlobCipher, options: SealedStorageOptions = {}): StateStorage {
  const report = options.onError ?? (() => undefined)
  // Names whose stored value could not be opened now. Nothing overwrites them.
  const kept = new Set<string>()
  // The newest value of each name that no write has stored yet.
  const newest = new Map<string, string>()
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job)
    queue = run.catch(() => undefined)
    return run
  }

  async function read(name: string): Promise<string | null> {
    const stored = await inner.getItem(name)
    if (stored === null || stored === undefined) {
      kept.delete(name)
      return null
    }
    if (!stored.startsWith(SEALED_PREFIX)) {
      kept.delete(name)
      try {
        await inner.setItem(name, SEALED_PREFIX + (await cipher.seal(stored)))
      } catch (error) {
        report(error)
      }
      return stored
    }
    try {
      const opened = await cipher.open(stored.slice(SEALED_PREFIX.length))
      kept.delete(name)
      if (opened === null) {
        report(new Error('The device data was sealed with a key this phone no longer has; starting empty.'))
      }
      return opened
    } catch (error) {
      kept.add(name)
      report(error)
      return null
    }
  }

  async function writeNewest(name: string): Promise<void> {
    const value = newest.get(name)
    if (value === undefined) {
      return // an earlier job in the queue already wrote the newest value
    }
    newest.delete(name)
    if (kept.has(name)) {
      throw new Error('The stored device data could not be opened, so it is kept, not overwritten.')
    }
    await inner.setItem(name, SEALED_PREFIX + (await cipher.seal(value)))
  }

  return {
    getItem: name => enqueue(() => read(name)),
    setItem: (name, value) => {
      newest.set(name, value)
      return enqueue(() => writeNewest(name)).catch(error => {
        report(error)
      })
    },
    removeItem: name => {
      newest.delete(name)
      return enqueue(async () => {
        kept.delete(name)
        await inner.removeItem(name)
      }).catch(error => {
        report(error)
      })
    }
  }
}
