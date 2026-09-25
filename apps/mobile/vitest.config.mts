import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@vendor': path.resolve(import.meta.dirname, 'vendor'),
      '@test': path.resolve(import.meta.dirname, 'test'),
    },
  },
})
