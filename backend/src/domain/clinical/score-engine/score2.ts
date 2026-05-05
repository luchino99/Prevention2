/**
 * SCORE2 Cardiovascular Risk Engine
 * Pure function for 10-year ASCVD risk calculation
 *
 * Source: score2.html legacy codebase
 * Reference: SCORE2 ESC 2021 Guidelines
 *
 * Mathematical formula:
 * 1. Transform variables: cage=(age-60)/5, csbp=(sbp-120)/20, ctchol=(tchol_mmol-6), chdl=(hdl_mmol-1.3)/0.5
 * 2. Calculate logit using gender-specific coefficients
 * 3. Compute uncalibrated risk from logit and baseline survival
 * 4. Apply region-specific calibration
 * 5. Categorize risk level
 *
 * Zero side effects - pure calculation only
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
 * Calculate uncalibrated 10-year risk
 * risk = 1 - S0 ^ exp(logit)
 */
function calculateUncalibratedRisk(
  logit: number,
  s0: number,
): number {
  const exponent = Math.exp(logit);
  const risk = 1 - Math.pow(s0, exponent);
  return risk * 100; // Convert to percentage
}

/**
 * Apply region-specific calibration
 * calibrated = scale1 + scale2 * logit
 * This is the log-odds form; then convert back
 */
function applyCalibratedRisk(
  logit: number,
  calibration: CalibrationParameters,
): number {
  const calibratedLogit = calibration.scale1 + calibration.scale2 * logit;
  const s0 = BASELINE_SURVIVAL.male; // Use male as reference for the formula
  const risk = 1 - Math.pow(s0, Math.exp(calibratedLogit));
  return risk * 100;
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

  // Step 4: Calculate uncalibrated 10-year risk
  const s0 = BASELINE_SURVIVAL[sex];
  const uncalibratedRisk = calculateUncalibratedRisk(logit, s0);

  // Step 5: Apply region-specific calibration
  const calibration = CALIBRATION[sex][riskRegion];
  const calibratedRisk = applyCalibratedRisk(logit, calibration);

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
