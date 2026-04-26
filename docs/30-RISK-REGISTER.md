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

**Critical-blocker count remaining: 0.**

---

## Section B — High risks (post-remediation status)

| ID | Title | Status | Notes |
|---|---|---|---|
| H-01 | RLS regression undetected (no Postgres-side test) | 🟡 Partial | Hardened by migration 010 + code review; automated policy-level test on Phase 9 roadmap (`28-TESTING-STRATEGY.md §6`) |
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
| M-01 | Rate limiter is in-memory only (no horizontal coordination) | 🟡 Partial | Upstash integration ready behind env-var; deploy is single-region single-function so impact is bounded today |
| M-02 | Tenant-admin UI for retention overrides incomplete | 🟡 Partial | Schema columns + cron honour them; UI partial (`21-PRIVACY-TECHNICAL.md §13`) |
| M-03 | No SBOM export for SOUP inventory (IEC 62304 §5.1) | 🟡 Partial | `package.json` + lockfile present; formal SBOM `EXT-MDR` |
| M-04 | No public security.txt / vulnerability-disclosure policy | 🟡 Partial | On the operator roadmap (`25-MDR-READINESS.md §8`) |
| M-05 | Backup-restore drill not automated (Art.32(1)(d)) | 🟡 Partial | Supabase PITR is platform-managed; controller-side annual drill `EXT-LEGAL` |
| M-06 | Per-tenant KMS envelope for `clinical_input_snapshot` | 🟡 Partial | Platform-managed AES-256 today; per-tenant KMS on roadmap |
| M-07 | PDF visual-regression test absent | 🟡 Partial | Manual smoke test; no headless renderer in CI |
| M-08 | Mutation testing not configured | 🔵 Roadmap | Stryker integration would harden the equivalence test surface |
| M-09 | Audit query UI for tenant_admin partial | 🟡 Partial | Admin endpoint `/api/v1/admin/audit` exists; UI surface partial |
| M-10 | DSR end-to-end automated test absent | 🟡 Partial | Manual test passed; full state-machine integration test on roadmap; per-transition strict-audit propagation already covered indirectly via `unit/audit-logger.test.ts` (Phase 9) |
| M-11 | Cron handler signing-secret automated test absent | ✅ Resolved | `tests/unit/cron-auth.test.ts` (Phase 9) — 14 cases covering secret hygiene, bearer compare, Vercel header gate, opaque deny |
| M-12 | Multi-tenant cross-read negative test absent | 🟡 Partial | Mitigated by RLS + endpoint code review; explicit Postgres-side negative test on roadmap |
| M-13 | Composite-risk "silence is not safety" invariant unprotected by automated test | ✅ Resolved | `tests/unit/composite-risk.test.ts` (Phase 9) — locks in indeterminate-band semantics (C-02) and out-of-range truthful skip reasoning (H-05) |

---

## Section D — Low / hardening opportunities

| ID | Title | Status |
|---|---|---|
| L-01 | Per-tenant engine-version pinning (controller can defer a bump) | 🔵 Roadmap |
| L-02 | Engine-version diff report | 🔵 Roadmap |
| L-03 | Backfill recompute job (legacy assessments under new engine, retaining historical row) | 🔵 Roadmap |
| L-04 | Automated alert on `AUDIT_WRITE_FAILED` log lines | 🔵 Roadmap |
| L-05 | Automated alert on RLS-denial spikes | 🔵 Roadmap |
| L-06 | Linter-enforced ban on `Math.random()` / `Date.now()` inside `backend/src/domain/clinical/` | 🔵 Roadmap |
| L-07 | Per-score code-coverage report (informational, not gating) | 🔵 Roadmap |
| L-08 | Frontend bundle-size budget enforcement | 🔵 Roadmap |
| L-09 | MFA required for all clinician roles (currently MFA-supported, not MFA-mandatory) | 🔵 Roadmap (controller policy `EXT-LEGAL`) |
| L-10 | Patient-subject-facing breach-notification channel (Art.34) | ⚪ EXT-LEGAL |

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

| ID | Item | Owner |
|---|---|---|
| E-01 | Per-tenant DPA template | Counsel + business |
| E-02 | Sub-processor list per tenant | Controller |
| E-03 | Lawful-basis assignment per data category | Controller DPO |
| E-04 | DPIA template (Art.35) | Controller DPO |
| E-05 | MDR qualification + classification (Rule 11) | Regulatory consultant + notified body |
| E-06 | Intended-purpose statement (final) | Manufacturer + consultant |
| E-07 | Risk management file (ISO 14971) | Consultant + engineering |
| E-08 | Clinical evaluation report (CER) | Consultant |
| E-09 | QMS (ISO 13485) | Business + consultant |
| E-10 | Independent penetration test | Security vendor |
| E-11 | Tenant-facing IFU | Consultant + product |
| E-12 | Supervisory-authority breach-notification template | Counsel |
| E-13 | Annual restore drill | Operator + controller |

---

## Section G — Risk acceptance summary

| Tier | Open count | Status |
|---|---|---|
| Critical (B-series) | 0 | All 15 closed |
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
