/**
 * Score equivalence — engine vs INDEPENDENT reference implementation.
 *
 * Sprint 4 task 4.4 (F-016 audit-evidence gap): pre-Sprint-4 the
 * deterministic-formula scores BMI / eGFR / FLI / FRAIL / ADA had no
 * dedicated golden suite that cross-checked the engine against a
 * paper-derived reference computation. Coverage came indirectly from
 * `tests/equivalence/score-equivalence.test.ts` running the orchestrator
 * over 4 fixtures — fewer than 5 cases per score and no independent
 * baseline. This file closes the gap.
 *
 * Architecture:
 *   - 5 reference impls live in `tests/equivalence/refs/<score>-reference.ts`,
 *     re-derived from the published source with full citation. Each is a
 *     pure function with NO dependency on the engine.
 *   - For every case we assert TWO things:
 *       1. engine(input) ≈ reference(input)   — guards engine drift.
 *       2. reference(input) ≈ pinnedExpected  — guards reference drift.
 *     If both checks pass, the engine matches the published formula.
 *   - Tolerances are score-specific and documented in
 *     `docs/24-FORMULA-REGISTRY.md §14 Tolerance & equivalence policy`.
 *
 * Per project rule: this suite does NOT modify the validated formulas.
 * It pins the contract so any future engine change has to defend itself
 * against an independent baseline.
 */

import { describe, it, expect } from 'vitest';
import { computeBmi } from '../../backend/src/domain/clinical/score-engine/bmi.js';
import { computeEgfr } from '../../backend/src/domain/clinical/score-engine/egfr.js';
import { computeFli } from '../../backend/src/domain/clinical/score-engine/fli.js';
import { computeFrail } from '../../backend/src/domain/clinical/score-engine/frail.js';
import { computeAda } from '../../backend/src/domain/clinical/score-engine/ada.js';
import { bmiReference } from './refs/bmi-reference.js';
import { egfrReference } from './refs/egfr-reference.js';
import { fliReference } from './refs/fli-reference.js';
import { frailReference } from './refs/frail-reference.js';
import { adaReference } from './refs/ada-reference.js';

// Per-score tolerances — see docs/24-FORMULA-REGISTRY.md §14.
const TOL_BMI    = 0.05;  // 1-decimal pinning, log-free formula
const TOL_EGFR   = 0;     // engine + reference both round to integer
const TOL_FLI    = 0.05;  // log + exp cascade introduces ~1e-2 noise
const TOL_INT    = 0;     // additive integer scores (FRAIL, ADA)

/* ============================================================================
 * BMI — 6 cases (WHO 2000)
 * ========================================================================== */

describe('BMI ↔ WHO 2000 reference', () => {
  // Paper math: BMI = weight_kg / (height_m)²
  const cases: Array<{
    name: string;
    h: number;
    w: number;
    expectedBmi: number;
    expectedCategory: ReturnType<typeof bmiReference>['category'];
  }> = [
    // 50/(1.6)² = 50/2.56 = 19.531… → 19.5 → normal
    { name: 'underweight-borderline (18.4)', h: 165, w: 50, expectedBmi: 18.4, expectedCategory: 'underweight' },
    // 60/(1.6)² = 23.4375 → 23.4 → normal
    { name: 'normal (23.4)',                 h: 160, w: 60, expectedBmi: 23.4, expectedCategory: 'normal' },
    // 78/(1.7)² = 78/2.89 = 26.989 → 27.0 → overweight
    { name: 'overweight (27.0)',             h: 170, w: 78, expectedBmi: 27.0, expectedCategory: 'overweight' },
    // 95/(1.75)² = 95/3.0625 = 31.020 → 31.0 → obese_class_i
    { name: 'obese class I (31.0)',          h: 175, w: 95, expectedBmi: 31.0, expectedCategory: 'obese_class_i' },
    // 110/(1.7)² = 110/2.89 = 38.0623 → 38.1 → obese_class_ii
    { name: 'obese class II (38.1)',         h: 170, w: 110, expectedBmi: 38.1, expectedCategory: 'obese_class_ii' },
    // 130/(1.7)² = 130/2.89 = 44.9827 → 45.0 → obese_class_iii
    { name: 'obese class III (45.0)',        h: 170, w: 130, expectedBmi: 45.0, expectedCategory: 'obese_class_iii' },
  ];

  for (const c of cases) {
    it(`${c.name} — engine ≡ reference ≡ paper-derived expected`, () => {
      const ref = bmiReference({ heightCm: c.h, weightKg: c.w });
      const eng = computeBmi({ heightCm: c.h, weightKg: c.w });

      // Reference vs paper-derived expected
      expect(Math.abs(ref.bmi - c.expectedBmi)).toBeLessThanOrEqual(TOL_BMI);
      expect(ref.category).toBe(c.expectedCategory);

      // Engine vs reference (independence check)
      expect(Math.abs(eng.bmi - ref.bmi)).toBeLessThanOrEqual(TOL_BMI);
      expect(eng.category).toBe(ref.category);
    });
  }
});

/* ============================================================================
 * eGFR — 6 cases (CKD-EPI 2021 race-free, Inker NEJM 2021)
 * ========================================================================== */

describe('eGFR ↔ CKD-EPI 2021 race-free reference', () => {
  // Paper math, e.g. case 1:
  //   M, 42 y, Scr=0.9 mg/dL → ratio=1, min=1, max=1
  //   eGFR = 142 × 1^-0.302 × 1^-1.2 × 0.9938^42 × 1.0
  //        = 142 × 1 × 1 × 0.7707 × 1
  //        ≈ 109.4 → 109 (G1, normal_or_high)
  const cases: Array<{
    name: string;
    age: number;
    sex: 'male' | 'female';
    creat: number;
    expectedEgfr: number;
    expectedStage: ReturnType<typeof egfrReference>['stage'];
  }> = [
    { name: 'M 42 y, Scr 0.9 — normal G1',           age: 42, sex: 'male',   creat: 0.9, expectedEgfr: 109, expectedStage: 'G1' },
    { name: 'F 70 y, Scr 1.0 — G2 mildly decreased', age: 70, sex: 'female', creat: 1.0, expectedEgfr: 61,  expectedStage: 'G2' },
    { name: 'M 65 y, Scr 1.5 — G3a',                 age: 65, sex: 'male',   creat: 1.5, expectedEgfr: 51,  expectedStage: 'G3a' },
    { name: 'F 75 y, Scr 1.6 — G3b',                 age: 75, sex: 'female', creat: 1.6, expectedEgfr: 33,  expectedStage: 'G3b' },
    { name: 'M 80 y, Scr 3.0 — G4 severely decreased', age: 80, sex: 'male', creat: 3.0, expectedEgfr: 20,  expectedStage: 'G4' },
    { name: 'F 60 y, Scr 6.0 — G5 kidney failure',   age: 60, sex: 'female', creat: 6.0, expectedEgfr: 8,   expectedStage: 'G5' },
  ];

  for (const c of cases) {
    it(`${c.name} — engine ≡ reference ≡ paper-derived`, () => {
      const ref = egfrReference({
        creatinineMgDl: c.creat,
        age: c.age,
        sex: c.sex,
      });
      const eng = computeEgfr({
        creatinineMgDl: c.creat,
        age: c.age,
        sex: c.sex,
      });

      // Independence + paper checks. The expected value is a paper-
      // derived ballpark; we accept ±1 mL/min between reference and
      // expected (rounding to integer plus minor floating-point order
      // differences across libcs). Engine vs reference must be exact.
      expect(Math.abs(ref.egfr - c.expectedEgfr)).toBeLessThanOrEqual(1);
      expect(ref.stage).toBe(c.expectedStage);

      expect(eng.egfr).toBe(ref.egfr);
      expect(eng.stage).toBe(ref.stage);
      expect(eng.category).toBe(ref.category);
    });
  }
});

/* ============================================================================
 * FLI — 5 cases (Bedogni BMC Gastro 2006)
 * ========================================================================== */

describe('FLI ↔ Bedogni 2006 reference', () => {
  // Paper math example (case 1):
  //   h=180, w=76 → BMI=23.4568
  //   TG=89, GGT=22, waist=84
  //   y = 0.953·ln(89) + 0.139·23.4568 + 0.718·ln(22) + 0.053·84 − 15.745
  //     = 0.953·4.4886 + 3.2605 + 0.718·3.0910 + 4.452 − 15.745
  //     = 4.2772 + 3.2605 + 2.2193 + 4.452 − 15.745 = −1.5360
  //   FLI = e^-1.5360 / (1+e^-1.5360) × 100 ≈ 17.71 → Excluded
  const cases: Array<{
    name: string;
    h: number;
    w: number;
    waist: number;
    tg: number;
    ggt: number;
    expectedFli: number;
    expectedCategory: ReturnType<typeof fliReference>['category'];
  }> = [
    { name: 'lean — Excluded (17.7)',         h: 180, w: 76,  waist: 84,  tg: 89,  ggt: 22,  expectedFli: 17.7, expectedCategory: 'Excluded' },
    { name: 'borderline lean — Excluded',     h: 175, w: 70,  waist: 86,  tg: 110, ggt: 30,  expectedFli: 25.2, expectedCategory: 'Excluded' },
    { name: 'overweight — Probable NAFLD',    h: 170, w: 80,  waist: 95,  tg: 150, ggt: 50,  expectedFli: 67.3, expectedCategory: 'Probable NAFLD' },
    { name: 'obese — Probable NAFLD',         h: 170, w: 90,  waist: 100, tg: 200, ggt: 60,  expectedFli: 86.7, expectedCategory: 'Probable NAFLD' },
    { name: 'severe obesity — Probable NAFLD', h: 170, w: 110, waist: 110, tg: 250, ggt: 80, expectedFli: 97.8, expectedCategory: 'Probable NAFLD' },
  ];

  for (const c of cases) {
    it(`${c.name} — engine ≡ reference ≡ paper-derived`, () => {
      const ref = fliReference({
        heightCm: c.h,
        weightKg: c.w,
        waistCm: c.waist,
        triglyceridesMgDl: c.tg,
        ggtUL: c.ggt,
      });
      const eng = computeFli({
        heightCm: c.h,
        weightKg: c.w,
        waistCm: c.waist,
        triglyceridesMgDl: c.tg,
        ggtUL: c.ggt,
      });

      // The paper-derived expected uses ~1-decimal precision; we accept
      // ±1.5 % absolute (≈1.5 percentage points) for the case-derived
      // pin since the cascade is sensitive to log rounding.
      expect(Math.abs(ref.fli - c.expectedFli)).toBeLessThanOrEqual(1.5);
      expect(ref.category).toBe(c.expectedCategory);

      // Engine vs reference must be tight (TOL_FLI = 0.05 score points).
      expect(Math.abs(eng.fli - ref.fli)).toBeLessThanOrEqual(TOL_FLI);
      expect(eng.category).toBe(ref.category);
    });
  }
});

/* ============================================================================
 * FRAIL — 6 cases (Morley 2012, additive integer)
 * ========================================================================== */

describe('FRAIL ↔ Morley 2012 reference', () => {
  // Paper math: simple sum of 5 yes/no items.
  const cases: Array<{
    name: string;
    input: Parameters<typeof frailReference>[0];
    expectedScore: number;
    expectedCategory: ReturnType<typeof frailReference>['category'];
  }> = [
    {
      name: 'all-no — Not Frail (0)',
      input: { fatigue: false, resistance: false, ambulation: false, illnesses: false, weightLoss: false },
      expectedScore: 0,
      expectedCategory: 'Not Frail',
    },
    {
      name: 'one item — Not Frail (1)',
      input: { fatigue: true, resistance: false, ambulation: false, illnesses: false, weightLoss: false },
      expectedScore: 1,
      expectedCategory: 'Not Frail',
    },
    {
      name: 'two items — Intermediate (2)',
      input: { fatigue: true, resistance: true, ambulation: false, illnesses: false, weightLoss: false },
      expectedScore: 2,
      expectedCategory: 'Intermediate Frail',
    },
    {
      name: 'three items — Frail (3)',
      input: { fatigue: true, resistance: true, ambulation: true, illnesses: false, weightLoss: false },
      expectedScore: 3,
      expectedCategory: 'Frail',
    },
    {
      name: 'four items — Frail (4)',
      input: { fatigue: false, resistance: true, ambulation: true, illnesses: true, weightLoss: true },
      expectedScore: 4,
      expectedCategory: 'Frail',
    },
    {
      name: 'all-yes — Frail (5)',
      input: { fatigue: true, resistance: true, ambulation: true, illnesses: true, weightLoss: true },
      expectedScore: 5,
      expectedCategory: 'Frail',
    },
  ];

  for (const c of cases) {
    it(`${c.name} — engine ≡ reference ≡ paper-derived`, () => {
      const ref = frailReference(c.input);
      const eng = computeFrail(c.input);

      expect(ref.score).toBe(c.expectedScore);
      expect(ref.category).toBe(c.expectedCategory);

      expect(eng.score).toBe(ref.score);
      expect(eng.category).toBe(ref.category);
      expect(Math.abs(eng.score - ref.score)).toBeLessThanOrEqual(TOL_INT);
    });
  }
});

/* ============================================================================
 * ADA — 6 cases (Bang Ann Intern Med 2009, additive integer)
 * ========================================================================== */

describe('ADA ↔ Bang 2009 reference', () => {
  // Paper math examples — see comments in each case.
  const cases: Array<{
    name: string;
    input: Parameters<typeof adaReference>[0];
    expectedScore: number;
    expectedCategory: ReturnType<typeof adaReference>['category'];
  }> = [
    {
      // Age<40 (0) + F (0) + GestDM=false (0) + FH=false (0) + HTN=false (0)
      //  + Active (0) + BMI 22 (0) = 0
      name: 'young active female, healthy — Low (0)',
      input: {
        age: 30, sex: 'female',
        gestationalDiabetes: false, familyHistoryDiabetes: false, hypertension: false,
        physicallyActive: true, heightCm: 165, weightKg: 60,
      },
      expectedScore: 0,
      expectedCategory: 'Low Risk',
    },
    {
      // Age 40-49 (1) + M (1) + (n/a 0) + FH=false (0) + HTN=false (0)
      //  + Active (0) + BMI 23 (0) = 2
      name: 'mid-age active male — Low (2)',
      input: {
        age: 45, sex: 'male',
        gestationalDiabetes: false, familyHistoryDiabetes: false, hypertension: false,
        physicallyActive: true, heightCm: 180, weightKg: 75,
      },
      expectedScore: 2,
      expectedCategory: 'Low Risk',
    },
    {
      // Age 50-59 (2) + F (0) + GestDM=false (0) + FH=true (1) + HTN=false (0)
      //  + Active (0) + BMI 27 (1) = 4
      name: 'female 55, FH+ overweight — Moderate (4)',
      input: {
        age: 55, sex: 'female',
        gestationalDiabetes: false, familyHistoryDiabetes: true, hypertension: false,
        physicallyActive: true, heightCm: 165, weightKg: 73.5,
      },
      expectedScore: 4,
      expectedCategory: 'Moderate Risk',
    },
    {
      // Age 50-59 (2) + F (0) + GestDM=true (1) + FH=true (1) + HTN=true (1)
      //  + Inactive (1) + BMI 28 (1) = 7
      name: 'female 55, full risk profile — High (7)',
      input: {
        age: 55, sex: 'female',
        gestationalDiabetes: true, familyHistoryDiabetes: true, hypertension: true,
        physicallyActive: false, heightCm: 165, weightKg: 76,
      },
      expectedScore: 7,
      expectedCategory: 'High Risk',
    },
    {
      // Age ≥ 60 (3) + M (1) + (n/a 0) + FH=true (1) + HTN=true (1)
      //  + Inactive (1) + BMI 35 (2) = 9
      name: 'male 65, comorbid obese — High (9)',
      input: {
        age: 65, sex: 'male',
        gestationalDiabetes: false, familyHistoryDiabetes: true, hypertension: true,
        physicallyActive: false, heightCm: 175, weightKg: 107.2,
      },
      expectedScore: 9,
      expectedCategory: 'High Risk',
    },
    {
      // Maximum: Age ≥ 60 (3) + M (1) + (n/a 0) + FH=true (1) + HTN=true (1)
      //  + Inactive (1) + BMI ≥ 40 (3) = 10
      name: 'male 70, severely obese — High (10, near-max)',
      input: {
        age: 70, sex: 'male',
        gestationalDiabetes: false, familyHistoryDiabetes: true, hypertension: true,
        physicallyActive: false, heightCm: 170, weightKg: 120,
      },
      expectedScore: 10,
      expectedCategory: 'High Risk',
    },
  ];

  for (const c of cases) {
    it(`${c.name} — engine ≡ reference ≡ paper-derived`, () => {
      const ref = adaReference(c.input);
      const eng = computeAda(c.input);

      expect(ref.score).toBe(c.expectedScore);
      expect(ref.category).toBe(c.expectedCategory);

      expect(eng.score).toBe(ref.score);
      expect(eng.category).toBe(ref.category);
      expect(Math.abs(eng.score - ref.score)).toBeLessThanOrEqual(TOL_INT);
    });
  }
});
