import { defineConfig } from 'vitest/config';

// Real-browser (Playwright) integration + e2e tests (tests/integration, tests/e2e).
// Run serially: concurrent test files saturate CPU on the Intel Mac, so
// animation-timing assertions miss their event window under contention (#15).
// fileParallelism:false runs one test file at a time, eliminating the race.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
