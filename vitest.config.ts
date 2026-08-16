import { defineConfig } from 'vitest/config'

/**
 * The test suite exercises the plugin against the DeepSeek Harness SDK. The
 * SDK packages are unpublished, so tests run only after `pnpm link-sdk`
 * links a local harness checkout (see README). The build itself
 * (tsdown → lib/) needs no SDK and works on a fresh clone.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.{ts,tsx}'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/xlsx.mjs.d.ts', 'src/css-modules.d.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
