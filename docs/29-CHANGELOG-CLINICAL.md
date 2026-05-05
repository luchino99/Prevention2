# Uelfy Clinical — Score Engine Changelog

> **Scope.** Per-`engine_version` log of every change to the clinical
> score engine: formulas, coefficients, eligibility rules, skip
> semantics, risk-band thresholds, persistence shape. Companion to
> `23-CLINICAL-ENGINE.md` (architecture), `24-FORMULA-REGISTRY.md`
> (per-score citations), and `11-CHANGELOG.md` (whole-platform changes).
>
> **Audience.** Engineers, clinical reviewers, regulators auditing
> engine evolution.
>
> **Stance.** This is the **forensic log** of the clinical engine. A
> change to engine output that is not recorded here is, by project
> definition, a regression.
>
> **Conventions.**
>
> - Versions follow `YYYY-MM-DD.NN`. Two changes on the same day
>   increment `NN`.
> - Each entry lists: scope (which scores affected), classification
>   (additive / behavioural / formula / cosmetic), and required
>   actions on persisted data (recompute? migrate? leave?).
> - **Per project rule:** validated formulas are not modified without
>   explicit user instruction. Every "formula" classification entry
>   below references the user authorisation that gated it.

---

## Classification key

| Class | Meaning | Recompute legacy? |
|---|---|---|
| **additive** | New score added; existing scores unchanged | No |
| **eligibility** | Skip rule changed; existing computed values unchanged | No (skips re-evaluate at next assessment) |
| **behavioural** | Output shape, label, or banding changed; numeric value unchanged | No (consumers updated) |
| **formula** | Coefficient, formula, or risk-band threshold changed | YES — historical assessments retain their old `engine_version`; new assessments use new |
| **cosmetic** | Comments, naming, types — no engine output change | No |

---

## [2026-05-04.02] — PREDIMED adherence bands aligned to Schroder 2011

**Class.** formula (band thresholds — score formula unchanged).
**Scope.** PREDIMED MEDAS adherence categorization in
`backend/src/domain/clinical/nutrition-engine/predimed.ts`
(`categorizePredimedAdherence`).

**User authorisation.** The Tier-5 audit (AUD-2026-05-04) instructed:
"if the code diverges from the published formula, correct it; do not
leave score thresholds at non-canonical values when a published
canonical exists." The PREDIMED bands fall under that directive.

**Change.**
| Score | 0..7 | 8..9 | 10..14 |
|---|---|---|---|
| Before | low (0..4) | medium (5..9) | high (10..14) |
| After  | low (0..7) | medium (8..9) | high (10..14) |

**Sources.**
- Schroder H, et al. *J Nutr* 2011;141(6):1140-5. (Original 14-item
  MEDAS validation; introduces the ≤7 / 8-9 / ≥10 stratification.)
- Estruch R, et al. *N Engl J Med* 2018;378:e34. (Trial used MEDAS
  ≥10 as the high-adherence intervention target.)

**Recompute legacy?** Yes — historical `nutrition_snapshots` rows
carry their old `adherenceBand` derived from the previous bands. New
assessments use the new bands; old assessments retain theirs (and
their `engine_version` stamp records which set applied). A backfill
recompute is not required for safety but is on the L-03 roadmap if a
controller asks for cohort-uniform classification.

**Tests added.** `tests/unit/predimed-mifflin.test.ts` — full band
matrix (0/3/7/8/9/10/12/14) + invalid-input + array-length guards +
integration with Mifflin BMR/TDEE.

---

## [2026-05-04.01] — SCORE2 / SCORE2-Diabetes canonical recalibration

**Class.** formula (recalibration step corrected to canonical paper form).
**Scope.** `score2.ts` + `score2-diabetes.ts` — `applyCalibratedRisk`,
`calculateUncalibratedRisk(Fraction)`, end-to-end orchestration.

**User authorisation.** Tier-5 audit (AUD-2026-05-04 finding C-01)
instructed: "if the code attuale diverge dalla formula pubblicata,
correggilo." The previous shortcut form was algebraically distinct
from the Hageman 2021 Box S5 canonical formula and produced clinically
significant under-estimates (e.g. M, 62y, smoker, SBP 168, TC 251
went from 11.7 % → 21.0 %).

**Change.**

Previous (shortcut, NOT equivalent to paper):
```
risk_recal = 1 − S0_male^exp(scale1 + scale2 × LP)
                      ^-- male baseline survival hard-coded for both sexes
```

New (canonical, paper Box S5):
```
risk_uncal  = 1 − S0_sex^exp(LP)                  (sex-specific S0)
cll_uncal   = ln(−ln(1 − risk_uncal))
cll_cal     = scale1 + scale2 × cll_uncal
risk_recal  = 1 − exp(−exp(cll_cal))
```

Algebraic non-equivalence: `(−ln(S0_male))^1 ≠ (−ln(S0_sex))^scale2`
for any combination of `(sex, region)` published in the paper, so the
two forms produce different numbers — see file header in `score2.ts`
for the derivation.

**Sources.**
- Hageman SHJ, Pennells L, Ojeda F, et al. SCORE2 risk prediction
  algorithms: new models to estimate 10-year risk of cardiovascular
  disease in Europe. *Eur Heart J* 2021;42(25):2439-54. Suppl Box S5
  (canonical recalibration form), Table S2 (coefficients), Table S5
  (regional calibration parameters).
- Pennells L, et al. SCORE2-Diabetes: 10-year cardiovascular risk
  estimation in type 2 diabetes in Europe. *Eur Heart J*
  2023;44(28):2544-56. (Same recalibration shape; diabetes-specific
  coefficients and baseline survival.)

**Recompute legacy?** Yes — historical SCORE2 / SCORE2-Diabetes
risk values were systematically under-estimated. Existing
`score_results` rows retain their original `engine_version` stamp;
new assessments use the corrected engine. Clinical lead should
review whether a re-stratification of historical patients is
indicated; for the pilot tenant this is moot (no historical cohort
yet).

**Tests added.**
- `tests/unit/score2-golden.test.ts` — independent reference
  implementation (paper-derived, structurally distinct from
  production code) + 9 golden cases (sex × region × age) + 5
  regression assertions (sex-specific baseline, cll transform,
  band ordering, determinism, no-NaN) + 3 SCORE2-Diabetes cases.
- `tests/equivalence/score-equivalence.test.ts` regression
  baselines updated to canonical-formula values.

**External confirmation recommended.** Operator may compare the same
9 cases against https://heartscore.escardio.org and record any
divergences in `24-FORMULA-REGISTRY.md`. A spread of ±0.1-0.5 % is
expected (tool rounding); larger divergences indicate either a
paper-vs-tool difference or a regression.

---

## [2026-04-26.01] — Documentation pack baseline

**Class.** cosmetic.
**Scope.** Documentation only. No engine code, no migration, no
persisted-row change.

This entry baselines the engine docs at the start of the Phase 8
documentation pack:

- `23-CLINICAL-ENGINE.md` introduced — architecture, layering,
  determinism contract, snapshot persistence.
- `24-FORMULA-REGISTRY.md` introduced — per-score citations + skip
  semantics in one place.
- `25-MDR-READINESS.md` introduced — MDR/IEC 62304 posture.
- `28-TESTING-STRATEGY.md` introduced — test posture.

No `engine_version` bump.

---

## [2026-04-22.01] — Engine snapshot persistence baseline

**Class.** behavioural.
**Scope.** All scores. The atomic `create_assessment` RPC ensures
score results + snapshot are written in a single transaction
(migration `011_atomic_assessment.sql`, B-03 fix, Task #59).

Engine outputs unchanged numerically. Persistence shape is now atomic
across:

- `assessments`
- `assessment_clinical_snapshots`
- `score_results`

If the RPC fails partway, none of the rows land. Operationally this
removes the "ghost assessment with no snapshot" failure mode observed
in the legacy non-atomic path.

No recompute required.

---

## [2026-04-20.01] — SCORE2 truthful skip messaging

**Class.** eligibility.
**Scope.** SCORE2, SCORE2-Diabetes.
**Authorisation.** Task #21 (WS2).

Introduced `score2-eligibility.ts` as a non-throwing pre-flight that
routes inputs to the formula or to a typed skip entry with one of:

- `missing_inputs`
- `age_below_range`
- `age_above_range`
- `has_diabetes`
- `no_diabetes`
- `prior_cv_event`

Previously the orchestrator caught the formula's defensive throw and
the composite-risk layer fell back to a hard-coded "missing lipid panel
and/or blood pressure" reason that was false whenever the user had
provided complete data merely outside the validated derivation domain
(e.g. age 75).

**Formula coefficients are unchanged.** This entry is an *eligibility*
change, not a formula change.

No recompute required — historical scores remain valid; the difference
only affects the *skip reason text* shown to the clinician.

---

## [2026-04-19.01] — Atomic engine output schema (CWS-8)

**Class.** behavioural.
**Scope.** All scores.
**Authorisation.** Task #20 (CWS-8).

Rewrote `clinical-engine.test.ts` against the canonical
`ScoreResultEntry[]` shape; the test suite now enforces:

- Every result has a non-empty `score_id`.
- Every result has either a numeric `value` (with band) OR a
  `status='skipped'` envelope with `skip_reason` and (if applicable)
  `missing_fields`.
- PREDIMED is reused from the nutrition-engine, not re-implemented.
- Output is byte-for-byte deterministic across runs.

No formula change. No recompute required.

---

## [2026-04-18.01] — PREDIMED wired into orchestrator (CWS-6)

**Class.** additive.
**Scope.** PREDIMED MEDAS now appears in the orchestrator output.
**Authorisation.** Task #18 (CWS-6).

PREDIMED was previously surfaced only via the nutrition engine's
summary block. The orchestrator now invokes
`computePredimedScore` + `categorizePredimedAdherence` (re-exported
from `nutrition-engine/predimed.ts`) and emits a standard
`ScoreResultEntry` so the score appears in dashboards, PDF, and
downstream alerts on the same footing as the cardiometabolic scores.

`PREDIMED_MAX_SCORE = 14` exported as the canonical constant — UI and
orchestrator consume the same source.

**Formula unchanged** — the calculator continues to live in a single
module. This is an *additive* surface change.

No recompute required for legacy assessments — PREDIMED rows simply
appear from this version forward.

---

## [2026-04-15.01] — Indeterminate risk band (migration 006)

**Class.** behavioural.
**Scope.** Composite risk profile.
**Authorisation.** Task #14 (CWS-2 — SCORE2 / SCORE2-Diabetes debug).

Added `indeterminate` to the canonical risk-band enum in
`risk-aggregation/composite-risk.ts` and the database column
`risk_profiles.band`. Previously, an assessment with too many skipped
score modules would collapse to "low risk" by omission, which is a
clinically misleading default. Now such assessments produce
`indeterminate` and a follow-up plan that prioritises completing the
missing inputs.

Score formulas are unchanged. The change is in the **aggregation
layer** between scores and the risk profile.

No recompute required, but legacy "low" rows that originated from
incomplete inputs may, on user-triggered re-evaluation, transition to
`indeterminate`. Downstream consumers (dashboard, PDF, follow-up
engine) handle the new band.

---

## [2026-04-12.01] — Alert engine split (CWS-5)

**Class.** behavioural.
**Scope.** Alert taxonomy. No score module touched.
**Authorisation.** Task #17 (CWS-5).

Alerts are now split into two families with distinct semantics:

- **Completeness alerts** — input missing; remediation is "add the
  missing data"; never expires; cleared when the input is added.
- **Due-follow-up alerts** — time-based; remediation is "schedule the
  next assessment"; cleared on next assessment or explicit dismiss.

Score outputs and risk bands are unchanged. The change improves
clinician triage (Task #28 — UI triage separation).

No recompute required.

---

## [2026-04-10.01] — Critical clinical alert thresholds (Issue #44)

**Class.** behavioural.
**Scope.** Alert engine threshold catalogue.
**Authorisation.** Issue #44.

Documented critical-threshold catalogue:

- eGFR < 30 → "Severely decreased renal function" (G4 / G5).
- HbA1c ≥ 10% → "Severe hyperglycaemia".
- SBP ≥ 180 OR DBP ≥ 110 → "Hypertensive crisis".
- LDL ≥ 190 → "Severe hypercholesterolaemia".
- FIB-4 ≥ 3.25 → "High suspicion of advanced fibrosis".
- SCORE2-band escalation across two consecutive assessments.

Each threshold is sourced from the corresponding guideline (catalogued
in `guideline-catalog/`). No score formula changed; the alert engine
consumes existing score outputs against published thresholds.

No recompute required.

---

## [2026-03-28.01] — Bounded lifestyle recommendation engine (WS6)

**Class.** additive.
**Scope.** New non-clinical-score surface (lifestyle).
**Authorisation.** Task #26 (WS6).

Introduced `lifestyle-recommendation-engine/` producing bounded
suggestions from PREDIMED adherence, activity METs, and metabolic
syndrome criteria. Output is a small set of typed suggestions; the
clinician chooses what to surface.

This is **not a meal planner** and **not a workout planner** (per
project's product-scope rules). It does not modify any score formula
or risk band.

No `engine_version` bump required for the score engine; the lifestyle
engine has its own version stamp.

No recompute required.

---

## [2026-03-15.01] — Initial documented engine baseline

**Class.** baseline.
**Scope.** All scores at the moment the documented changelog began.

Score modules implementing:

- BMI (WHO 2000)
- SCORE2 (ESC 2021)
- SCORE2-Diabetes (ESC 2023)
- ADA (American Diabetes Association)
- FLI (Bedogni 2006)
- FRAIL (Morley 2012)
- Metabolic Syndrome (ATP III / IDF harmonisation)
- FIB-4 (Sterling 2006)
- eGFR (CKD-EPI 2021 race-free)
- PREDIMED MEDAS (Estruch et al.)

All formulas verified against the cited source per
`24-FORMULA-REGISTRY.md`. Equivalence vectors pinned in
`tests/equivalence/score-equivalence.test.ts`.

This is the reference point for any subsequent **formula** change.

---

## Future-entry template

```
## [YYYY-MM-DD.NN] — <one-line headline>

**Class.** <additive | eligibility | behavioural | formula | cosmetic>
**Scope.** <which scores / which surfaces>
**Authorisation.** <task / user instruction reference>

<Description: what changed, why, and the source / guideline if formula.>

**Recompute required?** <yes / no>. <If yes: which historical rows are
recomputed, which retain their old engine_version, what the rollback
plan is.>

**Tests updated.** <Which equivalence vectors / unit tests changed.>

**Persisted-row impact.** <Which tables, which columns, which migrations.>

**Cross-references.** <Related issues / PRs / docs.>
```

---

## Change-control reminders

- A **formula** change (coefficient, threshold, equation) requires:
  - Explicit user instruction (project rule).
  - An `engine_version` bump.
  - An entry in this changelog.
  - Updated equivalence vector in `tests/equivalence/`.
  - Updated citation in `24-FORMULA-REGISTRY.md`.
  - A regression-window plan: which historical rows are recomputed,
    which retain their old `engine_version`.
- A **behavioural** change without numeric impact requires this
  changelog entry but no recompute.
- A **cosmetic** change (renames, comments) requires no entry here —
  use `11-CHANGELOG.md` only.

---

**Cross-references**

- `23-CLINICAL-ENGINE.md` — engine architecture & determinism.
- `24-FORMULA-REGISTRY.md` — per-score citations.
- `25-MDR-READINESS.md` — verification posture under MDR / IEC 62304.
- `28-TESTING-STRATEGY.md` — test posture.
- `11-CHANGELOG.md` — whole-platform changelog.
