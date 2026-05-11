# RLS Staging Runbook (Sprint 5 task 5.5 / closes #55, fail-closed elevation in Sprint 7 task 7.2)

> **Purpose.** Stand up a Supabase **staging** project dedicated to running
> RLS regression tests on every push, so the multi-tenant isolation
> guarantees that ship to production are verified end-to-end (not just
> by the unit-mocked `tests/integration/api-patients.test.ts` suite).
>
> **Audience.** Repo operator (currently the founder).
>
> **Outcome.** After completing this runbook, every CI run executes the
> RLS test suite against a real Postgres + Supabase Auth instance with
> all 19 migrations applied, instead of skipping it with the current
> `[run-rls-tests] SKIP DATABASE_URL not set` line.
>
> **Sprint 7 status.** The CI wire-through (Section 3) is now COMMITTED
> on `.github/workflows/ci.yml`. `scripts/run-rls-tests.mjs` was
> elevated from skip-graceful to **fail-closed in CI** when the secret
> is non-empty. Pending: the operator runs Section 2 once to create the
> staging project and populate the GitHub secrets.

---

## 1. Why a separate staging project (not "use prod")

* **Destructive tests.** The RLS suite seeds and deletes rows, swaps
  JWT contexts, and purposely tries cross-tenant reads. Running this
  against production data is a malpractice-tier mistake.
* **Schema parity.** Staging applies the same migrations 001…019 in
  the same order as production. A schema diff between staging and
  prod is the canary for "we forgot a migration".
* **Restore drill.** The same staging project doubles as the host for
  the annual restore drill (`docs/33-RESTORE-DRILL-SOP.md`). Resources
  are amortised.

## 2. One-time setup (≈30 min)

1. **Create the project**
   - Supabase Dashboard → "New project"
   - Name: `uelfy-staging` (or similar — anything that's NOT the prod
     name)
   - Region: same as production (same EU region — keeps GDPR /
     intra-EU-transfer assumptions identical)
   - Plan: Free tier is fine for tests; Pro if you also use this for
     restore drills
2. **Apply migrations**
   - Supabase Dashboard → SQL Editor
   - Paste each `supabase/migrations/00<N>_*.sql` in numerical order
     (001 → 019)
   - Verify after the last one with the smoke queries documented in
     each migration's footer comments
3. **Capture credentials** — from Project Settings → Database:
   - `Connection string > URI` with the **service_role** password (NOT
     the project-default `postgres` user) — this gets ALL the row-level
     access your tests need. URL format:
     `postgresql://postgres.<ref>:<password>@aws-<region>.pooler.supabase.com:6543/postgres`
   - **Anon key** + **service_role key** + **JWT secret** (for tests
     that mint JWTs) from Project Settings → API
4. **GitHub Actions secrets** — Settings → Secrets and variables →
   Actions → New repository secret:
   - `DATABASE_URL_STAGING` — the URI from step 3 (service_role
     password embedded)
   - `SUPABASE_STAGING_URL` — the project URL (`https://<ref>.supabase.co`)
   - `SUPABASE_STAGING_ANON_KEY`
   - `SUPABASE_STAGING_SERVICE_ROLE_KEY`
   - `SUPABASE_STAGING_JWT_SECRET`

## 3. Wire-through in `.github/workflows/ci.yml` (Sprint 7 task 7.2 — DONE)

The wire-through is now committed at the **job-level** env block of
`build-and-test` (not at step-level as the original Sprint-5 sketch
proposed — job-level is cleaner because every step in build:check
inherits the URL without per-step repetition):

```yaml
jobs:
  build-and-test:
    env:
      SBOM_CVE_FAIL_ON_HIGH: 'true'
      DATABASE_URL_STAGING: ${{ secrets.DATABASE_URL_STAGING }}
```

Notes on the elevated semantics:

* `scripts/run-rls-tests.mjs` now reads **both** `DATABASE_URL` and
  `DATABASE_URL_STAGING`, preferring the latter when both are set so
  the CI secret name cannot collide with a developer's shell export.
* In CI (`CI=true`) with the secret non-empty, the script is
  **fail-closed**: any psql error, missing test file, or assertion
  failure exits 2 and breaks the build. There is **no graceful skip
  path** in this scenario.
* In CI with the secret empty (the rollout window before Section 2 is
  done), the script emits a visible `WARN — SKIP` line and exits 0, so
  the gap is auditable in build logs but does not block the build.
* A CI step now installs `postgresql-client` defensively if the runner
  image regresses and drops `psql` from PATH.
* If you want fail-closed locally (paranoid mode), export
  `RLS_GATE_REQUIRED=1` — every skip path becomes a fail.

To add the other Supabase staging secrets (anon key / service-role
key / JWT secret) if a future test needs them, follow the same
pattern: add to the job-level env, never to a single step.

## 4. Local developer use (optional)

A developer can opt-in locally by:

```sh
export DATABASE_URL_STAGING="postgresql://postgres.<ref>:<password>@…/postgres"
npm run test:rls

# Paranoid mode — turn every skip into a fail (matches CI semantics):
RLS_GATE_REQUIRED=1 npm run test:rls
```

The connection string is the same one stored in the GitHub secret.
Most engineers will NOT run RLS tests locally (CI does it on every
push), but the option exists for debugging an RLS regression. The
script accepts both `DATABASE_URL` (legacy) and `DATABASE_URL_STAGING`
(canonical CI name); when both are set the latter wins.

## 5. Per-PR teardown (idempotency)

The RLS tests **must clean up after themselves** so the staging DB
doesn't accumulate orphan rows. The current `tests/rls/*.sql` suite
uses `BEGIN…ROLLBACK` per case for this reason — verify when adding
new tests that the same pattern is preserved.

A monthly manual purge of the `audit_events` table on staging is
sufficient (`fn_retention_prune` will handle the rest if cron is
wired). Do NOT enable retention cron on staging by default — it can
race with tests that count rows immediately after insert.

## 6. Rotation cadence

* **Service-role password** — rotate every 90 days per the secrets
  policy (see `27-INCIDENT-RESPONSE.md §13`). Update the GitHub secret
  in lockstep.
* **JWT secret** — only rotate when staging migrates between Supabase
  projects; never in normal operation (would invalidate every test
  fixture's signed JWT).

## 7. Verifying the gate is live

After the GitHub secret `DATABASE_URL_STAGING` is added and the next
CI workflow runs on a `push` to main (or a PR), the build-and-test job
should show in its log:

```
[run-rls-tests] Running 1 RLS test file(s) against staging DB
[run-rls-tests] Mode: CI fail-closed (errors will fail the build).
[run-rls-tests] OK   tests/rls/cross_tenant_negative.sql
[run-rls-tests] All RLS tests passed.
```

If the secret is empty / unset, the log shows instead:

```
[run-rls-tests] WARN SKIP — no DATABASE_URL / DATABASE_URL_STAGING configured.
[run-rls-tests] WARN To enforce the RLS gate in CI, set the DATABASE_URL_STAGING
                     secret in this repo.
```

That second case is the **legitimate rollout-window state** until you
complete Section 2. It is NOT silent (the WARN lines are visible in
build logs), but it does NOT block merges. After Section 2 the WARN
must disappear — if it does not, the secret name is wrong or empty.

To verify the fail-closed path before relying on it, intentionally
break a RLS policy on the staging project (e.g. drop the `USING (...)`
clause from a select policy) and push a no-op commit. The CI build
must go red on the `Build gates` step with a non-zero exit from
`run-rls-tests.mjs`. Then restore the policy.

## 8. Cost note

Free Supabase project + ~500 RLS-suite rows per CI run is well within
the free tier's 500 MB DB cap. Expected monthly cost: **€0**.

If the project later moves to Pro (€25/month per project) for the
restore drill, the same staging instance amortises both use-cases —
no separate project needed.

---

## Cross-references

- `scripts/run-rls-tests.mjs` — the test runner that flips on
  `DATABASE_URL`
- `scripts/check-rls-coverage.mjs` — the FORCE-RLS coverage check
- `tests/rls/*.sql` — the test cases themselves
- `docs/33-RESTORE-DRILL-SOP.md` — annual restore drill SOP that
  reuses this staging project
- `docs/28-DEPLOY-RUNBOOK.md` — how migrations move from staging to
  production
