import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Sprint 6 task 6.1 (L-07): `json-summary` is the machine-readable
      // shape that scripts/check-coverage-thresholds.mjs consumes.
      // `text` keeps the console summary; `html` + `lcov` are kept so a
      // developer can drill into per-line coverage locally / in CI
      // artefacts.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'backend/src/**/*.ts',
        'shared/**/*.ts',
        'api/v1/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/node_modules/**',
        // Tests + fixtures are excluded so coverage % reflects production
        // code, not test scaffolding.
        'tests/**',
        '**/__tests__/**',
        // Generated / vendored.
        'frontend-dist/**',
      ],
    },
    globals: false,
    testTimeout: 15000,
  },
});
