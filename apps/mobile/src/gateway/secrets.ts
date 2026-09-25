/**
 * Minimal secret storage contract, next to the port so the device store can use
 * it without importing an adapter. The SecureStore adapter lives in
 * src/state/persistence.ts; `MemorySecretStore` is the in-memory fake.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>()
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key)
  }
}
