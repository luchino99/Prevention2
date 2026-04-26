# Uelfy Clinical — Medical Device Regulation (MDR) Readiness

> **Scope.** Posture of the platform with respect to EU Medical Device
> Regulation 2017/745 (MDR), MDCG 2019-11 (qualification of MDSW), and
> related national transpositions. Companion to `23-CLINICAL-ENGINE.md`
> (architecture) and `24-FORMULA-REGISTRY.md` (per-score citations).
>
> **Audience.** Founder, regulatory counsel, controllers contemplating
> CE-marked deployment.
>
> **What this is not.** A regulatory submission. The substantive
> qualification, classification, conformity assessment, technical file,
> clinical evaluation, and post-market surveillance are
> **`EXT-MDR`** — they require external regulatory expertise, a notified
> body for class IIa+ devices, and a Quality Management System
> (typically ISO 13485). This document records what the *engineering
> side* has prepared so far and what the regulatory side will need to
> consume.
>
> **Operational stance today.** The platform is operated as
> **decision-support** under the controller's clinical judgement. It is
> not currently placed on the market as a CE-marked medical device. A
> decision to pursue CE marking is a controller- or
> Uelfy-business-level decision and is `EXT-MDR`.

---

## 1. Qualification — is this Medical Device Software (MDSW)?

Per MDCG 2019-11 §3, software is MDSW when it has a medical purpose as
defined in Article 2(1) MDR. The decision tree:

| Question | Uelfy answer | Implication |
|---|---|---|
| Is the software a software? | Yes | Continue |
| Is it an accessory of a medical device? | No | Continue |
| Does it perform an action on data, beyond storage / archival / lossless compression? | **Yes** — it computes risk scores, generates alerts, generates a follow-up plan | Continue |
| Is the action for the benefit of an individual patient? | Yes | Continue |
| Does it have a medical purpose per Art.2(1) MDR? | **Likely yes** — risk prediction informs clinical management | Likely qualifies as MDSW |

**Conclusion.** Uelfy's score + alert + follow-up engine **likely
qualifies as MDSW** under MDR. The lifestyle recommendation engine and
the diet-adherence surface arguably do not, on their own, but they are
co-deployed with the MDSW components.

**`EXT-MDR`.** Final qualification belongs to the regulatory consultant
+ notified body (where applicable).

---

## 2. Classification — likely Rule 11

Annex VIII Rule 11 MDR governs MDSW that provides information used for
decisions with diagnosis or therapeutic purposes:

| If the information is used for decisions which may cause … | Class |
|---|---|
| Death or irreversible deterioration | III |
| Serious deterioration / surgical intervention | IIb |
| All other decisions of diagnostic / therapeutic nature | **IIa** |
| Information for monitoring physiological processes | IIa or IIb depending on parameters |
| All other software | I |

**Most likely Uelfy classification: IIa.**

Reasoning: the engine produces risk scores (SCORE2, ADA, FIB-4, eGFR,
MetS) that inform diagnostic-or-therapeutic decisions. These decisions
are not, in isolation, immediately life-threatening — they shape a
follow-up plan that a clinician acts on. The clinician retains the
decision; the software is decision-support.

If the deployment configuration changes (e.g. the alert engine is
allowed to auto-page on critical thresholds, or AI commentary is
allowed to drive a treatment recommendation), the classification could
escalate. Such a change is `EXT-MDR` and requires a re-classification
exercise.

**`EXT-MDR`.** Final classification is the notified body's call.

---

## 3. Intended purpose

The intended purpose is the controlling document for everything else
(qualification, classification, clinical evaluation, post-market
surveillance). It must be drafted by the manufacturer (Uelfy or the
controller, depending on the commercial model) and is `EXT-MDR`.

**Provisional engineering-side intended-purpose statement** — for use
as a draft input to the regulatory consultant:

> *Uelfy Clinical is decision-support software for healthcare
> professionals working in cardio-nephro-metabolic risk management. It
> aggregates patient demographic, anthropometric, vital, laboratory, and
> lifestyle data; computes published, validated risk scores (BMI,
> SCORE2, SCORE2-Diabetes, ADA, FLI, FRAIL, Metabolic Syndrome, FIB-4,
> eGFR, PREDIMED MEDAS); generates structured alerts when documented
> clinical thresholds are crossed; and produces a structured follow-up
> plan and patient report. The software is intended to assist, not
> replace, clinical judgement; it does not prescribe medication, dose,
> or therapy; it does not deny or grant care without explicit clinician
> action. It is intended for use by qualified healthcare professionals
> in adult outpatient cardio-nephro-metabolic care.*

This is a *draft for consultant review*, not a final intended-purpose
statement.

---

## 4. General Safety and Performance Requirements (Annex I MDR)

Mapping of the engineering-side controls to Annex I:

| GSPR area | Implementation pointer | Status |
|---|---|---|
| §1 General safety requirement | Decision-support framing; no auto-action; clinician HITL | ✅ |
| §3 Risk management | Documented risk register (`Phase 9 deliverable`); per-score skip semantics; out-of-range guards | 🟡 partial — risk file `EXT-MDR` |
| §4 Risk acceptability | Per-score validated domain enforced; alerts surface threshold crossings | ✅ |
| §10 Chemical / physical / biological | N/A (software) | — |
| §13 Information supplied with the device | UI labels, PDF "Reference framework" section, this doc pack | 🟡 IFU `EXT-MDR` |
| §14 Performance requirements | Golden-vector tests per score; engine determinism contract | ✅ |
| §17 Electronic programmable systems | IEC 62304 software lifecycle process needed | ⚠️ `EXT-MDR` — process documentation pending |
| §17.1 Cybersecurity | `20-SECURITY.md` — RLS, RBAC, audit, rate-limiting, secrets | ✅ |
| §17.4 Algorithm transparency | Formula registry (`24-FORMULA-REGISTRY.md`); engine_version stamping | ✅ |
| §23 Information for users | UI + PDF + privacy notice + this doc pack | 🟡 user IFU `EXT-MDR` |

---

## 5. IEC 62304 software lifecycle posture

IEC 62304 defines the software lifecycle for medical-device software.
Required artefacts and the platform's current posture:

| Artefact | Status | Where |
|---|---|---|
| Software safety classification (A/B/C) | `EXT-MDR` — provisional **B** (no expected death; non-serious injury possible if the clinician acts on a wrong score) | TBD |
| Software development plan | Partial — engineering practices documented in `02-PIANO-REFACTOR.md` and the changelog | `docs/` |
| Software requirements specification | Partial — implicit in code + this doc pack; needs formalisation | `EXT-MDR` |
| Software architecture | `23-CLINICAL-ENGINE.md` + `20-SECURITY.md` | ✅ |
| Detailed design | Per-module headers + `24-FORMULA-REGISTRY.md` | ✅ |
| Unit tests | Vitest suite — see `28-TESTING-STRATEGY.md` | ✅ |
| Integration tests | RPC-level + endpoint tests planned in Phase 9 | 🟡 |
| System tests | Manual smoke tests documented in `26-DEPLOYMENT-RUNBOOK.md` | 🟡 |
| Risk management file | Phase 9 deliverable + `EXT-MDR` | 🟡 |
| Configuration management | Git + numbered migrations + engine_version | ✅ |
| Problem resolution | Issue tracker + changelog discipline | ✅ |
| SOUP (Software Of Unknown Provenance) inventory | `package.json` + `12-PACKAGE-UPGRADE.md` | 🟡 needs SOUP table per IEC 62304 §5.1 |

---

## 6. Clinical evaluation

Per MDR Article 61 + Annex XIV, clinical evaluation is required for all
classes of medical device. The platform aggregates published, validated
scores; the clinical evaluation is largely a literature-review exercise
demonstrating that:

- Each score is from a peer-reviewed source.
- The implementation matches the source.
- The intended population is consistent with the source's derivation
  population.
- The software does not extrapolate outside the validated domain (the
  eligibility evaluator enforces this).

The platform's per-score citations in `24-FORMULA-REGISTRY.md` are the
inputs to the clinical evaluation report. The CER itself is `EXT-MDR`.

---

## 7. Post-market surveillance & vigilance

Articles 83–86 MDR require continuous post-market surveillance, with
escalation to vigilance (Art.87) for serious incidents.

Engineering hooks already in place:

- Audit trail (`audit_events`) — every clinical action recorded.
- `AUDIT_WRITE_FAILED` log line — operational signal that an audit
  event could not be persisted (B-09).
- Failed-login + DSR ledger — privacy-side surveillance.
- Per-score skip telemetry — the orchestrator already wraps each score
  in try/catch and returns typed skip entries; a future surveillance
  collector can aggregate skip rates per tenant per score to detect
  unusual usage patterns.

PMS plan, PMS report, periodic safety update report (PSUR), and
vigilance reporting workflows are `EXT-MDR`.

---

## 8. Cybersecurity (MDCG 2019-16)

The MDCG 2019-16 guidance on cybersecurity for MDSW maps to:

| Topic | Pointer |
|---|---|
| Secure-by-design | `20-SECURITY.md §6` (secure SDLC) |
| Secure-by-default | RLS forced ON, MFA-supported auth, opaque error envelope, rate limiting on auth |
| Threat model | `20-SECURITY.md §11` |
| Vulnerability disclosure | `EXT-MDR` — needs published security.txt + disclosure policy |
| Security update mechanism | Standard CI/CD; numbered migrations | 
| SBOM | `package.json` + lockfile; SBOM export `EXT-MDR` |
| Penetration testing | `EXT-MDR` — independent pentest required pre-CE |

---

## 9. ISO 13485 QMS dependency

CE marking of an MDSW class IIa device requires a Quality Management
System per ISO 13485, audited by the notified body. This is a
business-process undertaking, not a code change. `EXT-MDR`.

The engineering side already operates with a number of QMS-friendly
practices: numbered migrations, change-control via the doc pack,
audit-trail-by-default, semantic engine versioning. These are inputs
to the QMS, not a substitute.

---

## 10. UDI, EUDAMED, registration

If/when CE marking is pursued:

- A UDI-DI (basic UDI-DI) and per-version UDI must be assigned.
- The device must be registered in EUDAMED.
- The manufacturer's economic operator role must be declared.

All `EXT-MDR`.

---

## 11. Decision-support framing — keep it visible

The single biggest technical safeguard against scope creep into a
higher MDR class is the **decision-support framing**. Engineering must
preserve this in every surface:

- UI: every score block carries the "decision support — clinician
  judgement required" label.
- PDF: the "Reference framework" section lists the source publication
  and the role of the clinician.
- API: no endpoint that accepts patient input *and* returns a
  prescription/dose/treatment.
- AI commentary: bounded, secondary, never authoritative — and
  off-by-default per `21-PRIVACY-TECHNICAL.md §11`.

A change that breaks any of the above is treated as a regulatory
risk, not a UX choice, and requires `EXT-MDR` review before merge.

---

## 12. Open items / EXT-MDR register

| Item | Owner | Status |
|---|---|---|
| Final qualification + classification (Rule 11) | Regulatory consultant + notified body | EXT-MDR |
| Intended-purpose statement (final) | Manufacturer + consultant | EXT-MDR |
| Software safety classification (62304 A/B/C) | Consultant | EXT-MDR — provisional B |
| Risk management file (ISO 14971) | Consultant + engineering | EXT-MDR |
| Clinical evaluation report (CER) | Consultant | EXT-MDR — engineering supplies citations |
| QMS (ISO 13485) | Business / consultant | EXT-MDR |
| Independent penetration test | Security vendor | EXT-MDR |
| SBOM export & SOUP inventory | Engineering | Roadmap (engineering-side; doc presentation EXT-MDR) |
| PMS plan + PSUR template | Consultant | EXT-MDR |
| Vigilance reporting workflow | Consultant + business | EXT-MDR |
| UDI assignment + EUDAMED registration | Business | EXT-MDR |
| Vulnerability disclosure policy + security.txt | Engineering + business | Roadmap |
| Tenant-facing IFU (Instructions For Use) | Consultant + product | EXT-MDR |

---

**Cross-references**

- `23-CLINICAL-ENGINE.md` — engine architecture & determinism.
- `24-FORMULA-REGISTRY.md` — per-score citations.
- `20-SECURITY.md` — cybersecurity controls.
- `28-TESTING-STRATEGY.md` — verification posture.
- `29-CHANGELOG-CLINICAL.md` — engine evolution log.
