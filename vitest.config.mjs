import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 20_000,
    restoreMocks: true,
  },
});
