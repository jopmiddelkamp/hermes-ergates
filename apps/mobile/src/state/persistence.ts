/**
 * Device storage adapters (docs/05 section 3).
 *
 * - `asyncStorageJson` persists connections/organization/prefs/drafts/outbox as one
 *   JSON blob in AsyncStorage under `DEVICE_STORAGE_KEY` (docs/05: "AsyncStorage;
 *   no secrets").
 * - `secureSecretStore` persists auth secrets only (token/cookie/mode), one entry per
 *   key, in expo-secure-store. Callers build keys with `secretKey`, matching the
 *   `ergates.<connectionId>.<token|cookie|mode>` names `RealGateway` already uses
 *   (src/gateway/real/real-gateway.ts).
 *
 * `expo-secure-store` is loaded lazily (dynamic import inside each method) rather
 * than imported at module scope: it transitively pulls in react-native, which a
 * plain Node/vitest run cannot parse. Loading it only when a method actually runs
 * keeps this module — and anything that imports it, like device-store.ts — safe to
 * import in Node tests. AsyncStorage has no such issue and is imported normally.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware'

import type { SecretStore } from '@/gateway/secrets'
export { MemorySecretStore } from '@/gateway/secrets'

export const DEVICE_STORAGE_KEY = 'ergates-device-v1'

/** The three SecureStore entries a connection owns; RealGateway reads/writes the same names (`ergates.<connectionId>.<kind>`). */
export function secretKey(connectionId: string, kind: 'token' | 'cookie' | 'mode'): string {
  return `ergates.${connectionId}.${kind}`
}

/** Zustand `persist` storage over AsyncStorage. Safe to call at module scope: it only holds a reference to AsyncStorage, never invokes it. */
export function createAsyncStorageJson<S>(): PersistStorage<S> {
  const storage = createJSONStorage<S>(() => AsyncStorage)
  if (!storage) {
    throw new Error('Failed to create the AsyncStorage-backed persist storage.')
  }
  return storage
}

/** SecureStore-backed SecretStore. `key` is the full `ergates.<connectionId>.<kind>` string. */
export const secureSecretStore: SecretStore = {
  async get(key) {
    const SecureStore = await import('expo-secure-store')
    return SecureStore.getItemAsync(key)
  },
  async set(key, value) {
    const SecureStore = await import('expo-secure-store')
    await SecureStore.setItemAsync(key, value)
  },
  async remove(key) {
    const SecureStore = await import('expo-secure-store')
    await SecureStore.deleteItemAsync(key)
  }
}

/** In-memory `StateStorage`, e.g. for `createAsyncStorageJsonFake`; never touches AsyncStorage. */
export function createMemoryStateStorage(): StateStorage {
  const map = new Map<string, string>()
  return {
    getItem: async key => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async key => {
      map.delete(key)
    }
  }
}

/** In-memory `persist` storage with the same JSON shape as `createAsyncStorageJson`, for tests. */
export function createMemoryStorageJson<S>(): PersistStorage<S> {
  const storage = createJSONStorage<S>(() => createMemoryStateStorage())
  if (!storage) {
    throw new Error('Failed to create the in-memory persist storage.')
  }
  return storage
}
