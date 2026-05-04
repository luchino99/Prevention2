# Uelfy Clinical — Deployment Runbook

> **Scope.** Operational procedure to deploy, upgrade, roll back, and
> smoke-test the platform. Companion to `20-SECURITY.md` (security
> controls), `27-INCIDENT-RESPONSE.md` (incident playbook), and
> `12-PACKAGE-UPGRADE.md` (dependency policy).
>
> **Audience.** Operators with access to the Vercel project and the
> Supabase project. Assumes baseline familiarity with Vercel CLI and
> Supabase CLI.
>
> **Stance.** EU-hosted by default (Vercel + Supabase EU regions). Any
> non-EU deployment is `EXT-LEGAL` and out of scope for this runbook.

---

## 1. Stack at a glance

| Layer | Service | Notes |
|---|---|---|
| Frontend hosting | Vercel (static `frontend-dist/`) | Built by `npm run build` |
| API | Vercel Functions (Node 20.x runtime) | Endpoints under `api/v1/*` |
| Cron jobs | Vercel Cron | Defined in `vercel.json` `crons` |
| Database | Supabase Postgres | EU region |
| Auth | Supabase Auth | Email + password, MFA-supported |
| Storage | Supabase Storage | For PDFs (when persisted) |
| Optional rate-limit store | Upstash Redis (EU) | Falls back to in-memory if not set |

---

## 2. Required environment variables

Set on Vercel (per environment: Production, Preview, Development) and,
for migrations, on the operator's local machine.

### Core (mandatory in production)

| Variable | Purpose | Sensitivity |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Low |
| `SUPABASE_ANON_KEY` | Supabase anon (public) key | Low (publicly readable in JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for backend writes | **CRITICAL — server-only** |
| `CRON_SIGNING_SECRET` | Bearer secret for `/api/v1/internal/*` cron handlers (B-04) | **CRITICAL — server-only** |
| `NODE_ENV` | `production` in production | n/a |

### Optional / configurable

| Variable | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `MFA_ENFORCEMENT_ENABLED` | unset (off) | When `"true"`, all `tenant_admin` and `platform_admin` sessions MUST be aal2 (MFA-verified). Pre-MFA admin tokens are rejected with `403 MFA_REQUIRED`; the frontend auto-redirects to `/pages/mfa-enroll.html`. **Default-off rollout**: enable AFTER every admin has enrolled at the `/pages/mfa-enroll.html` page (otherwise admins lock themselves out). See `30-RISK-REGISTER` L-09 |
| `MFA_ENFORCEMENT_CLINICIAN_ENABLED` | unset (off) | Tier 4 extension of L-09. When `"true"`, every `clinician` session must be aal2. Same dispatcher serves enrolment + challenge — flip ONLY after the clinician cohort has been onboarded to TOTP. The flag is independent of the admin one to allow phased rollout per controller policy |
| `MFA_ENFORCEMENT_STAFF_ENABLED` | unset (off) | Tier 4 extension of L-09. When `"true"`, every `assistant_staff` session must be aal2. Independent flag for the same reason as above |
| `SBOM_CVE_FAIL_ON_HIGH` | unset (warn-only) | When `"true"`, `npm run check:sbom-cves` fails the build for High severity CVEs (Critical always fails). Default is warn-only because GHSA cadence is bursty and a hard failure on every fresh advisory would block hot-fixes |
| `ANONYMIZE_GRACE_DAYS` | 30 | Grace window before anonymising soft-deleted patients |
| `ANONYMIZE_MAX_PER_RUN` | (engine default) | Cap on rows per cron tick to keep the function bounded |
| `UPSTASH_REDIS_REST_URL` | unset | If set, rate limiter uses Upstash distributed bucket; else falls back to in-memory (single-instance only). **Strongly recommended in production** — see §11b |
| `UPSTASH_REDIS_REST_TOKEN` | unset | Paired with above |
| `OPENAI_API_KEY` | unset | Required only if optional AI commentary is enabled. Off by default — see `21-PRIVACY-TECHNICAL.md §11` |
| `VERCEL_ENV` | (Vercel-injected) | `production` / `preview` / `development` |

### Build-time

The frontend reads a public config injected at build time by
`scripts/inject-public-config.mjs`. Do not put secrets there — only
`SUPABASE_URL` + `SUPABASE_ANON_KEY` are exposed to the browser.

### Pre-deploy environment-variable checklist

```
[ ] All CRITICAL secrets set in Production scope only (not in Preview)
[ ] CRON_SIGNING_SECRET ≥ 32 random bytes (constant-time-comparable)
[ ] SUPABASE_SERVICE_ROLE_KEY rotated within last 12 months
[ ] OPENAI_API_KEY unset unless tenant explicitly enabled the feature
[ ] NODE_ENV=production set in Production scope
```

---

## 3. Database migrations

Migrations live in `supabase/migrations/` and are numbered (001..011 at
time of writing). Apply them in order, never skip, never edit a
migration after it has been applied to production.

### Migration set (April 2026)

| File | Purpose |
|---|---|
| `001_schema_foundation.sql` | Core tables, audit_events, consent_records, RLS off (then turned on in 002) |
| `002_rls_policies.sql` | RLS policies forced on every PHI table |
| `003_retention_anonymization_snapshot.sql` | `fn_anonymize_patient`, `fn_retention_prune`, `clinical_input_snapshot` |
| `004_audit_events_extensions.sql` | `outcome`, `failure_reason`, `user_agent` columns |
| `005_professional_patient_links.sql` | PPL table + `is_linked_to_patient(uuid)` SECURITY DEFINER helper |
| `006_risk_indeterminate.sql` | Add `indeterminate` band to risk profile |
| `007_due_items.sql` | Due-items table + countdown |
| `008_activity_mets_persistence.sql` | METs persistence |
| `009_assessment_delete_cascade.sql` | Cascade rules for assessment delete |
| `010_security_hardening.sql` | B-01 / B-02 / B-15 — narrows clinician policies to PPL-linked patients, scopes consent + audit insert, locks down clinical-reports bucket |
| `011_atomic_assessment.sql` | `create_assessment` RPC — B-03 atomicity |
| `012_force_row_level_security.sql` | B-01 defence-in-depth — `FORCE ROW LEVEL SECURITY` on all 20 PHI / tenant / identity tables |
| `013_fix_assessment_atomic_defaults.sql` | B-03-bis — re-defines `create_assessment_atomic` to inject column DEFAULTs into the JSONB before `populate_record`. Without this, every assessment write fails with NOT NULL on `id` |
| `014_tenant_retention_overrides.sql` | M-02 — adds 4 nullable INTEGER columns to `tenants` (`retention_days_audit`, `retention_days_anonymize_grace`, `retention_days_alerts_resolved`, `retention_days_notifications`) with CHECK bounds. Read+edited by the new admin tenant-settings UI |

### Migration procedure

```
# 1. Verify the diff against staging first
supabase db diff --use-migra > /tmp/preflight.sql

# 2. Apply in staging
supabase db push --linked  # against the staging project ref

# 3. Run smoke tests against staging (see §6)

# 4. Apply in production (a maintenance window is preferred for
#    structural changes, not required for additive ones)
supabase db push --linked  # production project ref

# 5. Verify with `select * from pg_extension;`, `\dt`, and the smoke
#    tests below
```

**Never** run a migration against production without first running it
against staging.

---

## 4. Deploy procedure (Vercel)

### Standard deploy (all changes that don't include a destructive migration)

```
# 1. Local sanity check
npm install
npm run typecheck
npm run test
npm run build

# 2. Push to the deployment branch (typically `main` for Production
#    or any feature branch for Preview)
git push origin main

# 3. Vercel auto-builds. Monitor at https://vercel.com/<org>/<project>
```

### Deploy with migration

```
# 1. Apply migration in staging Supabase project
supabase db push --project-ref <staging>

# 2. Deploy code to a Preview environment pointed at staging
vercel --target=preview

# 3. Smoke-test (see §6)

# 4. Apply migration in production Supabase project
supabase db push --project-ref <production>

# 5. Promote the preview to production
vercel promote <preview-url>
```

The migration goes **before** the code that depends on it. The reverse
order can break the running production deployment.

---

## 5. Build verification

`scripts/verify-build.mjs` enforces baseline guarantees on the build
output (no orphan source maps, expected entrypoints exist, no unexpected
file types). It runs as part of `npm run build`. A failure here blocks
deploy.

`npm run build:check` additionally runs `tsc --noEmit` against
`tsconfig.json`. Use this before opening a PR.

`npm run typecheck:prod` uses the stricter `tsconfig.prod.check.json`
and is the gate for production-bound branches.

---

## 6. Smoke tests post-deploy

Run these after every deploy. They take < 5 minutes. None of them
write to a production patient row.

### 6.1 Health endpoint

```
curl -i https://<host>/api/v1/health
# expect HTTP 200, JSON body { "status": "ok", ... }
```

### 6.2 Auth round-trip

```
# Log in via the Supabase auth flow (UI), then verify session works:
curl -i -H "Authorization: Bearer <jwt>" https://<host>/api/v1/me
# expect HTTP 200 with user_id + role
```

### 6.3 RLS sanity (staging only — do not run in production)

```
# Using the anon key (browser-equivalent), attempt to read patients
# without authentication. Must return 0 rows or 401.
```

### 6.4 Cron auth

```
# Without the signing secret — must be rejected
curl -i https://<host>/api/v1/internal/retention
# expect HTTP 401 / 403

# With the wrong secret — must be rejected (constant-time compare)
curl -i -H "Authorization: Bearer wrong" https://<host>/api/v1/internal/retention
# expect HTTP 401

# With the correct secret — must run
curl -i -H "Authorization: Bearer $CRON_SIGNING_SECRET" https://<host>/api/v1/internal/retention
# expect HTTP 200, structured JSON with the prune counts
```

### 6.5 Audit emission

```
# After a successful login, query audit_events server-side:
select count(*) from audit_events
 where action = 'auth.login'
   and created_at > now() - interval '5 minutes';
# expect ≥ 1
```

### 6.6 PDF render

```
# As an authenticated clinician, request a report on a known
# assessment in a staging patient. PDF should download cleanly with
# the embedded NotoSans font (no font-fallback boxes).
```

### 6.7 DSR endpoint (staging only)

```
# Create a DSR via POST /api/v1/admin/dsr
# Verify state transitions: received → in_progress → fulfilled
# Verify each transition writes to audit_events with the dsr.* action
```

---

## 7. Rollback

### Code rollback

```
# In Vercel UI: Deployments → previous good deployment → "Promote to Production"
# OR
vercel rollback <deployment-url>
```

### Migration rollback

Migrations are forward-only by convention. If a migration causes a
production incident:

1. Roll back the **code** first (the previous code version may tolerate
   the new schema if the migration was additive).
2. Apply a *new* migration that reverts the schema (e.g.
   `012_revert_011.sql`). Do not try to "un-apply" a numbered migration
   in place.

For destructive migrations (column drops, type changes), recovery may
require Supabase point-in-time recovery — `EXT-LEGAL` to confirm
recovery point with the controller.

---

## 8. Operational dashboards / monitoring

| Signal | Where to watch |
|---|---|
| HTTP 5xx rate | Vercel function logs |
| `AUDIT_WRITE_FAILED` | Vercel function logs (grep) |
| RLS denials | Supabase logs (`pgaudit`-style) |
| Cron success | Vercel cron run history |
| DB connections | Supabase dashboard |
| Rate-limit hits | Function logs (`[ratelimit]` prefix) |

A formal observability stack (e.g. Logflare, Datadog) is `EXT-LEGAL` —
the platform emits structured logs but does not bundle a vendor SDK.

---

## 9. Secret rotation

| Secret | Rotation cadence | Procedure |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Annual or on suspected exposure | Supabase Dashboard → Project Settings → API → Regenerate; update Vercel env; redeploy |
| `CRON_SIGNING_SECRET` | Annual or on suspected exposure | Generate 32+ random bytes (`openssl rand -hex 32`); update Vercel env; redeploy |
| `OPENAI_API_KEY` | Per OpenAI policy | OpenAI dashboard; update Vercel env; redeploy |
| `UPSTASH_REDIS_REST_TOKEN` | Annual or on suspected exposure | Upstash dashboard; update Vercel env; redeploy |
| Supabase `anon` key | Only on suspected exposure | Regenerate in Supabase; update Vercel env; rebuild (the anon key is baked into the public bundle) |

After any secret rotation, run the §6 smoke tests.

---

## 10. Backup & restore

- Supabase provides point-in-time recovery (PITR) for the database tier
  (platform-managed). Operator confirms PITR is enabled and the
  retention window matches the controller's RPO.
- Storage bucket backups (PDFs) follow Supabase Storage's replication
  defaults; controller-side PDF re-generation from `score_results` is
  always possible since no clinical data lives only in the PDF.

A restore drill is `EXT-LEGAL` and should be conducted at least
annually (Art.32(1)(d) — testing of restore capability).

---

## 11. Cron operations

| Cron | Schedule | Endpoint | Notes |
|---|---|---|---|
| Retention prune | `0 3 * * *` (03:00 UTC) | `/api/v1/internal/retention` | Prunes audit / notification rows past per-tenant windows |
| Anonymisation | `0 4 * * *` (04:00 UTC) | `/api/v1/internal/anonymize` | Anonymises soft-deleted patients past `ANONYMIZE_GRACE_DAYS` |

Both endpoints:

- Require `Authorization: Bearer $CRON_SIGNING_SECRET` (constant-time
  compare — B-04).
- Return structured JSON with the counts.
- Are idempotent (safe to re-run).

Manual run procedure (incident response):

```
curl -X POST https://<host>/api/v1/internal/retention \
  -H "Authorization: Bearer $CRON_SIGNING_SECRET"
```

---

## 11b. Distributed rate limiting (M-01)

By default the rate limiter uses an in-memory token bucket scoped to a
single Vercel function instance. Cold-start fan-out resets the counter,
so a determined attacker can multiply the effective limit by N. **Wire
Upstash before opening the platform to a paying tenant.**

### Setup

1. Create an Upstash Redis database in the **EU region** (matches the
   rest of the stack — DPA / sub-processor parity).
2. From the Upstash dashboard copy:
   - REST URL  → set as `UPSTASH_REDIS_REST_URL` in Vercel project env
   - REST token → set as `UPSTASH_REDIS_REST_TOKEN` (Production scope only)
3. Trigger a redeploy (Vercel re-reads env at build time).
4. Verify: hit any endpoint twice, then check `X-RateLimit-Remaining`
   in response headers — the counter must persist across calls even
   when Vercel routes to a different instance.

### Behaviour with / without env vars

| State | What happens |
|---|---|
| Both env vars set | Distributed counter via Upstash; safe across cold-starts |
| Either unset | Per-instance in-memory bucket (development default) |
| Upstash transiently down (timeout, network) | Fallback to in-memory for this request only — `[rate-limit-upstash] pipeline …` warning logged. Next request retries Upstash. |

### Sub-processor implications

Adding Upstash adds one runtime sub-processor. Update
`docs/21-PRIVACY-TECHNICAL.md §11` and the per-tenant DPA before
flipping the env vars in production. No PHI is ever written to Redis
(keys are `ratelimit:<routeId>:<userIdOrIpHash>`); but the network
endpoint itself counts as data flow that GDPR Art.30 expects to be
recorded.

### Regression gate

`scripts/check-rate-limit-async.mjs` (wired into
`npm run build:check` + standalone `npm run check:rate-limit`)
fails the build if a future PR re-introduces the synchronous
`checkRateLimit` in any `api/v1/**` endpoint.

## 12. Security headers

Configured in `vercel.json`. After every deploy verify with:

```
curl -I https://<host>/pages/login.html
# expect: X-Content-Type-Options, X-Frame-Options DENY,
#         Referrer-Policy, Permissions-Policy, HSTS,
#         Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy
```

For `/pages/*` and `/components/*` the CSP is restrictive
(no inline scripts, only Supabase as a third-party connect-src).

---

## 12b. AUDIT_EVENTS partitioning cutover (SOP)

> Triggered when a tenant's `audit_events` row count crosses **50 M** or
> the daily DELETE under `fn_retention_prune` starts taking >30 s.
> Until that point, the BRIN index added by migration 016 is sufficient.

### Why partition

`audit_events` is append-only and dominated by range scans
(retention DELETE, audit-query UI date filter). Monthly range
partitioning lets the retention cron call `DROP PARTITION` (O(1),
no row-by-row WAL) instead of `DELETE FROM … WHERE created_at < …`
(O(rows-deleted), heavy WAL).

### Pre-flight

```sql
-- 1. Confirm the cron-side cutoff is older than the partitions you
--    plan to drop. fn_audit_oldest_safe_cutoff() returns the
--    timestamp before which EVERY tenant has already agreed to drop.
SELECT fn_audit_oldest_safe_cutoff();

-- 2. Snapshot the row count + size — for the post-flight diff.
SELECT pg_size_pretty(pg_total_relation_size('audit_events'))
     , (SELECT COUNT(*) FROM audit_events);
```

### Cutover (maintenance window required)

```sql
BEGIN;

-- 1. Rename the existing table so we can swap in the partitioned one.
ALTER TABLE audit_events RENAME TO audit_events_legacy;

-- 2. Create the partitioned skeleton with the same column set.
--    NOTE: the partition key MUST be part of every UNIQUE / PK
--    constraint, so the PK becomes (id, created_at).
CREATE TABLE audit_events (
  -- columns identical to audit_events_legacy
  LIKE audit_events_legacy INCLUDING ALL EXCLUDING CONSTRAINTS,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 3. Pre-create the partitions you'll need (last 12 months + next).
--    Run the helper:
DO $$
DECLARE
  m DATE;
BEGIN
  FOR m IN SELECT generate_series(
    date_trunc('month', NOW() - INTERVAL '12 months'),
    date_trunc('month', NOW() + INTERVAL '1 month'),
    INTERVAL '1 month'
  )::DATE LOOP
    EXECUTE format(
      'CREATE TABLE audit_events_y%sm%s ' ||
      'PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L);',
      to_char(m, 'YYYY'), to_char(m, 'MM'),
      m,
      (m + INTERVAL '1 month')::DATE
    );
  END LOOP;
END $$;

-- 4. Bulk copy in chunks (avoid long-running single TX on huge tables).
INSERT INTO audit_events SELECT * FROM audit_events_legacy;

-- 5. Sanity: row counts must match.
SELECT (SELECT COUNT(*) FROM audit_events) AS new
     , (SELECT COUNT(*) FROM audit_events_legacy) AS old;

-- 6. Re-create indexes that didn't carry through LIKE.
CREATE INDEX ON audit_events (tenant_id, created_at);
CREATE INDEX ON audit_events USING BRIN (created_at);

-- 7. Drop the legacy table (the rename keeps it as a fast-rollback
--    safety net — keep it around until you're confident).
-- DROP TABLE audit_events_legacy;  -- run AFTER 7 days of stable ops.

COMMIT;
```

### Retention worker post-cutover

After the cutover, replace the audit-event branch of
`fn_retention_prune` with a `DROP PARTITION` form:

```sql
-- Pseudocode — implementation lives in the next migration that
-- ships with the cutover, NOT in 015.
FOR p IN
  SELECT child.relname AS part_name,
         pg_get_expr(child.relpartbound, child.oid) AS bounds
    FROM pg_inherits i
    JOIN pg_class child  ON child.oid  = i.inhrelid
    JOIN pg_class parent ON parent.oid = i.inhparent
   WHERE parent.relname = 'audit_events'
LOOP
  -- Parse upper bound from `bounds`; if upper_bound < safe_cutoff:
  --   EXECUTE format('DROP TABLE %I', p.part_name);
END LOOP;
```

### Monthly partition pre-creation

Add a Vercel cron at month start:

```
POST /api/v1/internal/audit-partitions
Authorization: Bearer ${CRON_SIGNING_SECRET}
```

The handler creates next-month's partition. Failure to pre-create is
not catastrophic — Postgres rejects inserts past the highest defined
range with an error, which the audit emitter surfaces as
`AUDIT_WRITE_FAILED` (already monitored).

### Rollback

```sql
BEGIN;
ALTER TABLE audit_events RENAME TO audit_events_partitioned_failed;
ALTER TABLE audit_events_legacy RENAME TO audit_events;
COMMIT;
```

The legacy rename in step 1 is the rollback handle — keep it for at
least 7 days post-cutover.

---

## 13. Definition of "deploy successful"

A production deploy is "successful" when **all** of the following hold:

```
[ ] Vercel build status = success
[ ] All §6 smoke tests pass
[ ] No new HTTP 5xx in the first 15 minutes
[ ] No AUDIT_WRITE_FAILED log lines in the first 15 minutes
[ ] Cron next-run-time updated in Vercel UI
[ ] Frontend loads without console errors on at least 1 modern browser
```

If any of the above fails, follow §7 rollback.

---

**Cross-references**

- `20-SECURITY.md` — security architecture.
- `27-INCIDENT-RESPONSE.md` — incident response playbook.
- `12-PACKAGE-UPGRADE.md` — dependency upgrade policy.
- `vercel.json` — runtime configuration source of truth.
- `package.json` — script source of truth.
