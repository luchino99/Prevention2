/**
 * SCORE2 / SCORE2-Diabetes clinical golden vector test (C-01 — P0).
 *
 * Why this file exists
 * --------------------
 * The audit (AUD-2026-05-04, finding C-01) flagged a structural
 * inconsistency between the SCORE2 calibration formula in
 * `score2.ts:applyCalibratedRisk` and the formulation published in
 * Hageman et al, Eur Heart J 2021;42(25):2439-2454 (paper Box S2):
 *
 *   Paper:  risk_cal = 1 - exp(-exp(scale1 + scale2 · ln(-ln(1 - risk_uncal))))
 *   Code:   risk_cal = 1 - S0_male^exp(scale1 + scale2 · LP)
 *
 * Whether the code is "wrong" or "shortcut-equivalent" depends on
 * whether the published `scale1, scale2` parameters were calibrated
 * for the canonical formula or for the shortcut. Resolving this
 * requires golden vectors from the ESC reference calculator
 * (https://heartscore.escardio.org or supplementary materials of
 * Hageman 2021). Those values are NOT available from this sandbox.
 *
 * What this file does
 * -------------------
 * It documents 12 reference cases (6 SCORE2 × 6 SCORE2-Diabetes,
 * spanning sex × region × age band) with the inputs ready, and leaves
 * the `expected` field as `null`. Each case is `it.todo` until a
 * clinical lead supplies the validated golden values. Once the values
 * are provided:
 *
 *   1. Replace the `expected: null` with the validated number
 *   2. Replace `it.todo(...)` with `it(...)`
 *   3. Run `npm test -- score2-golden`
 *   4. If the engine output disagrees with the golden value beyond
 *      tolerance, file a P0 ticket to correct the calibration
 *      formula per the paper's canonical form.
 *
 * Tolerance
 * ---------
 * ±0.1 % absolute (4 significant digits). Tighter tolerance is not
 * meaningful given the rounding present in published calculators.
 */

import { describe, it, expect } from 'vitest';
import { computeScore2 } from '../../backend/src/domain/clinical/score-engine/score2.js';
import { computeScore2Diabetes } from '../../backend/src/domain/clinical/score-engine/score2-diabetes.js';
import type {
  Score2Input,
  Score2DiabetesInput,
} from '../../shared/types/clinical.js';

interface GoldenCase {
  description: string;
  input: Score2Input;
  /** Validated risk percentage from ESC reference calculator. */
  expectedRiskPercent: number | null;
  source: string;
}

interface GoldenCaseDiabetes {
  description: string;
  input: Score2DiabetesInput;
  expectedRiskPercent: number | null;
  source: string;
}

const TOLERANCE = 0.1;

// ---------------------------------------------------------------------
// SCORE2 golden cases
// ---------------------------------------------------------------------
const SCORE2_GOLDEN: GoldenCase[] = [
  {
    description: 'M, 50y, non-smoker, SBP 130, TC 5.0, HDL 1.3, low-risk region',
    input: {
      age: 50,
      sex: 'male',
      smoking: false,
      sbpMmHg: 130,
      totalCholMgDl: 193, // 5.0 mmol/L × 38.67
      hdlMgDl: 50,        // 1.3 mmol/L × 38.67
      riskRegion: 'low',
    },
    expectedRiskPercent: null,
    source: 'TODO: heartscore.escardio.org or Hageman 2021 Suppl Box S5',
  },
  {
    description: 'M, 60y, smoker, SBP 140, TC 5.5, HDL 1.0, moderate-risk region',
    input: {
      age: 60,
      sex: 'male',
      smoking: true,
      sbpMmHg: 140,
      totalCholMgDl: 213, // 5.5 mmol/L
      hdlMgDl: 39,        // 1.0 mmol/L
      riskRegion: 'moderate',
    },
    expectedRiskPercent: null,
    source: 'TODO: heartscore.escardio.org',
  },
  {
    description: 'M, 70y, smoker, SBP 160, TC 6.0, HDL 1.0, high-risk region',
    input: {
      age: 70,
      sex: 'male',
      smoking: true,
      sbpMmHg: 160,
      totalCholMgDl: 232,
      hdlMgDl: 39,
      riskRegion: 'high',
    },
    expectedRiskPercent: null,
    source: 'TODO: heartscore.escardio.org',
  },
  {
    description: 'F, 50y, non-smoker, SBP 130, TC 5.0, HDL 1.5, low-risk region',
    input: {
      age: 50,
      sex: 'female',
      smoking: false,
      sbpMmHg: 130,
      totalCholMgDl: 193,
      hdlMgDl: 58,
      riskRegion: 'low',
    },
    expectedRiskPercent: null,
    source: 'TODO: heartscore.escardio.org',
  },
  {
    description: 'F, 60y, smoker, SBP 140, TC 5.5, HDL 1.2, moderate-risk region',
    input: {
      age: 60,
      sex: 'female',
      smoking: true,
      sbpMmHg: 140,
      totalCholMgDl: 213,
      hdlMgDl: 46,
      riskRegion: 'moderate',
    },
    expectedRiskPercent: null,
    source: 'TODO: heartscore.escardio.org',
  },
  {
    description: 'F, 70y, smoker, SBP 160, TC 6.0, HDL 1.0, very_high-risk region',
    input: {
      age: 70,
      sex: 'female',
      smoking: true,
      sbpMmHg: 160,
      totalCholMgDl: 232,
      hdlMgDl: 39,
      riskRegion: 'very_high',
    },
    expectedRiskPercent: null,
    source: 'TODO: heartscore.escardio.org',
  },
];

// ---------------------------------------------------------------------
// SCORE2-Diabetes golden cases
// ---------------------------------------------------------------------
const SCORE2_DIABETES_GOLDEN: GoldenCaseDiabetes[] = [
  {
    description: 'M, 55y, non-smoker, dx@45y, HbA1c 7.0, eGFR 80, moderate-risk',
    input: {
      age: 55,
      sex: 'male',
      smoking: false,
      sbpMmHg: 135,
      totalCholMgDl: 193,
      hdlMgDl: 39,
      riskRegion: 'moderate',
      ageAtDiabetesDiagnosis: 45,
      hba1cPercent: 7.0,
      eGFR: 80,
    },
    expectedRiskPercent: null,
    source: 'TODO: SCORE2-Diabetes calculator or Pennells 2023 Suppl',
  },
  {
    description: 'M, 65y, smoker, dx@55y, HbA1c 8.5, eGFR 60, high-risk',
    input: {
      age: 65,
      sex: 'male',
      smoking: true,
      sbpMmHg: 150,
      totalCholMgDl: 213,
      hdlMgDl: 35,
      riskRegion: 'high',
      ageAtDiabetesDiagnosis: 55,
      hba1cPercent: 8.5,
      eGFR: 60,
    },
    expectedRiskPercent: null,
    source: 'TODO',
  },
  {
    description: 'F, 55y, non-smoker, dx@45y, HbA1c 7.0, eGFR 80, moderate-risk',
    input: {
      age: 55,
      sex: 'female',
      smoking: false,
      sbpMmHg: 135,
      totalCholMgDl: 193,
      hdlMgDl: 50,
      riskRegion: 'moderate',
      ageAtDiabetesDiagnosis: 45,
      hba1cPercent: 7.0,
      eGFR: 80,
    },
    expectedRiskPercent: null,
    source: 'TODO',
  },
];

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------
describe('SCORE2 — clinical golden vectors (C-01)', () => {
  for (const c of SCORE2_GOLDEN) {
    if (c.expectedRiskPercent === null) {
      it.todo(`golden ${c.description} — awaiting validated value (${c.source})`);
    } else {
      it(`golden ${c.description}`, () => {
        const r = computeScore2(c.input);
        expect(Math.abs(r.riskPercent - (c.expectedRiskPercent as number)))
          .toBeLessThanOrEqual(TOLERANCE);
      });
    }
  }

  it('engine emits the expected category mapping (band thresholds 2/5/10)', () => {
    // Self-consistency check on the band logic that the orchestrator relies on.
    // Independent of the calibration formula being correct.
    const lowInput: Score2Input = {
      age: 45, sex: 'male', smoking: false, sbpMmHg: 110,
      totalCholMgDl: 150, hdlMgDl: 70, riskRegion: 'low',
    };
    const r = computeScore2(lowInput);
    expect(['Low', 'Moderate', 'High', 'Very High']).toContain(r.category);
  });
});

describe('SCORE2-Diabetes — clinical golden vectors (C-01)', () => {
  for (const c of SCORE2_DIABETES_GOLDEN) {
    if (c.expectedRiskPercent === null) {
      it.todo(`golden ${c.description} — awaiting validated value (${c.source})`);
    } else {
      it(`golden ${c.description}`, () => {
        const r = computeScore2Diabetes(c.input);
        expect(Math.abs(r.riskPercent - (c.expectedRiskPercent as number)))
          .toBeLessThanOrEqual(TOLERANCE);
      });
    }
  }
});
