# Uelfy Clinical — Data Protection Impact Assessment (DPIA)

> **⚠️ This is a TECHNICAL SCAFFOLD, not a completed DPIA.**
>
> This document is the structured starting point for the formal Data
> Protection Impact Assessment required by GDPR Art. 35. It must be
> completed and signed off by:
>
> 1. The data controller (founder + clinic operator) for the description
>    of processing, purposes, and necessity assessment.
> 2. A qualified DPO (internal or external) for the Art. 35(2)
>    consultation, the Art. 35(7)(d) measures-and-safeguards review, and
>    the residual-risk acceptance.
> 3. Italian Garante Privacy if Art. 36 prior consultation is required
>    (only when the residual risk remains high after mitigations).
>
> No production rollout to a real clinic with real patients should occur
> before items 1 and 2 are signed.
>
> **Scope.** Sprint 3 task 3.4 — provides the structure, pre-fills
> sections that are factual (architecture, technical controls, data
> categories), and explicitly leaves blank the sections that require
> legal-counsel + DPO judgment.
>
> **Audience.** Founder, future DPO, future clinic operator (data
> controller), Garante Privacy if consulted.
>
> **Companion docs:**
> - `docs/22-GDPR-READINESS.md` — overall GDPR posture
> - `docs/20-SECURITY.md` — security controls (referenced by §6 below)
> - `docs/14-DELETION-POLICY.md` — retention + erasure technical spec
> - `docs/40-DSR-WORKFLOW-AUDIT.md` — Art. 15-22 fulfilment status
> - `docs/41-CONSENT-ENFORCEMENT.md` — Art. 7 consent matrix
> - `docs/36-SECRETS-ROTATION.md` — rotation runbook
>
> **Status.** Sprint 3 task 3.4 — initial scaffold. Sections marked
> `[TO COMPLETE BY DPO]` or `[TO CONFIRM BY CONTROLLER]` are placeholders.

---

## 0. Document control

| Field | Value |
|---|---|
| Title | Uelfy Clinical — DPIA for cardio-nephro-metabolic risk assessment platform |
| Document version | 0.1 (scaffold) |
| Date | 2026-05-07 |
| Author of scaffold | Founder (Uelfy) |
| Reviewer (DPO) | `[TO COMPLETE]` |
| Approver (Controller) | `[TO COMPLETE]` — typically the clinic CEO / Medical Director |
| Status | DRAFT — NOT VALID FOR REGULATORY SUBMISSION |
| Next review | Annually OR on any material change to processing |

---

## 1. Description of the envisaged processing operations

### 1.1 Nature of the processing

Uelfy Clinical is a B2B cloud-hosted SaaS that allows healthcare
professionals (clinicians + their assistant staff) within a clinical
organisation (a "tenant") to:

* enrol patients and capture demographic + medical-history data
* compute validated cardio-nephro-metabolic risk scores (SCORE2,
  SCORE2-Diabetes, FIB-4, FLI, CKD-EPI, FRAIL, MetS, PREDIMED-MEDAS,
  Mifflin-St Jeor BMR/TDEE)
* track longitudinal patient history (assessments over time, score
  evolution, alert workflow)
* generate clinical PDF reports for the patient's record
* manage GDPR-relevant lifecycle: consent records, data subject
  requests (access, erasure, portability, rectification),
  retention-driven anonymization

### 1.2 Scope (categories of personal data)

| Data category | GDPR Art. 4 / Art. 9 classification | Examples |
|---|---|---|
| Demographic identifiers | Personal data (Art. 4(1)) | full name, date of birth, sex assigned at birth, fiscal code (codice fiscale), residence postal code |
| Contact data | Personal data | email, phone (optional) |
| Clinical anamnesis | **Special category — health data** (Art. 9(1)) | family history, medications, comorbidities, allergies |
| Vital + lab measurements | **Special category — health data** (Art. 9(1)) | blood pressure, body composition, lipid panel, eGFR, HbA1c, AST/ALT, platelets |
| Lifestyle | **Special category — health data** (Art. 9(1)) where it indicates health status; otherwise personal data | dietary patterns (PREDIMED), physical activity (METS) |
| Score outputs | **Special category — health data** (Art. 9(1)) — derived diagnostic indicators | SCORE2 risk %, FIB-4 stage, KDIGO category, MetS criteria |
| Authentication identifiers | Personal data | email (login), MFA enrolment status, IP-hash for audit |
| Audit trail | Personal data + reference to health data | actor user id, action, entity id, timestamp, IP-hash |

NO data categories EXCLUDED from this DPIA scope: every operation in
the platform handles either personal or special-category data.

### 1.3 Context of the processing

* **Controller**: each clinic / healthcare organisation that licenses
  the platform. Uelfy is a **processor** under Art. 28 — a Data
  Processing Agreement (DPA) is signed with each tenant before
  go-live.
* **Joint controller relationships**: none in the current MVP.
* **Sub-processors** (Art. 28(2-4)):
  - Vercel Inc. — hosting (EU regions)
  - Supabase (Powerbase Inc.) — database + auth + storage (EU regions)
  - Upstash — distributed rate-limit (EU regions)
  - GitHub Inc. — source control (NOT in the data path; PHI never
    reaches GitHub)
* **Geographic scope**: EU-only. All sub-processors configured in EU
  regions (Frankfurt / Dublin / Stockholm). No transfer outside EU/EEA
  contemplated. If a future controller asks for non-EU operation it
  becomes an `EXT-LEGAL` decision (Schrems II + DPA addendum) — out
  of MVP scope.
* **Volume**: small initially (one pilot clinic, ~hundreds of patients).
  Scaling to thousands of patients per tenant + tens of tenants is the
  Sprint 6+ horizon and triggers a DPIA review per §10.
* **Subject categories**: adult patients of the licensee clinic
  (and the clinic's own staff users for authentication). No children,
  no vulnerable subjects in the MVP scope (controller MUST flag if
  this changes — pediatric processing requires its own DPIA).

### 1.4 Purposes (matched to legal basis)

| Purpose | Legal basis (Art. 6) | Special-category basis (Art. 9) |
|---|---|---|
| Provision of clinical care + risk assessment | Art. 6(1)(c) legal obligation (medical record obligation) + Art. 6(1)(b) contract | **Art. 9(2)(h) healthcare provision** by a health professional bound by professional secrecy |
| Authentication, RBAC, security | Art. 6(1)(c) legal obligation (security of processing per Art. 32) | n/a |
| Audit logging for accountability | Art. 6(1)(c) Art. 30 + Art. 5(2) | n/a |
| Retention-driven anonymization | Art. 6(1)(c) Art. 5(1)(e) | n/a |
| Consent records (registration of patient consent for opt-in features) | Art. 6(1)(c) Art. 7(1) | n/a (the registration is administrative; the gated processing has its own basis) |
| OPT-IN: notifications (email/SMS to patient) | Art. 6(1)(a) consent | — |
| OPT-IN: AI-assisted commentary (Sprint 5+) | Art. 6(1)(a) consent | **Art. 9(2)(a) explicit consent** |
| OPT-IN: data sharing with external clinician (Sprint 5+) | Art. 6(1)(a) consent | **Art. 9(2)(a) explicit consent** |
| OPT-IN: marketing communications | Art. 6(1)(a) consent | n/a |

The opt-in purposes are gated by `backend/src/middleware/consent-gate.ts`
(Sprint 3 task 3.2). Clinical-care purposes proceed under Art. 9(2)(h)
without consent — see `docs/41-CONSENT-ENFORCEMENT.md` for the
decision matrix.

`[TO CONFIRM BY CONTROLLER]` — verify that the legal-basis claim above
matches the clinic's own legal opinion. Italian healthcare context
typically aligns Art. 9(2)(h) with the clinic's professional duty.

---

## 2. Necessity and proportionality

### 2.1 Necessity

Each data category captured by the platform is required by at least
one of the validated clinical scores or by the regulatory record
obligation. There is no field collected purely for "nice to have" or
analytical convenience.

`[TO COMPLETE BY DPO]` — review `CONSTANTS_AND_SCHEMAS_INDEX.md` against
this claim. If any captured field cannot be tied to a score input or
a record obligation, either justify it or remove it.

### 2.2 Proportionality

* **Data minimisation** (Art. 5(1)(c)): the schema captures the
  minimum set of variables consumed by the score engines, plus the
  identifiers required to retrieve the patient and the audit metadata
  required for accountability. No "soft" personality / preference /
  behavioural fields beyond what enters a clinical score.
* **Storage limitation** (Art. 5(1)(e)): per-category retention in
  `docs/14-DELETION-POLICY.md` + Sprint 3 task 3.3 split (auth events
  180d, default 10y).
* **Purpose limitation** (Art. 5(1)(b)): granular consent matrix
  (Sprint 3 task 3.2) prevents drift of clinical data into
  marketing / research / sharing without explicit consent.
* **Accuracy** (Art. 5(1)(d)): clinicians + assistant staff hand-enter
  values; rectification is per-record via standard CRUD endpoint;
  immutable assessment snapshots preserve the value AT THE TIME of
  scoring (clinical evidence) — corrections produce a new assessment
  rather than mutating history.

### 2.3 Alternatives considered

* **Run scoring on the clinician's local PC instead of cloud SaaS.**
  Rejected: would prevent multi-clinician collaboration on the same
  patient, would prevent longitudinal history tracking across visits,
  and would shift the security burden to each clinic's local IT —
  harder to enforce, harder to audit, harder to update when guidelines
  change.
* **Process anonymous data only.** Rejected: clinical scoring is by
  definition per-patient, longitudinal, and identifiable — alerts
  must be linkable to a real person reachable by the clinician.
* **Store unencrypted.** Rejected: see §6 measures (TLS in transit,
  Postgres encryption at rest via Supabase, Storage at-rest encryption).

---

## 3. Data flow

### 3.1 Textual flow diagram

```
[Clinician browser]
     │  HTTPS (TLS 1.3, HSTS preload)
     ▼
[Vercel Edge → Vercel serverless function (api/v1/*)]
     │  Auth: Supabase JWT validated per request
     │  RBAC: rbac.ts middleware
     │  Tenancy: assertSameTenant on every loaded resource
     │  Rate-limit: Upstash Redis (per-route bucket)
     │  Consent gate (when opt-in path): assertConsentFor
     ▼
[Supabase Postgres (EU region)]
     │  RLS ENABLE + FORCE on all 20 PHI tables (mig 002 + 012)
     │  Service-role bypasses RLS; tenancy enforced in app layer
     ▼
[audit_events table — append via recordAuditStrict]
     │  retention: per-category (auth.* 180d, default 10y, mig 018)
     ▼
[Daily cron: fn_retention_prune (03:00 UTC)
              + fn_anonymize_patient (04:00 UTC)]
```

PDF reports are rendered server-side by `pdf-lib` from validated score
output, signed-URL'd in the Supabase `clinical-reports` private
bucket (5-min TTL signed URL), and never persisted client-side.

### 3.2 Data NEVER leaves EU

All sub-processors configured in EU regions. CDN is Vercel Edge in EU.
No telemetry / analytics SDK in the frontend (no third-party JS
beyond the self-vendored Supabase JS client).

`[TO CONFIRM BY DPO]` — operationally verify Vercel project region +
Supabase project region + Upstash database region are all EU before
go-live with each new tenant.

---

## 4. Risk assessment for the rights and freedoms of natural persons

For each identified risk, severity is `Low / Medium / High` and
likelihood is `Rare / Possible / Likely`. The combination produces an
overall risk level. Mitigating measures (§6) reduce one or both axes;
the residual is what the controller accepts.

| # | Risk | Severity (pre) | Likelihood (pre) | Mitigation | Severity (post) | Likelihood (post) | Residual |
|---|---|---|---|---|---|---|---|
| R1 | Unauthorised access to PHI by external attacker | High | Possible | TLS 1.3 + HSTS + auth + MFA mandate (admins, clinicians, assistant_staff) + rate-limit + RLS + audit trail (see §6.1, §6.2) | High | Rare | Medium |
| R2 | Unauthorised access by malicious or compromised internal user | High | Possible | RBAC + tenant isolation + per-clinician PPL gate + MFA mandate + audit trail with immutable insert + structured ACCESS_DENIED logging (see §6.2, §6.3) | High | Rare | Medium |
| R3 | Cross-tenant data leak via API bug | High | Possible | Three-layer auth (role + tenant + PPL) + RLS FORCE + opaque error envelope + integration tests for `cross_tenant` denial path (see §6.2) | High | Rare | Medium |
| R4 | PHI leak via supply chain (vulnerable dependency) | High | Possible | Pinned deps + npm ci on Vercel + SBOM (CycloneDX) + automated CVE scan in CI + Renovate weekly review + secret rotation (see §6.4) | Medium | Rare | Low |
| R5 | Data subject unable to exercise Art. 15 / 17 / 20 within 30d | Medium | Possible | DSR API + state machine + 30d sla_deadline + audit + erasure cron (Sprint 3 task 3.6 will close access/portability worker stub) | Medium | Rare | Low (after 3.6) |
| R6 | Over-retention / storage limitation breach | Medium | Likely | Daily retention prune + per-category audit retention + per-tenant overrides (Sprint 3 task 3.3) | Low | Rare | Low |
| R7 | Loss of accountability — audit trail tampered or missing | High | Rare | recordAuditStrict throws on insert failure; audit_events INSERT-only via RLS; structured AUDIT_WRITE_FAILED log on any failure; service-role only path | High | Rare | Medium (operational) |
| R8 | Regulatory exposure due to outdated privacy notice | Medium | Likely | Sprint 3 task 3.5 — informativa rewrite with full sub-processor list, retention table, Art. 13 fields | Medium | Rare | Low (after 3.5) |
| R9 | AI commentary giving unsafe diagnostic-like output | High | Possible (when AI feature activates) | AI is OUT OF clinical scoring path (project rule); AI confined to bounded supportive commentary; AI never replaces deterministic computation; opt-in via ai_processing consent gate; AI output marked clearly as advisory | Medium | Rare | Medium |
| R10 | Cross-border transfer to non-EU | High | Rare | Architecture pinned to EU regions; sub-processors EU-located; Renovate / Vercel UI cannot accidentally migrate region; documented in §1.3 + §6.5 | High | Rare | Low |

`[TO COMPLETE BY DPO]` — review the severity / likelihood
classifications. The controller's risk appetite may move some of the
"Medium" residuals into "accept" / "treat further" buckets.

---

## 5. Likely consequences for data subjects

For each risk in §4 that retains a "Medium" or higher residual:

* **R1 / R2 / R3 (PHI exposure)** — disclosure of clinical conditions
  could expose subjects to insurance discrimination, employment
  discrimination (where the condition is not job-related and the
  employer is not entitled to know), social stigma (mental health,
  HIV, addiction), or relational consequences (family discovering a
  prognosis the subject had not yet shared).
* **R7 (audit gap)** — could prevent detection of unauthorised access
  after the fact, indirectly amplifying R1/R2.
* **R9 (unsafe AI output)** — could mislead clinician into a wrong
  decision OR (if shown to the patient) cause unjustified anxiety.
  Note: this is mitigated to the maximum extent possible by keeping
  AI strictly out of the deterministic scoring path.

---

## 6. Measures envisaged to address the risks

This section summarises what is implemented and points to the
authoritative technical document.

### 6.1 Network and transport security

- TLS 1.3 + HSTS `max-age=63072000; includeSubDomains; preload`.
- Strict CSP (`script-src 'self'`); `'unsafe-inline'` only on
  `style-src` (Sprint 5 task 62 to remove).
- COOP / CORP same-origin; X-Frame-Options DENY; X-Content-Type-Options
  nosniff; Permissions-Policy locks down sensors.
- Reference: `docs/20-SECURITY.md` §9b (Web security headers).

### 6.2 Authentication & authorization

- Supabase Auth with email/password + TOTP MFA mandate per role
  (`docs/20-SECURITY.md` §3 + `backend/src/middleware/auth-middleware.ts`).
- 4 enforceable roles + 1 patient role; 3 admin types gated by MFA
  flags (verified via `/api/v1/health` subsystem `mfa_enforcement` +
  CI smoke gate per Sprint 2 task 2.3).
- 3-layer authz: role gate (`requireRole`) + tenant gate
  (`assertSameTenant`) + per-clinician PPL gate (where applicable).
- RLS ENABLE + FORCE on all 20 PHI tables (`docs/10-SECURITY-GDPR-CHECKLIST.md`
  §2.1c + `scripts/check-rls-coverage.mjs` anti-recidiva CI gate).

### 6.3 Audit & accountability

- Append-only `audit_events` with `recordAuditStrict` guarantee
  (B-09 / `tests/unit/audit-logger.test.ts`).
- Per-category retention (`docs/14-DELETION-POLICY.md` §1.1).
- Structured logs: `ACCESS_DENIED`, `CONSENT_DENIED`, `MFA_REQUIRED`,
  `AUDIT_WRITE_FAILED`, `RATE_LIMIT_BACKEND_FAILURE`,
  `RETENTION_RUN`, `SCORE_ENGINE_FAILURE`.
- Datadog log monitors planned in Sprint 6 task (incident detection
  dashboard).

### 6.4 Supply chain & secret management

- `package-lock.json` committed; Vercel uses `npm ci --include=dev`
  for byte-deterministic install (`docs/35-CI-CD-WORKFLOW.md` §3).
- SBOM in repo (CycloneDX); CVE scan gate in CI
  (`scripts/check-sbom-cves.mjs`); Renovate weekly review
  (`renovate.json`).
- Secrets rotation runbook (`docs/36-SECRETS-ROTATION.md`) — 90 days
  for service-role + Upstash token, 180 days for cron secret.
- Production smoke gate verifies subsystems remain `ok` after every
  push (`/api/v1/health` polling in `ci.yml` smoke-prod job).

### 6.5 Geographic & sub-processor

- All sub-processors EU-located (verified per §1.3).
- DPA template in `docs/32-EXT-LEGAL-TEMPLATES.md` `[TO REVIEW BY DPO]`.

### 6.6 Subject rights workflow

- DSR API + state machine (Art. 15 / 17 / 20 partial; rectification
  via standard CRUD; restriction / objection deferred to Sprint 4).
- Consent record append-only with versioning (Art. 7 accountability).
- Erasure via `fn_anonymize_patient` after 30-day soft-delete grace.
- Reference: `docs/40-DSR-WORKFLOW-AUDIT.md`,
  `docs/41-CONSENT-ENFORCEMENT.md`.

### 6.7 Privacy by design / by default

- Data minimisation enforced at the schema level (no "extra fields
  in case we need them later").
- Tenancy default = strict isolation (additive opt-in to share).
- MFA default = ON for sensitive roles when env flags set.
- Consent default = NOT GRANTED for opt-in purposes (gates fail-closed).

---

## 7. Consultation

### 7.1 Internal stakeholders

| Stakeholder | Consulted? | Date | Outcome |
|---|---|---|---|
| DPO | `[TO COMPLETE]` | | |
| Information Security lead | Founder (acting) | 2026-05-07 | Sprint 1 + Sprint 2 hardening reviewed and accepted |
| Clinical lead | `[TO COMPLETE BY CONTROLLER]` | | |

### 7.2 Data subjects (Art. 35(9))

`[TO COMPLETE BY CONTROLLER]` — under Art. 35(9), the controller
should "where appropriate" consult with data subjects or their
representatives. For a B2B platform serving an existing clinic, this
is typically achieved by the clinic itself via patient committees /
patient advisory groups when material new processing is introduced.

### 7.3 Garante Privacy (Art. 36)

Required ONLY if the residual risk in §4 remains **High** after the
mitigations in §6. Currently the highest residual is **Medium** (R1,
R2, R3, R7, R9 — see table). Consultation is therefore NOT triggered
under the literal reading of Art. 36(1).

`[TO COMPLETE BY DPO]` — confirm this assessment. If the DPO's
re-classification raises any residual to High, Art. 36 prior
consultation is required and production rollout is paused until
Garante responds.

---

## 8. Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| Author of scaffold | Founder (Uelfy) | | 2026-05-07 |
| DPO | `[TO COMPLETE]` | | |
| Data Controller | `[TO COMPLETE BY CONTROLLER]` | | |
| Garante Privacy (if Art. 36) | `[N/A unless residual High]` | | |

---

## 9. Periodic review

| Trigger | Reviewer | Action |
|---|---|---|
| Annual (May each year, 12 months from approval) | DPO | Full re-evaluation; update §4 risk table; re-confirm §1.3 sub-processor list |
| Material change to processing (new PHI category, new purpose, new sub-processor, geographic expansion) | Controller → DPO | Trigger ad-hoc review BEFORE the change is deployed |
| Security incident affecting PHI | DPO | Re-evaluate §4 R1/R2/R3 likelihood; update §6 mitigations |
| New regulator guidance (Garante / EDPB / WP29 successor) | DPO | Targeted update of the affected section |

This document is versioned in the repo
(`git log -- docs/39-DPIA-CARDIO.md` for history). The DPO may also
maintain an external signed PDF for regulatory submission; the Markdown
in the repo remains the working source.

---

## 10. Document history

| Date | Change | Author |
|---|---|---|
| 2026-05-07 | Initial scaffold (Sprint 3 task 3.4) | founder + AI pair |
