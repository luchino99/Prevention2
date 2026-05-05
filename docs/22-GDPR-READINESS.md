# Uelfy Clinical — GDPR Readiness (Article-by-Article)

> **Scope.** Per-Article readiness assessment, mapped to the actual code,
> migrations, endpoints, and runtime behaviour. Companion to
> `20-SECURITY.md`, `21-PRIVACY-TECHNICAL.md`, `14-DELETION-POLICY.md`,
> `27-INCIDENT-RESPONSE.md`.
>
> **Audience.** DPOs, controller legal/compliance teams, security
> assessors.
>
> **What this is not.** A legal opinion. Items marked `EXT-LEGAL` require
> sign-off by the controller's counsel. The platform implements technical
> measures that *support* GDPR-aligned operation; the controller (the
> tenant clinic) remains accountable for the lawful-basis assignment,
> retention overrides, sub-processor approval, DPIA, and DPA.
>
> **Status legend.**
>
> | Marker | Meaning |
> |---|---|
> | ✅ | Implemented in code today, with file references. |
> | 🟡 | Partial — implemented but with documented gaps. |
> | 🔵 | Architectural — supported by design but requires controller config. |
> | ⚪ `EXT-LEGAL` | Outside this codebase — controller / counsel responsibility. |

---

## Article 5 — Principles relating to processing

### 5(1)(a) Lawfulness, fairness, transparency

**Status.** 🔵 Architectural + ⚪ `EXT-LEGAL`.

The platform exposes a `consent_records` table (migration 001), a
typed-action audit trail (`audit_events`), and a privacy-notice surface
(`/legal/privacy`). The controller is responsible for the substantive
lawful-basis assignment per data category per tenant.

### 5(1)(b) Purpose limitation

**Status.** ✅.

- Each persistence table has a single declared purpose (see
  `21-PRIVACY-TECHNICAL.md §4`).
- `consent_records.purpose` carries the per-purpose declaration.
- Audit metadata is allowlist-sanitised (`audit-logger.ts`
  `sanitizeMetadata`) — there is no free-form bag for cross-purpose data.

### 5(1)(c) Data minimisation

**Status.** ✅.

- Engine input is a typed Zod snapshot (`AssessmentInput`); extra fields
  are stripped, not stored.
- Audit logger captures hashed IP + truncated UA only.
- Failed-login telemetry captures **email domain only**, not the full
  email (`recordFailedLogin` in `audit-logger.ts`).
- No third-party enrichment.

### 5(1)(d) Accuracy

**Status.** ✅ for technical mechanism, 🔵 for clinical content.

- `PATCH /api/v1/patients/[id]` and `PATCH /api/v1/assessments/[id]`
  exist for rectification with full audit.
- Substantive accuracy of the clinical record is the clinician's
  responsibility (out of scope for the platform).

### 5(1)(e) Storage limitation

**Status.** ✅ default, 🔵 per-tenant overrides.

Implemented via two cron functions:

- `fn_anonymize_patient()` (migration 003) — soft-deleted patients past
  30-day grace are anonymised, not hard-deleted, preserving clinical
  scalars without identifiers.
- `fn_retention_prune()` — prunes audit/notification rows past per-tenant
  retention windows.

Cron paths: `/api/v1/internal/anonymize` (`0 4 * * *`) and
`/api/v1/internal/retention` (`0 3 * * *`), both gated by
`CRON_SIGNING_SECRET`.

Per-tenant override columns exist on `tenants` (`retention_days_*`); the
admin UI for tenant_admin to edit them is partial — see open items.

### 5(1)(f) Integrity & confidentiality

**Status.** ✅. See `20-SECURITY.md §3` (auth), §4 (RBAC + RLS), §5 (TLS,
encryption-at-rest via Supabase platform AES-256), §10 (rate limiting),
§11 (threat model).

### 5(2) Accountability

**Status.** ✅.

- Every CRUD on patients, assessments, consents, reports, alerts, and
  DSR transitions writes to `audit_events`.
- Privacy-significant writes use the strict variant (`recordAuditStrict`,
  B-09) — a failed audit row aborts the request with
  `AUDIT_WRITE_FAILED`.
- Every schema change is a numbered SQL migration.
- Doc pack (this file + `20-`, `21-`, `26-`, `27-`) is the human-readable
  surface of accountability.

---

## Article 6 — Lawfulness of processing

**Status.** 🔵 + ⚪ `EXT-LEGAL`.

The default basis assignments are in `21-PRIVACY-TECHNICAL.md §2`. The
platform supports:

- Art.6(1)(b) contract — clinician account, patient enrolment.
- Art.6(1)(c) legal obligation — medical-record retention, DSR fulfilment.
- Art.6(1)(f) legitimate interest — security telemetry (audit IP hashes).

For Art.9 health data the platform anchors on Art.9(2)(h) (healthcare).
The controller (tenant clinic) confirms the basis per data category.

---

## Article 7 — Conditions for consent

**Status.** ✅ for the recording mechanism.

- `consent_records` table (migration 001) — append-only event log with
  `granted` boolean, `policy_version`, `consent_text_hash`, `granted_at`,
  `revoked_at`, `purpose`, `lawful_basis`.
- `POST /api/v1/consents` writes a new row; revoke writes a new row with
  `granted=false` (immutable history per Art.7(1)).
- Policy version is recorded so a withdrawal can be linked to the exact
  text the subject had agreed to.
- `recordAuditStrict` is used for grant **and** revoke so the audit trail
  cannot silently drop a consent decision.

⚪ `EXT-LEGAL`: the actual policy text and translations belong to the
controller.

---

## Article 8 — Children's consent

**Status.** 🔵 Architectural + ⚪ `EXT-LEGAL`. Default scope: adult
patients.

See `21-PRIVACY-TECHNICAL.md §10`. If a tenant opts to onboard
paediatric patients, the controller must verify parental consent and
configure tenant retention windows accordingly. The platform does not
implement age-gating at sign-up because the patient does not self-sign.

---

## Article 9 — Special categories of personal data

**Status.** ✅ technical, 🔵 controller posture.

All clinical data is treated as Art.9 special-category from the outset:

- Encryption at rest (Supabase AES-256 platform-managed; per-tenant KMS
  envelope on the roadmap — see `21-PRIVACY-TECHNICAL.md §13`).
- TLS 1.2+ in transit (managed by Vercel).
- RLS forces tenant + PPL relationship gating on every read/write
  (migrations 002 + 005).
- Audit logging of read/write (`audit_events`).
- Default lawful basis: Art.9(2)(h) healthcare; the controller confirms.

---

## Article 12 — Transparent information & modalities

**Status.** ✅ for the technical surface.

- `/legal/privacy` page in the frontend.
- DSR ledger (`data_subject_requests`) tracks `requested_at`,
  `sla_deadline` (`requested_at + 30 days`), and the lifecycle state
  machine (`api/v1/admin/dsr/[id]/process.ts`).
- Operational SLA: 30 days, surfaced in admin dashboard.

⚪ `EXT-LEGAL`: privacy-notice prose belongs to the controller.

---

## Articles 13 / 14 — Information to data subjects

**Status.** 🔵 Architectural + ⚪ `EXT-LEGAL`.

- The privacy notice in onboarding lists data categories, purposes,
  retention windows (defaults), recipients/sub-processors, and rights
  (Art.13(1)/(2)).
- For Art.14 (data not obtained directly from the subject — typically a
  referral), the controller's intake workflow is responsible for
  supplying the notice.

---

## Article 15 — Right of access

**Status.** ✅.

- Endpoint: `GET /api/v1/patients/[id]/export`.
- Returns a JSON envelope with patient profile, clinical profiles,
  assessments, score results, alerts, follow-up plans, lifestyle
  snapshots, consents, and (sanitised) audit events visible to the
  subject.
- Audit IP hashes are kept server-side only — not handed back.
- Action `patient.export` is logged via `recordAuditStrict`.

---

## Article 16 — Rectification

**Status.** ✅.

- `PATCH /api/v1/patients/[id]` and `PATCH /api/v1/assessments/[id]`.
- Each PATCH is audit-logged with the action `patient.update` /
  `assessment.update`.
- DSR kind `rectification` exists in the ledger for subject-initiated
  requests routed through the controller.

---

## Article 17 — Right to erasure

**Status.** ✅ via soft-delete + grace + anonymisation.

- `DELETE /api/v1/patients/[id]` performs **soft-delete**: sets
  `deleted_at`, removes from active queries, audit-logged via
  `recordAuditStrict` as `patient.delete`.
- After 30-day grace, `fn_anonymize_patient()` (migration 003)
  irreversibly strips identifiers; clinical scalars are retained for
  cohort statistics.
- Grace window is per-tenant configurable via
  `tenants.retention_grace_days`; default 30.
- ⚠️ Note for controllers: anonymisation is preferred over deletion to
  preserve clinical lineage. If the subject demands hard deletion, the
  controller must escalate via DSR `kind=erasure_hard` (currently
  `EXT-LEGAL` — manual procedure).

---

## Article 18 — Restriction of processing

**Status.** ✅.

- DSR ledger supports `kind=restriction` with state-machine tracking.
- Soft-delete already removes the row from active processing surfaces;
  restriction is a stronger admin-flagged state distinct from delete.
- Audit actions `dsr.start`, `dsr.fulfill`, `dsr.reject`, `dsr.cancel`
  are logged via `recordAuditStrict`.

---

## Article 20 — Portability

**Status.** ✅.

Same export endpoint as Art.15 (`GET /api/v1/patients/[id]/export`).
Output is structured JSON suitable for re-ingestion (no PDFs, no
opaque blobs). Score outputs include `engine_version` so the recipient
can correlate with a published formula registry.

---

## Article 21 — Right to object

**Status.** ✅ ledger + controller workflow.

- DSR ledger supports `kind=objection` — the controller decides whether
  the objection prevails over the legitimate-interest basis (typically
  for analytics/legitimate-interest processing). Decision recorded in
  the ledger with `recordAuditStrict`.
- For the platform's main processing (clinical care under Art.9(2)(h)),
  Art.21(1) does not apply (Art.21 covers Art.6(1)(e)/(f) only).

---

## Article 22 — Automated individual decision-making

**Status.** ✅ Architectural — engine is decision-support, not decision.

- Score outputs are presented to the clinician with the explicit framing
  "decision support". The clinician is the human-in-the-loop.
- No endpoint denies or grants care without human action.
- No optional AI commentary (off by default — see
  `21-PRIVACY-TECHNICAL.md §11`) is allowed to alter the deterministic
  score output.

---

## Article 25 — Data protection by design & default

**Status.** ✅.

See `21-PRIVACY-TECHNICAL.md` (the technical privacy-by-design view).
Highlights: Zod-strict schemas (data minimisation), single-purpose
tables (purpose limitation), allowlist audit metadata (no PHI leakage),
per-tenant retention windows (storage limitation), pseudonymous internal
identifiers (UUIDs), IP hashing, RLS-by-default for every PHI table.

---

## Article 28 — Processor obligations

**Status.** ⚪ `EXT-LEGAL` for the contract; ✅ for the technical
preconditions.

- DPA template — controller-facing — is `EXT-LEGAL`.
- Sub-processor list — `EXT-LEGAL`. The platform's runtime
  sub-processors are listed in `21-PRIVACY-TECHNICAL.md §11`.
- Technical preconditions met by Uelfy:
  - Separate environments (preview / production).
  - Audit log of every processing action.
  - Breach playbook (`27-INCIDENT-RESPONSE.md`).
  - Sub-processor change-control via the changelog and migration
    pipeline.

---

## Article 30 — Records of processing activities

**Status.** ✅ system records, ⚪ `EXT-LEGAL` controller-side ROPA.

- The platform side: `audit_events` table is the authoritative
  per-action record. Retention default 7 years (medical-record
  alignment); per-tenant configurable via `tenants.retention_days_audit`.
- The controller-side ROPA (categories of subjects, recipients, transfers,
  retention) is `EXT-LEGAL` — Uelfy supplies the inputs (sub-processor
  list, default retention windows, technical/organisational measures).

---

## Article 32 — Security of processing

**Status.** ✅. Full mapping in `20-SECURITY.md`.

| Art.32(1) measure | Implementation |
|---|---|
| Pseudonymisation & encryption | UUIDs internally; AES-256 at rest; TLS 1.2+ in transit; `fn_anonymize_patient()` for irreversible pseudonymisation |
| Confidentiality, integrity, availability | RLS + RBAC + PPL relationship gates; `audit_events` integrity log; cron-driven retention |
| Restore capability | Supabase point-in-time recovery (platform-managed); backup verification on the roadmap |
| Regular testing | Vitest suite (engine determinism, score golden vectors); manual pentest cadence is `EXT-LEGAL` |

---

## Article 33 — Notification to supervisory authority

**Status.** ✅ playbook, 🔵 reporting workflow.

See `27-INCIDENT-RESPONSE.md`:

- Detection signals: failed-audit-write spikes
  (`AUDIT_WRITE_FAILED` log lines), anomalous deletion volume, RLS
  violations (logged at the DB layer).
- 72-hour clock starts from controller awareness (Art.33(1)).
- Notification template: ⚪ `EXT-LEGAL`.

---

## Article 34 — Notification to data subject

**Status.** 🔵 Architectural + ⚪ `EXT-LEGAL`.

- Communication channel: email via the controller's existing patient
  channel (the platform does not currently send patient-facing email).
- Threshold ("high risk") is the controller's call.

---

## Article 35 — Data Protection Impact Assessment (DPIA)

**Status.** ⚪ `EXT-LEGAL` — required for large-scale Art.9 processing.

The platform supplies the technical inputs (data flows, retention,
sub-processors, security controls). The substantive DPIA is the
controller's deliverable. Particularly required when:

- Onboarding paediatric or large-cohort tenants.
- Enabling optional AI commentary (off by default).
- Cross-border processing to non-EU sub-processors.

---

## Article 44 — Cross-border transfers

**Status.** ✅ default EU-only, ⚪ `EXT-LEGAL` for opt-out.

- Default: Vercel + Supabase EU regions.
- No analytics/CDN traffic from the clinical UI (zero third-party scripts
  beyond the Supabase SDK).
- Fonts bundled at build time — no Google Fonts CDN runtime call.
- Non-EU deployment requires `EXT-LEGAL` Transfer Impact Assessment +
  SCCs.

---

## Cross-cutting capabilities matrix

| Capability | Where it lives | Audit action(s) |
|---|---|---|
| Subject access | `GET /api/v1/patients/[id]/export` | `patient.export` |
| Subject portability | same endpoint | `patient.export` |
| Erasure (soft + anonymise) | `DELETE /api/v1/patients/[id]` + cron `fn_anonymize_patient` | `patient.delete` |
| Rectification | `PATCH /api/v1/patients/[id]` etc. | `patient.update`, `assessment.update` |
| Restriction | DSR ledger | `dsr.start` → `dsr.fulfill` |
| Objection | DSR ledger | `dsr.start` → `dsr.fulfill` / `dsr.reject` |
| Consent grant | `POST /api/v1/consents` | `consent.grant` (strict) |
| Consent revoke | `POST /api/v1/consents` (with `granted=false`) | `consent.revoke` (strict) |
| DSR lifecycle | `api/v1/admin/dsr/*` | `dsr.create`, `dsr.start`, `dsr.fulfill`, `dsr.reject`, `dsr.cancel` (all strict) |
| Audit query | `GET /api/v1/admin/audit` (admin-gated) | n/a — read endpoint |

---

## Open items / EXT-LEGAL register

| Item | Owner | Status |
|---|---|---|
| Per-tenant DPA template | Controller counsel + Uelfy legal | EXT-LEGAL |
| Sub-processor list per tenant | Controller | EXT-LEGAL |
| Lawful-basis assignment per category | Controller DPO | EXT-LEGAL |
| DPIA template (Art.35) | Controller DPO | EXT-LEGAL |
| Hard-deletion procedure (Art.17 escalation beyond anonymisation) | Manual SOP | Open — currently a manual admin procedure |
| Tenant-admin UI for retention overrides | Engineering | Partial (admin pages exist, full RBAC for tenant-scoped retention edits is on the roadmap) |
| Per-tenant KMS envelope for `clinical_input_snapshot` | Engineering | Roadmap |
| Patient-subject-facing breach notification channel (Art.34) | Controller | EXT-LEGAL — uses controller's existing patient channel |
| TIA + SCCs for non-EU deployment | Controller counsel | EXT-LEGAL — opt-out path |
| Backup-restoration drills (Art.32(1)(d)) | Engineering | Roadmap (Supabase PITR is platform-managed; controller-side restore drill TBD) |

---

## Verification posture

This document is verifiable against the codebase as follows:

| Claim | How to verify |
|---|---|
| RLS enforces tenant + PPL on patient reads | `supabase/migrations/002_rls_policies.sql` + `005_professional_patient_links.sql` |
| Strict audit on consent / DSR / patient delete / export / report | `git grep -n recordAuditStrict api/` (7 files) |
| Soft-delete + anonymisation cron | `supabase/migrations/003_retention_anonymization_snapshot.sql` + `api/v1/internal/anonymize.ts` |
| 30-day DSR SLA | `data_subject_requests.sla_deadline` default in migration 001 |
| No raw IP stored | `audit-logger.ts` `buildAuditRow` — `ip_hash` only |
| Engine determinism + decision-support framing | `engine/` — see `23-CLINICAL-ENGINE.md` |

---

**Cross-references**

- `20-SECURITY.md` — security architecture.
- `21-PRIVACY-TECHNICAL.md` — privacy-by-design technical view.
- `14-DELETION-POLICY.md` — full retention/anonymisation matrix.
- `27-INCIDENT-RESPONSE.md` — Art.33/34 breach notification playbook.
- `10-SECURITY-GDPR-CHECKLIST.md` — historical pre-Phase-8 checklist.
