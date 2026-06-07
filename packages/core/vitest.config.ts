import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Real-browser (Playwright) integration + e2e tests are excluded from the
    // default run. Their animation-timing assertions miss their event window
    // when test files run concurrently and saturate CPU (#15). Run them serially
    // via vitest.integration.config.ts (`pnpm test:integration`).
    exclude: [...configDefaults.exclude, 'tests/integration/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
    testTimeout: 30000,
  },
});
