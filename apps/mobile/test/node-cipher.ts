/**
 * A `BlobCipher` for Node tests: real AES-256-GCM from `node:crypto`, with its
 * key in memory. The phone uses expo-crypto (src/state/persistence.ts); the
 * sealing rules under test (src/state/sealed-storage.ts) are the same.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { BlobCipher } from '@/state/sealed-storage'

export class NodeCipher implements BlobCipher {
  private key: Buffer | null = null
  /** When set, `open` rejects with it (a key store that refuses, damaged data). */
  openError: Error | null = null
  /** Milliseconds each `seal` waits before it answers. */
  sealDelayMs: (plaintext: string) => number = () => 0
  sealCalls = 0

  /** The key disappears, as on a phone restored from a backup. */
  forgetKey(): void {
    this.key = null
  }

  async seal(plaintext: string): Promise<string> {
    this.sealCalls += 1
    const delay = this.sealDelayMs(plaintext)
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    this.key ??= randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')
  }

  async open(sealed: string): Promise<string | null> {
    if (this.openError) {
      throw this.openError
    }
    if (!this.key) {
      return null
    }
    const bytes = Buffer.from(sealed, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(bytes.length - 16))
    return Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString('utf8')
  }
}
