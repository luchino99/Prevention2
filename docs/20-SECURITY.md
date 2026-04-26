# Uelfy Clinical — Security Architecture

> **Scope.** This document describes the implemented security architecture of
> the Uelfy Clinical platform — a B2B cardio-nephro-metabolic risk-assessment
> SaaS handling sensitive health data of EU data subjects. It is the
> engineering counterpart to the matrix-style readiness checklist in
> `10-SECURITY-GDPR-CHECKLIST.md` and the privacy-by-design narrative in
> `21-PRIVACY-TECHNICAL.md`.
>
> **Audience.** Security engineers, internal reviewers, external pentesters,
> tenant security teams performing due diligence.
>
> **What this document is not.** Not a legal opinion. Not a final
> certification. Not a substitute for an independent third-party audit. Items
> that require external sign-off are flagged `EXT-LEGAL`, `EXT-CLIN`, or
> `EXT-MDR`.

---

## 1. Asset model

| Asset class | Examples | Sensitivity | Storage |
|---|---|---|---|
| Patient PHI (identifying) | name, DoB, email, phone, external_code | High (Art.9 GDPR) | `patients` table, `clinical-reports` bucket |
| Patient PHI (clinical) | lab values, scores, alerts, follow-up plans | High (Art.9 GDPR) | `assessments`, `score_results`, `risk_profiles`, `alerts`, `followup_plans` |
| Consent records | consent_type, granted, policy_version, ip_hash | Medium-High (accountability) | `consent_records` |
| DSR records | DSR kind, subject id, sla_deadline, export path | Medium-High | `data_subject_requests` |
| Audit trail | actor, action, entity, ip_hash, ua | Medium (integrity-critical) | `audit_events` |
| Auth secrets | Supabase service-role key, cron signing secret, JWT signing key | Critical | Vercel env (encrypted at rest) |
| Report PDFs | rendered clinical PDF + DSR exports | High (Art.9 GDPR) | `clinical-reports` bucket (private, signed-URL gated) |

The clinical engine itself is **stateless and pure**: it consumes a snapshot
of inputs and emits scores deterministically (see `23-CLINICAL-ENGINE.md`).
There is no model state, no per-tenant ML weight, and no AI in the
authoritative scoring path.

## 2. Trust boundaries

```
                                 ┌───────────────────────────────┐
                                 │  Browser / professional UI    │
                                 │  - holds Supabase access JWT  │
                                 │  - never holds service role   │
                                 └──────────────┬────────────────┘
                                                │ HTTPS, Bearer JWT
                                                ▼
                                 ┌───────────────────────────────┐
                                 │  Vercel serverless functions  │
                                 │  api/v1/**                    │
                                 │  - withAuth → validateAccess  │
                                 │  - rbac gates                 │
                                 │  - rate limit                 │
                                 │  - opaque error envelope      │
                                 └──────────────┬────────────────┘
                                                │ service-role JWT
                                                ▼
                                 ┌───────────────────────────────┐
                                 │  Supabase (Postgres + Storage)│
                                 │  - RLS on every table         │
                                 │  - SECURITY DEFINER helpers   │
                                 │  - private bucket (B-15)      │
                                 └───────────────────────────────┘
```

Three trust boundaries, three gates:

1. **Browser ↔ API.** Every privileged endpoint is wrapped in
   `withAuth` (`backend/src/middleware/auth-middleware.ts`) which calls
   `supabaseAdmin.auth.getUser(token)` per request. JWTs are *validated*
   server-side, not merely decoded. The browser never sees the service-role
   key.
2. **API ↔ Postgres.** Even though the API uses the service-role key to
   talk to Postgres (bypassing RLS for performance reasons in some hot
   paths), every privileged read/write also enforces tenant isolation
   in application code as defence-in-depth. RLS remains enabled and is the
   primary boundary if a future endpoint forgets the explicit filter.
3. **Tenant boundary.** A `tenant_id` column gates *every* row in *every*
   PHI-bearing table. RLS policies (`002_rls_policies.sql`,
   `010_security_hardening.sql`) ensure no clinician of tenant A can ever
   read data of tenant B. Migration `012_force_row_level_security.sql`
   additionally sets `FORCE ROW LEVEL SECURITY` on all 20 PHI / tenant /
   identity tables so RLS evaluates even for the table owner — only
   `service_role` (with `BYPASSRLS`) bypasses, by design. `assertSameTenant`
   (in `rbac.ts`) is the application-layer mirror.

## 3. Authentication

- **Identity provider.** Supabase Auth (PostgREST + GoTrue). All user
  records live in `public.users`, joined to `auth.users` by id.
- **Token format.** Supabase JWT (HS256). Validated per request via
  `supabaseAdmin.auth.getUser(token)`.
- **Session refresh.** Handled client-side by the Supabase SDK
  (`autoRefreshToken: true`). The server only ever sees access tokens.
- **MFA.** TOTP available for `tenant_admin` and `platform_admin`
  (frontend/pages/mfa-enroll.html). Enforcement policy is per-tenant
  (configurable; not yet enforced platform-wide — see `EXT-LEGAL`).
- **Failed-login telemetry.** `recordFailedLogin` hashes the IP, captures
  domain-level email metadata only (no full email), and writes
  `auth.failed_login` rows with `outcome=failure` for monitoring.
- **Suspension.** `users.is_suspended` is checked on every authenticated
  request — a suspended user cannot use a still-valid token.

## 4. Authorization (RBAC + RLS + relationship gates)

Three layers stacked:

1. **Role gate** (`backend/src/middleware/rbac.ts`).
   - `requireClinicalWrite` → platform_admin / tenant_admin / clinician.
   - `requireTenantMember` → above + assistant_staff.
   - `requireTenantAdmin` → only the two admin roles.
   - `requirePlatformAdmin` → only platform_admin.
2. **Tenant gate** (`assertSameTenant`).
   - Every loaded resource is checked against `req.auth.tenantId` before
     being returned. Platform admins are explicitly cross-tenant by design.
3. **Relationship gate** (B-08 — clinician ↔ patient).
   - Even within a tenant, a `clinician` can only act on patients linked
     via `professional_patient_links` (`is_active=true`). The
     `is_linked_to_patient(uuid)` SECURITY DEFINER helper enforces this in
     SQL; `isPplGated()` in `consents/index.ts` mirrors it in the API.

Rationale: RLS gives us **tenant isolation**; the role gate gives us
**capability separation**; the relationship gate gives us **least-privilege
within a tenant**. All three must agree; a misconfigured RLS policy alone
cannot create a privilege escalation path.

## 5. Data protection in transit & at rest

- **In transit.** All client traffic served over TLS 1.2+ via Vercel.
  Supabase enforces TLS for Postgres and Storage. No HTTP fallback.
- **At rest (Postgres).** Encrypted at rest by Supabase (AES-256, AWS-managed
  keys). The `clinical_input_snapshot` JSONB column is intentionally a flat
  copy of the assessment input bytes, never a pointer — this is the only PHI
  field exposed in the `assessments` table itself; the rest of the rows are
  computed scalars.
- **At rest (Storage).** `clinical-reports` bucket is **private** (no public
  read), gated by service-role only via migration `010_security_hardening`
  (audit blocker B-15). Object access is exclusively by **5-minute signed
  URL** minted by the API after re-authorising the caller. URLs are scoped
  to a single object path, cannot be reused across tenants, and are not
  cached (response carries `Cache-Control: no-store`).
- **Backups.** Supabase manages snapshot retention. Backups inherit
  encryption and tenant isolation (the snapshot is the same Postgres image).

## 6. Secrets & key management

| Secret | Where it lives | Who holds it |
|---|---|---|
| Supabase service-role JWT | Vercel env `SUPABASE_SERVICE_ROLE_KEY` | Backend only — never bundled into frontend |
| Supabase anon key | Vercel env + injected into frontend bundle | Public, scoped by RLS |
| `CRON_SIGNING_SECRET` | Vercel env | Read only by `api/v1/internal/*` cron handlers |
| Database password | Supabase dashboard | Not used by app — service-role JWT replaces it |

Verification via `scripts/verify-build.mjs` (asserts the service-role key
never appears in the frontend bundle).

## 7. Secure SDLC

- **TypeScript strict mode** — `tsconfig.json` sets `strict: true`,
  `noImplicitOverride`, `noUncheckedIndexedAccess`, `noImplicitAny`.
- **Schema-first input validation** — every endpoint parses the request
  body / query against a Zod schema (`replyValidationError` for the
  client-safe envelope).
- **Opaque error envelope** — `replyError` / `replyDbError` /
  `replyServiceError` (`http-errors.ts`) collapse all DB / runtime errors to
  a fixed `{code, requestId}` shape (audit blocker B-05). PostgREST messages
  are logged server-side only; clients never see column names, RLS policy
  names, or stack traces.
- **Migration discipline** — every schema change is a numbered SQL
  migration in `supabase/migrations/`. No ad-hoc DDL. RLS is added in the
  same migration that creates the table.
- **Atomic clinical writes** — `create_assessment_atomic` (migration 011)
  wraps the 9 child inserts of an assessment in a single transaction
  (audit blocker B-03). No more bestEffort `try/catch` swallowing partial
  state.

## 8. Auditability

- **Immutable audit log** — `audit_events` is append-only by convention
  (no UPDATE / DELETE policy in 002). Every privacy-significant action
  emits a row.
- **Two write modes** — `recordAudit` (best-effort, for low-risk reads)
  and `recordAuditStrict` (throws `AuditWriteError` on failure, used for
  consent changes, patient delete, report generate/download, DSR
  transitions). The strict variant guarantees the matching audit row is
  reachable in practice; on failure the API returns
  `500 AUDIT_WRITE_FAILED` and the operator is paged.
- **What is logged** — actor (user_id, role, tenant_id), action (canonical
  enum), resource_type + resource_id, outcome, optional sanitized metadata.
  IP is *hashed* (SHA-256), never stored raw. User-agent is truncated.
- **What is NOT logged** — score values, lab values, full URLs, request
  bodies. The `sanitizeMetadata` helper enforces an allowlist of scalar /
  enum-like values only.

## 9. Rate limiting

`backend/src/middleware/rate-limit.ts` (in-memory) and
`rate-limit-upstash.ts` (distributed). Each route specifies a `routeId` +
budget from `RATE_LIMITS` (`read`, `write`, `admin`, `reportExport`,
`auth`). The 429 response carries `Retry-After` and the standard
`X-RateLimit-*` headers. Heavy paths (PHI export, report generation) are
budgeted at single-digit requests per minute per actor.

## 10. Threat model summary

| Threat | Mitigation | Status |
|---|---|---|
| Stolen access JWT (XSS / phishing) | Short JWT TTL; suspension flag re-checked per request; MFA available for admins | ✅ |
| Cross-tenant data leak via API bug | Three-layer auth (role + tenant + PPL) + RLS + opaque error envelope | ✅ |
| Cross-tenant data leak via RLS bug | App-layer tenant filter as defence-in-depth on every query | ✅ |
| Schema enumeration via error reflection | Centralised `replyError` / `replyDbError` (B-05) | ✅ |
| Compromised cron endpoint | Constant-time bearer check + `CRON_SIGNING_SECRET` + Vercel `x-vercel-cron` header (B-04) | ✅ |
| Storage object enumeration | Private bucket, service-role gating (B-15), signed URLs only, 5-min TTL | ✅ |
| Audit gap on privileged write | `recordAuditStrict` + `AUDIT_WRITE_FAILED` envelope (B-09) | ✅ |
| AI hallucination affecting clinical decision | No AI in scoring path; AI confined to bounded supportive commentary if enabled | ✅ |
| Malicious admin within a tenant | Audit log captures every action with actor + IP-hash; RLS prevents cross-tenant; tenant_admin cannot grant platform_admin | ✅ |
| Insider at platform level | Service-role access is logged via Supabase Postgres logs; key rotation procedure documented in `26-DEPLOYMENT-RUNBOOK.md`; principle of need-to-know enforced operationally | 🟡 (operational) |
| DDoS / bot scraping | Vercel platform DDoS + per-route rate limit | 🟡 (capacity hard limits depend on Vercel plan) |
| Supply-chain compromise (npm) | Pinned dependency versions, `npm audit` on CI, minimal dependency surface (`pdf-lib`, `@supabase/supabase-js`, `zod`) | 🟡 (no SBOM yet) |

## 11. Dependencies (security posture)

Production runtime dependencies (`package.json`):

- `@supabase/supabase-js` — official Supabase SDK.
- `pdf-lib` + `@pdf-lib/fontkit` — pure-JS PDF rendering, no shell-out.
- `zod` — input validation.

No transitive dependency on a templating engine, a SQL builder, an HTML
sanitiser, or a wkhtmltopdf-style native binary. The smaller surface lowers
supply-chain risk.

## 12. Open / EXT items

- **EXT-LEGAL.** Per-tenant DPA template + sub-processor list.
- **EXT-LEGAL.** Cross-border transfer assessment (TIA) when tenants
  outside EEA are onboarded.
- **EXT-MDR.** Formal classification under EU MDR 2017/745 (current
  position: clinical decision *support*, not a medical device — see
  `25-MDR-READINESS.md`). Requires Notified Body opinion.
- **EXT-CLIN.** Independent clinical re-validation of every score against
  the published reference (current equivalence tests live in
  `tests/equivalence/score-equivalence.test.ts` — see
  `28-TESTING-STRATEGY.md`).
- Platform-wide MFA enforcement for admin roles (currently available, not
  required).
- SBOM generation in CI.

## 13. Reporting a vulnerability

Security disclosures: **security@uelfy.example** (placeholder — replace
with the actual mailbox before go-live). PGP key listed at
`/.well-known/security.txt`. We commit to acknowledging within 72 hours
and providing a fix timeline within 7 working days for CVSS ≥ 7.0
findings.

---

**Cross-references**

- `10-SECURITY-GDPR-CHECKLIST.md` — implementation matrix.
- `21-PRIVACY-TECHNICAL.md` — privacy-by-design data flows.
- `22-GDPR-READINESS.md` — Article-by-article readiness.
- `26-DEPLOYMENT-RUNBOOK.md` — environment configuration + key rotation.
- `27-INCIDENT-RESPONSE.md` — detection and breach-notification workflow.
