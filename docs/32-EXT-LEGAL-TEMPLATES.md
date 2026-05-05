# Uelfy Clinical — EXT-LEGAL / EXT-MDR Document Drafts

> **Scope.** Engineering-side drafts of the legal and regulatory
> documents that ride alongside the platform. They are
> **NOT signed** — every section here must be reviewed and finalised
> by the responsible counsel / DPO / regulatory consultant before any
> tenant signs anything based on it.
>
> **Audience.** Founder + the legal/regulatory counterpart who will
> turn the drafts into binding documents.
>
> **What is here.**
>
> 1. Per-tenant Data Processing Agreement (DPA) — draft skeleton
> 2. Sub-processor list — draft (engineering-side enumerable)
> 3. DPIA outline (Art. 35) — draft sections
> 4. Intended-purpose statement (MDR draft) — refined
> 5. Patient-facing breach notification — architectural doc
> 6. Lawful-basis assignment matrix — draft per data category
>
> **What is NOT here.**
> - Liability caps, indemnities, dispute-resolution clauses,
>   governing-law choice — counsel-only.
> - The MDR Technical File, the Clinical Evaluation Report (CER),
>   the ISO 14971 Risk Management File — regulatory-consultant-only.

---

## 1. Per-tenant Data Processing Agreement (DPA) — draft skeleton

### 1.1 Parties

> The Data Processing Agreement ("DPA") is entered into by:
>
> **Controller** — the clinical entity (e.g. clinic, hospital, group
> practice) operating the Uelfy Clinical platform under its own
> licence. Identification: `<legal name>`, `<registered address>`,
> `<VAT/registration n.>`, contact `<email>`.
>
> **Processor** — Uelfy S.r.l. (placeholder), `<registered office>`,
> `<VAT/registration n.>`, DPO contact: `dpo@uelfy.com`.

### 1.2 Subject matter and duration

> The Processor processes Personal Data on behalf of the Controller
> exclusively to deliver the Uelfy Clinical platform — the web-based
> cardio-nephro-metabolic risk-assessment service described in
> `docs/00-PRODUCT-OVERVIEW.md` (placeholder). The DPA is co-terminous
> with the underlying service contract and survives termination only
> for as long as is required to fulfil deletion / portability requests
> per Section §1.7.

### 1.3 Categories of data subjects

> - Patients of the Controller (data subjects under GDPR Art.4(1))
> - Healthcare professionals operating under the Controller's
>   instructions (clinicians, assistant staff, tenant administrators)

### 1.4 Categories of personal data

> Aligned with `docs/21-PRIVACY-TECHNICAL.md §2`. In summary:
>
> - Identifying PHI: name, contact, DoB, sex
> - Clinical PHI: lab values, vitals, medications, diagnoses,
>   computed risk scores, alerts, follow-up plans
> - Lifestyle adherence: PREDIMED responses, activity minutes
> - Account data: clinician name, role, email, MFA factor
> - Telemetry: actor user id, hashed IP, action, truncated UA
> - Consent records and DSR records

### 1.5 Nature and purpose of processing

> Storage, retrieval, computation of validated clinical scores, audit
> logging, generation of clinical PDF reports, fulfilment of GDPR
> rights requests on behalf of the Controller. **The Processor does
> not carry out clinical decision-making.** Score outputs are
> decision-support; the Controller's clinicians remain accountable.

### 1.6 Sub-processors

> See §2 below for the engineering-enumerable list. Adding a new
> sub-processor requires 30-day prior written notice to the Controller
> and a right to object on documented grounds. A sub-processor change
> log is maintained at `docs/11-CHANGELOG.md` under "Sub-processors".

### 1.7 Termination obligations

> On termination the Processor will, at the Controller's choice
> (Art.28(3)(g)):
>
> - **Return** all Personal Data within 30 days as a JSON envelope per
>   patient (the same shape as `GET /api/v1/patients/{id}/export`),
>   bundled by tenant; OR
> - **Delete** all Personal Data following the deletion / anonymisation
>   procedure documented in `docs/14-DELETION-POLICY.md` and
>   `docs/21-PRIVACY-TECHNICAL.md §7`.

### 1.8 Technical and organisational measures (TOMs)

> Authoritative reference: `docs/20-SECURITY.md` and
> `docs/21-PRIVACY-TECHNICAL.md`. Highlights to incorporate verbatim
> in the DPA Annex II:
>
> - TLS 1.2+ in transit; AES-256 at rest (Supabase platform-managed)
> - RLS-enforced tenant isolation on every PHI table (`002`, `010`, `012`)
> - Force-RLS active on all 20 PHI/identity tables (migration 012)
> - Service-role JWT never leaves the server (B-12)
> - 7+ years immutable audit log (`audit_events`); strict-audit
>   guarantee on every privacy-significant write (B-09)
> - SHA-256 IP hashing — raw IP never persisted (`audit-logger.ts`)
> - 30-day grace + irreversible anonymisation for soft-deleted patients
>   (`fn_anonymize_patient`, migration 003)
> - 30-day SLA on DSR fulfilment with a state-machine ledger (B-14)
> - Cron handlers behind constant-time bearer (`CRON_SIGNING_SECRET`,
>   B-04)
> - Default-EU hosting (Vercel + Supabase EU regions)

### 1.9 Audit rights

> The Controller may audit the Processor's TOMs once per calendar year
> with 30-day prior notice. The Processor will provide the latest:
>
> - SBOM (`sbom.cyclonedx.json` at the repo root, IEC 62304 §5.1 SOUP)
> - Risk register (`docs/30-RISK-REGISTER.md`)
> - Most recent independent penetration-test report (when available;
>   `EXT-MDR` deliverable)

### 1.10 Liability, indemnities, governing law

> **EXT-LEGAL — counsel only.** The engineering side has no opinion
> here.

---

## 2. Sub-processor list — draft

The engineering-enumerable runtime sub-processors at the time of writing.
Per-tenant DPA must keep its own copy and update on every change.

| Sub-processor | Role | Region | Triggered by |
|---|---|---|---|
| **Supabase, Inc.** | Postgres + Storage + Auth host | EU (Frankfurt — `aws-eu-central-1`) | Every PHI persistence + auth check |
| **Vercel, Inc.** | Serverless function + edge host | EU (`fra1` — Frankfurt) for production deploy | Every HTTP request |
| **Upstash, Inc.** *(optional)* | Distributed rate-limit Redis | EU (`eu-west-1`) | Every rate-limited endpoint, IF `UPSTASH_REDIS_REST_URL` is set |
| **OpenAI, Inc.** *(optional, off by default)* | Bounded supportive AI commentary | US — `EXT-LEGAL` SCC required | Only when a tenant explicitly enables AI commentary |
| **Google Fonts / jsDelivr** | NotoSans typeface (build-time download into the build artefact) | global CDN; **fetched at build time, not at runtime** | The fonts ship inside the deploy artefact; clinician browsers fetch them from the Uelfy origin, not Google |

**Notes for counsel.**

- `Google Fonts / jsDelivr` is build-time only because of the same-
  origin CSP. They are **not** runtime sub-processors — no clinician
  browser ever hits them. We list them here for full disclosure.
- The `OpenAI` row is dotted-line: off by default (`OPENAI_API_KEY`
  unset). Activating it is a per-tenant choice that requires a DPA
  addendum and a transfer-impact assessment (Art.46–49 SCCs).

---

## 3. DPIA outline (Art. 35) — draft sections

The full DPIA is the Controller's responsibility; the structure below is
what counsel and the engineering side typically produce together.

```
1. Description of processing operations
   1.1 Nature, scope, context, purposes
   1.2 Data flow diagrams                 ← reuse docs/20-SECURITY.md trust-boundary diagram
   1.3 Sub-processors                     ← §2 above
2. Necessity and proportionality
   2.1 Lawful basis per data category     ← §6 below
   2.2 Data minimisation evidence         ← docs/21-PRIVACY-TECHNICAL.md §3
   2.3 Purpose limitation evidence        ← docs/21-PRIVACY-TECHNICAL.md §4
   2.4 Storage limitation                 ← docs/14-DELETION-POLICY.md
3. Risks to data subjects
   3.1 Confidentiality risks              ← register sections C/E
   3.2 Integrity risks                    ← register section C-01..C-09
   3.3 Availability risks                 ← M-05 restore drill SOP, doc 33
4. Mitigations and TOMs
   4.1 Technical                          ← docs/20-SECURITY.md
   4.2 Organisational                     ← per-tenant SOP + training
5. Residual risk and balancing test
6. Consultation evidence (DPO, data subjects where applicable)
```

The two boxes that cannot come from engineering:

> **(2.1) Lawful basis assignment** — controller's call (the typical
> healthcare configuration is Art.6(1)(b) contract + Art.9(2)(h)
> healthcare for clinical data, Art.6(1)(f) legitimate interest for
> security telemetry). See §6 below for the matrix engineering
> recommends as default.

> **(5) Residual risk balancing** — DPO judgement.

---

## 4. Intended-purpose statement (MDR draft) — refined

> **Intended use.** *Uelfy Clinical is software for healthcare
> professionals supporting cardio-nephro-metabolic risk assessment and
> longitudinal patient monitoring. The software computes published,
> validated risk scores (BMI; SCORE2 and SCORE2-Diabetes; ADA;
> Fatty Liver Index; FRAIL; Metabolic Syndrome ATP III/IDF; FIB-4;
> CKD-EPI 2021 race-free eGFR; PREDIMED MEDAS), aggregates them into
> a deterministic composite risk profile, generates structured alerts
> when documented clinical thresholds are crossed, produces a
> follow-up plan with recommended next-action dates, and renders a
> clinical PDF report. The software is decision-support: every
> output is presented for the clinician's review and is not actionable
> without explicit clinician confirmation. Score formulas are
> implemented as published; the software does not extrapolate beyond
> the validated derivation domain (eligibility evaluator gates inputs
> outside the domain).*
>
> **Intended user.** *Qualified healthcare professionals operating in
> outpatient cardio-nephro-metabolic and primary-care settings within
> the European Economic Area.*
>
> **Intended patient population.** *Adult patients (≥ 18 years).
> Paediatric use is out of scope.*
>
> **Indication / contraindication.** *Risk stratification in adult
> patients with at least one cardio-nephro-metabolic risk factor.
> Not for use in acute decompensated states (decompensated heart
> failure, ketoacidosis, acute kidney injury, etc.) where the input
> ranges fall outside the score's validated derivation domain — the
> software will mark such inputs as "indeterminate".*
>
> **Mode of operation.** *Decision-support. The output is always
> presented as advisory and labelled as such on every UI surface and
> in every PDF.*

This statement should be reviewed by the regulatory consultant against
MDR Article 2 (definitions), MDCG 2019-11 (qualification of MDSW), and
the controller's clinical-care pathway.

---

## 5. Patient-facing breach notification (Art.34) — architectural

The Processor (Uelfy) does **not** maintain a patient-facing
communication channel. When a notifiable breach occurs:

1. The Processor notifies the Controller within the 24-hour SLA
   documented in `docs/27-INCIDENT-RESPONSE.md §5.1`.
2. The Controller decides — exercising the threshold judgement of
   Art.34 — whether to notify each affected patient.
3. The Controller uses **its own** existing patient communication
   channel (typically a clinic email registry or letter). Uelfy can
   provide the per-patient identifier list and the technical evidence
   pack but does not directly contact patients.

**Counsel template** for the controller's patient letter is
out of scope here — it is a Controller deliverable. Uelfy's role is
limited to **supplying** the breach evidence.

---

## 6. Lawful-basis assignment matrix — engineering recommendation

Default suggestion the Controller's DPO can adopt or override.

| Data category | Default lawful basis | Notes |
|---|---|---|
| Identifying PHI (name, DoB, contact) | Art.6(1)(b) contract + Art.9(2)(h) healthcare | Required to identify the patient under care |
| Clinical PHI (labs, vitals, diagnoses) | Art.9(2)(h) healthcare | Special category (Art.9), processed for medical care |
| Computed clinical data (scores, alerts, plans) | Art.9(2)(h) healthcare | Derived from PHI; same legal basis |
| Lifestyle adherence (PREDIMED, activity) | Art.9(2)(h) where part of care; Art.6(1)(a) consent otherwise | Per-controller decision |
| Account data (clinician) | Art.6(1)(b) contract | Required for service delivery |
| Audit telemetry (actor, hashed IP, action) | Art.6(1)(f) legitimate interest | Necessary for security and accountability (Art.32) |
| Consent records | Art.7(1) accountability | Required documentation under Art.7 |
| DSR records | Art.12(3) record-keeping | Required to evidence the SLA-bound fulfilment |

---

## 7. Open items — to finalise before any tenant onboarding

| Item | Owner |
|---|---|
| Replace bracketed `<…>` placeholders in §1.1 with real entities | Operator + counsel |
| Fix-final the MDR intended-purpose statement | Regulatory consultant |
| Run the first DPIA against a real tenant context | Controller's DPO |
| Lawful-basis matrix sign-off (this file §6) | Controller's DPO |
| Public PGP key for `security@uelfy.com` | Operator |
| Liability / indemnity / governing law clauses | Counsel |

---

**Cross-references**

- `docs/20-SECURITY.md` — security architecture (TOMs source)
- `docs/21-PRIVACY-TECHNICAL.md` — privacy-by-design view
- `docs/22-GDPR-READINESS.md` — Article-by-article readiness
- `docs/25-MDR-READINESS.md` — MDR posture
- `docs/27-INCIDENT-RESPONSE.md` — breach playbook
- `docs/30-RISK-REGISTER.md` — consolidated residual-risk view
- `docs/33-RESTORE-DRILL-SOP.md` — Art.32(1)(d) restore-drill procedure
