# Uelfy Clinical — First Tenant Onboarding Runbook

> **Scope.** Operational checklist + commands to take the platform from
> "code on `main` + Tier 1-4 shipped" to "first paying tenant logged in
> and using the product end-to-end".
>
> **Audience.** You (founder / engineering lead) executing the cutover.
> Some steps require the controller's clinical lead and DPO to sign
> documents — those are flagged `EXT-LEGAL` / `EXT-CLIN`.
>
> **Companion docs.** `26-DEPLOYMENT-RUNBOOK.md` (deploy mechanics),
> `31-LAUNCH-CHECKLIST.md` (gates), `27-INCIDENT-RESPONSE.md`
> (alert wiring), `33-RESTORE-DRILL-SOP.md` (backup SOP).

---

## 0. Mental model

This runbook is sequenced as a directed graph: each step depends on
the previous ones. Skipping a step often produces a downstream
failure that LOOKS like a different bug. Run them in order.

Phases:

| Phase | What | Gate to next |
|---|---|---|
| **P1** Infrastructure | Vercel, Supabase, Upstash, Datadog ready | All env vars set |
| **P2** Database | Migrations 001-016 applied | RLS / cron functions verified |
| **P3** Identity bootstrap | First platform_admin + MFA | aal2 admin can log in |
| **P4** Tenant provisioning | Create tenant + tenant_admin | tenant_admin can sign in |
| **P5** Clinical onboarding | Clinician + first patient | E2E assessment + PDF |
| **P6** Observability | Datadog monitors armed | First alert fires + acks |
| **P7** Hardening flips | MFA mandate ON for all admins | All admins on aal2 |
| **P8** Sign-off | Launch checklist signed | Go-live complete |

Estimated wall-clock: **3-4 hours** if everything goes right.
Realistically: **plan a half-day** with a colleague on hand for the
first run.

---

## P1. Infrastructure (≈ 30 min)

### P1.1 Vercel project

```
[ ] Vercel account exists, EU billing entity if controller is in EU
[ ] Project linked to git repo, branch = main
[ ] Region = fra1 (Frankfurt — EU)
[ ] Project setting "Function Region" = fra1
[ ] Build & Output settings: Build Command = `npm run build`,
    Output Directory = `frontend-dist`
[ ] Custom domain wired (HTTPS auto-renewed) — e.g. app.uelfy.com
```

### P1.2 Supabase project

```
[ ] Supabase project created, region = eu-central-1 / eu-west-1
[ ] PITR enabled (Pro plan)
[ ] Network restrictions: tighten if controller has a VPN; otherwise
    accept defaults
[ ] Database password rotated, stored in 1Password (NOT in repo)
[ ] Storage bucket `clinical-reports` created as PRIVATE (verified
    in Studio → Storage → bucket settings)
```

Capture for the next step:

- `SUPABASE_URL` (project URL)
- `SUPABASE_ANON_KEY` (Studio → Project Settings → API → `anon` key)
- `SUPABASE_SERVICE_ROLE_KEY` (Studio → Project Settings → API →
  `service_role` key — **production scope only**)

### P1.3 Upstash Redis (rate limiter — M-01 in prod)

```
[ ] Upstash Redis database created in EU region
[ ] REST API enabled
[ ] Capture UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
[ ] Add Upstash to the per-tenant DPA sub-processor list
```

Without these env vars the rate limiter falls back to in-memory
(single-instance) — Vercel's serverless model means each function
instance gets its own bucket, which is fine for dev but useless in
production. Strongly recommended.

### P1.4 Datadog (or Logflare / Vercel logs alone)

```
[ ] Vercel Log Drain configured (or Datadog Vercel integration)
[ ] Drain captures stdout/stderr of api/v1/* functions
[ ] Test query returns recent function invocations
```

### P1.5 Vercel environment variables

Set these in Vercel UI → Project → Settings → Environment Variables.
**Production scope only** for secrets; never copy to Preview / Dev.

| Variable | Scope | Notes |
|---|---|---|
| `SUPABASE_URL` | All | Public |
| `SUPABASE_ANON_KEY` | All | Public — also baked into bundle |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production only** | NEVER preview/dev |
| `CRON_SIGNING_SECRET` | Production only | ≥ 32 random bytes — `openssl rand -hex 32` |
| `NODE_ENV` | All | `production` |
| `UPSTASH_REDIS_REST_URL` | Production | From P1.3 |
| `UPSTASH_REDIS_REST_TOKEN` | Production | From P1.3 |
| `MFA_ENFORCEMENT_ENABLED` | Production | leave **unset** for now (P3 flips it) |
| `MFA_ENFORCEMENT_CLINICIAN_ENABLED` | Production | leave **unset** for now (P7 flips it) |
| `MFA_ENFORCEMENT_STAFF_ENABLED` | Production | leave **unset** for now (P7 flips it) |
| `ANONYMIZE_GRACE_DAYS` | Production | `30` (or per tenant DPA) |
| `OPENAI_API_KEY` | Production | **unset** unless AI commentary opt-in |
| `SBOM_CVE_FAIL_ON_HIGH` | Production | `false` initially (warn-only) |

### P1.6 Generate the cron signing secret

```
openssl rand -hex 32
```

Paste in Vercel as `CRON_SIGNING_SECRET`. Save in 1Password under the
project record. Rotation cadence: 12 months — calendar reminder set.

### P1.7 First deploy

```
git push origin main
```

Wait for Vercel build to go green. Watch the build log for:

- `npm run build` succeeds
- `verify-build.mjs` passes
- `check-engine-determinism.mjs` passes
- `check-rate-limit-async.mjs` passes
- `check-sbom.mjs` passes
- `check-sbom-cves.mjs` passes (or warns)

If any of these red-flags, fix BEFORE moving on. Section A.1 of
`31-LAUNCH-CHECKLIST.md` is the full gate list.

---

## P2. Database migrations (≈ 20 min)

### P2.1 Apply migrations 001-016

In Supabase Studio → SQL Editor, paste each migration file in order.
**Order matters** — migrations reference each other.

```
001_schema_foundation.sql
002_alerts_followups.sql
003_retention_anonymization_snapshot.sql
004_audit_events_extensions.sql
005_professional_patient_links.sql
006_indeterminate_band.sql
007_*.sql … (all numbered files)
008_*.sql
…
013_fix_assessment_atomic_defaults.sql
014_tenant_retention_overrides.sql
015_retention_prune_per_tenant.sql      ← Tier 4
016_audit_events_brin_index.sql         ← Tier 4
```

Alternative: `supabase db push` against the linked project (faster
but less interactive — recommended once you trust the toolchain).

### P2.2 Verify migrations applied

```sql
SELECT action, metadata_json->>'name' AS name, created_at
FROM audit_events
WHERE action = 'system.migration.applied'
ORDER BY created_at DESC;
-- expect: 16+ rows, latest = 016_audit_events_brin_index
```

### P2.3 Verify RLS posture (B-01)

```sql
SELECT c.relname AS table_name,
       c.relrowsecurity      AS rls_on,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'tenants','users','patients','patient_clinical_profiles',
    'assessments','assessment_measurements','score_results',
    'risk_profiles','nutrition_snapshots','activity_snapshots',
    'followup_plans','alerts','consent_records',
    'data_subject_requests','report_exports','audit_events',
    'professional_patient_links','notification_jobs'
  )
ORDER BY c.relname;
-- expect: every row has rls_on = true AND rls_forced = true
```

### P2.4 Verify functions exist

```sql
SELECT proname FROM pg_proc
WHERE proname IN (
  'fn_anonymize_patient',
  'fn_retention_prune',
  'fn_audit_oldest_safe_cutoff',
  'create_assessment',
  'is_linked_to_patient'
)
ORDER BY proname;
-- expect: 5 rows
```

### P2.5 Verify anon has zero PHI grants

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
  AND table_schema = 'public'
  AND table_name IN ('patients', 'assessments', 'consent_records', 'audit_events');
-- expect: 0 rows
```

If you get rows here, migration 010 didn't run cleanly. Stop and
re-run it.

### P2.6 RLS test suite (optional but strongly recommended)

```bash
DATABASE_URL=postgres://... npm run test:rls
```

Should print `OK` for the 6 cross-tenant negative assertions. If it
skips because `psql` is missing, install postgresql-client locally
and re-run.

---

## P3. Platform admin bootstrap (≈ 20 min)

> **Why first.** Without a platform_admin row, no one can log in to
> the new database. Supabase Auth and `public.users` are two separate
> tables; you must mirror the auth user into `public.users` and
> assign the role.

### P3.1 Create the auth user

Supabase Studio → Authentication → Users → "Add user" → "Create
new user".

```
Email:    you@uelfy.com
Password: <strong, ≥ 16 chars, stored in 1Password>
Auto Confirm User: YES (skip the email verification)
```

Capture the resulting `auth.users.id` (UUID). Studio shows it in the
user detail panel.

### P3.2 Bootstrap a placeholder tenant for the platform_admin

The schema requires `users.tenant_id NOT NULL`. The platform_admin
needs a "home tenant" — by convention we use a synthetic one with
`status='active'` and `slug='_platform'`.

```sql
INSERT INTO tenants (name, slug, plan, status)
VALUES ('Uelfy Platform', '_platform', 'enterprise', 'active')
ON CONFLICT (slug) DO NOTHING
RETURNING id;
```

Capture the returned `id` as `:platform_tenant_id`.

### P3.3 Insert your `public.users` row

```sql
INSERT INTO users (id, tenant_id, role, full_name, email, status)
VALUES (
  '<auth.users.id from P3.1>'::uuid,
  '<platform_tenant_id from P3.2>'::uuid,
  'platform_admin',
  'Your Full Name',
  'you@uelfy.com',
  'active'
);
```

### P3.4 Verify the round-trip

Open the deployed app at `https://app.uelfy.com/pages/login.html`,
log in with the email + password from P3.1.

You should land on `/pages/dashboard.html`. If you see
`USER_PROFILE_NOT_FOUND` instead, P3.3 didn't run — re-check the
UUID matches `auth.users.id` exactly.

### P3.5 MFA enrolment for the platform_admin

Navigate to `https://app.uelfy.com/pages/mfa-enroll.html`.

You should see the **enrollment** flow (Tier 3 dispatcher detects
no verified factor). Scan the QR with Google Authenticator / 1Password
/ Authy / Microsoft Authenticator. Enter the 6-digit code.

After "Verify and enable", the dispatcher confirms `aal2` and
auto-redirects to dashboard. Now your session is MFA-protected.

### P3.6 Flip the admin MFA mandate

In Vercel UI → Project → Settings → Environment Variables:

```
MFA_ENFORCEMENT_ENABLED = true
```

Redeploy the project (Vercel auto-redeploys when env vars change in
production scope; or hit "Redeploy" manually).

### P3.7 Verify the gate

```bash
# Pre-MFA legacy token (from before P3.5) — get a fresh aal1 token by
# signing in incognito as a synthetic user without enrolling MFA.
curl -s -H "Authorization: Bearer $LEGACY_TOKEN" https://app.uelfy.com/api/v1/me
# expect: HTTP 403 with body {"error":{"code":"MFA_REQUIRED",...}}

# Your aal2 token (from P3.5)
curl -s -H "Authorization: Bearer $AAL2_TOKEN" https://app.uelfy.com/api/v1/me
# expect: HTTP 200 with the user profile
```

In Datadog: filter `@event:ACCESS_DENIED reason:mfa_required` —
you should see exactly one entry per legacy-token call.

---

## P4. First tenant + tenant_admin (≈ 30 min)

### P4.1 Create the tenant

Talk to the customer. Capture: legal name, slug (URL-safe), plan
tier, country. Then in Supabase SQL Editor:

```sql
INSERT INTO tenants (name, slug, plan, status)
VALUES (
  'Studio Medico Esempio S.r.l.',
  'studio-medico-esempio',
  'professional',                    -- starter | professional | clinic | enterprise
  'trial'                            -- promote to 'active' after billing setup
)
RETURNING id;
```

> **Note on schema.** The current `tenants` schema (migration 001 +
> 014) has these columns: `id`, `name`, `slug`, `plan`, `status`,
> `logo_url`, `settings`, `max_professionals`, `max_patients`,
> `created_at`, `updated_at`, plus the four `retention_days_*`
> overrides added by 014. There is NO `country` column today —
> jurisdiction is implicit from the EU-only deployment. If a
> controller insists on a country tag for billing, store it under
> `settings->>'country'` (JSONB) rather than adding a new column,
> until a real product reason justifies a schema change.

Capture the returned `id` as `:tenant_id`.

### P4.2 Optional: per-tenant retention overrides

If the controller has a tighter / longer retention window than the
platform default (audit 3650, alerts-resolved 365, notifications 90,
anonymize-grace 30), set them now via the admin UI
(`/pages/tenant-settings.html`) OR directly:

```sql
UPDATE tenants
SET retention_days_audit = 2555,                  -- 7 years
    retention_days_alerts_resolved = 730,         -- 2 years
    retention_days_notifications = 60,
    retention_days_anonymize_grace = 14
WHERE id = '<tenant_id>'::uuid;
```

Migration 015 means the daily cron will honour these from the next
run onward.

### P4.3 Create the tenant_admin auth user

Supabase Studio → Authentication → Users → "Add user".

```
Email:    admin@studiomedicoesempio.it
Password: <generated, sent to the admin via separate channel>
Auto Confirm User: YES
```

Capture the `auth.users.id` as `:admin_auth_id`.

### P4.4 Mirror in `public.users`

```sql
INSERT INTO users (id, tenant_id, role, full_name, email, status)
VALUES (
  '<admin_auth_id>'::uuid,
  '<tenant_id>'::uuid,
  'tenant_admin',
  'Dott.ssa Maria Rossi',
  'admin@studiomedicoesempio.it',
  'active'
);
```

### P4.5 Audit row for the bootstrap

```sql
INSERT INTO audit_events (
  tenant_id, actor_user_id, action, entity_type, entity_id,
  metadata_json
) VALUES (
  '<tenant_id>'::uuid,
  '<your_platform_admin_user_id>'::uuid,
  'admin.role_change',
  'user',
  '<admin_auth_id>'::uuid,
  jsonb_build_object('action', 'tenant_admin_bootstrap', 'tenant', 'studio-medico-esempio')
);
```

### P4.6 Send credentials to the tenant_admin

Send via two separate channels:

- **Channel 1 (email):** the URL `https://app.uelfy.com/pages/login.html`
  + the email address used in P4.3.
- **Channel 2 (phone / signal / signed PDF):** the password.

The tenant_admin's first action is:

1. Log in. They land on `/pages/dashboard.html`.
2. Get rejected by `/api/v1/me` with `MFA_REQUIRED` (because P3.6
   flipped the flag).
3. Frontend redirects to `/pages/mfa-enroll.html` — dispatcher
   detects no verified factor → enrollment flow.
4. Scan QR, enter 6-digit code, redirect back to dashboard.

If the tenant_admin reports a loop (the Tier 3 fix should have
eliminated this), re-read `30-RISK-REGISTER.md` L-09 acceptance
criteria #6/9 to triage.

---

## P5. Clinical onboarding (≈ 45 min)

### P5.1 Tenant_admin creates the first clinician

The clinician role is the day-to-day user. Today there is no
dedicated UI; tenant_admin creates them via the same Studio + SQL
flow as P4 (or you do it on their behalf).

```sql
-- 1. Auth user (Studio → Add user)
-- 2. Mirror:
INSERT INTO users (id, tenant_id, role, full_name, email, status)
VALUES (
  '<clinician_auth_id>'::uuid,
  '<tenant_id>'::uuid,
  'clinician',
  'Dr. Marco Bianchi',
  'mbianchi@studiomedicoesempio.it',
  'active'
);
```

### P5.2 First patient

Tenant_admin or clinician opens the dashboard → "New patient" →
fills the form → submit. The backend writes to `patients` with
`tenant_id` derived from the auth context.

Verify in SQL:

```sql
SELECT id, display_name, tenant_id, consent_status, created_at
FROM patients
WHERE tenant_id = '<tenant_id>'::uuid
ORDER BY created_at DESC LIMIT 5;
```

### P5.3 Professional-patient link (B-08 gate)

If the patient was created by a **clinician**, the assessment service
auto-creates the PPL row. If created by **tenant_admin**, the PPL is
NOT auto-created — tenant_admin needs to assign clinicians explicitly.

Today this is also a SQL operation:

```sql
INSERT INTO professional_patient_links (
  tenant_id, professional_user_id, patient_id,
  relationship_type, is_active
) VALUES (
  '<tenant_id>'::uuid,
  '<clinician_user_id>'::uuid,
  '<patient_id>'::uuid,
  'primary',
  true
);
```

Without an active PPL, the clinician will hit `403 NO_PATIENT_LINK`
on every patient-touching endpoint. The L-05 follow-up shipped in
Tier 4 makes this attempt visible in Datadog as
`@event:ACCESS_DENIED reason:cross_clinician_ppl`.

### P5.4 First assessment

Clinician opens patient page → "New assessment" → fills the
required labs (10 fields per `shared/schemas/assessment-input.ts`)
→ submit.

Verify in SQL:

```sql
SELECT a.id, a.status, rp.composite_risk_level,
       array_length(
         (SELECT array_agg(sr.id) FROM score_results sr
          WHERE sr.assessment_id = a.id), 1
       ) AS score_count
FROM assessments a
LEFT JOIN risk_profiles rp ON rp.assessment_id = a.id
WHERE a.tenant_id = '<tenant_id>'::uuid
ORDER BY a.created_at DESC LIMIT 5;
-- expect: score_count >= 6 (SCORE2/2-D, BMI, MetS, FIB-4, eGFR, …)
```

### P5.5 PDF report

From the assessment page, click "Generate PDF report". The backend
mints a 5-minute signed URL on `clinical-reports` bucket and returns
it. Open in a new tab — verify visually:

- Header band with tenant name
- Patient identification block
- Composite risk + per-domain banded cards
- Score table with each computed score
- Lifestyle summary, recommendations, alerts, follow-up plan
- Footer with audit ID + non-authoritative-AI disclaimer

In SQL:

```sql
SELECT id, assessment_id, file_size_bytes, engine_version, created_at
FROM report_exports
WHERE tenant_id = '<tenant_id>'::uuid
ORDER BY created_at DESC LIMIT 3;
```

### P5.6 Consent record

For the first patient, file at least one `health_data_processing`
consent so the platform has a clear `recordAuditStrict` paper trail
matching the patient's data activity.

Via UI (consent page) or direct API:

```bash
curl -X POST https://app.uelfy.com/api/v1/consents \
  -H "Authorization: Bearer $TENANT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "<patient_id>",
    "consentType": "health_data_processing",
    "purpose": "treatment",
    "policyVersion": "1.0",
    "legalBasis": "consent",
    "action": "grant"
  }'
```

### P5.7 DSR sanity (Art.15 export round-trip)

```bash
curl -s -H "Authorization: Bearer $TENANT_ADMIN_TOKEN" \
  "https://app.uelfy.com/api/v1/patients/<patient_id>/export" \
  -o patient-export.json

jq '.assessments | length, .consents | length' patient-export.json
# expect: at least 1 of each
```

A `data_subject_requests` row is also created with `kind='access'` —
verify in SQL:

```sql
SELECT id, kind, status, fulfilled_at
FROM data_subject_requests
WHERE subject_patient_id = '<patient_id>'::uuid;
-- expect: at least 1 row, status='fulfilled'
```

---

## P6. Observability wiring (≈ 30 min)

### P6.1 Datadog (or equivalent) monitors

Three structured events fail-closed and need eyes on them. Configure
log monitors with these queries:

| Monitor | Query | Threshold | Severity |
|---|---|---|---|
| Audit write outage | `@event:AUDIT_WRITE_FAILED` | ≥ 1 in 5 min | P1 |
| Cross-tenant attempt | `@event:ACCESS_DENIED @reason:cross_tenant` | ≥ 5 in 15 min | P2 |
| Cross-clinician PPL | `@event:ACCESS_DENIED @reason:cross_clinician_ppl` | ≥ 10 in 1 h | P3 |
| MFA gate hit | `@event:ACCESS_DENIED @reason:mfa_required` | ≥ 100 in 15 min | P3 (likely campaign) |
| Rate limit backend down | `@event:RATE_LIMIT_BACKEND_FAILURE` | ≥ 1 in 10 min | P2 |
| Retention cron success | `@event:RETENTION_RUN` | ≤ 0 in 25 h | P3 (cron didn't run) |

### P6.2 Vercel cron health

Vercel UI → Cron → both `/api/v1/internal/retention` (03:00 UTC) and
`/api/v1/internal/anonymize` (04:00 UTC) should show "Last invocation
succeeded".

### P6.3 First retention run (manual probe)

Trigger the retention cron once manually so you see the first
`RETENTION_RUN` event arrive:

```bash
curl -X POST https://app.uelfy.com/api/v1/internal/retention \
  -H "Authorization: Bearer $CRON_SIGNING_SECRET"

# expect: HTTP 200 with body containing pruneResult.tenant_count >= 1
```

In Datadog, filter `@event:RETENTION_RUN` — you should see ONE entry
with `pruneResult.breakdown.audit_per_tenant ≥ 0`. Tier 4 wired this
specifically so per-tenant pruning is visible operationally.

### P6.4 First AUDIT_WRITE_FAILED probe

Optional but strongly recommended once: deliberately break the
audit table for 30 seconds so you see the structured event come
through end-to-end. Procedure documented in `27-INCIDENT-RESPONSE.md
§11.2`.

### P6.5 Alert escalation

```
[ ] On-call rotation defined with at least 2 engineers
[ ] Datadog → Slack / PagerDuty wiring tested with a synthetic alert
[ ] Tenant-side escalation contact captured in DPA appendix
```

---

## P7. Hardening flips (≈ 15 min)

> Only do this AFTER every active user in the role has enrolled MFA.
> Flipping early locks people out.

### P7.1 Enrolment audit

```sql
SELECT
  u.role,
  count(*) AS users,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM auth.mfa_factors mf
      WHERE mf.user_id = u.id AND mf.status = 'verified'
    )
  ) AS mfa_enrolled
FROM users u
WHERE u.status = 'active'
  AND u.tenant_id = '<tenant_id>'::uuid
GROUP BY u.role
ORDER BY u.role;
```

For each role, `mfa_enrolled = users` is the green-light to flip the
corresponding flag.

### P7.2 Flip clinician + staff flags (Tier 4)

In Vercel UI → Settings → Environment Variables:

```
MFA_ENFORCEMENT_CLINICIAN_ENABLED = true
MFA_ENFORCEMENT_STAFF_ENABLED     = true
```

Vercel auto-redeploys. From the next deploy, every clinician /
assistant_staff session at aal1 hits 403 → frontend redirects to
mfa-enroll → Tier 3 dispatcher serves the enrolment / challenge.

### P7.3 SBOM CVE policy

When the supply chain is mature (all High CVEs triaged):

```
SBOM_CVE_FAIL_ON_HIGH = true
```

This makes `npm run build:check` fail PRs that introduce new High
CVEs (Critical always fails). Until then, the gate stays warn-only.

---

## P8. Sign-off (≈ 30 min)

### P8.1 Walk through `31-LAUNCH-CHECKLIST.md`

Open the file. For each gate that this runbook just exercised, tick
it. Anything you can't tick must either be:

- a known `EXT-LEGAL` / `EXT-CLIN` / `EXT-MDR` row → controller
  signs the waiver in §F
- or a real engineering gap → fix BEFORE go-live

### P8.2 Sign-off block (`§F`)

| Role | Owner | Action |
|---|---|---|
| Engineering lead (Uelfy) | You | Sign §F.1 once §A is green |
| DPO (Uelfy) | You or designated DPO | Sign §F.2 once §B is green |
| Founder (Uelfy) | You | Sign §F.3 |
| Controller — clinical lead | Tenant clinical lead | Sign §F.4 (`EXT-CLIN`) |
| Controller — DPO | Tenant DPO | Sign §F.5 (`EXT-LEGAL`) |
| Controller — IT lead | Tenant IT | Sign §F.6 |
| Regulatory consultant | If MDR-scope | Sign §F.7 (`EXT-MDR`) |

### P8.3 First-week monitoring discipline

For the first 7 days post go-live, run this morning checklist:

```
[ ] Vercel cron (retention + anonymize) — last run = success
[ ] Datadog @event:AUDIT_WRITE_FAILED count = 0 in last 24h
[ ] Datadog @event:ACCESS_DENIED — only legitimate denials
    (no cross_tenant patterns)
[ ] DSR pipeline empty or all in-SLA (`sla_deadline > NOW()`)
[ ] Tenant-side users haven't reported MFA loops or 5xx errors
```

After 7 clean days you can drop to a weekly cadence.

### P8.4 30-day review

Per `§G` of the launch checklist:

```
[ ] Retention cron has pruned at least one row matching per-tenant
    cutoff (verify via @event:RETENTION_RUN breakdown)
[ ] At least one assessment + PDF round-trip
[ ] Backup restore drill scheduled within next 11 months
    (`33-RESTORE-DRILL-SOP.md`)
[ ] Sub-processor list reviewed — Upstash + Supabase + Vercel +
    OpenAI (if enabled)
```

---

## Appendix A — Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| "USER_PROFILE_NOT_FOUND" on first login | `public.users.id` ≠ `auth.users.id` | Re-check UUID match in P3.3 / P4.4 |
| Endless MFA redirect loop | Browser cache holds stale aal1 token | Hard reload + clear LocalStorage; re-login |
| `403 NO_PATIENT_LINK` for clinician | Missing PPL row | INSERT into `professional_patient_links` (P5.3) |
| Cron returns 401 | `CRON_SIGNING_SECRET` mismatch | Re-paste from 1Password into Vercel env |
| Rate limit flapping | Upstash env vars unset | Set both URL + TOKEN; redeploy |
| PDF report 500s | Fonts not fetched at build | Check `fetch:fonts` ran in build log |
| `MIGRATION_REQUIRED` from assessment-service | Migration 005 not applied | Apply 005, retry |
| `clinical_input_snapshot` immutable error | Trying to UPDATE a snapshot | Don't — by design (003 trigger) |

## Appendix B — Provisioning scripts (optional)

For scaling beyond the first tenant, the SQL flows in P3-P5 should
become a backend endpoint (`POST /api/v1/admin/tenants` —
platform_admin only). It does not exist today; this runbook keeps
the manual SQL path because the first tenant is a one-shot event
and writing the endpoint costs more than it saves at n=1.

When you onboard the **third** tenant, build the endpoint. Track
this in the engineering backlog.

---

## Appendix C — Rollback

If something goes catastrophically wrong:

1. **Revert env flags first** — `MFA_ENFORCEMENT_*` → unset
2. **Revert code** — `git revert <SHA>` + push (Vercel redeploys)
3. **Revert migrations** — only if the migration itself broke
   something. Migration rollback procedure in
   `26-DEPLOYMENT-RUNBOOK.md §7`.
4. **Restore from PITR** — only if the database is corrupted.
   `33-RESTORE-DRILL-SOP.md`.

---

**End of runbook.** When P1-P8 are all green, the platform is in
production with one paying tenant. Schedule the 30-day review and
move on.
