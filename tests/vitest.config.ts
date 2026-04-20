import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'backend/src/**/*.ts',
        'shared/**/*.ts',
        'api/v1/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/node_modules/**',
      ],
    },
    globals: false,
    testTimeout: 15000,
  },
});
