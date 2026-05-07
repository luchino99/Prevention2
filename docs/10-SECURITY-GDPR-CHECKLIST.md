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
| 8.8 | Data export (portability) endpoint | ✅ | `api/v1/patients/[id]/export.ts` — returns versioned envelope `uelfy.patient-export/v1`, creates `data_subject_requests` row |
| 8.9 | Right-to-erasure via soft-delete + anonymization job | ✅ | `patients.deleted_at` + `fn_anonymize_patient()` + daily `/api/v1/internal/anonymize` (grace window 30d, configurable) |
| 8.10 | DPO / joint controller records | ⬜ | Documentation task (non-code) |

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
| 12.3 | Health check endpoint | ✅ | `api/v1/health.ts` — `200 ok` / `207 degraded` / `503 unhealthy` with subsystem breakdown (Supabase + distributed rate-limit) |
| 12.4 | Alert on abnormal audit volume (failed_login spikes) | ⬜ | Ops task — dashboard needed |

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
