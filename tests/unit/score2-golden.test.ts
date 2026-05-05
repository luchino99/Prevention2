/**
 * SCORE2 / SCORE2-Diabetes — clinical golden vector test (C-01).
 *
 * Strategy
 * --------
 * The audit (AUD-2026-05-04 finding C-01) established that the
 * production engine's earlier "shortcut" recalibration formula was
 * algebraically distinct from the canonical Hageman 2021 cll formula
 * and produced clinically significant under-estimates.
 *
 * This file holds:
 *   1. An INDEPENDENT reference implementation (`refScore2`,
 *      `refScore2Diabetes`) derived directly from the published
 *      paper formulas. It uses the same coefficients, baseline
 *      survival values and recalibration parameters but reimplements
 *      the math from scratch in a single place. The reference is
 *      structurally distinct from the production engine — it does
 *      not import any production helper, only the public input/result
 *      types — so the test exercises the production engine
 *      end-to-end against a peer implementation.
 *   2. Nine golden cases spanning sex × risk region × age band.
 *      Expected values are computed deterministically by the
 *      reference implementation at test time (no external calculator
 *      lookup required) and compared against the production engine's
 *      output with a tolerance of ±0.1 % absolute.
 *   3. Five regression assertions that fail loudly if the production
 *      engine ever drifts back to the shortcut shape (male S0
 *      hard-coded, missing sex-specific calibration, missing cll
 *      transform, etc.).
 *
 * External confirmation
 * ---------------------
 * For belt-and-braces clinical sign-off, the operator may compare
 * the same nine cases against https://heartscore.escardio.org and
 * record divergences in `docs/24-FORMULA-REGISTRY.md`. The golden
 * vectors in this file already match the published formula, so a
 * spread of ±0.1-0.5 % between the production engine and HeartScore
 * is expected (rounding + presentation differences). A larger
 * divergence indicates either a paper-vs-tool difference or a
 * regression in the production engine.
 *
 * Sources
 *   - SCORE2:        Hageman, Eur Heart J 2021;42(25):2439-2454,
 *                    Suppl Box S5 (canonical recalibration form)
 *                    + Table S2 (coefficients) + Table S5 (regional
 *                    calibration parameters).
 *   - SCORE2-DM:     Pennells, Eur Heart J 2023;44(28):2544-2556
 *                    (same recalibration shape; diabetes-specific
 *                    coefficients and baseline survival).
 */

import { describe, it, expect } from 'vitest';
import { computeScore2 } from '../../backend/src/domain/clinical/score-engine/score2.js';
import { computeScore2Diabetes } from '../../backend/src/domain/clinical/score-engine/score2-diabetes.js';
import type {
  Score2Input,
  Score2DiabetesInput,
} from '../../shared/types/clinical.js';

// =====================================================================
// REFERENCE IMPLEMENTATION (independent — derived directly from paper)
// =====================================================================

const REF_COEFFS_S2 = {
  male: {
    age: 0.3742, smoking: 0.6012, sbp: 0.2777, tchol: 0.1458, hdl: -0.2698,
    smoke_age: -0.0755, sbp_age: -0.0255, chol_age: -0.0281, hdl_age: 0.0426,
  },
  female: {
    age: 0.4648, smoking: 0.7744, sbp: 0.3131, tchol: 0.1002, hdl: -0.2606,
    smoke_age: -0.1088, sbp_age: -0.0277, chol_age: -0.0226, hdl_age: 0.0613,
  },
} as const;

const REF_S0_S2 = { male: 0.9605, female: 0.9776 } as const;

const REF_CAL_S2 = {
  male: {
    low:       { s1: -0.5699, s2: 0.7476 },
    moderate:  { s1: -0.1565, s2: 0.8001 },
    high:      { s1:  0.3207, s2: 0.9360 },
    very_high: { s1:  0.5836, s2: 0.8294 },
  },
  female: {
    low:       { s1: -0.7380, s2: 0.7019 },
    moderate:  { s1: -0.3143, s2: 0.7609 },
    high:      { s1:  0.2508, s2: 0.9369 },
    very_high: { s1:  0.4370, s2: 0.7820 },
  },
} as const;

/** Independent SCORE2 reference (Hageman 2021 cll form). */
function refScore2(input: Score2Input): { uncal: number; recal: number } {
  const c = REF_COEFFS_S2[input.sex];
  const cage = (input.age - 60) / 5;
  const csbp = (input.sbpMmHg - 120) / 20;
  const tchol = input.totalCholMgDl / 38.67;
  const hdl = input.hdlMgDl / 38.67;
  const ctchol = tchol - 6;
  const chdl = (hdl - 1.3) / 0.5;
  const sm = input.smoking ? 1 : 0;
  const LP =
    c.age * cage +
    c.smoking * sm +
    c.sbp * csbp +
    c.tchol * ctchol +
    c.hdl * chdl +
    c.smoke_age * sm * cage +
    c.sbp_age * csbp * cage +
    c.chol_age * ctchol * cage +
    c.hdl_age * chdl * cage;
  const s0 = REF_S0_S2[input.sex];
  const uncal = 1 - Math.pow(s0, Math.exp(LP));
  const cal = REF_CAL_S2[input.sex][input.riskRegion];
  const cll = Math.log(-Math.log(1 - uncal));
  const recal = 1 - Math.exp(-Math.exp(cal.s1 + cal.s2 * cll));
  return { uncal: uncal * 100, recal: recal * 100 };
}

/** Independent SCORE2-Diabetes reference (Pennells 2023). */
const REF_COEFFS_S2DM = {
  male: {
    age: 0.2241, smoking: 0.5765, sbp: 0.1849, tchol: 0.0871, hdl: -0.1553,
    ageDiag: -0.0327, hba1c: 0.0761, egfr: -0.1578,
    smoke_age: -0.0573, sbp_age: -0.0188, chol_age: -0.0229, hdl_age: 0.0282,
    ageDiag_age: 0.0081, hba1c_age: -0.0192, egfr_age: 0.0451,
  },
  female: {
    age: 0.3336, smoking: 0.7336, sbp: 0.2049, tchol: 0.0618, hdl: -0.1794,
    ageDiag: -0.0243, hba1c: 0.0769, egfr: -0.1375,
    smoke_age: -0.0782, sbp_age: -0.0098, chol_age: -0.0132, hdl_age: 0.0313,
    ageDiag_age: 0.0025, hba1c_age: -0.0070, egfr_age: 0.0318,
  },
} as const;
const REF_S0_S2DM = { male: 0.9350, female: 0.9632 } as const;

function refScore2Diabetes(input: Score2DiabetesInput): { uncal: number; recal: number } {
  const c = REF_COEFFS_S2DM[input.sex];
  const cage = (input.age - 60) / 5;
  const csbp = (input.sbpMmHg - 120) / 20;
  const ctchol = input.totalCholMgDl / 38.67 - 6;
  const chdl = (input.hdlMgDl / 38.67 - 1.3) / 0.5;
  const cageDiag = (input.age - input.ageAtDiabetesDiagnosis - 10) / 5;
  const hba1cMmol = (input.hba1cPercent - 2.15) * 10.929;
  const chba1c = (hba1cMmol - 31) / 9.34;
  const cegfr = (Math.log(input.eGFR) - 4.5) / 0.15;
  const sm = input.smoking ? 1 : 0;
  const LP =
    c.age * cage + c.smoking * sm + c.sbp * csbp + c.tchol * ctchol + c.hdl * chdl
    + c.ageDiag * cageDiag + c.hba1c * chba1c + c.egfr * cegfr
    + c.smoke_age * sm * cage + c.sbp_age * csbp * cage
    + c.chol_age * ctchol * cage + c.hdl_age * chdl * cage
    + c.ageDiag_age * cageDiag * cage + c.hba1c_age * chba1c * cage + c.egfr_age * cegfr * cage;
  const s0 = REF_S0_S2DM[input.sex];
  const uncal = 1 - Math.pow(s0, Math.exp(LP));
  const cal = REF_CAL_S2[input.sex][input.riskRegion];
  const cll = Math.log(-Math.log(1 - uncal));
  const recal = 1 - Math.exp(-Math.exp(cal.s1 + cal.s2 * cll));
  return { uncal: uncal * 100, recal: recal * 100 };
}

// =====================================================================
// GOLDEN CASES
// =====================================================================

interface GoldenCase<I> {
  description: string;
  input: I;
}

const SCORE2_GOLDEN: GoldenCase<Score2Input>[] = [
  { description: 'M, 50y, non-smoker, SBP 130, TC 5.0, HDL 1.3, low',
    input: { age: 50, sex: 'male', smoking: false, sbpMmHg: 130, totalCholMgDl: 193, hdlMgDl: 50, riskRegion: 'low' } },
  { description: 'M, 60y, smoker, SBP 140, TC 5.5, HDL 1.0, moderate',
    input: { age: 60, sex: 'male', smoking: true, sbpMmHg: 140, totalCholMgDl: 213, hdlMgDl: 39, riskRegion: 'moderate' } },
  { description: 'M, 70y, smoker, SBP 160, TC 6.0, HDL 1.0, high',
    input: { age: 70, sex: 'male', smoking: true, sbpMmHg: 160, totalCholMgDl: 232, hdlMgDl: 39, riskRegion: 'high' } },
  { description: 'M, 65y, non-smoker, SBP 145, TC 5.2, HDL 1.1, very_high',
    input: { age: 65, sex: 'male', smoking: false, sbpMmHg: 145, totalCholMgDl: 201, hdlMgDl: 43, riskRegion: 'very_high' } },
  { description: 'F, 50y, non-smoker, SBP 130, TC 5.0, HDL 1.5, low',
    input: { age: 50, sex: 'female', smoking: false, sbpMmHg: 130, totalCholMgDl: 193, hdlMgDl: 58, riskRegion: 'low' } },
  { description: 'F, 60y, smoker, SBP 140, TC 5.5, HDL 1.2, moderate',
    input: { age: 60, sex: 'female', smoking: true, sbpMmHg: 140, totalCholMgDl: 213, hdlMgDl: 46, riskRegion: 'moderate' } },
  { description: 'F, 70y, smoker, SBP 160, TC 6.0, HDL 1.0, very_high',
    input: { age: 70, sex: 'female', smoking: true, sbpMmHg: 160, totalCholMgDl: 232, hdlMgDl: 39, riskRegion: 'very_high' } },
  // Borderline / edge-of-band
  { description: 'M, 40y (lower bound), non-smoker, SBP 110, TC 4.0, HDL 1.6, low',
    input: { age: 40, sex: 'male', smoking: false, sbpMmHg: 110, totalCholMgDl: 154, hdlMgDl: 62, riskRegion: 'low' } },
  { description: 'F, 80y (upper bound), smoker, SBP 170, TC 6.5, HDL 0.9, very_high',
    input: { age: 80, sex: 'female', smoking: true, sbpMmHg: 170, totalCholMgDl: 251, hdlMgDl: 35, riskRegion: 'very_high' } },
];

const SCORE2_DIABETES_GOLDEN: GoldenCase<Score2DiabetesInput>[] = [
  { description: 'M, 55y, non-smoker, dx@45y, HbA1c 7.0, eGFR 80, moderate',
    input: { age: 55, sex: 'male', smoking: false, sbpMmHg: 135, totalCholMgDl: 193, hdlMgDl: 39,
             riskRegion: 'moderate', ageAtDiabetesDiagnosis: 45, hba1cPercent: 7.0, eGFR: 80 } },
  { description: 'M, 65y, smoker, dx@55y, HbA1c 8.5, eGFR 60, high',
    input: { age: 65, sex: 'male', smoking: true, sbpMmHg: 150, totalCholMgDl: 213, hdlMgDl: 35,
             riskRegion: 'high', ageAtDiabetesDiagnosis: 55, hba1cPercent: 8.5, eGFR: 60 } },
  { description: 'F, 55y, non-smoker, dx@45y, HbA1c 7.0, eGFR 80, moderate',
    input: { age: 55, sex: 'female', smoking: false, sbpMmHg: 135, totalCholMgDl: 193, hdlMgDl: 50,
             riskRegion: 'moderate', ageAtDiabetesDiagnosis: 45, hba1cPercent: 7.0, eGFR: 80 } },
];

// Tolerance: ±0.1 % absolute. Tighter than that is not meaningful given
// floating-point rounding across two independent implementations.
const TOLERANCE = 0.1;

// =====================================================================
// TESTS — production engine vs reference implementation
// =====================================================================

describe('SCORE2 — production engine matches paper-derived reference (C-01)', () => {
  for (const c of SCORE2_GOLDEN) {
    it(`golden ${c.description}`, () => {
      const ref = refScore2(c.input);
      const out = computeScore2(c.input);
      expect(out.riskPercent).toBeCloseTo(ref.recal, 1);
      expect(Math.abs(out.riskPercent - ref.recal)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(out.uncalibratedRisk - ref.uncal)).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  // ─── Regression assertions: catch drift back to the shortcut form ───

  it('uses sex-specific baseline survival (NOT male-hardcoded for both)', () => {
    // Same LP-driving inputs for M and F should NOT collapse to the same
    // recalibrated risk when the sex differs — coefficients differ AND
    // baseline survival differs. A regression that hard-codes S0_male
    // for both sexes would still differentiate by coefficients but the
    // calibration step would then be wrong; this test catches the
    // calibration-side regression because the F path now uses the
    // female S0 inside the cll transform.
    const baseInput = {
      age: 60, smoking: false, sbpMmHg: 140,
      totalCholMgDl: 213, hdlMgDl: 50, riskRegion: 'moderate' as const,
    };
    const m = computeScore2({ ...baseInput, sex: 'male' });
    const f = computeScore2({ ...baseInput, sex: 'female' });
    // The two values must be visibly different at 4-digit precision.
    expect(Math.abs(m.riskPercent - f.riskPercent)).toBeGreaterThan(0.05);
    // Each must independently match the reference for its own sex.
    expect(m.riskPercent).toBeCloseTo(refScore2({ ...baseInput, sex: 'male' }).recal, 1);
    expect(f.riskPercent).toBeCloseTo(refScore2({ ...baseInput, sex: 'female' }).recal, 1);
  });

  it('applies the cll recalibration (not the shortcut S0^exp form)', () => {
    // Build a case where the shortcut form and the cll form disagree by
    // > tolerance. Production engine must follow the cll form.
    const input: Score2Input = {
      age: 62, sex: 'male', smoking: true,
      sbpMmHg: 168, totalCholMgDl: 251, hdlMgDl: 37,
      riskRegion: 'moderate',
    };
    const ref = refScore2(input);              // canonical: ~21.0
    const out = computeScore2(input);
    expect(out.riskPercent).toBeCloseTo(ref.recal, 1);
    // Shortcut value would be ~11.7 — at least 5 % below the canonical.
    expect(out.riskPercent).toBeGreaterThan(15);
  });

  it('respects regional calibration ordering (low < moderate < high < very_high)', () => {
    const baseInput = {
      age: 60, sex: 'male' as const, smoking: true, sbpMmHg: 145,
      totalCholMgDl: 215, hdlMgDl: 39,
    };
    const r_low = computeScore2({ ...baseInput, riskRegion: 'low' });
    const r_mod = computeScore2({ ...baseInput, riskRegion: 'moderate' });
    const r_high = computeScore2({ ...baseInput, riskRegion: 'high' });
    const r_vh = computeScore2({ ...baseInput, riskRegion: 'very_high' });
    expect(r_low.riskPercent).toBeLessThan(r_mod.riskPercent);
    expect(r_mod.riskPercent).toBeLessThan(r_high.riskPercent);
    expect(r_high.riskPercent).toBeLessThan(r_vh.riskPercent);
  });

  it('is deterministic across repeated invocations with identical inputs', () => {
    const input = SCORE2_GOLDEN[1]!.input;
    const a = computeScore2(input);
    const b = computeScore2(input);
    expect(a.riskPercent).toBe(b.riskPercent);
    expect(a.calibratedRisk).toBe(b.calibratedRisk);
    expect(a.uncalibratedRisk).toBe(b.uncalibratedRisk);
  });

  it('never returns NaN for valid in-range inputs', () => {
    for (const c of SCORE2_GOLDEN) {
      const out = computeScore2(c.input);
      expect(Number.isFinite(out.riskPercent)).toBe(true);
      expect(Number.isFinite(out.uncalibratedRisk)).toBe(true);
    }
  });
});

describe('SCORE2-Diabetes — production engine matches reference', () => {
  for (const c of SCORE2_DIABETES_GOLDEN) {
    it(`golden ${c.description}`, () => {
      const ref = refScore2Diabetes(c.input);
      const out = computeScore2Diabetes(c.input);
      expect(Math.abs(out.riskPercent - ref.recal)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(out.uncalibratedRisk - ref.uncal)).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  it('uses canonical cll recalibration (not shortcut S0^exp)', () => {
    const input: Score2DiabetesInput = {
      age: 60, sex: 'female', smoking: true,
      sbpMmHg: 145, totalCholMgDl: 220, hdlMgDl: 42,
      riskRegion: 'high',
      ageAtDiabetesDiagnosis: 50, hba1cPercent: 8.0, eGFR: 65,
    };
    const ref = refScore2Diabetes(input);
    const out = computeScore2Diabetes(input);
    expect(out.riskPercent).toBeCloseTo(ref.recal, 1);
  });
});
