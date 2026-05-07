# Uelfy Clinical — Consent Enforcement Matrix

> **Scope.** Sprint 3 task 3.2 — purpose-based consent enforcement
> design + decision matrix. Defines WHICH operations are gated by
> Art.7 GDPR consent and WHICH proceed under a different legal basis
> (Art.6(1)(c) legal obligation or Art.9(2)(h) healthcare provision).
>
> **Audience.** Founder + future DPO. Reference for any contributor
> adding a new endpoint that touches PHI.
>
> **Companion docs:**
> - `docs/22-GDPR-READINESS.md` — overall GDPR posture
> - `docs/40-DSR-WORKFLOW-AUDIT.md` — Data Subject Request handling
> - `backend/src/middleware/consent-gate.ts` — runtime enforcement
> - `tests/unit/consent-gate.test.ts` — unit coverage of the middleware
>
> **Status.** Sprint 3 task 3.2 — middleware ready, no production
> endpoints currently call it (no opt-in operation exists yet — see §3
> "Application points roadmap"). The middleware is documented and
> shipped now so future endpoints (Sprint 4: notifications, Sprint 5+:
> AI commentary, external clinician sharing) integrate it from day one.

---

## 1. The five `consent_type` enum values + their legal basis

The `consent_records` table (migration 001) carries a per-purpose
consent record per patient. The `consent_type` enum has five values;
each has a different legal basis under GDPR.

| `consent_type` | Legal basis (Art.6 + Art.9) | Enforcement at runtime? |
|---|---|---|
| `health_data_processing` | Art.6(1)(c) legal obligation + Art.9(2)(h) healthcare provision | **NO** — clinical care does not depend on consent |
| `ai_processing` | Art.6(1)(a) consent + Art.9(2)(a) explicit consent | **YES** — opt-in only |
| `notifications` | Art.6(1)(a) consent | **YES** — opt-in only (email/SMS/push) |
| `data_sharing_clinician` | Art.6(1)(a) consent + Art.9(2)(a) explicit consent | **YES** — sharing PHI with external clinicians is opt-in |
| `marketing` | Art.6(1)(a) consent | **YES** — opt-in only |

**Why `health_data_processing` is NOT enforced**: gating clinical
operations on consent would (a) wrongly imply the legal basis is
Art.6(1)(a) instead of Art.9(2)(h), (b) block lawful clinical care
when the patient has not yet completed any consent flow (e.g. emergency
intake), and (c) misrepresent the controller-processor relationship —
the clinic IS the controller obliged by law to provide care.

The four enforceable types share Art.6(1)(a) base — strict opt-in,
revocable at any time per Art.7(3).

---

## 2. Middleware contract

`backend/src/middleware/consent-gate.ts` exports two functions:

### `assertConsentFor(patientId, consentType, context?): Promise<void>`

Throws `ConsentDeniedError` if the latest `consent_records` row for
the (patient, consent_type) pair is missing, has `granted=false`, or
has `revoked_at` set. Throws also on query error (fail-closed).

- `consentType` is constrained to `EnforceableConsentType` at the type
  level — TypeScript prevents accidentally passing `'health_data_processing'`.
- The error has `status=403` and `code='CONSENT_REQUIRED'` for direct
  HTTP mapping in the calling endpoint.
- Every denial emits a structured `CONSENT_DENIED` log with reason
  ∈ `{no_record, not_granted, revoked}` for observability.

### `hasConsentFor(patientId, consentType, context?): Promise<boolean>`

Best-effort variant — returns `false` instead of throwing on denial.
Use when the caller wants to BRANCH on consent state (include vs omit
a field, render vs hide a UI control) rather than gate the whole
operation.

Both functions emit identical structured logs.

### Latest-wins semantics

`consent_records` is **append-only by design** (revoke creates a new
row instead of mutating the granted row — Art.7(1) accountability).
The middleware therefore queries `ORDER BY granted_at DESC LIMIT 1`
and applies its decision to that single latest row. A revoke after a
grant correctly denies; a re-grant after a revoke correctly allows.

---

## 3. Application points roadmap

### 3.1 Currently no enforcement (Sprint 3)

Surveyed every endpoint under `api/v1/`:

| Surface | Operation | Legal basis | Need consent gate? |
|---|---|---|---|
| `/patients/...` (CRUD) | Clinical record management | Art.9(2)(h) | NO |
| `/assessments/...` | Score calculation, risk stratification | Art.9(2)(h) | NO |
| `/alerts/...` | Clinical alerts to clinician | Art.9(2)(h) | NO |
| `/consents/...` | Consent CRUD itself | Art.6(1)(c) (record-keeping for Art.7) | NO |
| `/admin/dsr/...` | DSR fulfilment | Art.6(1)(c) | NO |
| `/internal/retention.ts` | Cron retention sweep | Art.6(1)(c) | NO |
| `/internal/anonymize.ts` | Cron anonymization | Art.17 obligation | NO |
| `/auth/session.ts` | Session validation | Art.6(1)(b) contract | NO |
| `/health.ts` | Operational probe | n/a | NO |
| `/me.ts` | Caller's own profile | Art.6(1)(b) contract | NO |
| `/admin/audit.ts`, `/admin/tenant.ts` | Tenant admin operations | Art.6(1)(c) record-keeping | NO |
| `/patients/[id]/export.ts` | PDF export | Art.9(2)(h) (clinical record) | NO* |

*`/patients/[id]/export.ts` already reads `consent_records` to include
them in the export payload (transparency obligation), but it does NOT
gate the export itself. This is correct: the export is for the patient's
own clinical record, not for sharing with third parties.

**Conclusion: zero application points exist today.** The middleware is
shipped READY but inert — no endpoint imports it. This is intentional
and correct: forcing a consent gate on operations that operate under
Art.9(2)(h) would be both legally wrong AND a UX regression.

### 3.2 Sprint 4 application points

When Sprint 4 introduces operational notifications, the
`/api/v1/internal/notifications-dispatch` worker (or equivalent) MUST
call `assertConsentFor(patientId, 'notifications')` before each send.
Pseudocode:

```ts
import { assertConsentFor, ConsentDeniedError } from '.../consent-gate.js';

for (const job of pendingJobs) {
  try {
    await assertConsentFor(job.patient_id, 'notifications', {
      route: 'cron notifications-dispatch',
    });
    await sendNotification(job);
    await markJobSent(job.id);
  } catch (e) {
    if (e instanceof ConsentDeniedError) {
      await markJobCancelled(job.id, 'consent_revoked');
      continue;
    }
    throw e;
  }
}
```

### 3.3 Sprint 5+ application points

| Future surface | Consent type | Notes |
|---|---|---|
| AI commentary endpoint (e.g. `/api/v1/assessments/[id]/ai-summary`) | `ai_processing` | Bounded supportive AI per project_instructions |
| External clinician share (e.g. `/api/v1/patients/[id]/share`) | `data_sharing_clinician` | Patient referral / second opinion |
| Marketing campaigns endpoint (e.g. `/api/v1/marketing/dispatch`) | `marketing` | Opt-in newsletter / events |

Each of these endpoints MUST call `assertConsentFor` before any
PHI-touching operation, AND log the structured `CONSENT_DENIED` event
on denial (the middleware does this automatically).

---

## 4. Frontend integration (deferred to Sprint 4 / Sprint 5)

A consent management page (`/pages/consent.html`) would let the patient
(or admin acting on their behalf) view current state for each
`consent_type`, grant new ones, or revoke existing ones. Implementation
follows the granular schema already present:

```
GET  /api/v1/consents?patientId=<uuid>          (already exists)
POST /api/v1/consents                            (already exists)
     body: { patientId, consentType, action: 'grant' | 'revoke',
             policyVersion, legalBasis, purpose }
```

The backend is ready. The UI page is a Sprint 4-5 deliverable.

---

## 5. Audit observability

When `assertConsentFor` denies, it emits a structured log line:

```json
{
  "level": "warn",
  "event": "CONSENT_DENIED",
  "patientId": "<uuid>",
  "consentType": "notifications" | "ai_processing" | ...,
  "reason": "no_record" | "not_granted" | "revoked",
  "policyVersion": "1.0.0",
  "actorUserId": "<uuid> | null",
  "route": "<METHOD> <path>",
  "revokedAt": "<iso8601>"   // when reason=revoked
}
```

These events feed the privacy dashboard. A Datadog log monitor
(planned Sprint 6 task) will alert on:

- A burst of `CONSENT_DENIED` from the same `actorUserId` — possible
  enumeration of subjects whose consent state is unknown.
- A burst of `reason=revoked` for a single tenant — possible mass
  revocation event triggered by a privacy notice change requiring
  re-consent.

---

## 6. Test coverage

`tests/unit/consent-gate.test.ts` covers all 4 denial paths + grant
path + best-effort wrapper:

```
✓ exports exactly the 4 enforceable consent types
  (regression guard: health_data_processing must NOT be in the list)
✓ assertConsentFor: does NOT throw on granted+not-revoked
✓ assertConsentFor: throws no_record when no row exists
✓ assertConsentFor: throws not_granted when granted=false
✓ assertConsentFor: throws revoked when revoked_at set
✓ assertConsentFor: throws not_granted on query error (fail-closed)
✓ ConsentDeniedError carries status=403 + code=CONSENT_REQUIRED
✓ hasConsentFor: returns true when granted
✓ hasConsentFor: returns false when no record (no throw)
✓ hasConsentFor: returns false when revoked (no throw)
✓ hasConsentFor: returns false on query error (fail-closed)
```

Total: 11 tests.

---

## 7. External-AI finding F-011 closure

External-AI audit finding F-011: "Consent tracking minimale, no granular
per finalità."

**Status: false positive** — the schema already had a 5-value
`consent_type` enum + per-record `policy_version` + immutable history
(revoke creates a new row). The AI was reading the static zip and did
not see the enum definition in `001_schema_foundation.sql`.

**However, F-011 surfaced a REAL gap** that this Sprint 3 task 3.2
closes: there was no runtime enforcement layer. We now have one
(`backend/src/middleware/consent-gate.ts` + 11 unit tests + this doc).
The middleware is READY for the application points listed in §3.2 and
§3.3 above; today it is correctly inert because no opt-in operation
exists.

---

## 8. Document history

| Date | Change | Author |
|---|---|---|
| 2026-05-07 | Initial version (Sprint 3 task 3.2) | founder + AI pair |
