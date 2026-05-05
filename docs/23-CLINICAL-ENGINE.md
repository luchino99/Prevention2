# Uelfy Clinical — Engine Architecture & Determinism

> **Scope.** Architecture of the deterministic clinical engine: the
> score modules, the layering above them, the inputs/outputs envelope,
> the determinism guarantees, the skip semantics (what we do when data
> is missing), and the test posture. Companion to `24-FORMULA-REGISTRY.md`
> (per-score citations and formulas) and `25-MDR-READINESS.md` (medical
> device regulation posture).
>
> **Audience.** Engineers, clinical reviewers, regulatory assessors.
>
> **What this is not.** A clinical guideline. The engine implements
> validated formulas from published guidelines; it is a deterministic
> calculator, not a clinical decision-maker. All outputs are
> **decision-support** — a clinician is the human-in-the-loop.

---

## 1. Design principles

The engine is built around six non-negotiable rules:

1. **Pure functions.** Every score module is `(input) → output`. No
   I/O, no global state, no clock reads, no random numbers.
2. **No fabrication.** Missing inputs produce a typed *skip entry*, not
   a guessed value. We never silently substitute defaults for clinical
   inputs.
3. **Single source of truth per formula.** Each score lives in exactly
   one module under `backend/src/domain/clinical/score-engine/`.
   Reuse — even cross-engine — goes through that module's exported
   helpers (e.g. PREDIMED is reused from the nutrition engine, not
   re-implemented).
4. **Versioned outputs.** Every persisted score row carries an
   `engine_version` string so a future change in formula or coefficient
   set is forensically distinguishable from a recomputation of legacy
   data.
5. **Decision-support framing.** Every clinician-facing surface
   (dashboard, PDF, alert) labels engine output as "decision support"
   and never auto-acts on it. There is no endpoint that grants or
   denies care without a clinician's explicit input.
6. **Deterministic snapshot.** Every assessment persists the exact
   typed input that fed the engine in `assessment_clinical_snapshots`
   so the run is reproducible byte-for-byte.

---

## 2. Layering

The clinical domain (`backend/src/domain/clinical/`) is split into
cooperating layers. Each layer has a narrow contract and never reaches
across the abstraction.

```
            ┌──────────────────────────────────────────┐
            │  API layer (api/v1/assessments/*)        │
            │  - parses HTTP, calls services           │
            └──────────────┬───────────────────────────┘
                           │
            ┌──────────────▼───────────────────────────┐
            │  Service / orchestration layer            │
            │  (backend/src/services/assessments)       │
            │  - Zod-validates input                    │
            │  - calls computeAllScores(input)          │
            │  - persists snapshot + results            │
            │  - calls alert + followup engines         │
            └──────────────┬───────────────────────────┘
                           │
            ┌──────────────▼───────────────────────────┐
            │  Score engine (score-engine/index.ts)     │
            │  - selects which score modules to run     │
            │  - wraps each in try/catch                │
            │  - returns ScoreResultEntry[]             │
            └──────┬─────────────┬──────────────┬──────┘
                   │             │              │
        ┌──────────▼───┐ ┌───────▼──────┐ ┌─────▼────────┐
        │ score modules│ │ derivations  │ │ completeness │
        │ (10 modules) │ │ (BMI helpers │ │ (input-hole  │
        │              │ │  etc.)       │ │  detection)  │
        └──────────────┘ └──────────────┘ └──────────────┘
                   │
            ┌──────▼───────────────────────────────────┐
            │  Risk-aggregation (composite-risk.ts)    │
            │  Pure mapping: scores → risk profile     │
            └──────────────┬───────────────────────────┘
                           │
            ┌──────────────▼───────────────────────────┐
            │  Alert + follow-up engines               │
            │  - alert-deriver.ts (clinical thresholds)│
            │  - followup-plan.ts (rule catalog)       │
            │  - lifestyle-recommendation-engine       │
            └──────────────┬───────────────────────────┘
                           │
            ┌──────────────▼───────────────────────────┐
            │  Persistence (services + RLS)            │
            │  - score_results, alerts, followup_plans │
            │  - assessment_clinical_snapshots         │
            └──────────────────────────────────────────┘
```

Adjacent helpers:

- `screening-engine/` — separate from score-engine; handles screening
  questionnaires (PREDIMED rolls in via the nutrition engine, FRAIL
  scale lives in the score engine because it's a numeric scale, not a
  binary screen).
- `nutrition-engine/` — diet quality scoring (PREDIMED MEDAS) and BMR /
  TDEE estimation. Reused by `score-engine` for PREDIMED.
- `activity-engine/` — METs computation from activity inputs.
- `report-engine/` — PDF rendering. Reads persisted rows; never
  recomputes scores at render time.
- `guideline-catalog/` — structured catalogue of which guideline / source
  underpins each score (surfaced in UI + PDF as "Reference framework").

---

## 3. Score modules (current set)

Implemented in `backend/src/domain/clinical/score-engine/`:

| Module | File | Domain | Notes |
|---|---|---|---|
| BMI | `bmi.ts` | Anthropometry | Always computed when height + weight present |
| SCORE2 | `score2.ts` | CV (40–69, no diabetes) | ESC 2021 SCORE2 model |
| SCORE2-Diabetes | `score2-diabetes.ts` | CV (40–69, diabetes) | ESC SCORE2-Diabetes 2023 |
| SCORE2 Eligibility | `score2-eligibility.ts` | CV gating | Returns either skip entry or eligibility-pass marker |
| ADA | `ada.ts` | Diabetes screening | Computed only for non-diabetics |
| FLI | `fli.ts` | Hepatic | Fatty Liver Index (Bedogni 2006) |
| FRAIL | `frail.ts` | Geriatric | 5-item FRAIL scale |
| Metabolic syndrome | `metabolic-syndrome.ts` | Metabolic | NCEP ATP III / IDF criteria |
| FIB-4 | `fib4.ts` | Hepatic fibrosis | Sterling 2006 |
| eGFR | `egfr.ts` | Renal | CKD-EPI 2021 (race-free) |
| PREDIMED MEDAS | `nutrition-engine/predimed.ts` (re-exported) | Lifestyle | 14-item Mediterranean diet adherence |

Per-module formulas, sources, and skip semantics live in
`24-FORMULA-REGISTRY.md`. **Per project rule, validated formulas are
not modified without explicit user instruction.**

---

## 4. Determinism contract

A "deterministic" engine call means: for a fixed `engine_version` and a
fixed `AssessmentInput`, the output `ScoreResultEntry[]` is bit-for-bit
identical across runs, processes, and machines.

Implementation:

| Concern | Implementation |
|---|---|
| Time | The engine takes no `Date.now()`. Patient age is a derivable input, not a clock read. |
| Randomness | No `Math.random()` in any score module. |
| External I/O | Score modules import only pure helpers; no DB, no HTTP. |
| Floating-point determinism | Pure JS arithmetic, no native add-ons; results documented to the precision the source guideline specifies (e.g. SCORE2 to one decimal). |
| Locale | No `toLocaleString` in score code; presentation formatting is in `report-engine` / frontend, not in the calculator. |
| Module side-effects | Score modules import only types + constants; the orchestrator wraps each in `try/catch` so a thrown module cannot poison sibling scores. |

**Enforcement (CI gate, L-06).** `scripts/check-engine-determinism.mjs`
greps every source file under the deterministic-locked sub-trees
(`score-engine/`, `risk-aggregation/`, `nutrition-engine/`,
`derivations/`, `completeness/`, `screening-engine/`) for forbidden
patterns: `Math.random()`, `Date.now()`, `new Date()`,
`performance.now()`, `crypto.{getRandomValues,randomUUID,randomBytes}`.
A single match fails the script with exit 2 and lists every offender by
file:line, blocking `npm run build` and `npm run build:check`. The
`EXCLUSIONS` map at the top of the script documents the adjacent
sub-trees that are NOT deterministic-locked (`report-engine`,
`alert-engine`, `followup-engine`, `lifestyle-recommendation-engine`,
`activity-engine`, `guideline-catalog`) with a one-line justification
each. Adding a new sub-tree under `domain/clinical/` requires either
listing it in `DETERMINISTIC_DIRS` or in `EXCLUSIONS` with a reason —
no silent third option.

---

## 5. Snapshot persistence

Every assessment persists a `clinical_input_snapshot` (table created in
migration 001, updated in 003) carrying the exact validated input the
engine consumed:

- Numeric and enum fields land in typed columns where possible.
- Free-form clinical inputs land in a versioned JSONB `payload` with the
  schema version stamped.
- The snapshot, the score results, and the engine version together
  constitute a reproducible run.

The atomic `create_assessment` RPC (migration 011, B-03 fix) writes the
assessment + snapshot + score results in a single transaction so a
power loss between rows is not possible.

After anonymisation (`fn_anonymize_patient`, migration 003), the
snapshot is stripped of PHI but **retains the score-relevant scalars
plus `engine_version`** so longitudinal cohort analytics remain
possible without re-identifying the subject (see
`21-PRIVACY-TECHNICAL.md §7`).

---

## 6. Skip semantics (no fabrication)

When a score module cannot run because a required input is missing,
it returns a **skip entry**, not a guessed result. The skip entry has
the same envelope as a result:

```ts
{
  score_id: 'SCORE2',
  status: 'skipped',
  skip_reason: 'missing_inputs',
  missing_fields: ['hdl', 'sbp'],
  engine_version: '...'
}
```

Surfaced to the clinician in the UI ("Required: HDL, SBP — please
complete the lab fields") and in the PDF ("Not computed — missing: HDL,
SBP"). This is the WS2 truthful skip messaging deliverable (Task #21):
the engine never silently produces a half-computed score.

The 10 lab fields required to enable the full score set are enforced
end-to-end (Task #22) — UI requires them, schema rejects missing ones,
DB columns are NOT NULL where appropriate, and the snapshot persists
the actual values used.

---

## 7. Risk aggregation

`risk-aggregation/composite-risk.ts` is a **pure mapping** from score
outputs to a risk profile (low / moderate / high / very-high /
indeterminate). It does not introduce new clinical content beyond what
the source guidelines already define; it is a presentation reducer.

The `indeterminate` band exists explicitly (migration 006) so a profile
with too many skipped scores does not collapse to "low risk" by
omission.

---

## 8. Alert engine

`alert-engine/alert-deriver.ts` evaluates persisted score results and
clinical inputs against a published threshold catalogue (see Task #44 —
critical clinical thresholds):

- Critical lab values (e.g. severely depressed eGFR, very high HbA1c).
- Risk-band escalations (e.g. SCORE2 jumping a band vs. last assessment).
- Completeness gaps (e.g. due labs).
- Follow-up overdue conditions (driven by the `due_items` table —
  Task #27 / 29 / 33).

Alerts are persisted to `alerts`; the API surface
(`/api/v1/alerts/[id]/ack`) supports ack / resolve / dismiss with strict
audit (post-Phase 7.1).

The alert engine is split (Task #17, CWS-5) into:

- **Completeness alerts** — input is missing.
- **Due-follow-up alerts** — time-based.

so a clinician can triage "what to fix in the assessment" separately
from "what to schedule".

---

## 9. Follow-up planning

`followup-engine/followup-plan.ts` consumes the score outputs + the
guideline catalog and produces a `followup_plan` with structured items:
recommended next-assessment date, referrals (e.g. nephrology if eGFR
band requires), and lab re-checks. Stored in `followup_plans` and
linked to `due_items` for the countdown surface.

Per project rule: this is decision-support — the clinician edits and
confirms; no plan auto-executes.

---

## 10. Lifestyle recommendation engine

`lifestyle-recommendation-engine/` (Task #26, WS6) produces bounded,
non-prescriptive lifestyle suggestions based on PREDIMED adherence band,
activity METs, and metabolic-syndrome criteria:

- Mediterranean diet adherence guidance (PREDIMED-aligned).
- Activity-level guidance (WHO physical activity guidelines).
- Body-composition guidance (BMI category-aligned).

It is **not a meal planner** and **not a workout planner** (per
project's product-scope rules). The output is a small set of typed
suggestions; the clinician chooses which to surface to the patient.

---

## 11. Versioning

`engine_version` is a string of the form `YYYY-MM-DD.<seq>` stamped on
every persisted score row, snapshot, and PDF. A version bump is
required when any of the following change:

- A score formula (rare — requires explicit user authorisation).
- A coefficient set (e.g. SCORE2 calibration table).
- A skip rule (requires regression test update).
- A risk-band threshold.

Two side-by-side engine versions can coexist in the database — historic
assessments retain the engine_version they were computed under, and
trend charts annotate version transitions.

---

## 12. Tests

Test layout (in `tests/`):

- **Per-score golden vectors** — known input → known output, sourced
  from the guideline appendix where one exists.
- **Skip semantics** — every required field, when omitted, must produce
  a skip entry with the correct `missing_fields`.
- **Determinism** — running `computeAllScores` twice on the same input
  yields identical output (deep-equal).
- **Engine orchestrator** — `clinical-engine.test.ts` (Task #20) covers
  the canonical orchestrator shape, including PREDIMED reuse and
  cross-module skip propagation.
- **Atomic create-assessment** — RPC-level test for migration 011
  (Task #59, B-03).

Test posture and CI gating in `28-TESTING-STRATEGY.md`.

---

## 13. What the engine deliberately does NOT do

- It does not prescribe medication, dose, or therapy.
- It does not generate meal plans or workout plans.
- It does not call third-party APIs at evaluation time.
- It does not write to the database itself (services do).
- It does not fall back to defaults when inputs are missing — it skips.
- It does not produce a "diagnosis" — it produces score values + risk
  bands, framed as decision-support.

---

## 14. Optional AI commentary boundary

If a tenant enables the optional bounded AI commentary (off by default
— see `21-PRIVACY-TECHNICAL.md §11`), the AI runs **after** the
deterministic engine and **only** on the bounded summary. It cannot:

- Override a score value.
- Override a risk band.
- Generate a diagnosis-like statement.
- Receive raw PHI in the prompt — only the summary the engine already
  produced.

The AI commentary is rendered as a clearly-labelled, secondary,
non-authoritative block in the UI/PDF.

---

## 15. Open items

| Item | Owner | Status |
|---|---|---|
| Per-tenant engine-version pinning (allow controllers to defer a version bump) | Engineering | Roadmap |
| Engine-version diff report (what changed between v_n and v_{n+1}) | Engineering | Roadmap |
| Backfill recompute job (recompute legacy assessments under the new engine, retaining historical row) | Engineering | Roadmap |
| External clinical reviewer sign-off per score | Controller / clinical | EXT-CLIN |
| MDR conformance assessment (if tenant uses output as a CE-marked clinical decision aid) | EXT-MDR | See `25-MDR-READINESS.md` |

---

**Cross-references**

- `24-FORMULA-REGISTRY.md` — per-score formulas, citations, skip rules.
- `25-MDR-READINESS.md` — medical device regulation posture.
- `28-TESTING-STRATEGY.md` — what is tested, what is not.
- `29-CHANGELOG-CLINICAL.md` — score-engine evolution log.
