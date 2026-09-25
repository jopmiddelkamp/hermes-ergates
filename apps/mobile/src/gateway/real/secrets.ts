/** The secret-store contract lives next to the port (`src/gateway/secrets.ts`); the real adapter re-exports it. */
export { MemorySecretStore, type SecretStore } from '../secrets'
