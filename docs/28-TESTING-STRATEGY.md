# Uelfy Clinical — Testing Strategy

> **Scope.** What we test, what we don't, why, and how to extend the
> suite. Companion to `23-CLINICAL-ENGINE.md` (engine architecture),
> `24-FORMULA-REGISTRY.md` (per-score citations), `25-MDR-READINESS.md`
> (verification posture under MDR / IEC 62304).
>
> **Audience.** Engineers writing or reviewing tests; QA / regulatory
> reviewers verifying coverage.
>
> **Stance.** Tests are part of the safety case. A change that
> degrades the test surface is not a refactor — it is a regression.

---

## 1. Test taxonomy

The `tests/` tree is split by *intent*, not by code layer.

```
tests/
├── unit/           – per-module pure-function tests
├── integration/    – API surface + DB round-trip tests
├── equivalence/    – per-score golden-vector tests against legacy
│                     implementation (CWS heritage)
├── fixtures/       – shared test inputs (assessment payloads, etc.)
└── vitest.config.ts
```

**Runner.** Vitest (`npm run test` → `vitest run`).

---

## 2. Unit tests — current set

| File | What it covers |
|---|---|
| `unit/clinical-engine.test.ts` | Orchestrator (`computeAllScores`) shape, skip propagation, PREDIMED reuse, decision-support framing |
| `unit/guideline-catalog.test.ts` | Guideline catalog source attributions are non-empty, every score has a catalog entry |
| `unit/middleware.test.ts` | `withAuth`, error envelope (B-05 opaque DB errors), audit-context construction |
| `unit/pdf-report-service.test.ts` | PDF render pipeline doesn't throw on canonical inputs, font embedding works (CWS-3 fix) |
| `unit/cron-auth.test.ts` | **Phase 9** — B-04 cron hardening: secret-hygiene fail-closed, length-disclosure-safe bearer compare, Vercel-only `x-vercel-cron` header gate, opaque `denyCron` body |
| `unit/audit-logger.test.ts` | **Phase 9** — B-09 audit guarantee: `recordAudit` best-effort never throws; `recordAuditStrict` throws `AuditWriteError` (with `Error.cause`) on row error or driver throw; `recordFailedLogin` keeps email-domain only (data minimisation); `sanitizeMetadata` truncates strings to 256 chars and drops nested objects |
| `unit/composite-risk.test.ts` | **Phase 9** — C-02/H-05: "silence is not safety" invariant — all-skipped input → composite `indeterminate`, never `low`; stratified domain dominates; numeric encoding (indeterminate=0, low=1, …, very_high=4); truthful skip reasoning (no legacy "missing lipid panel" placeholder for an out-of-range age skip) |

These are pure-function tests — no network, no DB, no file system
beyond Vitest's snapshot dir.

---

## 3. Integration tests — current set

| File | What it covers |
|---|---|
| `integration/api-patients.test.ts` | Patient CRUD round-trip with auth header injection; verifies audit-row emission, RLS context, soft-delete behaviour |

Integration tests run against a Supabase test schema (or a local
Supabase via `supabase start`), with a tear-down after each test.

---

## 4. Equivalence tests — golden vectors

| File | What it covers |
|---|---|
| `equivalence/score-equivalence.test.ts` | Per-score input → expected-output vectors, sourced from the published guideline appendix where one exists, or pinned from the legacy HTML implementation we're refactoring away from |

These are the **regulatory backbone** of the engine test suite. A
change to a coefficient or a formula that breaks an equivalence test
must not be merged unless:

1. It is explicitly authorised by the user (project rule — validated
   formulas are not modified without explicit instruction); AND
2. The change is paired with an `engine_version` bump and an entry in
   `29-CHANGELOG-CLINICAL.md`; AND
3. The corresponding equivalence vector is updated and the cited
   source in `24-FORMULA-REGISTRY.md` reflects the new authoritative
   guideline.

---

## 5. Coverage matrix — engine layer

For each score module the suite is expected to cover, at minimum:

| Test class | Why |
|---|---|
| Canonical happy-path | Confirms the "everyday" calculation matches the source |
| Edge of validated domain (low) | Confirms the lower bound is accepted |
| Edge of validated domain (high) | Confirms the upper bound is accepted |
| Just outside validated domain | Confirms the formula throws OR the eligibility evaluator skips |
| Missing required input | Confirms a typed skip entry, never a guessed value |
| Sex variation | Confirms sex-specific coefficients applied correctly |
| Determinism | Same input twice → identical output (deep-equal) |

Current coverage status per score is recorded in
`29-CHANGELOG-CLINICAL.md` as the changelog evolves; a per-score
coverage gap is treated as a regression.

---

## 6. What is *not* covered by automated tests today

Honest list — these are the open items pursued in Phase 9 / `EXT-CLIN`
/ `EXT-MDR`:

| Gap | Plan |
|---|---|
| RLS-policy-level test (Postgres-side enforcement, not just app-side) | Roadmap — add a Postgres-side test fixture that runs as the anon role and confirms RLS denial. Mitigated for Phase 9 by migration 010 + code review. |
| Cron handler signing-secret unit test | ✅ Done — `unit/cron-auth.test.ts` (Phase 9) |
| Audit guarantee unit test | ✅ Done — `unit/audit-logger.test.ts` (Phase 9) |
| Composite-risk indeterminate-band invariant test | ✅ Done — `unit/composite-risk.test.ts` (Phase 9) |
| DSR end-to-end state-machine integration test | Roadmap — needs full Supabase chain mock; manual smoke test today (`26-DEPLOYMENT-RUNBOOK.md §6.7`) |
| End-to-end PDF visual regression (font rendering, layout) | `EXT` — no headless renderer in CI; manual smoke test today |
| Rate-limiter integration test against Upstash | Roadmap (in-memory only today) |
| AI-commentary boundary test (off-by-default, no PHI in prompt) | Roadmap / `EXT-MDR` |
| Multi-tenant cross-read negative test | Roadmap — mitigated by RLS + endpoint code review (`30-RISK-REGISTER.md` M-12) |

These gaps are **explicit**: a regulator or auditor reading this
document gets the truthful picture, not an aspirational one.

---

## 7. Test data discipline

- **No real PHI in fixtures.** All test patients are synthetic; names
  use the `Test` / `Synthetic` family.
- **No production secrets in test config.** Supabase test project is
  separate from production; credentials are scoped per-environment in
  Vercel.
- **Fixtures are reproducible.** Inputs are static objects, not
  randomised; randomness in the engine itself is forbidden anyway
  (§4 of `23-CLINICAL-ENGINE.md`).

---

## 8. Determinism contract enforcement

The engine determinism contract (`23-CLINICAL-ENGINE.md §4`) is
enforced by:

- A determinism test in `unit/clinical-engine.test.ts` that calls
  `computeAllScores` twice on the same input and deep-equals the
  result.
- A linter rule (informal — code review) that flags `Math.random()`,
  `Date.now()`, or `new Date()` inside `backend/src/domain/clinical/`.
- A grep gate in `npm run build:check` for these patterns inside the
  engine tree (planned Phase 9 hardening).

---

## 9. CI gating

Required before a PR can be merged to `main`:

```
npm run typecheck
npm run typecheck:prod
npm run test
npm run build
```

Required before a deploy to production:

```
all of the above + the §6 smoke tests in 26-DEPLOYMENT-RUNBOOK.md
```

A failing equivalence test is a **release blocker** — never an
override.

---

## 10. Test-writing guidelines

When adding a new test:

1. Place it in the matching subtree (`unit` / `integration` /
   `equivalence`) — not in a code-adjacent `__tests__` folder.
2. Name files `*.test.ts`. Vitest discovers them automatically.
3. Use `describe` blocks per module / endpoint, not per file.
4. Pin numeric expectations to the precision the source guideline
   specifies (not more, not less).
5. For equivalence tests, cite the source in a comment block at the top
   of the test (matching the citation in `24-FORMULA-REGISTRY.md`).
6. Never use real PHI. Never use a tenant id from a real production
   tenant.

---

## 11. Coverage measurement

We do not gate on a coverage percentage today. The
golden-vector + skip-semantics + determinism trifecta is the
**meaningful** coverage. A coverage percentage gate without that
trifecta is theatre.

That said: the Phase 9 deliverable adds a coverage report (Vitest's
built-in c8) for engine modules so reviewers can see uncovered
branches. The number is informational, not a CI gate.

---

## 12. Mutation testing (future)

For the score modules specifically, mutation testing (e.g. Stryker)
would confirm that the equivalence vectors actually exercise the
formula and not just its happy path. This is a roadmap item — not
required before launch — and aligns with IEC 62304 Class B verification
expectations (`25-MDR-READINESS.md`).

---

## 13. Test debt — explicit list

| Item | Severity | Plan |
|---|---|---|
| Per-score equivalence vectors are pinned to legacy HTML implementations for some scores; cross-check against the published guideline appendix | Medium | EXT-CLIN review per score |
| RLS policy regression test does not yet exist | High | Phase 9 |
| DSR state-machine integration test does not yet exist | High | Phase 9 |
| Cron-secret rejection test does not yet exist | Medium | Phase 9 |
| PDF visual regression test (font / layout) | Low | EXT — manual today |

---

**Cross-references**

- `23-CLINICAL-ENGINE.md` — engine architecture & determinism.
- `24-FORMULA-REGISTRY.md` — per-score citations.
- `25-MDR-READINESS.md` — verification posture under MDR / IEC 62304.
- `26-DEPLOYMENT-RUNBOOK.md` — smoke tests post-deploy.
- `29-CHANGELOG-CLINICAL.md` — engine evolution log.
