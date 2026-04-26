# Uelfy Clinical — Formula Registry

> **Scope.** Per-score reference: source publication, formula, input
> contract, validated domain (where the source restricts it), output
> shape, risk bands, and skip semantics. Companion to
> `23-CLINICAL-ENGINE.md` (architecture).
>
> **Audience.** Clinicians reviewing the calculator; engineers
> maintaining the modules; auditors verifying that the implementation
> matches the cited guideline.
>
> **Project rule.** Validated clinical formulas are not modified
> without explicit user instruction. This document records the formula
> *as implemented today*; any future change requires a paired entry in
> `29-CHANGELOG-CLINICAL.md` and a versioned `engine_version` bump.
>
> **EXT-CLIN.** All entries here describe the *implementation*, not a
> standalone clinical endorsement. A clinical reviewer's sign-off per
> score belongs in the controller's quality system.

---

## Index

1. BMI — Body Mass Index (`bmi.ts`)
2. SCORE2 — 10y CV risk, non-diabetic 40–69 (`score2.ts`)
3. SCORE2-Diabetes — 10y CV risk, diabetic 40–69 (`score2-diabetes.ts`)
4. SCORE2 Eligibility evaluator (`score2-eligibility.ts`)
5. ADA — Diabetes risk score (`ada.ts`)
6. FLI — Fatty Liver Index (`fli.ts`)
7. FRAIL — Frailty scale (`frail.ts`)
8. Metabolic syndrome — ATP III / IDF criteria (`metabolic-syndrome.ts`)
9. FIB-4 — Liver fibrosis index (`fib4.ts`)
10. eGFR — CKD-EPI 2021 race-free (`egfr.ts`)
11. PREDIMED MEDAS — Mediterranean diet adherence (`nutrition-engine/predimed.ts`)

---

## 1. BMI

**File.** `backend/src/domain/clinical/score-engine/bmi.ts`

**Source.** WHO. *Obesity: preventing and managing the global epidemic.*
Technical Report Series 894, 2000.

**Formula.**

```
BMI = weight_kg / (height_cm / 100)^2
```

**Inputs.** `heightCm > 0`, `weightKg > 0`.

**Skip semantics.** If either input is ≤ 0, returns
`{ bmi: 0, category: 'invalid_input' }` so the caller can render a
truthful "invalid input" state rather than an arbitrary value.

**Output bands (WHO).**

| BMI | Category |
|---|---|
| < 18.5 | Underweight |
| 18.5 – 24.9 | Normal |
| 25.0 – 29.9 | Overweight |
| 30.0 – 34.9 | Obese class I |
| 35.0 – 39.9 | Obese class II |
| ≥ 40.0 | Obese class III |

**Always-on.** BMI is computed for every assessment that has both
height and weight. It also feeds FLI and ADA as a derived input.

---

## 2. SCORE2

**File.** `backend/src/domain/clinical/score-engine/score2.ts`

**Source.** ESC 2021. *SCORE2 working group.* Updated 10-year CV risk
prediction model for the European population.

**Validated domain.** Age 40–69, **without** diabetes. The eligibility
evaluator (§4) gates this.

**Formula sketch.**

```
cage   = (age − 60) / 5
csbp   = (sbp − 120) / 20
ctchol = (tchol_mmol − 6)
chdl   = (hdl_mmol − 1.3) / 0.5

logit  = Σ β_i · x_i  +  Σ β_{i,age} · x_i · cage     (sex-specific)

risk_uncalibrated = 1 − S0(t)^exp(logit)              (sex-specific S0)

risk_calibrated   = scale1 + scale2 · risk_uncalibrated   (region-specific)
```

Coefficients (sex-specific) and the region calibration tables (low /
moderate / high / very high) are inlined as `const` tables in the
module — see the source for exact values. They match the ESC 2021
publication.

**Inputs.** Age, sex, smoking status, SBP (mmHg), total cholesterol
(mmol/L or mg/dL — the module converts), HDL (same), region.

**Risk bands (ESC).**

| 10-y risk | Band |
|---|---|
| < 2.5% (age <50) / < 5% (50–69) | Low to moderate |
| 2.5–7.5% / 5–10% | High |
| ≥ 7.5% / ≥ 10% | Very high |

(See ESC 2021 for the exact age-stratified thresholds; the module
encodes them.)

**Skip semantics.** Throws on out-of-range input (defensive against
extrapolating outside derivation domain). The orchestrator does **not**
catch this silently — `score2-eligibility.ts` runs first and produces
a structured skip entry instead. See §4 below.

---

## 3. SCORE2-Diabetes

**File.** `backend/src/domain/clinical/score-engine/score2-diabetes.ts`

**Source.** ESC 2023. *SCORE2-Diabetes working group.* CV risk
prediction in patients with type 2 diabetes mellitus.

**Validated domain.** Age 40–69, type 2 diabetes mellitus.

**Extra inputs over SCORE2.** Age at diabetes diagnosis, HbA1c (% or
mmol/mol — module converts), eGFR (mL/min/1.73m²).

**Formula.** Same logit + calibration framework as SCORE2 with three
extra terms (`ageDiag`, `hba1c`, `egfr`) and four diabetes-specific
interaction terms with age. 15 coefficients per sex; full table inlined
in the module.

**Risk bands.** Same calibrated bands as SCORE2.

**Skip semantics.** As SCORE2; gated by
`evaluateScore2DiabetesEligibility`.

---

## 4. SCORE2 / SCORE2-Diabetes eligibility evaluator

**File.** `backend/src/domain/clinical/score-engine/score2-eligibility.ts`

**Why it exists.** The two ESC formulas throw when given out-of-range
input (correct defensive behaviour for a published model). The
orchestrator must NOT silently swallow that throw — it would erase the
distinction between "data missing" and "data outside derivation
domain".

This module is a pure non-throwing pre-flight check that returns either
"eligible" (the formula may run) or a typed skip entry with one of the
canonical reasons:

- `missing_inputs` — required field is null/undefined
- `age_below_range` — age < 40
- `age_above_range` — age > 69
- `has_diabetes` — non-diabetic SCORE2 attempted on a diabetic patient
- `no_diabetes` — diabetic SCORE2 attempted on a non-diabetic patient
- `prior_cv_event` — patient already has documented CVD; SCORE2 not
  applicable (treat as already high risk)

The composite-risk layer translates these reasons into truthful UI
copy (Task #21 — WS2 truthful skip messaging).

**Per project rule.** This module changes the *gating*, never the
*formula*. The validated coefficients in `score2.ts` and
`score2-diabetes.ts` are untouched.

---

## 5. ADA Diabetes Risk Score

**File.** `backend/src/domain/clinical/score-engine/ada.ts`

**Source.** American Diabetes Association — Risk Assessment Tool
(7-year incident type-2 diabetes). Implementation references the
legacy `ADA-score.html` module.

**Formula.** Simple additive scoring.

| Item | Points |
|---|---|
| Age < 40 | 0; 40–49 → 1; 50–59 → 2; ≥ 60 → 3 |
| Sex male | 1 |
| Female with prior gestational diabetes | 1 |
| Family history of diabetes | 1 |
| Hypertension | 1 |
| Physical inactivity (< 150 min/week) | 1 |
| BMI 25–29.9 → 1; 30–39.9 → 2; ≥ 40 → 3 |

**Bands.** 0–2 = low, 3–4 = moderate, ≥ 5 = high.

**Inputs.** Age, sex, gestational-DM history (female), family history,
hypertension flag, activity flag, height + weight (for BMI).

**Skip semantics.** Throws if height/weight ≤ 0. Computed only when
patient does **not** have diabetes (the orchestrator checks
`hasDiabetes`). For known diabetics, ADA is irrelevant; SCORE2-Diabetes
is the appropriate model.

---

## 6. Fatty Liver Index (FLI)

**File.** `backend/src/domain/clinical/score-engine/fli.ts`

**Source.** Bedogni G, et al. *The Fatty Liver Index: a simple and
accurate predictor of hepatic steatosis in the general population.*
Clinical Chemistry 2006.

**Formula.**

```
y   = 0.953·ln(triglycerides) + 0.139·BMI + 0.718·ln(GGT) + 0.053·waist − 15.745
FLI = (e^y / (1 + e^y)) · 100
```

Triglycerides in mg/dL, GGT in U/L, waist in cm.

**Bands.**

| FLI | Interpretation |
|---|---|
| < 30 | NAFLD excluded |
| 30 – 59 | Indeterminate |
| ≥ 60 | NAFLD probable |

**Inputs.** Triglycerides, GGT, waist circumference, BMI (computed).

**Skip semantics.** Skipped when triglycerides, GGT, or waist is
missing. Returns a typed skip entry with `missing_fields`.

---

## 7. FRAIL Scale

**File.** `backend/src/domain/clinical/score-engine/frail.ts`

**Source.** Morley JE, et al. *A simple frailty questionnaire (FRAIL)
predicts outcomes in middle-aged African Americans.* J Nutr Health Aging
2012.

**Formula.** 5 yes/no items, 1 point each:

1. Fatigue (tired > 3 days/week)
2. Resistance (climbing 1 flight of stairs is difficult)
3. Ambulation (walking 1 block is difficult)
4. Illnesses (> 5 illnesses)
5. Weight loss (> 5% in past year)

**Bands.** 0–1 = not frail, 2 = pre-frail (intermediate), 3–5 = frail.

**Skip semantics.** Skipped when the FRAIL questionnaire was not
administered for this assessment.

---

## 8. Metabolic syndrome (MetS)

**File.** `backend/src/domain/clinical/score-engine/metabolic-syndrome.ts`

**Source.** Grundy SM, et al. *Diagnosis and management of the
metabolic syndrome.* AHA / NHLBI Scientific Statement (2005), with the
IDF harmonisation update.

**Diagnosis.** Present if **≥ 3 of 5** criteria are met.

| Criterion | Threshold |
|---|---|
| Waist (abdominal obesity) | M > 102 cm; F > 88 cm |
| Triglycerides | ≥ 150 mg/dL (or on TG-lowering Rx) |
| HDL | M < 40 mg/dL; F < 50 mg/dL (or on HDL-raising Rx) |
| Blood pressure | SBP ≥ 130 OR DBP ≥ 85 (or on antihypertensive Rx) |
| Fasting glucose | ≥ 100 mg/dL (or on glucose-lowering Rx / DM) |

**Output.** Number of criteria met + boolean diagnosis.

**Skip semantics.** Skipped when fewer than the required inputs are
present.

---

## 9. FIB-4

**File.** `backend/src/domain/clinical/score-engine/fib4.ts`

**Source.** Sterling RK, et al. *Development and validation of a simple
non-invasive index to predict significant fibrosis in patients with
HIV/HCV co-infection.* Hepatology 2006.

**Formula.**

```
FIB-4 = (Age · AST) / (Platelets · √ALT)
```

Platelets in 10⁹/L (Giga/L) — *not* 10³/μL. Ages and lab units in
standard SI/conventional units.

**Bands (HCV-validated cut-offs).**

| FIB-4 | Interpretation |
|---|---|
| < 1.45 | Low risk advanced fibrosis (F0–F2) |
| 1.45 – 3.25 | Indeterminate |
| ≥ 3.25 | High risk advanced fibrosis (F3–F4) |

**Cut-off caveat.** Cut-offs are primarily validated for hepatitis C;
literature suggests age- and disease-specific adjustments. The module
applies the published cut-offs; clinical interpretation is
context-dependent (an EXT-CLIN consideration).

**Skip semantics.** Skipped when AST, ALT, or platelets is missing.

---

## 10. eGFR — CKD-EPI 2021 race-free

**File.** `backend/src/domain/clinical/score-engine/egfr.ts`

**Source.** Inker LA, et al. *New creatinine- and cystatin C-based
predictive equations for GFR.* Am J Kidney Dis 2023 (and the 2021
NKF/ASN reassessment which removed the race coefficient).

**Formula.**

```
eGFR = 142
     × min(Scr/κ, 1)^α
     × max(Scr/κ, 1)^(-1.200)
     × 0.9938^age
     × 1.012  (if female)
```

| | κ | α |
|---|---|---|
| Female | 0.7 | -0.241 |
| Male | 0.9 | -0.302 |

Scr in mg/dL, age in years.

**Stages (KDIGO 2021).**

| Stage | eGFR (mL/min/1.73m²) | Description |
|---|---|---|
| G1 | ≥ 90 | Normal or high |
| G2 | 60 – 89 | Mildly decreased |
| G3a | 45 – 59 | Mildly to moderately decreased |
| G3b | 30 – 44 | Moderately to severely decreased |
| G4 | 15 – 29 | Severely decreased |
| G5 | < 15 | Kidney failure |

**Inputs.** Creatinine (mg/dL), age (≥ 18), sex.

**Skip semantics.** Returns `egfr=0` with a guard reason if creatinine
≤ 0 or age < 18 (paediatric eGFR uses different equations and is out
of scope — see `21-PRIVACY-TECHNICAL.md §10`).

---

## 11. PREDIMED MEDAS

**File.** `backend/src/domain/clinical/nutrition-engine/predimed.ts`
(re-exported into the score-engine orchestrator).

**Source.** Estruch R, et al. *Primary Prevention of Cardiovascular
Disease with a Mediterranean Diet — PREDIMED.* The 14-item MEDAS
adherence screener.

**Formula.** 14 yes/no items, 1 point each. `PREDIMED_MAX_SCORE = 14`.

**Adherence bands.**

| Score | Adherence |
|---|---|
| ≤ 5 | Low |
| 6 – 9 | Medium |
| ≥ 10 | High |

**Inputs.** Boolean array `predimedAnswers[14]`.

**Skip semantics.** Returns `predimedScore=null, adherenceBand=null`
when the questionnaire was not administered. The orchestrator wraps
this into a standard skip entry for surface consistency.

**Why it's in the nutrition engine.** PREDIMED feeds two surfaces: the
score row (this registry) and the nutrition summary (BMR / TDEE +
adherence band). Co-locating the calculator avoids a second
implementation drifting (Task #18 — CWS-6 wired this through cleanly).

---

## 12. Coefficient and threshold change-control

Any of the following is a **breaking change** that requires an
`engine_version` bump and a paired entry in `29-CHANGELOG-CLINICAL.md`:

- A coefficient in any module's `const` table changes by any amount.
- A risk-band threshold changes.
- A skip rule's semantics change (e.g. broadening eligibility).
- The unit convention of an input changes.
- A calibration region table is updated.

Pure refactoring (renames, comment-only edits, type-tightening) does
**not** require a version bump. The CI test suite enforces this with
golden-vector tests per score (see `28-TESTING-STRATEGY.md`).

---

## 13. Cross-references

- `23-CLINICAL-ENGINE.md` — engine architecture, layering, snapshot
  persistence, decision-support framing.
- `25-MDR-READINESS.md` — medical-device-regulation posture.
- `28-TESTING-STRATEGY.md` — test posture per score.
- `29-CHANGELOG-CLINICAL.md` — score-engine evolution log.
- `backend/src/domain/clinical/score-engine/` — implementation source
  (one file per score).
