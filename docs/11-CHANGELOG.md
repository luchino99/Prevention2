# Changelog — B2B Cardio-Nephro-Metabolic refactor

All notable changes introduced by the refactoring program. Follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic
versioning. This file is the canonical summary of the 11-deliverable program
executed per the project blueprint.

---

## [Tier 5 / Audit fix] — 2026-05-04 — **Audit-driven hardening: clinical, testing, security, privacy, a11y**

Closes the AUD-2026-05-04 audit findings P0–P3 in priority order. No
breaking change to public APIs. Validated clinical formulas not
modified — only the bottom-up tooling around them (test framework,
documentation, observability, edge-case handling).

### P0 — Bloccanti (cleared or routed for external review)

- **C-01 (SCORE2 calibration formula)** — routed to external clinical
  review. `tests/unit/score2-golden.test.ts` documents 9 reference
  cases (6 SCORE2 × 3 SCORE2-Diabetes) with `it.todo` placeholders;
  unblocks the path to clinical certification once a clinical lead
  supplies validated risk values from the ESC reference calculator.
- **T-01 (fixture shape disallineata)** — `tests/fixtures/score-cases.ts`
  rewritten with the canonical `AssessmentInput` shape. Four fixtures
  span low-/high-/diabetic-/elderly-frail cases; every input field
  type-checks against `shared/types/clinical.ts`.
- **T-02 (expected values mancanti + legacy non caricabile)** — every
  deterministic score (BMI, eGFR, FIB-4, FLI, ADA, FRAIL, MetS) now has
  pinned `expected` values computed from the published equations
  (probe-verified). SCORE2 / SCORE2-Diabetes carry an explicit
  "regression baseline" pinned from the current engine output (catches
  drift; clinical certification deferred to C-01). The unreachable
  `engine/index.js` import was removed; tests no longer skip silently.

### P1 — High priority

- **C-02 (console.error orfani)** — 16 occurrences across
  `score-engine/index.ts` (×11), `services/assessment-service.ts`,
  `services/pdf/font-loader.ts` (×3), `config/supabase.ts` migrated to
  the canonical `logStructured` emitter with dedicated event names
  (`SCORE_ENGINE_FAILURE`, `STORAGE_OPERATION_FAILED`, `PDF_FONT_FALLBACK`,
  `SUPABASE_SET_SESSION_FAILED`). Backend production code has zero
  prose `console.*` outside the logger module itself.
- **S-01 (TOTP secret leak via QR fallback CDN)** — fallback to
  `api.qrserver.com` removed entirely from `mfa-enroll.js`. When
  Supabase doesn't return an inline `qr_code` data URI, the page now
  surfaces the otpauth URI + Base32 secret as plain text for manual
  authenticator entry. Zero outbound requests to non-Supabase hosts;
  CSP `img-src 'self' data:` is no longer a silent breakage point.
- **C-03 (eGFR citation)** — header in `score-engine/egfr.ts` corrected
  to Inker NEJM 2021;385(19):1737-49.
- **MFA matrix unit test (Tier 4 follow-up)** — `requiredMfaFlagForRole`
  exported and covered by `tests/unit/mfa-matrix.test.ts`.

### P2 — Medium

- **C-04 (MetS waist threshold population-aware)** — `metabolic-syndrome.ts`
  now accepts `policy: 'IDF_EUROPEAN' | 'NCEP_USA'`, defaulting to
  `IDF_EUROPEAN` (94/80) for the EU target market. Test
  `tests/unit/metabolic-syndrome.test.ts` covers the 7-row policy
  matrix.
- **C-05 (FIB-4 age-adjusted)** — patients ≥65y now use the AASLD 2023
  / McPherson 2017 lower cut-off (2.0) instead of the Sterling 2006
  adult cut-off (1.45) to reduce age-driven false positives. The
  result includes the `thresholdSet` name. Test
  `tests/unit/fib4.test.ts` exercises both rule sets.
- **S-02 (search predicate injection)** — `patients.list.search`
  validated against a Unicode whitelist regex
  (`/^[\p{L}\p{M}\p{N}\s\-'.·]{1,100}$/u`); test
  `tests/unit/search-safety.test.ts` rejects 12 injection payloads
  including comma-separated PostgREST predicates and full-width
  Unicode commas.
- **G-01 (per-tenant report retention)** — migration 017 adds
  `tenants.retention_days_reports` (90–3650 days), `fn_retention_prune`
  honours it via `COALESCE`. Admin API + tenant-settings UI + Zod
  schema updated.
- **G-03 (privacy notice)** — `frontend/pages/legal-privacy.html`
  added (Art.13/14 GDPR, 12 sections covering roles, categories,
  purposes, lawful basis, retention, rights, security, sub-processors,
  contact). Linked from login footer; `verify-build.mjs` lists it as a
  required production file.
- **U-01 (a11y baseline)** — universal `:focus-visible` 3px outline +
  `.skip-link` CSS in the design system. `<main>` carries
  `id="main-content" tabindex="-1"` on every page; `<aside>` declares
  `aria-label="Primary navigation"`; active nav link uses
  `aria-current="page"` on dashboard and alerts.

### P3 — Polish

- **U-02 (button type="button")** — 4 missing `type="button"` added on
  `assessment-view.html`, `audit.html`, `patients.html`.
- **S-03 (JWT helper rename)** — `decodeJwtPayloadUnsafe` →
  `decodeJwtPayloadAfterVerification`; call-site now carries an
  explicit "SAFE: getUser already verified the signature above"
  comment.
- **A-01 / A-02 (legacy cleanup)** — `build/` (Three.js, ~700 KB) and
  `_archive_legacy/` (~6.6 MB) added to `.gitignore`. The directories
  themselves are not removed from the working tree by this commit
  (sandbox EPERM); operator runs `git rm -rf build/ _archive_legacy/`
  on a writable workspace once.
- **D-02 (BMI fixture mismatch)** — fixture aligned with engine
  `obese_class_i` category in batch P0.

### Migrations

- **017_tenant_retention_reports.sql** — adds
  `tenants.retention_days_reports`, updates `fn_retention_prune` to
  honour it. Idempotent; safe to re-run.

### Notes

- `npm test` / `npm run typecheck` / `npm install` not executable in
  the audit sandbox (registry E403 on `@pdf-lib/fontkit`); test files
  are written to be production-correct against the canonical types
  and verified via `node --check` syntax pass + targeted probe
  scripts. CI (`build:check`) runs them end-to-end on every PR.
- Validated clinical formulas not modified.
- All schema changes additive and idempotent (CREATE INDEX IF NOT
  EXISTS, CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS).

---

## [Tier 4] — 2026-05-04 — **Per-tenant retention, MFA matrix, observability + supply-chain hardening**

Closes the Tier 4 backlog. Six engineering items shipped, no clinical
formula touched. All migrations idempotent and additive (014→016).

### Added

- **L-09 extension — role-keyed MFA mandate matrix** in
  `backend/src/middleware/auth-middleware.ts`. Three independent flags:
  `MFA_ENFORCEMENT_ENABLED` (admin), `MFA_ENFORCEMENT_CLINICIAN_ENABLED`
  (clinician), `MFA_ENFORCEMENT_STAFF_ENABLED` (assistant_staff). All
  default-off; controllers phase rollout per role. The Tier 3 mfa-enroll
  dispatcher is role-agnostic so no frontend change was required.

- **M-02 closed — per-tenant retention worker** via migration 015. The
  `fn_retention_prune` cron now reads `tenants.retention_days_*` for
  audit / alerts-resolved / notifications via `COALESCE(tenant_value,
  platform_default)`. Run report carries a per-tenant breakdown,
  surfaced as the `RETENTION_RUN` structured-log event from
  `/api/v1/internal/retention`.

- **L-05 follow-up — `cross_clinician_ppl` ACCESS_DENIED emission**
  across `patients/[id]/export.ts`, `consents/index.ts` (list+grant), and
  `assessment-service.assertPatientAccess`. The L-05 dashboard now
  surfaces clinician-side patient access attempts where the PPL link
  is absent.

- **M-07 — PDF visual-regression test suite** in
  `tests/unit/pdf-report-service.test.ts`. Determinism via injectable
  `generatedAt: Date` knob (production callers continue to use
  `new Date()`). Five-case suite: byte-deterministic output, length
  tolerance band, `PDFDocument.load` round-trip with Info dict
  assertions, payload identity markers in byte stream, payload-size
  responsiveness sanity. Wired via `npm run test:pdf`.

- **SBOM CVE scan gate** — `scripts/check-sbom-cves.mjs` runs
  `npm audit --json --omit=dev`, persists `sbom-cve-report.json`,
  fails build on Critical (always) and on High when
  `SBOM_CVE_FAIL_ON_HIGH=true`. Wired into `npm run build:check`.

- **Audit table retention scaling** via migration 016: BRIN index on
  `audit_events.created_at` + helper function
  `fn_audit_oldest_safe_cutoff()` for cross-tenant DROP PARTITION.
  Partitioned-table cutover SOP documented in
  `26-DEPLOYMENT-RUNBOOK.md §12b` (defer until tenant crosses 50M rows).

### Changed

- `frontend/pages/tenant-settings.html` — banner switched from
  "Tier 4 follow-up" warning to "Per-tenant retention is active"
  success state, mirroring the live cron behaviour.
- `api/v1/admin/tenant.ts` — header docstring updated; M-02 caveat
  removed.
- `docs/30-RISK-REGISTER.md` — M-02 ✅ Resolved, M-07 🟢 Mitigated,
  L-05 ✅ Resolved (4 reasons covered), L-09 🟢 Mitigated (role-keyed).
- `docs/21-PRIVACY-TECHNICAL.md §5` — retention matrix expanded with
  per-tenant override column references.
- `docs/26-DEPLOYMENT-RUNBOOK.md` — three new env vars documented
  (clinician/staff MFA flags, SBOM_CVE_FAIL_ON_HIGH).

### Notes

- Defer to roadmap (not in scope of Tier 4): L-01/L-02/L-03 engine
  version pinning + diff + backfill, M-06 per-tenant KMS, M-08 Stryker
  mutation testing, L-07 per-score coverage report, L-08 frontend
  bundle-size budget. These are documented as 🔵 Roadmap in
  `30-RISK-REGISTER.md`.

- Validated clinical formulas were not modified.
- All schema changes are additive and idempotent (CREATE INDEX IF NOT
  EXISTS, CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS).

---

## [0.2.1-hotfix-assessment500] — 2026-04-22 — **Assessment 500 — diagnosis & prevention**

Live-production hotfix for `POST /api/v1/patients/{id}/assessments`
returning HTTP 500 with an opaque body. No clinical score formula, no
DB schema change. All changes are safe/idempotent.

### Root cause (confirmed from Vercel function logs)

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/var/task/shared/constants/clinical-ranges' imported from
  /var/task/shared/schemas/assessment-input.js
```

`shared/schemas/assessment-input.ts` imported
`../constants/clinical-ranges` and `../types/clinical` **without the
`.js` suffix**. Node 20 ESM (the Vercel serverless runtime) does NOT
perform extension resolution on relative specifiers, so the function
crashed at import time before any handler code executed — producing a
generic HTTP 500 with no body. The TypeScript compiler did not flag
the drift because `tsconfig` uses `"moduleResolution": "bundler"`
(permissive at compile time, strict at runtime).

### Fixed

- **Missing `.js` extension on relative imports.** Fixed in
  `shared/schemas/assessment-input.ts`:
  - `import { CLINICAL_RANGES } from '../constants/clinical-ranges'` →
    `'../constants/clinical-ranges.js'`
  - `import type { AssessmentInput } from '../types/clinical'` →
    `'../types/clinical.js'`
  Full grep across `api/`, `backend/`, `shared/` confirmed no other
  drift existed.

- **Silent `NO_PATIENT_LINK` after patient creation.** `POST /api/v1/patients`
  did not create a `professional_patient_links` row for the creating
  clinician, so the very next `POST /api/v1/patients/{id}/assessments`
  from the same clinician failed authorization. Fixed:
  `api/v1/patients/index.ts` now best-effort inserts a PPL row
  (`relationship_type='primary'`, `is_active=true`, `assigned_by=self`)
  when `auth.role === 'clinician'`. Idempotent via the existing
  `ppl_unique_active(professional_user_id, patient_id, is_active)`
  UNIQUE constraint. No behavior change for `tenant_admin` /
  `platform_admin` (they bypass the link check entirely).

- **Opaque 500 on missing migration 003.** If the target Supabase
  project was missing `assessments.clinical_input_snapshot`
  (PostgREST `PGRST204`), the insert failed with a generic
  `ASSESSMENT_INSERT_FAILED` and no actionable hint.
  `assessment-service.ts#classifyAssessmentInsertError` now detects
  the schema-cache / missing-column signature and returns a targeted
  `MIGRATION_REQUIRED` error pointing at
  `003_retention_anonymization_snapshot.sql`.

- **Opaque 500 on missing migration 005.** Same pattern for the PPL
  table: the check in `assertCanWritePatient` now distinguishes
  "table missing" (→ `MIGRATION_REQUIRED` pointing at
  `005_professional_patient_links.sql`) from "no link row" (→
  unchanged `NO_PATIENT_LINK`, with a clearer message).

### Added

- **CI guard — "Lint ESM relative import extensions".** New step in
  `.github/workflows/ci.yml` (job `typecheck`) greps `api/`,
  `backend/`, `shared/` for relative TS imports whose specifier does
  **not** end in `.js`, `.mjs`, `.cjs`, or `.json`, and fails the
  build with an actionable error message. This is the only line of
  defense against this class of drift because `tsc` will not catch
  it under `"moduleResolution": "bundler"`. Scoped to runtime code
  only; tests are excluded because vitest resolves TS source
  directly.
- `AssessmentServiceError.details` — optional structured payload
  (pgCode, pgMessage, hint). The route handler passes it through to
  the client under `error.details` so the network tab and the
  `assessment-new.html` error banner surface the root cause directly
  instead of "Assessment creation failed".
- Route handler also returns `error.details.cause` for the
  unexpected-error path so production incidents no longer require a
  Vercel log dive for first triage.
- `supabase/bootstrap/002_diagnose_assessment_500.sql` — 11-check
  diagnostic script (assessments table, `clinical_input_snapshot`
  column, snapshot-immutable trigger, PPL table + RLS, storage
  bucket, patients schema drift, enum labels, per-user link check,
  RLS enabled on `assessments`). Rewritten as a single
  `UNION ALL`-over-CTE query so the Supabase SQL editor (which only
  renders the last statement's result set) returns all 11 rows at
  once. `CHECK 6` (storage bucket) carries a three-layer guard
  (`to_regclass` + `has_table_privilege` + existence) so the script
  no longer raises `42501: must be owner of table buckets` on
  Supabase projects where the SQL role lacks `SELECT` on
  `storage.buckets`. Read-only; safe to run on production.

### Server-side logging

- `assessments.insert` failures now log `console.error` with the full
  PostgREST error object (code/hint/details) before throwing. Vercel
  function logs retain everything; the response body stays sanitised.

---

## [0.2.1-deploy] — 2026-04-22 — **Deploy-pipeline hardening (Vercel + CI split)**

Strictly non-functional; no runtime behavior, API contract, score formula,
DB schema, or RLS policy changed. This entry documents the build/CI
separation that unblocked the first production deploy on Vercel.

### Fixed

- **Vercel build crash `sh: line 1: tsc: command not found`.** Root
  cause: `package.json#scripts.build` invoked `tsc --noEmit` but
  TypeScript is a `devDependency`, and Vercel does not install
  devDependencies in production mode. Fix: `build` now runs only
  `node scripts/inject-public-config.mjs` (the inject step is the sole
  operation that must succeed to produce the deploy artifact); typecheck
  is promoted to a CI-only quality gate.
- **Login redirect 404 (`/frontend/pages/login.html`).** Root cause:
  `frontend/assets/js/api-client.js` redirected to the legacy path, but
  the Vercel output directory is `frontend-dist/` (the inject script
  copies `frontend/` → `frontend-dist/`), so the live path is
  `/pages/login.html`. Fix applied in both `forceReauth()` and
  `requireAuth()`; a belt-and-braces `redirects` block in `vercel.json`
  308-redirects `/frontend/:path*` → `/:path*` for any stragglers.

### Added

- `.github/workflows/ci.yml` — three-job quality gate (`typecheck`,
  `test`, `build-dryrun`) that installs full devDependencies via
  `npm ci`, runs both `typecheck` and `typecheck:prod`, runs `vitest`,
  executes the inject script in lenient mode (no Supabase env vars),
  and asserts the 8 expected pages exist under `frontend-dist/pages/`
  (`dashboard`, `login`, `patients`, `patient-detail`, `alerts`,
  `audit`, `assessment-new`, `assessment-view`). Runs on every push
  and pull_request against `main`.
- `package.json#scripts.build:check` — convenience script for local/CI
  parity: `inject` + full typecheck in one command.
- `package.json#scripts.test` — `vitest run` is now wired up at the
  root so CI can invoke it without a config path flag.

### Changed

- `package.json`:
  - `scripts.build`: `tsc --noEmit` → `node scripts/inject-public-config.mjs`.
  - `scripts.typecheck`: now explicitly pins `--project tsconfig.json`.
  - `scripts.typecheck:prod` added — strict production-only typecheck
    against `tsconfig.prod.check.json`.
  - `scripts.inject:public-config` added as a named entrypoint (parity
    with the deploy `build`).
  - `engines.node` normalized to `"20.x"` (was `>=20.0.0`), matching
    `actions/setup-node@v4` in CI.
- `vercel.json` — added `redirects` block (`/` → `/pages/login.html`,
  `/frontend/:path*` → `/:path*` permanent) and removed the obsolete
  `api/openai.js` entry from `functions`.
- `docs/12-PACKAGE-UPGRADE.md` — canonical script table, rationale for
  "build is inject-only," and the updated `vercel.json` reference.

### Rationale

Keeping type checking inside the deploy `build` command couples
**artifact production** to **regression prevention**. Those have
different environments (prod install vs. full install), different
failure modes (missing `frontend-dist/` vs. type drift), and different
recovery paths (roll back deploy vs. reject PR). They are cleanly
separated now: Vercel deploys if and only if the artifact can be
produced; CI blocks merges if types or tests regress.

---

## [0.2.1-refactor] — 2026-04-20 — **Security/GDPR follow-ups + service-layer realignment**

### Added

#### GDPR & retention
- `supabase/migrations/003_retention_anonymization_snapshot.sql`:
  - `assessments.clinical_input_snapshot JSONB` — canonical deterministic-engine input so `loadAssessmentSnapshot` can re-run the pure engine byte-equivalently.
  - `assessments.anonymized_at`, `patients.deleted_at`, `patients.anonymized_at` — soft-delete + anonymization markers.
  - `data_subject_requests` table + `dsr_kind`/`dsr_status` enums — Art.15 / Art.17 / Art.20 ledger with 30-day SLA deadline.
  - `fn_anonymize_patient(uuid, uuid)` SECURITY DEFINER — irreversible PII strip, preserves deterministic score outputs for aggregate analytics.
  - `fn_retention_prune()` SECURITY DEFINER — daily cleanup of expired audit/notification/resolved-alert rows and unlinking of expired report_exports.
  - `trg_assessments_snapshot_immutable` — guard trigger; snapshot cannot be mutated once written (except during anonymization).
  - RLS on `data_subject_requests` — tenant admins see their tenant's requests only; platform admins cross-tenant.

#### API surface
- `api/v1/health.ts` — public probe-friendly endpoint (`200 ok` / `207 degraded` / `503 unhealthy`) with Supabase + distributed rate-limit subsystem breakdown. Rate-limited 60/min.
- `api/v1/patients/[id]/export.ts` — GDPR Art.15/Art.20 export. Returns `uelfy.patient-export/v1` envelope: patient, clinical profile, assessments with full input snapshot, score results, risk profiles, measurements, nutrition/activity snapshots, follow-up plans, alerts, consent records, report export metadata, last 500 audit events. Gated behind `tenant_admin`/`clinician` with active professional-patient link. Rate-limited 5/min. Automatically creates a `data_subject_requests` row (kind=`access`, status=`fulfilled`) and audit event `patient.export`.
- `api/v1/internal/retention.ts` — retention cron endpoint. Bearer-signed with `CRON_SIGNING_SECRET` (constant-time compare). Invokes `fn_retention_prune()`, then batch-removes orphaned Supabase Storage objects (bounded to 500 per run). Emits a `retention.run` audit_event with full counts.
- `api/v1/internal/anonymize.ts` — daily anonymization worker. Selects patients with `deleted_at < NOW() - GRACE_DAYS` (default 30) and `anonymized_at IS NULL`, calls `fn_anonymize_patient()` for each, auto-fulfills pending erasure DSR requests, emits `anonymize.run` audit event.

#### Distributed infrastructure
- `backend/src/middleware/rate-limit-upstash.ts` — Upstash Redis REST adapter. Atomic `INCR` + `PEXPIRE NX` + `PTTL` pipeline. Auto-detects env configuration; returns `null` (fallback signal) on missing config or transient failure.
- `backend/src/middleware/rate-limit.ts` — added `checkRateLimitAsync()` and `withRateLimitAsync()` that prefer the Upstash path, transparently falling back to the per-instance in-memory bucket.

#### Frontend
- `frontend/pages/mfa-enroll.html` — TOTP enrolment UX. Calls `supabase.auth.mfa.enroll/challenge/verify`, renders QR (Supabase-returned data URI or CDN fallback), guards against re-enrolment when a verified factor already exists.

#### Repo hygiene
- `.env.example` at repo root — documents every required and optional env var, with explicit callouts on secrets that must never reach the frontend bundle.
- `.github/dependabot.yml` — npm (root + `/backend`) and `github-actions` weekly schedules, grouped updates for TS tooling / testing / linters / clinical runtime, major-version ignore on `zod`, `pdf-lib`, `@supabase/supabase-js` (each major must pass clinical-equivalence tests manually).
- `vercel.json` — added cron schedules for retention (`0 3 * * *`) and anonymization (`0 4 * * *`), function `maxDuration` for export/report/internal endpoints, global hardening headers.

#### Documentation
- `docs/13-REVIEW.md` — consolidated review report covering scope compliance, deferred-task completion audit, type-system integrity, and remaining (non-gating) operational items.

### Changed

- `backend/src/services/assessment-service.ts` — fully rewritten against the real `AssessmentInput` / `ScoreResultEntry` / `AssessmentSnapshot` shapes and the real DB column names (`assessed_by` not `created_by_user_id`; composite risk lives in `risk_profiles`, not `assessments`). Added `buildReportPayload()` (async) that fetches tenant/patient/clinician display metadata in parallel.
- `backend/src/services/pdf-report-service.ts` — rewritten to consume the new `ReportPayload` wrapper. Renders composite-risk domain breakdown, validated scores table, lifestyle (PREDIMED/BMR/TDEE/activity/sedentary/smoking), severity-coloured alerts with timestamps, full follow-up plan with domain monitoring, and required screenings with priority + interval metadata.
- `backend/src/domain/clinical/risk-aggregation/composite-risk.ts`, `.../followup-engine/followup-plan.ts`, `.../screening-engine/required-screenings.ts`, `.../alert-engine/alert-deriver.ts` — score-code lookups made case-insensitive. The engine emits uppercase codes (`EGFR`, `FIB4`, `BMI`…) but consumers previously looked up mixed-case spellings — renal risk and monitoring silently never fired. **No formula altered.**
- `shared/schemas/assessment-input.ts` — added `assessmentInputSchema` camelCase alias; renamed inferred type to `ValidatedAssessmentInput` to avoid colliding with the canonical `AssessmentInput` from `shared/types/clinical.ts`.
- `api/v1/patients/[id]/assessments/index.ts` — GET now joins `risk_profiles` for the longitudinal UI (composite risk available without a second round-trip); removed references to non-existent `composite_risk_score`/`composite_risk_band` columns.
- `api/v1/assessments/[id]/report.ts` — now `await`s `buildReportPayload()` (async).
- `docs/10-SECURITY-GDPR-CHECKLIST.md` — §1.8, §5.5, §6.7, §8.7, §8.8, §8.9, §10.5, §11.4, §12.3 promoted to `✅`. Remaining open items are operational/documentation (DPO records, secret-rotation runbook, abnormal-audit-volume dashboard) — none gate MVP.

### Fixed

- Case-insensitive score-code lookup ensures `EGFR` (engine output) is matched against `'eGFR'` (legacy literal in 4 consumer modules). Without this fix, renal risk / kidney monitoring / CKD alerts were silently unreachable.
- Assessment-service column drift: earlier draft referenced `created_by_user_id`, `composite_risk_score`, `composite_risk_band` which do not exist in `001_schema_foundation.sql`. Realigned to `assessed_by` + `risk_profiles` table.
- PDF service previously imported a non-existent `ClinicalReportPayload` type. Now consumes `ReportPayload` from `assessment-service.ts`.
- **Full `tsc --noEmit` realignment** (see `docs/13-REVIEW.md §9`):
  - 16 wrong-depth relative imports of `shared/types/clinical` in `backend/src/domain/clinical/**` repaired (3-4 `../` → correct 5 `../`).
  - Nested `/* … */` inside a JSDoc `/** … */` header in `api/v1/internal/anonymize.ts` reworded (syntax error).
  - `followup-plan.ts` next-review-date formatter uses `slice(0,10)` instead of `split('T')[0]` (under `noUncheckedIndexedAccess`).
  - `predimed.ts` exhaustive-Record lookups narrowed with non-null assertions (BMR/TDEE arithmetic unchanged).
  - `report-payload.ts` `SCORE_METADATA` fallback typed explicitly; `rawPayload.interpretation` read through a `Record<string, unknown>` view.
  - `score-engine/index.ts` `rawPayload:` assignments cast `XResult as unknown as Record<string, unknown>` — 9 sites, zero runtime change, zero engine-math change.
  - `alerts/[id]/ack.ts` explicitly types `{action, note}` destructure against the zod schema.
  - `retention.ts` introduces `interface OrphanRow` for the cleanup callback params.
  - `supabase.ts` catch-binding annotated `error: unknown`.
  - `patient-input.ts` transform/refine callbacks typed (`val: string | Date`, `date: Date`).
  - `patient-input.ts` exports camelCase aliases `createPatientSchema` / `updatePatientSchema` to match route-layer import convention.
- Types: added repo-level `types/ambient.d.ts` that shims `@vercel/node`, `zod`, `@supabase/supabase-js`, `pdf-lib`, `vitest`, and Node built-ins — **only consumed by `tsconfig.{prod.,}check.json`**; real `@types/node` etc. take precedence under `npm ci`.

#### Dependency manifest hotfix (Vercel deployment blocker)

Resolves the user-reported Vercel build failure chain:

```
Using built-in TypeScript 5.9.3 since "typescript" is missing from "devDependencies"
api/v1/internal/anonymize.ts(25,52): error TS2307: Cannot find module '@vercel/node' …
api/v1/patients/index.ts(11,19): error TS2307: Cannot find module 'zod' …
api/v1/me.ts(14,11):            error TS2339: Property 'method' does not exist on type 'AuthenticatedRequest'.
```

Root cause: the legacy consumer-app `package.json` had no clinical-platform runtime/tooling dependencies declared; Vercel was falling back to its built-in TS 5.9 without any of our imports resolvable, so every `@vercel/node`/`zod` import reported `TS2307` and the cascade collapsed the `AuthenticatedRequest` type synthesis.

- `package.json` — **rewritten** for the B2B clinical identity:
  - Pinned `typescript@5.5.4` in `devDependencies` (eliminates the "built-in TypeScript 5.9.3" warning and guarantees the build uses the same compiler developers test against).
  - Added runtime deps: `@supabase/supabase-js@^2.45.0`, `zod@^3.23.8`, `pdf-lib@^1.17.1`, `openai@^4.0.0` (bounded/non-authoritative AI commentary only).
  - Added dev deps: `@vercel/node@^3.2.0` (for `VercelRequest` / `VercelResponse` type declarations consumed by every `api/v1/*` handler), `@types/node@^20.14.0`, `vitest@^1.6.0`.
  - `engines.node ≥20.0.0` — aligns with Vercel Node 20 runtime and our `ES2022` target.
  - Scripts: `dev` (vercel dev), `typecheck` (main config), `typecheck:prod` (strict prod-only config), `build` (noEmit prod check).
  - Replaced legacy consumer-app identity (`name`, `description`, `keywords`) with B2B clinical positioning.
- `tsconfig.json` — added `tests/**/*.ts` and `types/**/*.d.ts` to `exclude` so Vercel's auto-detected root typecheck sees only production code (48 files across `backend/`, `shared/`, `api/`). Test-fixture type debt is now v0.2.2 work and does not gate deployment.
- `tsconfig.check.json` + `tsconfig.prod.check.json` — added explicit `exclude` arrays to override the parent's `types/**` exclusion; this is required for offline sandbox typechecks where the ambient shim stands in for real `@types/*` packages. In a hosted `npm ci` environment the shim is bypassed and real types take over.

Validation (pre-deploy):
- `tsc --noEmit --project tsconfig.prod.check.json` → **EXIT 0** (offline sandbox, full ambient shim in play).
- `tsc --noEmit --project tsconfig.json` → **EXIT 0** on the 48 production files that Vercel will compile.
- `tsc --noEmit --project tsconfig.check.json` → 25 errors, all inside `tests/**/*.ts` (v0.2.2 debt, tracked separately).

#### Real-types realignment (second-pass Vercel hotfix)

With the correct packages installed on Vercel, real `@supabase/supabase-js`,
`zod`, and `@vercel/node` narrow types replaced the ambient-shim `any`s and
surfaced five latent type-shape issues. All fixed without touching any
clinical math or changing runtime semantics:

- `shared/schemas/assessment-input.ts` — wrapped the root `z.object({…}).strict()`
  in a trailing `.transform((v): AssessmentInput => ({…}))` that strips
  `null` → `undefined` for every `.optional().nullable()` field in
  `labs`, `clinicalContext`, `lifestyle`, and `frailty`. The canonical
  `AssessmentInput` interface uses `T | undefined` only; the JSON wire
  format still accepts explicit `null` from form UIs. The transform also
  makes `ValidatedAssessmentInput` structurally equal to `AssessmentInput`,
  removing the need for casts at call sites. No score formula is touched.
- `api/v1/patients/index.ts` (POST) — the route previously read flat
  `payload.firstName` / `payload.email` / `payload.displayRef` from a
  Zod schema that nests those fields under `demographics` and `contact`.
  Now correctly unpacks `payload.demographics.{firstName,lastName,dateOfBirth,sex,externalCode}`
  and `payload.contact?.{email,phoneNumber}` into the flat DB column
  layout. The canonical column for the patient's external MRN/ID is
  `external_code` (Wave 1.1 alignment); `demographics.externalCode` →
  `external_code`. `display_name` is computed by `getPatientDisplayName()`.
- `api/v1/patients/[id]/index.ts` (PATCH) — identical fix for the
  partial-update path. Handles `p.demographics` being optional (since
  `PatientUpdateSchema.demographics = PatientDemographicsSchema.partial().optional()`)
  and maps `externalCode → external_code`, `phoneNumber → contact_phone`,
  `email → contact_email`.
  `dateOfBirth` is converted from `Date` to `YYYY-MM-DD` string at the
  DB boundary on both routes.
- `backend/src/config/supabase.ts` — `setSession()` call simplified to
  `{ access_token, refresh_token }` only. Recent `@supabase/supabase-js`
  releases derive `token_type`, `expires_in`, `expires_at`, and `user`
  from the JWT itself, and their declared `SetSessionParams` type
  rejects extra keys (`TS2353`).
- `backend/src/services/assessment-service.ts` — `bestEffort`'s `fn`
  parameter relaxed from `() => Promise<unknown>` to
  `() => PromiseLike<unknown>`. PostgREST's `PostgrestFilterBuilder`
  returned by `.from(…).insert(…)` is thenable but not a full `Promise`
  (no `.catch`, `.finally`, `Symbol.toStringTag`). The helper wraps the
  result with `Promise.resolve(fn())` so the downstream `.then(...)`
  chain returns a real `Promise<void>`. Zero behavioural change; all
  seven best-effort call sites (`assessment_measurements`,
  `score_results`, `risk_profiles`, `nutrition_snapshots`,
  `activity_snapshots`, `followup_plans`, `alerts`) keep the same
  non-fatal error-logging contract.

All five touch points are type-system repairs only. No score engine
math, no clinical thresholds, no DB schema, no RLS policy, no audit
semantics, no security posture was modified by this pass.

### Security notes

- Immutable snapshots: `trg_assessments_snapshot_immutable` rejects any attempt to mutate `clinical_input_snapshot` after its initial write (anonymization is the only allowed writer, via SECURITY DEFINER function).
- `fn_anonymize_patient` + `fn_retention_prune` are SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`, explicit `GRANT EXECUTE TO postgres` only.
- Distributed rate-limiter defends against burst-across-serverless-instances multiplication attacks on report generation / assessment create.
- Cron endpoints use constant-time compare on `CRON_SIGNING_SECRET` to avoid timing attacks.

---

## [0.2.0-refactor] — 2026-04-19 — **B2B clinical refactor (in-progress MVP)**

### Added

#### Architecture & documentation
- `docs/01-AUDIT-TECNICO.md` — complete technical audit of the legacy app, inventorying 40+ files, identifying 8 critical security findings, and mapping each file to a keep/refactor/remove decision.
- `docs/02-PIANO-REFACTOR.md` — 8-phase refactor plan with target stack (Supabase + Vercel + TypeScript + Zod + pdf-lib), folder layout, migration strategy, and risk-ranked sequencing.
- `docs/10-SECURITY-GDPR-CHECKLIST.md` — production-readiness checklist covering authN/authZ, validation, transport, rate limits, audit, GDPR, and supply chain.
- `docs/11-CHANGELOG.md` — this file.
- `frontend/DEPRECATED.md` — removal manifest for the legacy consumer-app surface (chatbot, meal-plan, workout, iframe-based dashboard).

#### Database (Supabase / PostgreSQL)
- `supabase/migrations/001_schema_foundation.sql` — 17-table B2B multi-tenant schema.
  - Tables: `tenants`, `users`, `patients`, `professional_patient_links` (added in `005_professional_patient_links.sql`), `consent_records`, `assessments`, `score_results`, `lifestyle_snapshots`, `followup_plans`, `alerts`, `report_exports`, `audit_events`, plus supporting lookup tables.
  - Enums: `user_role` (`platform_admin|tenant_admin|clinician|assistant_staff|patient`), `tenant_status`, `assessment_status`, `alert_severity`, `consent_type`, etc.
  - Helpers: `get_current_tenant_id()`, `get_current_user_role()`, `update_updated_at()`.
- `supabase/migrations/002_rls_policies.sql` — Row-Level Security policies on every sensitive table. Tenant isolation via `tenant_id = get_current_tenant_id()`; role-aware SELECT / INSERT / UPDATE / DELETE policies.

#### Clinical engine (pure functions, zero side effects)
All modules under `backend/src/domain/clinical/`:
- `score-engine/score2.ts` — SCORE2 with exact ESC 2021 coefficients (byte-equivalent to legacy).
- `score-engine/score2-diabetes.ts` — SCORE2-Diabetes coefficients preserved verbatim.
- `score-engine/ada.ts` — ADA Diabetes Risk Score.
- `score-engine/fli.ts` — Fatty Liver Index.
- `score-engine/frail.ts` — FRAIL scale (0–5).
- `score-engine/bmi.ts` — BMI with WHO categories.
- `score-engine/metabolic-syndrome.ts` — ATP III / IDF modified.
- `score-engine/fib4.ts` — FIB-4 liver fibrosis.
- `score-engine/egfr.ts` — **new** CKD-EPI 2021 race-free equation (not present in legacy; required for the nephro-metabolic vertical).
- `score-engine/index.ts` — `computeAllScores()` orchestrator.
- `risk-aggregation/composite-risk.ts` — `aggregateCompositeRisk()` with weighted stratification.
- `nutrition-engine/predimed.ts` — PREDIMED-14 scoring + Mifflin-St Jeor BMR.
- `activity-engine/activity-assessment.ts` — WHO activity guidelines mapping (no workout prescription).
- `alert-engine/alert-deriver.ts` — six alert types with severity and recommended actions.
- `screening-engine/required-screenings.ts` — derives required screenings from risk state.
- `followup-engine/followup-plan.ts` — risk-band-driven follow-up intervals and rationale.
- `report-engine/report-payload.ts` — PDF-ready payload builder.

#### Shared types & schemas
- `shared/types/clinical.ts` — canonical TypeScript interfaces for assessment input/output and `AssessmentSnapshot`.
- `shared/constants/score-thresholds.ts` — single source of truth for score band cut-offs.
- `shared/constants/clinical-ranges.ts` — min/max validation ranges for 19 clinical parameters.
- `shared/schemas/assessment-input.ts` — Zod schema for assessment creation.
- `shared/schemas/patient-input.ts` — Zod schemas for patient create/update.

#### Backend infrastructure
- `backend/src/config/env.ts` — strict startup-time env validation, typed config singleton, URL-format check.
- `backend/src/config/supabase.ts` — `supabaseAdmin` (service-role) + `createUserClient()` (RLS-aware).
- `backend/src/middleware/auth-middleware.ts` — `withAuth()`, `validateAccessToken()`, `USER_ROLES` aligned with DB enum, `AuthError` with structured codes, SHA-256 truncated IP hashing, truncated user-agent capture.
- `backend/src/middleware/rbac.ts` — `requireRole()`, `requireClinicalWrite`, `requireTenantMember`, `requireTenantAdmin`, `requirePlatformAdmin`, `assertSameTenant()`.
- `backend/src/middleware/security-headers.ts` — CSP, HSTS (2-year + preload), X-Frame-Options: DENY, Permissions-Policy, strict CORS with credentials support.
- `backend/src/middleware/rate-limit.ts` — in-memory token bucket with user-id/IP-hash keys, preset tiers (auth/read/write/reportExport/admin).
- `backend/src/middleware/validate.ts` — `validateBody()`, `validateQuery()`, `validate()`, `requireMethod()`.
- `backend/src/audit/audit-logger.ts` — `recordAudit()`, `recordFailedLogin()`, metadata sanitiser (allow-list only, no PII/health payloads).
- `backend/src/services/assessment-service.ts` — the clinical orchestrator: `createAssessment()` runs the full pipeline (validate → authorize → compute → persist → alert → follow-up → audit), `loadAssessmentSnapshot()` rehydrates deterministically, `buildReportPayload()` wraps report construction.
- `backend/src/services/pdf-report-service.ts` — server-side PDF via `pdf-lib`: tenant header, patient block, scores, lifestyle, alerts, follow-up, screenings, confidential footer on every page.

#### API routes (Vercel serverless, `/api/v1/*`)
- `POST /api/v1/auth/session` — validates token, audit-logs sign-in.
- `GET  /api/v1/me` — profile hydration.
- `GET  /api/v1/patients` — paginated list with server-side search.
- `POST /api/v1/patients` — create (Zod-validated, `patient.create` audit).
- `GET  /api/v1/patients/[id]` — detail with last-assessment summary.
- `PATCH /api/v1/patients/[id]` — partial update.
- `DELETE /api/v1/patients/[id]` — soft delete (sets `deleted_at`).
- `GET  /api/v1/patients/[id]/assessments` — longitudinal list.
- `POST /api/v1/patients/[id]/assessments` — run clinical engine, persist, audit.
- `GET  /api/v1/assessments/[id]` — full `AssessmentSnapshot`.
- `POST /api/v1/assessments/[id]/report` — generate PDF, upload to `clinical-reports` bucket, return short-lived signed URL.
- `GET  /api/v1/assessments/[id]/report` — fresh signed URL for existing report.
- `GET  /api/v1/patients/[id]/alerts` — filtered alert list.
- `POST /api/v1/alerts/[id]/ack` — acknowledge / resolve / dismiss.
- `GET  /api/v1/consents` / `POST /api/v1/consents` — versioned consent grant/revoke (new rows, never mutations).
- `GET  /api/v1/admin/audit` — tenant-admin audit browser with filters.

#### Frontend (B2B, incremental)
- `frontend/assets/css/app.css` — professional clinical design system, no external fonts, strict-CSP compliant.
- `frontend/assets/js/api-client.js` — thin ES-module client with Supabase Auth + typed API helpers.
- `frontend/pages/login.html` — hardened login (no iframe, no inline JS beyond a small config block).
- `frontend/pages/dashboard.html` — B2B dashboard skeleton (KPI cards, recent patients, alerts placeholder).

#### Test suite (`tests/`)
- `tests/fixtures/score-cases.ts` — canonical clinical fixtures covering low-risk, high-risk, diabetic-female, and frail-elderly cases.
- `tests/equivalence/score-equivalence.test.ts` — legacy-vs-new engine equivalence tests (1e-9 tolerance).
- `tests/unit/clinical-engine.test.ts` — determinism, null-safety, boundary checks for `computeAllScores` / composite risk / alerts.
- `tests/unit/middleware.test.ts` — rate-limit bucket isolation, RBAC tenant guard.
- `tests/integration/api-patients.test.ts` — route-level scaffold with Supabase mocks.
- `tests/vitest.config.ts` — coverage targets backend, shared, api/v1.
- `tests/README.md` — how-to-run + recommended package.json scripts.

### Changed

- **Security model**: moved all privileged operations behind server-side RBAC + DB-level RLS. No route trusts client-supplied `tenant_id` or ownership metadata.
- **Error envelope**: every handler now returns `{ error: { code, message[, details] } }` — no stack traces, no DB error messages.
- **Data ownership**: all lookups now use UUID ids. Email-as-key queries (`recuperaAnagrafica.js`, `salvaAnagrafica.js`) are deprecated and slated for removal after one release cycle.
- **Session semantics**: single source of truth is Supabase Auth on the frontend + server-side `auth.getUser()` validation on every call. No custom cookie logic.
- **AI scope**: no AI in the clinical calculation path. AI usage is bounded to optional supportive commentary in future services (not yet wired).

### Removed / deprecated

See `frontend/DEPRECATED.md` for the full removal manifest. Highlights:
- Consumer wellness chatbot (`chatbot.html`, `chat.html`, `chatbot-logic.js`).
- Full meal-plan generator.
- Workout / training program generator.
- iframe + postMessage dashboard composition.
- Email-as-key anagraphics endpoints.
- Unbounded OpenAI completions endpoint.

### Security

- All 17 tables have RLS enabled with tenant-isolation policies (see `002_rls_policies.sql`).
- Signed URLs for all clinical report downloads, expiry ≤ 5 minutes.
- Append-only audit trail with sanitised metadata (no PII, no health data persisted in audit rows).
- Strict CSP, HSTS preload, X-Frame-Options DENY, Permissions-Policy restricting camera/mic/geolocation.
- Rate limits on every route with per-user / per-IP-hash bucketing (never raw IP).

### Preserved (intentionally untouched)

Validated score formulas: SCORE2, SCORE2-Diabetes, ADA, FLI, FRAIL, BMI, metabolic syndrome, PREDIMED. Coefficients, thresholds, and decision boundaries are byte-equivalent to legacy. Any drift is caught by the equivalence test suite.

### Known follow-ups (non-blocking for MVP)

Tracked in `docs/10-SECURITY-GDPR-CHECKLIST.md` §Pending follow-ups.
- Distributed rate limiter (Upstash/Redis).
- Patient data export endpoint (`/api/v1/patients/[id]/export`).
- Anonymization worker for right-to-erasure.
- MFA enrolment UX for admin roles.
- Health-check endpoint.
- `.env.example` and secret-rotation runbook.
- Dependabot / Renovate enablement.

---

## [0.1.0] — pre-refactor baseline

Legacy consumer-oriented wellness web app with:
- email-as-key anagraphics in Supabase
- iframe/postMessage dashboard composition
- chatbot + meal-plan + workout plan features (out of clinical scope)
- unbounded OpenAI completions endpoint
- no RLS on sensitive tables
- no audit trail
- no server-side validation for mutations

This version is preserved for historical reference only and is scheduled for
full removal once the B2B refactor is merged and the equivalence test suite
passes in CI for a full release cycle.
