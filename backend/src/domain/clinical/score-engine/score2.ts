/**
 * SCORE2 Cardiovascular Risk Engine
 *
 * Reference (primary source):
 *   Hageman SHJ, Pennells L, Ojeda F, et al. SCORE2 risk prediction
 *   algorithms: new models to estimate 10-year risk of cardiovascular
 *   disease in Europe. Eur Heart J. 2021;42(25):2439-2454.
 *   doi:10.1093/eurheartj/ehab309
 *
 * The model (paper Supplementary Material §4 + Box S5):
 *
 *   Linear predictor:
 *     LP = β_age·cage + β_smoking·smoking + β_sbp·csbp + β_chol·ctchol + β_hdl·chdl
 *        + β_smoke·age·smoking·cage + β_sbp·age·csbp·cage + β_chol·age·ctchol·cage + β_hdl·age·chdl·cage
 *
 *   Variable centering:
 *     cage   = (age - 60) / 5
 *     csbp   = (sbp - 120) / 20
 *     ctchol = tchol_mmol - 6
 *     chdl   = (hdl_mmol - 1.3) / 0.5
 *
 *   Uncalibrated 10-year risk (with sex-specific baseline survival):
 *     Uncal_risk = 1 - S0_sex^exp(LP)
 *
 *   Recalibration (paper Box S5 — canonical complementary log-log form):
 *     Recal_risk = 1 - exp(-exp(scale1 + scale2 · ln(-ln(1 - Uncal_risk))))
 *
 * Audit AUD-2026-05-04 finding C-01 (CLOSED in Tier-5):
 *   The previous implementation used a shortcut form
 *   `1 - S0_male^exp(scale1 + scale2·LP)` with male baseline survival
 *   hard-coded for both sexes. Algebraically that form is NOT
 *   equivalent to the paper's complementary log-log recalibration
 *   for any (scale2, S0_sex) combination, and produced clinically
 *   significant under-estimates (e.g. M, 62y, smoker, SBP 168, TC
 *   251 mg/dL: shortcut = 11.68%, canonical = 21.04% → "high" vs
 *   "very high" misclassification). This file now implements the
 *   canonical formula directly.
 *
 *   See also `tests/unit/score2-golden.test.ts` for the offline
 *   reference-implementation cross-check against this file's output,
 *   covering 9 cases across sex × region × age band. The
 *   reference-implementation lives in the test file (intentionally
 *   independent from production code) and is itself derived from
 *   the paper's published formula.
 *
 * Zero side effects — pure calculation only.
 */

import type { Score2Input, Score2Result } from '../../../../../shared/types/clinical.js';

// ============================================================================
// SCORE2 Coefficients (from legacy codebase)
// ============================================================================

interface Score2Coefficients {
  age: number;
  smoking: number;
  sbp: number;
  tchol: number;
  hdl: number;
  smoke_age: number;
  sbp_age: number;
  chol_age: number;
  hdl_age: number;
}

interface Score2BaselineSurvival {
  male: number;
  female: number;
}

interface CalibrationParameters {
  scale1: number;
  scale2: number;
}

interface RegionCalibration {
  low: CalibrationParameters;
  moderate: CalibrationParameters;
  high: CalibrationParameters;
  very_high: CalibrationParameters;
}

// Gender-specific coefficients
const COEFFICIENTS: Record<'male' | 'female', Score2Coefficients> = {
  male: {
    age: 0.3742,
    smoking: 0.6012,
    sbp: 0.2777,
    tchol: 0.1458,
    hdl: -0.2698,
    smoke_age: -0.0755,
    sbp_age: -0.0255,
    chol_age: -0.0281,
    hdl_age: 0.0426,
  },
  female: {
    age: 0.4648,
    smoking: 0.7744,
    sbp: 0.3131,
    tchol: 0.1002,
    hdl: -0.2606,
    smoke_age: -0.1088,
    sbp_age: -0.0277,
    chol_age: -0.0226,
    hdl_age: 0.0613,
  },
};

// Baseline 10-year survival probability
const BASELINE_SURVIVAL: Score2BaselineSurvival = {
  male: 0.9605,
  female: 0.9776,
};

// Calibration parameters per region (4 regions × 2 genders)
const CALIBRATION: Record<'male' | 'female', RegionCalibration> = {
  male: {
    low: { scale1: -0.5699, scale2: 0.7476 },
    moderate: { scale1: -0.1565, scale2: 0.8001 },
    high: { scale1: 0.3207, scale2: 0.9360 },
    very_high: { scale1: 0.5836, scale2: 0.8294 },
  },
  female: {
    low: { scale1: -0.7380, scale2: 0.7019 },
    moderate: { scale1: -0.3143, scale2: 0.7609 },
    high: { scale1: 0.2508, scale2: 0.9369 },
    very_high: { scale1: 0.4370, scale2: 0.7820 },
  },
};

// ============================================================================
// Unit Conversion Constants
// ============================================================================

const MG_DL_TO_MMOL_L = 1 / 38.67;

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Convert total cholesterol and HDL from mg/dL to mmol/L
 */
function convertCholesterolUnits(mgDl: number): number {
  return mgDl * MG_DL_TO_MMOL_L;
}

/**
 * Transform age variable: (age - 60) / 5
 */
function transformAge(age: number): number {
  return (age - 60) / 5;
}

/**
 * Transform SBP variable: (sbp - 120) / 20
 */
function transformSBP(sbpMmHg: number): number {
  return (sbpMmHg - 120) / 20;
}

/**
 * Transform total cholesterol: (tchol_mmol - 6)
 */
function transformTotalCholesterol(tcholMmol: number): number {
  return tcholMmol - 6;
}

/**
 * Transform HDL: (hdl_mmol - 1.3) / 0.5
 */
function transformHDL(hdlMmol: number): number {
  return (hdlMmol - 1.3) / 0.5;
}

/**
 * Calculate logit from transformed variables and coefficients
 * EXACT formula from legacy:
 * logit = coef.age * cage + coef.smoking * smoking + coef.sbp * csbp +
 *         coef.tchol * ctchol + coef.hdl * chdl +
 *         coef.smoke_age * smoking * cage + coef.sbp_age * csbp * cage +
 *         coef.chol_age * ctchol * cage + coef.hdl_age * chdl * cage
 */
function calculateLogit(
  coeffs: Score2Coefficients,
  cage: number,
  csbp: number,
  ctchol: number,
  chdl: number,
  smoking: boolean,
): number {
  const smokingValue = smoking ? 1 : 0;

  const logit =
    coeffs.age * cage +
    coeffs.smoking * smokingValue +
    coeffs.sbp * csbp +
    coeffs.tchol * ctchol +
    coeffs.hdl * chdl +
    coeffs.smoke_age * smokingValue * cage +
    coeffs.sbp_age * csbp * cage +
    coeffs.chol_age * ctchol * cage +
    coeffs.hdl_age * chdl * cage;

  return logit;
}

/**
 * Calculate uncalibrated 10-year risk (sex-specific baseline survival).
 * Returns the risk as a fraction in [0,1] (NOT percent) — easier to
 * compose with the recalibration step that consumes the fraction
 * directly via the complementary log-log transformation.
 *
 * Formula: risk_uncal = 1 - S0_sex^exp(LP)
 */
function calculateUncalibratedRiskFraction(logit: number, s0: number): number {
  const exponent = Math.exp(logit);
  return 1 - Math.pow(s0, exponent);
}

/**
 * Apply region-specific recalibration per Hageman 2021 Box S5
 * (canonical complementary log-log form).
 *
 *   cll_uncal = ln(-ln(1 - uncalibratedRisk))
 *   cll_cal   = scale1 + scale2 · cll_uncal
 *   risk_cal  = 1 - exp(-exp(cll_cal))
 *
 * The published `scale1, scale2` parameters are calibrated for THIS
 * formula. Using them with any "shortcut" expression
 * (e.g. `1 - S0^exp(scale1 + scale2·LP)`) is mathematically distinct
 * and produces different numbers — see the file header for the
 * derivation and the audit reference.
 *
 * Returns the recalibrated risk in PERCENT (0..100).
 */
function applyCalibratedRisk(
  uncalibratedRiskFraction: number,
  calibration: CalibrationParameters,
): number {
  // Mathematical guards on the cll transform domain.
  if (uncalibratedRiskFraction <= 0) return 0;
  if (uncalibratedRiskFraction >= 1) return 100;

  const cllUncal = Math.log(-Math.log(1 - uncalibratedRiskFraction));
  const cllCal = calibration.scale1 + calibration.scale2 * cllUncal;
  const calibratedRiskFraction = 1 - Math.exp(-Math.exp(cllCal));
  return calibratedRiskFraction * 100;
}

/**
 * Categorize risk based on percentage
 */
function categorizeRisk(riskPercent: number): string {
  if (riskPercent < 2) return 'Low';
  if (riskPercent < 5) return 'Moderate';
  if (riskPercent < 10) return 'High';
  return 'Very High';
}

// ============================================================================
// Main SCORE2 Compute Function (Pure)
// ============================================================================

/**
 * Calculate SCORE2 10-year cardiovascular risk
 *
 * @param input - Score2Input with age, sex, smoking, SBP, lipids, risk region
 * @returns Score2Result with calibrated/uncalibrated risk, category, and region
 *
 * @example
 * const result = computeScore2({
 *   age: 55,
 *   sex: 'male',
 *   smoking: true,
 *   sbpMmHg: 135,
 *   totalCholMgDl: 250,
 *   hdlMgDl: 40,
 *   riskRegion: 'moderate'
 * });
 * // result.riskPercent ≈ 5.2, category: 'Moderate'
 */
export function computeScore2(input: Score2Input): Score2Result {
  const {
    age,
    sex,
    smoking,
    sbpMmHg,
    totalCholMgDl,
    hdlMgDl,
    riskRegion,
  } = input;

  // Validate inputs
  if (age < 40 || age > 80) {
    throw new Error('SCORE2: Age must be between 40 and 80');
  }
  if (sbpMmHg < 60 || sbpMmHg > 250) {
    throw new Error('SCORE2: SBP must be between 60 and 250 mmHg');
  }
  if (totalCholMgDl < 50 || totalCholMgDl > 400) {
    throw new Error('SCORE2: Total cholesterol must be between 50 and 400 mg/dL');
  }
  if (hdlMgDl < 20 || hdlMgDl > 150) {
    throw new Error('SCORE2: HDL must be between 20 and 150 mg/dL');
  }

  // Get gender-specific coefficients
  const coeffs = COEFFICIENTS[sex];

  // Step 1: Convert lipids from mg/dL to mmol/L
  const tcholMmol = convertCholesterolUnits(totalCholMgDl);
  const hdlMmol = convertCholesterolUnits(hdlMgDl);

  // Step 2: Transform all variables
  const cage = transformAge(age);
  const csbp = transformSBP(sbpMmHg);
  const ctchol = transformTotalCholesterol(tcholMmol);
  const chdl = transformHDL(hdlMmol);

  // Step 3: Calculate logit
  const logit = calculateLogit(coeffs, cage, csbp, ctchol, chdl, smoking);

  // Step 4: Uncalibrated 10-year risk (sex-specific baseline survival).
  const s0 = BASELINE_SURVIVAL[sex];
  const uncalibratedFraction = calculateUncalibratedRiskFraction(logit, s0);
  const uncalibratedRisk = uncalibratedFraction * 100;

  // Step 5: Region-specific recalibration (paper Box S5 — cll form).
  const calibration = CALIBRATION[sex][riskRegion];
  const calibratedRisk = applyCalibratedRisk(uncalibratedFraction, calibration);

  // Step 6: Categorize
  const category = categorizeRisk(calibratedRisk);

  return {
    riskPercent: parseFloat(calibratedRisk.toFixed(2)),
    category,
    calibratedRisk: parseFloat(calibratedRisk.toFixed(2)),
    uncalibratedRisk: parseFloat(uncalibratedRisk.toFixed(2)),
    region: riskRegion,
  };
}
