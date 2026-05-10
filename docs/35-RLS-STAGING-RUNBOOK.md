# RLS Staging Runbook (Sprint 5 task 5.5 / closes #55)

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

## 3. Wire-through in `.github/workflows/ci.yml`

Add the secrets to the existing `build:check + test` job env:

```yaml
- name: build:check + test
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL_STAGING }}
    SUPABASE_URL: ${{ secrets.SUPABASE_STAGING_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_STAGING_ANON_KEY }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_STAGING_SERVICE_ROLE_KEY }}
    SUPABASE_JWT_SECRET: ${{ secrets.SUPABASE_STAGING_JWT_SECRET }}
  run: npm run build:check && npm test
```

The `scripts/run-rls-tests.mjs` script already detects `DATABASE_URL`
and switches from SKIP to ENFORCE automatically — no script change
needed. Same for `scripts/check-rls-coverage.mjs`.

## 4. Local developer use (optional)

A developer can opt-in locally by:

```sh
export DATABASE_URL="postgresql://postgres.<ref>:<password>@…/postgres"
npm run test:rls
```

The connection string is the same one stored in the GitHub secret.
Most engineers will NOT run RLS tests locally (CI does it on every
push), but the option exists for debugging an RLS regression.

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

After the GitHub secrets are added and CI runs, the next workflow run
should show:

```
[run-rls-tests] OK  18/18 RLS test cases passed against DATABASE_URL_STAGING.
[check-rls-coverage] OK  20/20 PHI tables have FORCE RLS enabled.
```

If either step still says SKIP, the secret name doesn't match — check
`scripts/run-rls-tests.mjs` for the exact env-var lookup.

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
