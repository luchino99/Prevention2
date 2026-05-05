# Test suite

Three layers, all runnable with `npm test` (vitest).

## 1. Equivalence tests — `tests/equivalence/`

Gate against any drift in the validated score formulas.
Each test feeds a fixture input into both the legacy engine (loaded from
`engine/**` in the repo root) and the new `backend/src/domain/clinical/score-engine/*`
module, and asserts numeric equivalence within `1e-9`.

These tests MUST stay green on every commit. If they fail, either:
- the legacy source has a bug that you are intentionally fixing — in which case
  update the fixture expected value and document the reason, or
- the new engine has accidentally diverged — in which case the new engine is wrong.

## 2. Unit tests — `tests/unit/`

Pure-function tests against the clinical engine modules and middleware helpers.

## 3. Integration tests — `tests/integration/`

Exercise the `/api/v1` handlers with a mocked Supabase client. Validate RBAC,
rate limiting, audit emission, and response shapes.

## Running

```
npm install
npm test                    # all
npm run test:equivalence    # formula equivalence only
npm run test:unit           # unit only
npm run test:integration    # integration only
```

## Recommended package.json additions

```json
{
  "devDependencies": {
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "typescript": "^5.4.5"
  },
  "scripts": {
    "test":              "vitest run",
    "test:watch":        "vitest",
    "test:equivalence":  "vitest run tests/equivalence",
    "test:unit":         "vitest run tests/unit",
    "test:integration":  "vitest run tests/integration",
    "coverage":          "vitest run --coverage"
  }
}
```
