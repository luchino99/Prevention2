# Uelfy Clinical — Consolidated Risk Register (Post-Remediation)

> **Scope.** Single, current view of every identified risk to the
> platform — security, privacy, clinical, operational, regulatory —
> with current status after the 9-phase remediation programme. This
> file replaces the ad-hoc tracking that was scattered across audit
> notes, task list, and per-phase changelog entries.
>
> **Companion docs.** `20-SECURITY.md`, `21-PRIVACY-TECHNICAL.md`,
> `22-GDPR-READINESS.md`, `25-MDR-READINESS.md`,
> `27-INCIDENT-RESPONSE.md`, `28-TESTING-STRATEGY.md`,
> `31-LAUNCH-CHECKLIST.md`.
>
> **Audience.** Founder, security lead, DPO, regulatory consultant.
>
> **Updated.** 2026-04-26.

---

## Severity & status legend

| Severity | Definition |
|---|---|
| **Critical** | Direct PHI exposure / regulatory blocker / multi-tenant break |
| **High** | Plausible PHI exposure under specific conditions; or significant compliance gap |
| **Medium** | Defence-in-depth weakness; isolated control gap; degraded UX with safety implications |
| **Low** | Hardening opportunity; observability gap; nice-to-have |

| Status | Meaning |
|---|---|
| ✅ Resolved | Mitigation in production; verified |
| 🟢 Mitigated | Mitigation in production; residual risk acceptable |
| 🟡 Partial | Mitigation in production; gap documented; remediation roadmapped |
| 🔵 Architectural | Lives in design; ongoing vigilance required |
| ⚪ EXT | Outside engineering scope; controller / counsel / consultant action |

---

## Section A — 15 Critical blockers (the B-series)

| ID | Title | Severity | Status | Mitigation reference |
|---|---|---|---|---|
| B-01 | RLS not forced on PHI tables | Critical | ✅ Resolved | Migration `010_security_hardening.sql` narrows per-clinician RLS policies (PPL-scoped reads); migration `012_force_row_level_security.sql` adds explicit `ALTER TABLE … FORCE ROW LEVEL SECURITY` on all 20 PHI / tenant / identity tables (defence-in-depth — `service_role` bypasses by design via `BYPASSRLS`, but FORCE catches any non-service-role table-owner connection) |
| B-02 | Sensitive grants exposed to anon role | Critical | ✅ Resolved | Migration 010 — `REVOKE` on PHI tables from `anon`; service-role only for backend writes |
| B-03 | Non-atomic assessment create (ghost rows possible) | Critical | ✅ Resolved | Migration `011_atomic_assessment.sql` — single `create_assessment(...)` RPC writes assessment + snapshot + score_results in one TX (Task #59) |
| B-04 | Cron endpoints unauthenticated | Critical | ✅ Resolved | `CRON_SIGNING_SECRET` bearer with constant-time compare; Vercel `x-vercel-cron` header verified (Task #54) |
| B-05 | DB errors leaked through HTTP responses (schema enumeration risk) | Critical | ✅ Resolved | Centralised `replyError` / `replyDbError` envelope — opaque `{code, requestId}` shape (Task #55) |
| B-06 | Endpoint authorisation drift (some endpoints missed RBAC checks) | Critical | ✅ Resolved | `withAuth` middleware enforced on every API path; per-role policy in `auth-middleware.ts` (Task #56) |
| B-07 | Tenant isolation gaps in writes | Critical | ✅ Resolved | Tenant id derived from auth context, never trusted from request body (Task #56) |
| B-08 | Clinician ↔ patient relationship gate missing | Critical | ✅ Resolved | `professional_patient_links` (migration 005) + `is_linked_to_patient(uuid)` SECURITY DEFINER helper enforced at every patient-touching endpoint (Task #56) |
| B-09 | Privacy-significant audit writes were best-effort (silent loss possible) | Critical | ✅ Resolved | `recordAuditStrict` + `AuditWriteError` + `AUDIT_WRITE_FAILED` HTTP envelope; propagated to all 7 guarantee pathways (Tasks #57, #63) |
| B-10 | Sensitive-read logging missing | Critical | ✅ Resolved | `patient.read`, `patient.export`, `assessment.read` audited via `recordAudit` on every successful read (Task #57) |
| B-11 | Email used as application key (PII coupling) | Critical | ✅ Resolved | Internal joins on UUID only; email kept in auth tier (Task #53 — Phase 0 quick wins) |
| B-12 | Frontend-exposed service-role secrets | Critical | ✅ Resolved | Service-role key never in `inject-public-config.mjs` output; only `SUPABASE_URL` + `SUPABASE_ANON_KEY` exposed (Task #53) |
| B-13 | CORS overly permissive | Critical | ✅ Resolved | Per-route CSP in `vercel.json`; `connect-src` restricted to self + Supabase (Task #53) |
| B-14 | No DSR endpoint (Art.12/15/17/20 not actionable) | Critical | ✅ Resolved | `data_subject_requests` ledger + `api/v1/admin/dsr/*` endpoints with state machine: received → in_progress → fulfilled / rejected / cancelled (Tasks #60, #63) |
| B-15 | Storage objects publicly accessible | Critical | ✅ Resolved | Migration 010 — bucket set to private; access exclusively via 5-minute signed URLs from service-role-mediated endpoint |
| B-03-bis | `create_assessment_atomic` RPC bypassed every column DEFAULT (id, created_at, severity, status, audience, etc.) by mixing `INSERT … SELECT * FROM jsonb_populate_record()` with implicit NULL fields, causing every assessment write to fail in production with `null value in column "id" violates not-null constraint` | Critical | ✅ Resolved | Migration `013_fix_assessment_atomic_defaults.sql` — defaults are merged into the JSONB before populate (right-biased `\|\|`: defaults `\|\|` caller `\|\|` forced FKs) so every NOT NULL DEFAULT is honoured for all 8 child tables. Discovered post-deploy via production log; safety net (transactional rollback from B-03) prevented partial writes. |

**Critical-blocker count remaining: 0.**

---

## Section B — High risks (post-remediation status)

| ID | Title | Status | Notes |
|---|---|---|---|
| H-01 | RLS regression undetected (no Postgres-side test) | ✅ Resolved | `tests/rls/cross_tenant_negative.sql` (Tier 1, Task #68) — 6 SQL assertions exercise the live policy set with `SET LOCAL ROLE authenticated` + JWT-claim impersonation. Runner `scripts/run-rls-tests.mjs` skips gracefully when DATABASE_URL or psql are absent (so CI Vercel is unblocked) and runs end-to-end against staging when configured. Wrapped in BEGIN…ROLLBACK so re-runnable. Wire: `npm run test:rls` |
| H-02 | Cross-tenant read via misuse of service-role context | 🟢 Mitigated | All admin endpoints check `auth.tenantId` against requested resource; covered by `recordAuditStrict` so any anomaly is forensically visible |
| H-03 | Atomic-create rollback under partial failure | 🟢 Mitigated | RPC pattern + error envelope; manual integration test passed; automated RPC integration test on Phase 9 roadmap |
| H-04 | Audit write outage masks real activity | 🟢 Mitigated | Strict-audit endpoints fail-closed; alerts on `AUDIT_WRITE_FAILED` log lines on roadmap (`27-INCIDENT-RESPONSE.md §11`) |
| H-05 | Out-of-range score inputs producing misleading composite risk | 🟢 Mitigated | `score2-eligibility.ts` truthful skip messaging (Task #21); `indeterminate` band added (migration 006) |
| H-06 | Engine version drift across hot deploys | 🟢 Mitigated | `engine_version` stamped on every persisted row; doc in `23-CLINICAL-ENGINE.md §11` |
| H-07 | Soft-deleted patient data lingering past grace window | 🟢 Mitigated | Daily anonymisation cron + `ANONYMIZE_GRACE_DAYS` config; cron monitored |
| H-08 | DSR SLA breach (30-day clock) | 🟢 Mitigated | `data_subject_requests.sla_deadline` set on creation; admin UI surfaces overdue items |
| H-09 | Consent revocation lost (audit gap) | ✅ Resolved | `consent.revoke` on `recordAuditStrict` path (B-09 propagation) |
| H-10 | Patient export discloses too much (audit IPs) | ✅ Resolved | Export envelope omits IP hashes; only the data subject's own data |
| H-11 | Optional AI commentary leaks PHI to OpenAI | 🔵 Architectural | Off by default; only the bounded summary reaches the prompt; controller opt-in (`21-PRIVACY-TECHNICAL.md §11`) |
| H-12 | Cross-border transfer to US sub-processors | 🔵 Architectural | EU-only by default; non-EU is `EXT-LEGAL` opt-in with TIA + SCCs |
| H-13 | Engine drift between code and citation | 🟢 Mitigated | Equivalence test suite + `24-FORMULA-REGISTRY.md` per-score citations; CI gate on equivalence vectors |
| H-14 | Catastrophic dependency vulnerability (e.g. zero-day in pdf-lib) | 🔵 Architectural | SBOM tracked via `package.json` + `12-PACKAGE-UPGRADE.md`; rapid-rotation runbook in `27-INCIDENT-RESPONSE.md §4.3` |

---

## Section C — Medium risks

| ID | Title | Status | Notes |
|---|---|---|---|
| M-01 | Rate limiter is in-memory only (no horizontal coordination) | ✅ Resolved | All 21 api/v1 endpoints migrated from sync `checkRateLimit` to async `checkRateLimitAsync` (Tier 2, Task #69 — 23 call sites updated by `scripts/migrate-rate-limit-to-async.mjs`). The async path uses Upstash Redis when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, with graceful fallback to in-memory if Upstash is unconfigured or transiently unavailable. Regression gate `scripts/check-rate-limit-async.mjs` blocks any future PR that re-introduces the sync variant. Operator must wire Upstash env vars before launch (gated in `31-LAUNCH-CHECKLIST §A.7`) and add Upstash to the per-tenant DPA sub-processor list |
| M-02 | Tenant-admin UI for retention overrides incomplete | 🟢 Mitigated | Migration `014_tenant_retention_overrides.sql` adds 4 nullable INTEGER columns to `tenants` (audit, anonymize_grace, alerts_resolved, notifications) with sensible CHECK bounds. Endpoint `/api/v1/admin/tenant` GET+PATCH (Tier 3, Task #74) — tenant_admin scoped to own tenant, platform_admin via `?id=`. PATCH uses `recordAuditStrict` (B-09) so a privacy-significant change to retention windows can never escape the audit trail. UI: `frontend/pages/tenant-settings.html` + `tenant-settings.js`. **Caveat (Tier 4)**: `fn_retention_prune` cron is still platform-wide; the values are persisted + auditable but the cron does not yet read them. UI shows an explicit banner declaring this. The doc claim in `21-PRIVACY-TECHNICAL.md §13` is now true (schema columns DO exist, after lying about it for some time) |
| M-03 | No SBOM export for SOUP inventory (IEC 62304 §5.1) | ✅ Resolved | `sbom.cyclonedx.json` (CycloneDX 1.5 application BOM) committed at repo root, regenerated via `npm run sbom:refresh` (Tier 3, Task #73). Canonical form (sorted components, volatile fields stripped) so git diffs show only meaningful supply-chain changes. Regression gate `npm run check:sbom` wired into `build:check` blocks any package.json change without a paired SBOM refresh. Loadable by Grype/Trivy for offline vulnerability scanning. The SBOM IS the SOUP inventory IEC 62304 §5.1 expects |
| M-04 | No public security.txt / vulnerability-disclosure policy | ✅ Resolved | RFC 9116 `/.well-known/security.txt` + `/security.txt` mirror (Vercel rewrite) + full `SECURITY.md` policy (Tier 1, Task #65). Two `SECURITY.md` copies (repo root for GitHub Security tab, `frontend/` for public-site serving) diff-checked at build time. SLAs published: 24h ack, 5d assessment, 30d fix High/Critical, 90d disclosure. `security@uelfy.com` mailbox must be activated before launch (gated in `31-LAUNCH-CHECKLIST.md`) |
| M-05 | Backup-restore drill not automated (Art.32(1)(d)) | 🟢 Mitigated | `docs/33-RESTORE-DRILL-SOP.md` (Tier 3, Task #75) — full annual SOP with 3 scenarios (PITR whole-DB, storage-only object, single-tenant export+re-import). Drill log template + sign-off block. RPO/RTO targets (≤5 min / ≤4 h) committed against Supabase platform-managed PITR. Drill is OPERATIONAL not automatable (controller-side execution); the SOP is the engineering deliverable |
| M-06 | Per-tenant KMS envelope for `clinical_input_snapshot` | 🟡 Partial | Platform-managed AES-256 today; per-tenant KMS on roadmap |
| M-07 | PDF visual-regression test absent | 🟡 Partial | Manual smoke test; no headless renderer in CI |
| M-08 | Mutation testing not configured | 🔵 Roadmap | Stryker integration would harden the equivalence test surface |
| M-09 | Audit query UI for tenant_admin partial | ✅ Resolved | Full query UI in `frontend/pages/audit.{html,js}` (Tier 2, Task #72): 6 filters (action, actor, resource type, outcome, from/to date range), pagination, CSV export. Backend `/api/v1/admin/audit` extended with `outcome` filter + `format=csv` support (5000-row cap on CSV pageSize). Active bug fixed: response-shape drift (backend was returning `{logs}`, frontend destructured `{events}` — table was silently empty in production). Now both sides aligned to `events`. |
| M-10 | DSR end-to-end automated test absent | ✅ Resolved | `tests/integration/api-dsr-state-machine.test.ts` (Tier 2, Task #71) — 8 cases covering: 4 happy-path transitions (create, start, cancel, reject) with audit-strict, illegal transition (start on fulfilled → 409), cross-tenant opaque 404 (no info disclosure), missing rejectionReason → 422, clinician role → 403. Uses scriptable Supabase mock chain that allows per-test response sequencing. Note: full e2e against live Supabase remains a follow-up like the RLS test (skip when DATABASE_URL is unset) |
| M-11 | Cron handler signing-secret automated test absent | ✅ Resolved | `tests/unit/cron-auth.test.ts` (Phase 9) — 14 cases covering secret hygiene, bearer compare, Vercel header gate, opaque deny |
| M-12 | Multi-tenant cross-read negative test absent | ✅ Resolved | Same delivery as H-01 (Tier 1, Task #68) — `tests/rls/cross_tenant_negative.sql` includes the dedicated cross-tenant-read assertion + cross-tenant-INSERT assertion + PPL-gate assertion + tenant_admin scope assertion |
| M-13 | Composite-risk "silence is not safety" invariant unprotected by automated test | ✅ Resolved | `tests/unit/composite-risk.test.ts` (Phase 9) — locks in indeterminate-band semantics (C-02) and out-of-range truthful skip reasoning (H-05) |

---

## Section D — Low / hardening opportunities

| ID | Title | Status |
|---|---|---|
| L-01 | Per-tenant engine-version pinning (controller can defer a bump) | 🔵 Roadmap |
| L-02 | Engine-version diff report | 🔵 Roadmap |
| L-03 | Backfill recompute job (legacy assessments under new engine, retaining historical row) | 🔵 Roadmap |
| L-04 | Automated alert on `AUDIT_WRITE_FAILED` log lines | 🟢 Mitigated | Structured-log emitter `emitAuditFailureLog()` in `audit-logger.ts` (Tier 1, Task #66): every failure path emits one canonical JSON line `{"event":"AUDIT_WRITE_FAILED", variant, action, resourceType, resourceId, dbErrorMessage, dbErrorCode}`. Contract frozen by 4 unit tests in `audit-logger.test.ts`. PHI-leak regression test included. Dashboard queries (Vercel grep, Datadog/Logflare, manual SQL) documented in `27-INCIDENT-RESPONSE.md §11.2` with severity thresholds (SEV-3/SEV-2/SEV-1). External alert destination wiring is tenant/operator choice — gated in launch checklist `§A.6` |
| L-05 | Automated alert on RLS-denial spikes | 🟢 Mitigated | `emitAccessDenialLog()` in `audit-logger.ts` + wiring in `middleware/rbac.ts` (Tier 1, Task #67). Captures 3 reason classes today (`unauthenticated`, `role_mismatch`, `cross_tenant`) at the centralised middleware boundary — covers every endpoint without per-endpoint changes. PPL-gate failure (`cross_clinician_ppl`) emission is Tier 2 follow-up across patient endpoints. Field contract locked by `AccessDenialContext` type. Dashboard queries + SEV-3/2/1 thresholds in `27-INCIDENT-RESPONSE.md §11.3`. External alert wiring is operator config (same destination as L-04) |
| L-06 | Linter-enforced ban on `Math.random()` / `Date.now()` inside `backend/src/domain/clinical/` | ✅ Resolved | `scripts/check-engine-determinism.mjs` (Tier 1, Task #64). 6 deterministic-locked sub-trees gated, 5 forbidden patterns; integrated into `npm run build` (Vercel deploy) AND `npm run build:check` (pre-PR). Regression-tested with injected violations: gate catches all 3 pattern families with file:line diagnostics |
| L-07 | Per-score code-coverage report (informational, not gating) | 🔵 Roadmap |
| L-08 | Frontend bundle-size budget enforcement | 🔵 Roadmap |
| L-09 | MFA required for all clinician roles (currently MFA-supported, not MFA-mandatory) | 🟢 Mitigated for admin roles | Backend gate in `auth-middleware.validateAccessToken` (Tier 2, Task #70) — `tenant_admin` and `platform_admin` roles MUST present an `aal2` (MFA-verified) JWT or get `403 MFA_REQUIRED`. Default-off via `MFA_ENFORCEMENT_ENABLED` env so a fresh deploy doesn't lock anyone out — operator flips after every admin enrols at `/pages/mfa-enroll.html`. Frontend `api-client.js` auto-redirects on `MFA_REQUIRED`. `mfa_required` added to `AccessDenialReason` enum so the L-05 dashboard catches the signal. Clinician + assistant_staff MFA mandate left as Tier 4 (controller policy choice + EXT-LEGAL DPA term) |
| L-10 | Patient-subject-facing breach-notification channel (Art.34) | 🔵 Architectural + ⚪ EXT-LEGAL | `docs/32-EXT-LEGAL-TEMPLATES.md §5` documents the architectural decision: Uelfy (processor) does NOT maintain a patient-facing comm channel; the controller uses its own existing patient registry. Uelfy supplies the breach evidence pack within the 24-hour processor SLA. Patient-letter template is counsel/controller-side |

---

## Section E — Clinical risks (per project rule: formula intact)

| ID | Title | Status | Notes |
|---|---|---|---|
| C-01 | Score module thrown error swallowed silently by orchestrator | ✅ Resolved | Orchestrator wraps in try/catch but surfaces a typed skip; eligibility evaluator routes around defensive throws |
| C-02 | Composite "low risk" inferred from skipped scores | ✅ Resolved | `indeterminate` band added (migration 006) |
| C-03 | Decision-support framing eroded over time | 🔵 Architectural | Vigilant — every UI / PDF / API surface reviewed pre-merge per `25-MDR-READINESS.md §11` |
| C-04 | Out-of-range input extrapolation | 🟢 Mitigated | `score2-eligibility.ts` + per-module guards; validated domain enforced |
| C-05 | PREDIMED double-implementation drift | ✅ Resolved | Single source in `nutrition-engine/predimed.ts`, re-exported (Task #18) |
| C-06 | Critical lab thresholds missing from alert engine | ✅ Resolved | Catalogue in alert-engine + `29-CHANGELOG-CLINICAL.md [2026-04-10.01]` (Task #44) |
| C-07 | FIB-4 cut-off context (HCV-validated) used outside HCV | 🟢 Mitigated | Documented in `24-FORMULA-REGISTRY.md §9`; clinician-side context required (`EXT-CLIN`) |
| C-08 | Paediatric eGFR equation not implemented | 🔵 Architectural | Adult-only by intended use (`21-PRIVACY-TECHNICAL.md §10`) |
| C-09 | AI commentary drifting into authoritative tone | 🔵 Architectural | Off by default; bounded surface; UI labels as secondary; controller opt-in |

---

## Section F — Regulatory / external (EXT register)

These are not engineering risks — they are deliverables owned outside
the codebase. Tracked here for completeness because they gate
production-grade deployment posture.

| ID | Item | Owner | Engineering-side draft |
|---|---|---|---|
| E-01 | Per-tenant DPA template | Counsel + business | ✅ Draft skeleton in `32-EXT-LEGAL-TEMPLATES.md §1` |
| E-02 | Sub-processor list per tenant | Controller | ✅ Engineering-enumerable list in `§2` (Supabase + Vercel + optional Upstash + optional OpenAI) |
| E-03 | Lawful-basis assignment per data category | Controller DPO | ✅ Default matrix in `§6` |
| E-04 | DPIA template (Art.35) | Controller DPO | ✅ Section outline in `§3` with cross-refs to docs |
| E-05 | MDR qualification + classification (Rule 11) | Regulatory consultant + notified body | EXT-MDR — engineering input documented in `25-MDR-READINESS.md §1-3` |
| E-06 | Intended-purpose statement (final) | Manufacturer + consultant | ✅ Refined draft in `32-EXT-LEGAL-TEMPLATES.md §4` |
| E-07 | Risk management file (ISO 14971) | Consultant + engineering | EXT-MDR |
| E-08 | Clinical evaluation report (CER) | Consultant | EXT-MDR — citations in `24-FORMULA-REGISTRY.md` |
| E-09 | QMS (ISO 13485) | Business + consultant | EXT-MDR |
| E-10 | Independent penetration test | Security vendor | EXT-LEGAL |
| E-11 | Tenant-facing IFU | Consultant + product | EXT-MDR |
| E-12 | Supervisory-authority breach-notification template | Counsel | EXT-LEGAL — Uelfy supplies evidence pack per `27-INCIDENT-RESPONSE §5.2` |
| E-13 | Annual restore drill | Operator + controller | ✅ SOP in `33-RESTORE-DRILL-SOP.md` ready to run |

---

## Section G — Risk acceptance summary

| Tier | Open count | Status |
|---|---|---|
| Critical (B-series) | 0 | All 16 closed (15 from initial audit + 1 post-deploy regression resolved by migration 013) |
| High | 14 listed | 0 unresolved; all mitigated, partial, or architectural |
| Medium | 12 listed | All have a documented mitigation or roadmap item |
| Low | 10 listed | All on roadmap |
| Clinical | 9 listed | All resolved, mitigated, or architectural |
| EXT | 13 listed | Owned outside engineering |

**Engineering-side residual risk for production launch:** the 12 Medium
items + 10 Low items. None are blockers. All are documented with
mitigation plans.

**Controller-side residual risk for production launch:** the EXT
register (Section F). These are typically resolved per-tenant during
the contracting / DPA phase.

---

## Section H — Change-control on this register

- This register is updated:
  - At every Phase boundary (Phases 0–9 done → next phase plan).
  - Whenever a new vulnerability or finding lands.
  - Whenever a roadmapped item ships.
- Each row links to a doc cross-reference for traceability.
- No row is silently dropped — items move to "✅ Resolved" with the
  resolving migration / commit / doc reference, and stay visible.

---

**Cross-references**

- `20-SECURITY.md` — security architecture.
- `21-PRIVACY-TECHNICAL.md` — privacy by design.
- `22-GDPR-READINESS.md` — Article-by-article readiness.
- `25-MDR-READINESS.md` — MDR / IEC 62304 posture.
- `27-INCIDENT-RESPONSE.md` — incident playbook.
- `28-TESTING-STRATEGY.md` — test posture and gaps.
- `31-LAUNCH-CHECKLIST.md` — gating checklist for production launch.
