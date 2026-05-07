# Uelfy Clinical — DSR Workflow Audit (GDPR Art.12-22)

> **Scope.** Sprint 3 task 3.1 — gap analysis of the current Data Subject
> Request (DSR) implementation against GDPR Articles 12-22 (transparency,
> access, rectification, erasure, restriction, portability, objection).
> Output is a per-Article status table + remediation plan that informs
> Sprint 3 tasks 3.2-3.7.
>
> **Audience.** Founder + future DPO. Audit-trail evidence for
> data-protection authority (Garante Privacy in Italy) and B2B clinical
> procurement security review.
>
> **Companion docs:**
> - `docs/22-GDPR-READINESS.md` — overall GDPR posture (broader than DSR)
> - `docs/14-DELETION-POLICY.md` — retention / deletion technical spec
> - `docs/21-PRIVACY-TECHNICAL.md` — privacy controls overview
>
> **Status.** Sprint 3 task 3.1 — initial audit + remediation plan.

---

## 1. Current implementation inventory

### Database layer

* **`data_subject_requests` table** (migration 003) — full schema:
  - `id`, `tenant_id`, `subject_patient_id`, `subject_user_id` (UUID FKs)
  - `kind dsr_kind` enum: `access | erasure | portability | rectification`
  - `status dsr_status` enum: `received | in_progress | fulfilled | rejected | cancelled`
  - `requested_by_user_id`, `fulfilled_by_user_id` (audit accountability)
  - `requested_at`, `fulfilled_at`, **`sla_deadline DEFAULT NOW() + INTERVAL '30 days'`** (Art.12(3) hard SLA)
  - `export_storage_path` (private bucket pointer for fulfilled access/portability)
  - `rejection_reason`, `notes` (free-text justification)
* **`fn_anonymize_patient(patient_id, actor_user_id)` RPC** — irreversible
  PII strip on a patient row (called by erasure worker AND by anonymize cron).
* **RLS + FORCE** on `data_subject_requests` (migration 002 + 012).

### API layer

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/api/v1/admin/dsr` | GET | List DSRs scoped to caller's tenant | tenant_admin OR platform_admin |
| `/api/v1/admin/dsr` | POST | File a new DSR | tenant_admin OR platform_admin |
| `/api/v1/admin/dsr/[id]` | GET | Read single DSR | same + tenant scope |
| `/api/v1/admin/dsr/[id]/process` | POST | State machine + worker dispatch | same + MFA-required |

State machine: `received → in_progress → fulfilled / rejected / cancelled`.
Verified by `tests/integration/api-dsr-state-machine.test.ts` (8 tests).

### Worker layer

| DSR kind | Programmatic fulfilment | Status |
|---|---|---|
| `erasure` | `fn_anonymize_patient(...)` RPC | ✅ implemented |
| `access` | JSON manifest STUB uploaded to private bucket | ⚠️ stub only — see gap §3 |
| `portability` | JSON manifest STUB uploaded to private bucket | ⚠️ stub only — see gap §3 |
| `rectification` | none — manual workflow required | ❌ no programmatic path |
| `restriction` (Art.18) | not in `dsr_kind` enum | ❌ enum extension needed |
| `objection` (Art.21) | not in `dsr_kind` enum | ❌ enum extension needed |

### Cron layer

* **`/api/v1/internal/anonymize`** (daily 04:00 UTC) — sweeps soft-deleted
  patients past 30-day grace and runs `fn_anonymize_patient`. Bounded
  `MAX_PER_RUN`. Audit-logged. Idempotent.

### Frontend layer

| Page | Status |
|---|---|
| `legal-privacy.html` | ✅ exists — informativa privacy (target: Sprint 3 task 3.5 update) |
| `dsr-request.html` (subject self-service) | ❌ does NOT exist |
| `admin/dsr-list.html` (admin DSR queue) | ❌ does NOT exist |

### Audit layer

Every DSR transition writes a structured `audit_events` row via
`recordAuditStrict`. Verified.

---

## 2. Per-Article GDPR coverage

| Article | Right | Implementation | Status |
|---|---|---|---|
| **Art.12** | Transparent communication | informativa in `legal-privacy.html` (to update task 3.5) | 🟡 partial |
| **Art.12(3)** | 30-day SLA | `sla_deadline` column DEFAULT 30d; **NO automated alerting if breached** | 🟡 enforcement missing |
| **Art.13/14** | Information at collection | Privacy notice page (to enhance task 3.5) | 🟡 partial |
| **Art.15** | Right of access | API endpoint + state machine ✅; worker outputs **STUB only**, not full PHI export | 🟡 worker incomplete |
| **Art.16** | Rectification | No programmatic path — admin must manually edit in Supabase dashboard | ❌ gap |
| **Art.17** | Erasure ("right to be forgotten") | `fn_anonymize_patient` ✅ + 30d grace cron ✅ | ✅ implemented |
| **Art.18** | Restriction of processing | NOT in enum; no flag mechanism on patient row | ❌ gap |
| **Art.19** | Notification obligation | Not implemented (notify recipients of rectification/erasure) | ❌ gap (low frequency in our model) |
| **Art.20** | Right to portability | API endpoint + state machine ✅; worker outputs **STUB only**, no FHIR/structured format | 🟡 worker incomplete |
| **Art.21** | Right to object | NOT in enum; no UI for subject to opt-out specific processing | ❌ gap |
| **Art.22** | Automated decision-making | N/A — clinical scoring is decision-SUPPORT, not automated decisions per Art.22(1). Documented in `docs/22-GDPR-READINESS.md` | ✅ N/A |

Legend: ✅ done · 🟡 partial · ❌ gap

---

## 3. Gap analysis

### 3.1 Critical gaps (must close before first paying customer)

| Gap | GDPR risk | Sprint 3 task | Effort |
|---|---|---|---|
| **Art.15 access** worker outputs only stub manifest — not the actual PHI | HIGH — failing a real Art.15 request in time invites Garante action | **task 3.6** (FHIR JSON export) | 1g |
| **Art.20 portability** same as Art.15 — stub only | HIGH — same as above | **task 3.6** (single endpoint serves both Art.15 + Art.20) | (incl. above) |
| **Privacy notice** outdated (no DPO contact, no subprocessor list, no granular purpose table) | HIGH — Art.13/14 information is the foundation of consent legitimacy | **task 3.5** | 1g |
| **Granular consent per purpose** — current `consent_records` is binary | MEDIUM — most clinical use is Art.6(1)(c) legal obligation + Art.9(2)(h) healthcare provision, so consent isn't strictly required for core; but research / marketing / secondary use need explicit granular consent | **task 3.2** | 1.5g |

### 3.2 Important gaps (should close in Sprint 3-4)

| Gap | GDPR risk | Path |
|---|---|---|
| **Art.12(3) SLA enforcement** — no alert if DSR open >25 days | MEDIUM — administrative, breach only if SLA missed | Add cron in `api/v1/internal/dsr-sla-check.ts`: scan `data_subject_requests WHERE status IN ('received','in_progress') AND sla_deadline - NOW() < 5 days` → emit `audit_events: dsr.sla.warning` + (future) email DPO. Add to Sprint 4. |
| **Art.18 restriction** — no `is_processing_restricted` flag on patient | MEDIUM — restriction is rare in clinical context but legally available | Schema migration: add `processing_restricted_until TIMESTAMPTZ` to `patients`. Middleware: `assertProcessingNotRestricted(patientId)` called in PHI write endpoints. Defer to Sprint 4. |
| **Art.21 objection** — not in enum, no UI | LOW-MEDIUM — clinical processing has strong legal basis (Art.6(1)(c)+9(2)(h)), so objection is mostly limited to research/marketing | Add `'objection'` to `dsr_kind` enum + UI flow that captures objection and triggers manual review by DPO. Defer to Sprint 4. |
| **Audit log retention per category** — uniform 3650d may be over-retention for low-value events | MEDIUM — Art.5(1)(e) storage limitation principle | **task 3.3** (this Sprint) |

### 3.3 Lower-priority gaps (Sprint 5+ or accept risk)

| Gap | Why deferred |
|---|---|
| **Art.16 rectification** UI workflow | Clinicians already edit patient data via standard `PUT /api/v1/patients/[id]` endpoint with audit logging. Rectification is therefore covered operationally without a separate "Art.16 request" flow. A formal flow with subject-side trigger would be nice for compliance evidence but is operationally redundant. |
| **Art.19 notification** to recipients of rectification/erasure | Our model has no third-party recipients of personal data (Vercel/Supabase/Upstash are processors under Art.28 DPA, not recipients under Art.4(9)). Art.19 obligation does not trigger. |
| **Subject self-service portal** (`dsr-request.html`) | Currently DSR is filed by tenant admin on behalf of subject. For a B2B clinical app where the subject is a patient and the controller is the clinic, this is the standard GDPR model (the clinic IS the controller, not the platform). Patient self-service is a "nice to have" for transparency but not strictly required. |

---

## 4. Remediation plan (Sprint 3 only — Sprint 4 follow-ups noted)

| Task | Closes | Sprint |
|---|---|---|
| **3.2** Granular consent per purpose | Art.7 + Art.13 information accuracy | Sprint 3 |
| **3.3** Audit log retention per category | Art.5(1)(e) storage limitation | Sprint 3 |
| **3.4** DPIA scaffold | Art.35 obligation | Sprint 3 |
| **3.5** Privacy notice update | Art.13/14 transparency | Sprint 3 |
| **3.6** FHIR JSON export | Art.15 access + Art.20 portability (worker, not stub) | Sprint 3 |
| **3.7** Sprint 3 changelog + checklist | docs hygiene | Sprint 3 |
| (next Sprint) Art.12(3) SLA enforcement cron | Art.12(3) | Sprint 4 |
| (next Sprint) Art.18 restriction flag | Art.18 | Sprint 4 |
| (next Sprint) Art.21 objection enum + flow | Art.21 | Sprint 4 |

---

## 5. Audit findings cross-reference

External-AI audit finding F-010 ("DSR workflow incompleto: export sì,
deletion parziale, anonymize separato"):

* "export sì" — partially correct: API surface + state machine exist, but
  worker outputs only a stub manifest, not the actual PHI → **closing
  via task 3.6**.
* "deletion parziale" — partial truth: erasure runs `fn_anonymize_patient`
  but only on already soft-deleted patients (cron-triggered). A direct
  Art.17 request via DSR endpoint correctly cascades. The "parziale"
  perception was likely because the AI saw the cron flow as separate
  from the DSR flow — they ARE separate by design (one is on-demand,
  one is scheduled), but both end up calling the same RPC.
* "anonymize separato" — correct observation: anonymization has both
  on-demand (DSR) and scheduled (cron) paths. This is intentional
  defence-in-depth, not a bug. Documented above.

Status: **F-010 is being closed across Sprint 3 tasks 3.5 + 3.6**. The
remaining "true gaps" (Art.16 rectification, Art.18 restriction, Art.21
objection) are explicitly deferred to Sprint 4 with rationale.

---

## 6. Document history

| Date | Change | Author |
|---|---|---|
| 2026-05-07 | Initial audit (Sprint 3 task 3.1) | founder + AI pair |
