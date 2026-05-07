# Uelfy Clinical — Deletion, Anonymization & Retention Policy

**Status:** Authoritative reference for how patient and assessment data are
removed, anonymized, retained, and (under GDPR Art. 15 / 17 / 20) returned to
the data subject. This document complements:

- `supabase/migrations/003_retention_anonymization_snapshot.sql` (DB-side
  `fn_retention_prune()` + `fn_anonymize_patient()` functions)
- `api/v1/internal/retention.ts` and `api/v1/internal/anonymize.ts` (HTTP cron
  entry points, scheduled by Vercel cron in `vercel.json`)
- `api/v1/patients/[id]/export.ts` (Art. 15 / 20 patient data portability)
- `docs/10-SECURITY-GDPR-CHECKLIST.md` (control matrix)

This file is intentionally short and operational, not legal counsel. Local
counsel must approve concrete retention windows before production rollout in
each jurisdiction.

---

## 1. Retention timeline (default policy, configurable per tenant)

| Data class | Default live retention | Action after expiry | Source |
|---|---|---|---|
| Patient demographics (`patients`) | While clinically active OR until subject revokes consent | Soft-delete (`deleted_at`) → 30-day grace → `fn_anonymize_patient()` | 003 migration |
| Assessment header (`assessments`) | 10 years from `created_at` (medical record default) | Anonymize: drop `clinical_input_snapshot` PHI fields, retain ID + `engine_version` for clinical lineage | 003 migration |
| Score results (`score_results`) | 10 years | Retain in anonymized form (no PHI) | 003 migration |
| Lifestyle snapshots | 5 years | Hard delete | 003 migration |
| Followup plans | 5 years | Hard delete | 003 migration |
| Alerts (`alerts`) | 2 years from `resolved_at` / `dismissed_at` | Hard delete | retention cron |
| Report exports (`report_exports`) | 1 year from `created_at` | Hard delete row + Storage object (`clinical-reports` bucket) | retention cron |
| Audit events `auth.*` category (`audit_events WHERE action LIKE 'auth.%'`) | **180 days** (security observability) | Hard delete via `fn_retention_prune` daily cron | 018 migration |
| Audit events default category (`audit_events WHERE action NOT LIKE 'auth.%'`) | **10 years** (medical-legal default) | Hard delete via `fn_retention_prune` daily cron | 018 migration (was 015) |
| Consent records (`consent_records`) | Forever (append-only history) | Never deleted; revocation is a new row with `granted=false` | 001 migration |
| Auth users (`auth.users`) | While the linked `public.users` row exists | On hard tenant offboarding: anonymize email + revoke session | manual |

`fn_retention_prune()` is invoked daily at 03:00 UTC by the Vercel cron
schedule `0 3 * * *`. `fn_anonymize_patient()` is invoked daily at 04:00 UTC
by `0 4 * * *`. Both are idempotent and safe to re-run.

### 1.1 Audit events retention by category (Sprint 3 task 3.3)

`audit_events` rows are split into TWO retention categories inside
`fn_retention_prune` (migration 018):

| Category | Action pattern | Default retention | Per-tenant override behaviour | Legal / standards basis |
|---|---|---|---|---|
| **Security** | `action LIKE 'auth.%'` (login, logout, failed_login) | **180 days** | `LEAST(tenants.retention_days_audit, 180)` — global override tightens but never widens this | NIS2 Annex II §4 incident-detection logs ~6 months · ISO 27001 A.8.15 logging · CERT-EU baseline · GDPR Art.5(1)(e) storage limitation |
| **Default** | everything else (`patient.*`, `assessment.*`, `consent.*`, `dsr.*`, `admin.*`, `system.*`, `report.*`, `retention.*`, `anonymize.*`, etc.) | **10 years** (3650 days) | `tenants.retention_days_audit` (range 30–3650) | Italian medical-deontological code (cartella clinica ≥10 years from last access) · GDPR Art.30 records of processing · Art.9(2)(h) healthcare provision basis |

Why split rather than uniform 10y for everything?

* `auth.*` events are **security observability artefacts**, not clinical
  records. Their forensic value drops sharply after the
  incident-detection window (typically 6 months). Storing 10 years of
  every login is unjustified under GDPR Art.5(1)(e) (storage
  limitation) and inflates `audit_events` volume by 1-2 orders of
  magnitude relative to the clinical-event stream.
* All other categories carry medical-legal weight (clinical writes,
  consent grants/revokes, DSR fulfilment evidence) and stay at the
  10-year default.

Per-tenant overrides on `tenants.retention_days_audit` continue to
work and apply to the **default** category. For the **security**
category we take `LEAST(override, 180)` so an operator who voluntarily
tightens the global window does NOT see their tighter setting widened
back up by the security floor.

If a future controller asks for category-specific overrides (e.g.
"keep auth events for 1 year for compliance with sector-specific
guidance"), add `tenants.retention_days_audit_security` in a follow-up
migration.

---

## 2. Soft delete vs. anonymization vs. hard delete

The codebase distinguishes three distinct lifecycle states. Application
handlers must respect them:

1. **Soft delete** — `deleted_at IS NOT NULL`. Row is excluded from all
   non-admin reads via the standard `.is('deleted_at', null)` filter applied
   in `api/v1/patients/index.ts` and `[id]/index.ts`. Reversible during the
   30-day grace window.
2. **Anonymization** — `anonymized_at IS NOT NULL`. PHI columns (names,
   contact info, free-text notes, raw clinical inputs) are nulled by
   `fn_anonymize_patient()`. The row itself is preserved so longitudinal
   aggregate analytics and audit trails remain consistent.
3. **Hard delete** — Row is removed from the table. Used only for ephemeral
   data classes (alerts, report exports, lifestyle snapshots) where
   retention beyond the policy window has no clinical or legal value.

Audit events are NEVER soft-deleted, anonymized at the application layer, or
hard-deleted. They are insert-only.

---

## 3. Subject Access Request (Art. 15) and Data Portability (Art. 20)

A patient (or a clinician acting on behalf of the patient under documented
authority) can request a portable export via:

```
GET /api/v1/patients/{patientId}/export
```

The handler in `api/v1/patients/[id]/export.ts`:

- Verifies the caller is `tenant_admin`, the linked clinician (via
  `professional_patient_links`), or the patient's own portal user
  (`portal_user_id`).
- Returns a JSON document with: demographics, consent history,
  clinical_input_snapshot of every assessment, score_results, alerts,
  report_exports metadata, audit trail of subject's own actions.
- Records an `audit_events` row with `action = 'patient.export'` and
  `metadata.legal_basis = 'gdpr_art_15'`.

The patient's PDF reports remain accessible via short-lived signed URLs from
the `clinical-reports` Supabase Storage bucket (TTL controlled by
`CLINICAL_REPORTS_SIGNED_URL_TTL`).

---

## 4. Subject Erasure (Art. 17)

A patient erasure request triggers, in order:

1. Tenant admin calls `DELETE /api/v1/patients/{patientId}` → sets
   `deleted_at = NOW()` and `consent_status = 'revoked'`.
2. The 30-day grace window allows reversal in case of operational error.
3. `fn_anonymize_patient()` runs at the next nightly window after the
   grace expires and anonymizes all linked PHI as described in §2.
4. Dependent rows (alerts, report exports, lifestyle snapshots) reach their
   own hard-delete window over time and are pruned.

If the legal basis for retention is medical-record law (e.g., 10-year
clinical retention requirement under the operating jurisdiction), the
clinical_input_snapshot is anonymized but the assessment header (id,
engine_version, computed score categories) is preserved. This must be
documented in the consent record and surfaced in the export.

---

## 5. Operational responsibilities

| Responsibility | Owner |
|---|---|
| Setting jurisdiction-specific retention windows in `tenants.retention_overrides` | Tenant admin during onboarding |
| Monitoring nightly cron success | Platform operator (Vercel Insights) |
| Reviewing failed anonymization rows | Platform operator (logged in `audit_events`) |
| Publishing the privacy policy that this technical policy supports | Tenant DPO / Customer counsel |

---

## 6. Verification checklist

Before any production release that touches patient lifecycle code, run:

- [ ] `npm run typecheck` — green
- [ ] `npm test -- backend/tests/services/assessment-service.spec.ts` — green
- [ ] Manual: soft-delete a test patient, observe filter in `/api/v1/patients`
- [ ] Manual: invoke `/api/v1/internal/retention` once, observe rows pruned
- [ ] Manual: invoke `/api/v1/internal/anonymize` once, observe PHI cleared
- [ ] `audit_events` shows the corresponding `system.retention.run` /
  `system.anonymize.run` rows
