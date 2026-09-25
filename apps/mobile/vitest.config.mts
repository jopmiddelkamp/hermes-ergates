import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The code the Node suites exercise. `app/` screens and the React Native UI
      // run only on a device; `vendor/hermes` is pinned upstream code.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary'],
      // Measured 2026-09-25 after the ADR-029 moves: statements 68.2, branches
      // 66.33, functions 60.28, lines 67.54. Gate = whole percent below, minus 2.
      thresholds: { statements: 66, branches: 64, functions: 58, lines: 65 }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@vendor': path.resolve(import.meta.dirname, 'vendor'),
      '@test': path.resolve(import.meta.dirname, 'test'),
    },
  },
})
