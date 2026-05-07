# Uelfy Clinical — Supabase Staging Setup

> **Status.** Placeholder runbook for when staging is activated. Sprint 2
> task 2.2 is deferred until this is done. Until then, the CI gates
> `run-rls-tests` and `check-rls-coverage` remain SKIP in CI (graceful).
>
> **When to do this.** Recommended timing: as soon as either (a) a
> second contributor joins the project (you need a sandbox to test
> destructive migrations before production), or (b) you start integrating
> with a paying customer's data (you need staging for end-to-end QA
> before promoting changes), or (c) Sprint 3+ tasks require live RLS /
> SQL test execution.
>
> **Cost.** Free tier: 500 MB DB, 50k MAU, 1 organization. Sufficient
> for staging. Hard cap is per-organization, so add this as a second
> organization if production already uses the only free slot.

---

## 1. Provision a new Supabase project

1. Open `https://supabase.com/dashboard/projects`.
2. Click **New project**.
3. Fill in:
   - **Name**: `prevention2-staging` (or similar)
   - **Database password**: generate a strong one (save in password manager
     — you will need it for the connection string)
   - **Region**: same as production (`eu-central-1` recommended for
     EU GDPR posture)
   - **Pricing plan**: Free
4. Wait ~2 minutes for project provisioning.
5. Note the **Project URL** (e.g. `https://abcdefg.supabase.co`) and the
   **Project Reference** (the `abcdefg` part).

## 2. Apply the 17 migrations

Two options:

### Option A — Supabase CLI (recommended)

```bash
brew install supabase/tap/supabase    # if not already installed
cd ~/Documents/GitHub/Prevention2

supabase login                         # browser-based OAuth
supabase link --project-ref <staging-project-ref>
supabase db push                       # applies supabase/migrations/*.sql in order
```

Verify:

```bash
# Should list 17 migration rows
supabase db remote commit --dry-run
```

### Option B — Manual via SQL Editor

For each file in `supabase/migrations/` in numeric order (001 → 017):

1. Open `https://supabase.com/dashboard/project/<staging-project-ref>/sql`
2. Copy the file contents
3. Paste in the SQL editor
4. Click **Run**

This is more error-prone and slower; prefer Option A.

## 3. Verify schema

Run in SQL editor:

```sql
-- Should return 20 rows, all with rls=t and force=t
SELECT c.relname,
       c.relrowsecurity      AS rls,
       c.relforcerowsecurity AS force
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'tenants','users','professionals','patients',
    'patient_clinical_profiles','assessments',
    'assessment_measurements','score_results','risk_profiles',
    'nutrition_snapshots','activity_snapshots','followup_plans',
    'alerts','consent_records','audit_events','report_exports',
    'notification_jobs','professional_patient_links',
    'due_items','data_subject_requests'
  )
ORDER BY c.relname;
```

If any row shows `rls=f` or `force=f`, the migration didn't apply
cleanly — re-check.

## 4. Add `DATABASE_URL_STAGING` GitHub secret

1. Open `https://supabase.com/dashboard/project/<staging-project-ref>/settings/database`
2. Find **Connection string** → **URI** → click "Show" → copy the value
   - Format: `postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
   - **CRITICAL**: this is a service-role-equivalent connection string.
     Treat as a top-secret credential. Never commit, never log.
3. Open `https://github.com/luchino99/Prevention2/settings/secrets/actions`
4. Click **New repository secret**
5. Name: `DATABASE_URL_STAGING`
6. Secret: paste the connection string
7. Click **Add secret**

## 5. Wire the secret into `ci.yml`

Edit `.github/workflows/ci.yml` — find the build-and-test job and add
`env: DATABASE_URL: ${{ secrets.DATABASE_URL_STAGING }}` to the run-rls-tests
and check-rls-coverage steps:

```yaml
      - name: Build gates (10 checks incl. CVE fail-on-high)
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL_STAGING }}
        run: npm run build:check
```

(Setting at the step level scopes the secret tightly. Setting at job
level would expose it to all steps including third-party actions —
more risk for marginal convenience.)

## 6. Verify in CI

Push a no-op commit:

```bash
git commit --allow-empty -m "chore(ci): activate Supabase staging for RLS tests"
git push origin main
```

Watch the workflow run. The `Build gates` step should now show:

```
[run-rls-tests] Running 1 RLS test file(s) against $DATABASE_URL
[run-rls-tests] OK   tests/rls/<file>.sql
[run-rls-tests] All RLS tests passed.
[check-rls-coverage] Querying RLS state for 20 PHI tables…
[check-rls-coverage] OK   20/20 PHI tables: RLS ENABLED + FORCE ENABLED
```

If you see "SKIP" still, the secret isn't being read — verify spelling
and that it was set at repository (not environment) level.

## 7. Update CHANGELOG + risk register

Once staging is live and CI is enforcing RLS tests:

- `docs/11-CHANGELOG.md` — add entry under `[Sprint 2 — Security
  boundary hardening]`: "RLS tests + coverage check now run against
  Supabase staging in CI (was: skipped)".
- `docs/30-RISK-REGISTER.md` — downgrade severity of "RLS regression
  risk" from medium to low.
- `docs/35-CI-CD-WORKFLOW.md` §4 (CI workflow) — replace the SKIP note
  with the live behaviour.

## 8. Maintenance

- **Schema drift**: when applying a new migration to production, ALWAYS
  apply it to staging first. The `Lockfile must be canonical` CI step
  doesn't catch DB drift — only manual review does.
- **Data refresh**: staging starts empty. If you need realistic test
  data, write seeders in `supabase/seed.sql` (Supabase CLI auto-runs
  this on `db reset`).
- **Cost monitoring**: free tier resets monthly. If you exceed the 500
  MB cap, Supabase will pause the project — CI will then start failing
  with connection errors. Upgrade to Pro tier (~$25/month) when this
  happens; or move staging to a self-hosted Postgres if you prefer.

---

## Document history

| Date | Change | Author |
|---|---|---|
| 2026-05-07 | Initial placeholder (Sprint 2 task 2.2 deferred) | founder + AI pair |
