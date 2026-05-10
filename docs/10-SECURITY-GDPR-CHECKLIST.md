# Security & GDPR Checklist — Uelfy Clinical (B2B refactor)

This is the production-readiness checklist that MUST be green before any tenant
onboarding or clinical go-live. Each item maps to at least one implementation
artefact introduced by the refactor.

Status legend:  `✅ done` · `🟡 partial / follow-up` · `⬜ open`

---

## 1. Authentication & session

| # | Control | Status | Evidence |
|---|---|---|---|
| 1.1 | All privileged endpoints require a validated Supabase JWT | ✅ | `backend/src/middleware/auth-middleware.ts` (`withAuth`, `validateAccessToken`) |
| 1.2 | JWT validated server-side on every call, not merely decoded | ✅ | `supabaseAdmin.auth.getUser(token)` is invoked per request |
| 1.3 | User row loaded from `public.users` on every call (role/suspension checked) | ✅ | Same middleware; respects `is_suspended` |
| 1.4 | Service-role key is never exposed to the browser | ✅ | Only used in `backend/src/config/supabase.ts`; frontend uses the anon key |
| 1.5 | Session refresh handled by Supabase client on the frontend | ✅ | `autoRefreshToken: true` in `frontend/assets/js/api-client.js` |
| 1.6 | Failed login attempts are audit-logged | ✅ | `recordFailedLogin` in `backend/src/audit/audit-logger.ts` |
| 1.7 | No passwords pass through custom server code | ✅ | `api/v1/auth/session.ts` accepts a Bearer token only |
| 1.8 | MFA available for `tenant_admin` / `platform_admin` roles | ✅ | `frontend/pages/mfa-enroll.html` — TOTP enrolment + verify UX via Supabase MFA API |

## 2. Authorization (RBAC + RLS)

| # | Control | Status | Evidence |
|---|---|---|---|
| 2.1 | Row-Level Security ENABLED on every sensitive table | ✅ | `supabase/migrations/002_rls_policies.sql` (17 tables) + `003`/`005`/`007` (3 added later) — total 20/20 PHI tables |
| 2.1b | FORCE ROW LEVEL SECURITY on every PHI table (defence-in-depth: applies even to table owner) | ✅ | `supabase/migrations/012_force_row_level_security.sql` — covers all 20 PHI tables |
| 2.1c | Anti-recidiva CI gate verifying RLS + FORCE state stays correct | ✅ | `scripts/check-rls-coverage.mjs` (in `npm run build:check`); fails if a future migration disables RLS or skips FORCE on any PHI table |
| 2.2 | Tenant isolation enforced at the database layer | ✅ | RLS policies key off `get_current_tenant_id()` |
| 2.3 | Role enum aligned between app code and DB | ✅ | `USER_ROLES` mirrors `public.user_role` enum |
| 2.4 | Defence-in-depth RBAC in code on top of RLS | ✅ | `backend/src/middleware/rbac.ts` (`requireRole`, `requireClinicalWrite`, etc.) |
| 2.5 | Assistant staff cannot create clinical assessments | ✅ | `assertCanWritePatient` in `assessment-service.ts` |
| 2.6 | Professional-to-patient linkage enforced for clinicians | ✅ | `professional_patient_links` lookup in `assessment-service.ts` |
| 2.7 | Cross-tenant reads blocked at the service boundary | ✅ | `assertSameTenant` + `CROSS_TENANT_FORBIDDEN` response |
| 2.8 | No email-as-key queries anywhere in new code | ✅ | All lookups use UUID ids; `recuperaAnagrafica.js` legacy path is deprecated |
| 2.9 | API endpoints all gated by auth (no anonymous PHI access path) | ✅ | Sprint 2 task 2.1 audit: 22/22 endpoints have appropriate auth — 18 with standard middleware (`requireAuth`/`assertSameTenant`/`requireRole`), 1 in-handler (`auth/session.ts` validates JWT), 2 cron-auth (`internal/*` via `CRON_SIGNING_SECRET`), 1 public-by-design (`health.ts`) |

## 3. Input validation & output handling

| # | Control | Status | Evidence |
|---|---|---|---|
| 3.1 | Every mutation endpoint validates body via Zod | ✅ | `shared/schemas/*.ts` + `validate.ts` middleware |
| 3.2 | Query parameters validated and coerced | ✅ | `validateQuery`, per-route `listQuerySchema` |
| 3.3 | UUID path parameters regex-validated before DB calls | ✅ | `getPatientId`, `getId` helpers |
| 3.4 | Clinical inputs bounded by `clinical-ranges.ts` | ✅ | `shared/constants/clinical-ranges.ts` |
| 3.5 | HTTP method allow-list with 405 handling | ✅ | `requireMethod` helper + per-route guards |
| 3.6 | Error envelopes never leak stack traces or DB details | ✅ | Handlers return `{ error: { code, message } }` only |

## 4. Transport & browser hardening

| # | Control | Status | Evidence |
|---|---|---|---|
| 4.1 | HSTS (two-year, includeSubDomains, preload) | ✅ | `security-headers.ts` |
| 4.2 | X-Frame-Options: DENY (no iframe embedding) | ✅ | Same |
| 4.3 | Content-Security-Policy restrictive by default | ✅ | `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` |
| 4.4 | Referrer-Policy strict-origin-when-cross-origin | ✅ | Same |
| 4.5 | Permissions-Policy disables camera/mic/geolocation | ✅ | Same |
| 4.6 | CORS strict allow-list, credentials-aware | ✅ | `applyStrictCors` — only configured origins |
| 4.7 | No inline `<script>` dependencies in new frontend pages | ✅ | Module scripts + external files only (small config block excepted) |
| 4.8 | `iframe` + `postMessage` architecture removed | ✅ | New frontend uses a single app shell (see `frontend/DEPRECATED.md`) |
| 4.9 | CSP enforce — no `'unsafe-inline'` on style-src | ✅ | Sprint 5 task 5.1: 117 inline `style="…"` attributes refactored to CSS classes; `vercel.json` CSP for `/pages/*` and `/components/*` now serves `style-src 'self'; style-src-attr 'none'; script-src-attr 'none'` (also removes inline event handlers). Anti-recidiva gate `scripts/check-no-inline-styles.mjs` wired into `build:check`. |
| 4.10 | Frontend bundle-size budget enforcement | ✅ | Sprint 5 task 5.4: `scripts/check-bundle-budget.mjs` enforces per-file byte budgets (15 tracked assets, supabase-js ≤250 KB, app.css ≤80 KB, page JS / components 20–50 KB). Wired into `build:check`. |

## 5. Rate limiting & anti-abuse

| # | Control | Status | Evidence |
|---|---|---|---|
| 5.1 | All routes behind in-memory token bucket | ✅ | `rate-limit.ts` |
| 5.2 | Per-user buckets (not per-IP) when authenticated | ✅ | `keyFor()` uses `userId` when present |
| 5.3 | Anonymous buckets keyed on hashed IP, never raw IP | ✅ | SHA-256 truncated |
| 5.4 | Report generation limited to 10/min per user | ✅ | `RATE_LIMITS.reportExport` |
| 5.5 | Distributed limiter upgrade path (Upstash/Redis) | ✅ | `rate-limit-upstash.ts` adapter; `checkRateLimitAsync()` auto-fallback to in-memory when Upstash unconfigured |

## 6. Audit trail & accountability

| # | Control | Status | Evidence |
|---|---|---|---|
| 6.1 | `audit_logs` table with tamper-evident schema | ✅ | Migration 001 |
| 6.2 | Every sensitive CRUD emits an audit event | ✅ | `recordAudit()` in handlers + service layer |
| 6.3 | Metadata sanitiser drops PII/health payloads | ✅ | `sanitizeMetadata()` — allow-list only |
| 6.4 | `ip_hash` stored (never raw IP) | ✅ | Truncated SHA-256 |
| 6.5 | User-agent truncated to 256 chars | ✅ | `getUserAgent()` |
| 6.6 | Audit reads restricted to tenant/platform admins | ✅ | `api/v1/admin/audit.ts` + RBAC |
| 6.7 | Append-only enforcement at DB level | ✅ | Migration 003: `trg_assessments_snapshot_immutable` for clinical snapshots; audit_events RLS remains insert-only per 002 |

## 7. Data at rest & object storage

| # | Control | Status | Evidence |
|---|---|---|---|
| 7.1 | Clinical reports stored in private bucket (`clinical-reports`) | ✅ | `api/v1/assessments/[id]/report.ts` |
| 7.2 | Reports issued only via short-lived signed URLs (≤ 5 min) | ✅ | `SIGNED_URL_EXPIRY_SECONDS = 300` |
| 7.3 | Every signed-URL issuance audit-logged | ✅ | `report.download` + `report.generate` events |
| 7.4 | No base64-encoded health data in any table | ✅ | Audit confirmed — all binaries land in storage, not DB |
| 7.5 | `cacheControl: 'no-store'` on uploads | ✅ | See `upload()` call |
| 7.6 | Supabase at-rest encryption (AES-256) | ✅ | Managed by Supabase |

## 8. GDPR — lawful basis, consent, rights

| # | Control | Status | Evidence |
|---|---|---|---|
| 8.1 | Consent is versioned (immutable row per version) | ✅ | `consent_records` schema + insert-on-change pattern in `api/v1/consents` |
| 8.2 | Revoking creates a new row with `granted=false` | ✅ | Same (boolean `granted` flag, append-only) |
| 8.3 | Lawful basis explicitly stored per consent | ✅ | `legal_basis` enum |
| 8.4 | Consent policy version stored alongside consent | ✅ | `policy_version` column (and optional `policy_url`, `jurisdiction`) |
| 8.5 | Purpose limitation recorded | ✅ | `purpose` column |
| 8.6 | Data minimization — storage only of fields required for scoring | ✅ | Shared types + Zod schemas; no unused payload fields persisted |
| 8.7 | Data retention policy documented per entity | ✅ | `fn_retention_prune()` SQL function + daily `/api/v1/internal/retention` cron (Vercel cron schedule `0 3 * * *`) |
| 8.7b | Per-category retention for `audit_events` (Sprint 3 task 3.3) | ✅ | Migration 018: `auth.*` events 180d (NIS2 + ISO 27001), default 10y (medical-deontological + Art.30). Per-tenant override via LEAST(). Doc 14 §1.1. |
| 8.8 | Data export (portability) endpoint | ✅ | `api/v1/patients/[id]/export.ts` — returns versioned envelope `uelfy.patient-export/v1` by default, FHIR R4 Bundle via `?format=fhir` (Sprint 3 task 3.6); creates `data_subject_requests` row |
| 8.8b | FHIR R4 interoperability for Art.20 portability (Sprint 3 task 3.6) | ✅ | `backend/src/services/fhir-export-service.ts` + 10 unit tests; 5 resource types (Patient, Observation, RiskAssessment, DiagnosticReport, Consent) wrapped in Bundle type=collection with `gdpr-art20-portability` tag |
| 8.9 | Right-to-erasure via soft-delete + anonymization job | ✅ | `patients.deleted_at` + `fn_anonymize_patient()` + daily `/api/v1/internal/anonymize` (grace window 30d, configurable) |
| 8.10 | DPO / joint controller records | 🟡 | DPIA scaffold (Sprint 3 task 3.4) at `docs/39-DPIA-CARDIO.md` with 13 [TO COMPLETE BY DPO/CONTROLLER] placeholders for legal sign-off before first paying customer |
| 8.11 | Granular consent runtime enforcement (Sprint 3 task 3.2) | ✅ | `backend/src/middleware/consent-gate.ts` exports `assertConsentFor` / `hasConsentFor` for the 4 enforceable consent types (`ai_processing`, `notifications`, `data_sharing_clinician`, `marketing`); type-level guard prevents accidental gating of `health_data_processing`. Decision matrix in `docs/41-CONSENT-ENFORCEMENT.md`. Currently inert (no opt-in operation exists yet); first integration Sprint 4. |
| 8.12 | Privacy notice (Art.13/14) updated for Sprint 3 controls (task 3.5) | ✅ | `frontend/pages/legal-privacy.html` v1.1: 13 sections, granular purposes, per-category retention, honest per-Article rights status, EU-only sub-processor list with GitHub disclosure |
| 8.13 | DSR workflow per-Article gap analysis (Sprint 3 task 3.1) | ✅ | `docs/40-DSR-WORKFLOW-AUDIT.md`: Art.15+Art.17+Art.20 implemented; Art.16 via standard CRUD; Art.18+Art.21 deferred Sprint 4 with documented path |

## 9. Clinical safety

| # | Control | Status | Evidence |
|---|---|---|---|
| 9.1 | Validated score formulas preserved byte-for-byte | ✅ | Pure modules + equivalence tests in `tests/equivalence/` |
| 9.2 | Score calculation deterministic (no side effects) | ✅ | All engine modules are pure functions |
| 9.3 | AI output strictly non-authoritative and bounded | ✅ | No AI in the clinical engine path; only in future supportive helpers |
| 9.4 | Clinical PDFs mark confidentiality and non-AI authority | ✅ | Footer disclaimer in `pdf-report-service.ts` |
| 9.5 | Alerts tagged by severity with recommended actions | ✅ | `alert-deriver.ts` + `alerts` table |
| 9.6 | Follow-up plan derived from composite risk band | ✅ | `followup-plan.ts` |
| 9.7 | Score computation fully auditable (input snapshot persisted) | ✅ | `assessments.clinical_input_snapshot` JSONB column |
| 9.8 | Composite-risk decision is reproducible (winning domain + tie-break + rationale) | ✅ | Sprint 4 task 4.1 — `CompositeDecision` block on `CompositeRiskProfile`, canonical priority `cardio > renal > metabolic > hepatic > frailty`, locked by 6 tests in `tests/unit/composite-risk.test.ts`. Doc: `docs/23-CLINICAL-ENGINE.md §7.2` |
| 9.9 | Alerts inbox dedup + closure provenance fully audited | ✅ | Sprint 4 task 4.2 — migration 019 `alerts.dedup_key` + partial unique index `idx_alerts_dedup_inflight` (in-flight dedup) + `dismissed_at`/`dismissed_by`/`resolved_by` (NIS2 / IEC 62304 §5.7 audit symmetry). Ack endpoint requires `note ≥ 3 chars` for resolve/dismiss, refuses re-closure of terminal rows (HTTP 409). Auto-close cron via `fn_auto_close_stale_alerts(30)` daily. Audit actions `alert.dismiss` + `alert.auto_close` registered. Doc: `docs/23-CLINICAL-ENGINE.md §8.1` |
| 9.10 | Follow-up plan deterministic + every guideline citation traces to the catalog | ✅ | Sprint 4 task 4.3 — `tests/unit/followup-plan.test.ts` (39 cases): determinism, cadence-by-composite-risk table, per-domain branches (CV/renal/hepatic/metabolic/frailty), diabetic chronic-care, NEW HTN tiered branch (ESC/ESH 2023), NEW smoking-cessation branch (ESC 2021 §3), `dueInDays` sentinel, **catalog-linkage invariant** (every emitted `guidelineSource` MUST exist in `guideline-registry.ts`). Doc: `docs/23-CLINICAL-ENGINE.md §9.1–§9.4` |
| 9.11 | Independent paper-derived reference equivalence with CI gate | ✅ | Sprint 4 task 4.4 — 5 reference impls in `tests/equivalence/refs/` (BMI, eGFR, FLI, FRAIL, ADA) re-derived from published source with zero engine imports. 29-case dual-assertion suite (engine ≡ reference ≡ paper-derived expected). CI gate `scripts/check-equivalence-coverage.mjs` enforces ≥ 5 cases per validated score (10 scores covered). Tolerance policy in `docs/24-FORMULA-REGISTRY.md §14`. Wired into `npm run build:check` |

## 10. Secrets & configuration

| # | Control | Status | Evidence |
|---|---|---|---|
| 10.1 | No secret in the frontend bundle | ✅ | Only anon key + URL |
| 10.2 | Env validated at startup | ✅ | `validateEnv()` |
| 10.3 | Missing env vars crash the server fast | ✅ | Throws on boot |
| 10.4 | `SUPABASE_URL` format-validated | ✅ | `new URL()` check |
| 10.5 | Env file template committed (`.env.example`) | ✅ | `.env.example` at repo root documents all required + optional variables |
| 10.6 | Secret rotation runbook documented | ⬜ | Ops task |

## 11. Supply chain

| # | Control | Status | Evidence |
|---|---|---|---|
| 11.1 | Only audited dependencies (`pdf-lib`, `zod`, `@supabase/supabase-js`, `vitest`) | ✅ | Minimal surface area |
| 11.2 | No runtime use of `eval`, `new Function`, or dynamic `require` | ✅ | Verified during review |
| 11.3 | Vercel serverless runtime pinned (Node ≥ 20) | 🟡 | Add `"engines": {"node":">=20"}` to `package.json` |
| 11.4 | Dependabot / Renovate enabled | ✅ | `.github/dependabot.yml` — npm (root + backend) + github-actions, grouped, weekly, major version ignored for zod/pdf-lib/supabase-js |

## 12. Observability

| # | Control | Status | Evidence |
|---|---|---|---|
| 12.1 | Structured error logging (no secrets) | ✅ | `console.error('[component] ...')` convention |
| 12.2 | Errors never leak internals to clients | ✅ | Uniform error envelope |
| 12.3 | Health check endpoint with deep probes | ✅ | Sprint 6 task 6.2 — `api/v1/health.ts` runs 4 concurrent probes (Supabase / Storage / Upstash / MFA-flag policy) each bounded by a 3 s hard timeout. Per-subsystem latency budgets: Supabase 500 ms, Storage 750 ms, Upstash 250 ms — overruns surface as `detail: "slow:<latency>ms"` without flipping the overall verdict. Storage added to the critical-subsystems set: a down storage bucket fails PDF reports, so it warrants `503 unhealthy` (HTTP 207 degraded reserved for Upstash fallback / partial MFA flags). |
| 12.4 | Datadog dashboard templates for every structured-log event | ✅ | Sprint 6 task 6.3 — importable JSON in `docs/observability/datadog-*.json` covering `RETENTION_RUN`, `ALERTS_AUTO_CLOSE_RUN`, `AUDIT_WRITE_FAILED`, `ACCESS_DENIED`. Each template ships a count-over-time tile, a faceted breakdown, and a monitor (alert) example with the SLO-anchored thresholds. Operator imports via Datadog UI; same queries map to Grafana Loki. README at `docs/observability/README.md`. |
| 12.5 | SLO definitions doc + burn-rate alerts | ✅ | Sprint 6 task 6.4 — `docs/41-SLO-DEFINITIONS.md` defines: 99.5 % availability initial target (99.9 % post-first-tenant), per-endpoint p95 latency budgets (read 200 ms / write 500 ms / PDF 5 s / FHIR 3 s / alert ack 300 ms), zero-tolerance audit-strict invariant, 28-hour cron-liveness budget, RBAC denial baselines per tenant. Multi-window multi-burn-rate alerting (14.4× over 1h SEV-2; 6× over 6h SEV-3) per Google SRE pattern. |
| 12.6 | Per-module code-coverage report | ✅ | Sprint 6 task 6.1 (closes L-07) — `tests/vitest.config.ts` emits `json-summary` via `@vitest/coverage-v8`; `scripts/check-coverage-thresholds.mjs` enforces per-module floors (validated formulas 90 %, interpretation layers 80 %, supporting modules 70 %). Run via `npm run check:coverage`. |

---

## Pending follow-ups

All previous operational follow-ups (retention cron, patient export,
anonymization worker, distributed rate-limiter, MFA UX, health endpoint,
`.env.example`, Dependabot) have been implemented. See §13 review report and
§11 changelog for the audit trail.

Remaining open items — documentation / operational only, not code:

- 8.10 — DPO / joint controller records (legal doc)
- 10.6 — Secret rotation runbook (ops doc)
- 12.4 — Alert on abnormal audit volume (ops dashboard)

None of these gate the MVP launch, nor general availability from a
technical standpoint.
