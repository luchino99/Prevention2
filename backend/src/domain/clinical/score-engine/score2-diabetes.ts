/**
 * SCORE2-Diabetes Cardiovascular Risk Engine
 * Pure function for 10-year ASCVD risk calculation in diabetes patients
 *
 * Source: score2-diabetes.html legacy codebase
 * Reference: SCORE2-Diabetes ESC 2021 Guidelines
 *
 * Extends SCORE2 with diabetes-specific variables:
 * - Age at diabetes diagnosis
 * - HbA1c (% to mmol/mol conversion)
 * - eGFR (kidney function)
 *
 * Mathematical formula:
 * 1. Transform all variables including diabetes-specific ones
 * 2. Calculate logit using gender-specific coefficients (15 coefficients each gender)
 * 3. Compute uncalibrated risk from logit and baseline survival
 * 4. Apply region-specific calibration (same as SCORE2)
 * 5. Categorize risk level
 *
 * Zero side effects - pure calculation only
 */

import type { Score2DiabetesInput, Score2DiabetesResult } from '../../../../../shared/types/clinical.js';

// ============================================================================
// SCORE2-Diabetes Coefficients (from legacy codebase)
// ============================================================================

interface Score2DiabetesCoefficients {
  age: number;
  smoking: number;
  sbp: number;
  tchol: number;
  hdl: number;
  ageDiag: number;
  hba1c: number;
  egfr: number;
  smoke_age: number;
  sbp_age: number;
  chol_age: number;
  hdl_age: number;
  ageDiag_age: number;
  hba1c_age: number;
  egfr_age: number;
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

// Gender-specific coefficients for SCORE2-Diabetes
const COEFFICIENTS: Record<'male' | 'female', Score2DiabetesCoefficients> = {
  male: {
    age: 0.2241,
    smoking: 0.5765,
    sbp: 0.1849,
    tchol: 0.0871,
    hdl: -0.1553,
    ageDiag: -0.0327,
    hba1c: 0.0761,
    egfr: -0.1578,
    smoke_age: -0.0573,
    sbp_age: -0.0188,
    chol_age: -0.0229,
    hdl_age: 0.0282,
    ageDiag_age: 0.0081,
    hba1c_age: -0.0192,
    egfr_age: 0.0451,
  },
  female: {
    age: 0.3336,
    smoking: 0.7336,
    sbp: 0.2049,
    tchol: 0.0618,
    hdl: -0.1794,
    ageDiag: -0.0243,
    hba1c: 0.0769,
    egfr: -0.1375,
    smoke_age: -0.0782,
    sbp_age: -0.0098,
    chol_age: -0.0132,
    hdl_age: 0.0313,
    ageDiag_age: 0.0025,
    hba1c_age: -0.0070,
    egfr_age: 0.0318,
  },
};

// Baseline 10-year survival probability (different from SCORE2)
const BASELINE_SURVIVAL: Record<'male' | 'female', number> = {
  male: 0.9350,
  female: 0.9632,
};

// Calibration parameters per region (same as SCORE2)
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
 * Convert HbA1c from percentage to mmol/mol
 * Formula: (HbA1c_pct - 2.15) * 10.929
 */
function convertHba1cToMmolMol(hba1cPct: number): number {
  return (hba1cPct - 2.15) * 10.929;
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
 * Transform age at diabetes diagnosis: (age - ageDiagnosis - 10) / 5
 */
function transformAgeDiagnosis(age: number, ageAtDiabetesDiagnosis: number): number {
  return (age - ageAtDiabetesDiagnosis - 10) / 5;
}

/**
 * Transform HbA1c in mmol/mol: (hba1c_mmol - 31) / 9.34
 */
function transformHba1cMmol(hba1cMmol: number): number {
  return (hba1cMmol - 31) / 9.34;
}

/**
 * Transform eGFR: (ln(eGFR) - 4.5) / 0.15
 */
function transformEgfr(egfr: number): number {
  if (egfr <= 0) {
    throw new Error('SCORE2-Diabetes: eGFR must be positive');
  }
  return (Math.log(egfr) - 4.5) / 0.15;
}

/**
 * Calculate logit from transformed variables and coefficients
 * EXACT formula from legacy (15 coefficients including diabetes-specific):
 * logit = coef.age * cage + coef.smoking * smoking + coef.sbp * csbp +
 *         coef.tchol * ctchol + coef.hdl * chdl + coef.ageDiag * cageDiag +
 *         coef.hba1c * chba1c + coef.egfr * cegfr +
 *         coef.smoke_age * smoking * cage + coef.sbp_age * csbp * cage +
 *         coef.chol_age * ctchol * cage + coef.hdl_age * chdl * cage +
 *         coef.ageDiag_age * cageDiag * cage + coef.hba1c_age * chba1c * cage +
 *         coef.egfr_age * cegfr * cage
 */
function calculateLogit(
  coeffs: Score2DiabetesCoefficients,
  cage: number,
  csbp: number,
  ctchol: number,
  chdl: number,
  cageDiag: number,
  chba1c: number,
  cegfr: number,
  smoking: boolean,
): number {
  const smokingValue = smoking ? 1 : 0;

  const logit =
    coeffs.age * cage +
    coeffs.smoking * smokingValue +
    coeffs.sbp * csbp +
    coeffs.tchol * ctchol +
    coeffs.hdl * chdl +
    coeffs.ageDiag * cageDiag +
    coeffs.hba1c * chba1c +
    coeffs.egfr * cegfr +
    coeffs.smoke_age * smokingValue * cage +
    coeffs.sbp_age * csbp * cage +
    coeffs.chol_age * ctchol * cage +
    coeffs.hdl_age * chdl * cage +
    coeffs.ageDiag_age * cageDiag * cage +
    coeffs.hba1c_age * chba1c * cage +
    coeffs.egfr_age * cegfr * cage;

  return logit;
}

/**
 * Calculate uncalibrated 10-year risk
 * risk = 1 - S0 ^ exp(logit)
 */
function calculateUncalibratedRisk(logit: number, s0: number): number {
  const exponent = Math.exp(logit);
  const risk = 1 - Math.pow(s0, exponent);
  return risk * 100; // Convert to percentage
}

/**
 * Apply region-specific calibration
 * calibrated = scale1 + scale2 * logit
 */
function applyCalibratedRisk(
  logit: number,
  calibration: CalibrationParameters,
  s0: number,
): number {
  const calibratedLogit = calibration.scale1 + calibration.scale2 * logit;
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
// Main SCORE2-Diabetes Compute Function (Pure)
// ============================================================================

/**
 * Calculate SCORE2-Diabetes 10-year cardiovascular risk
 *
 * @param input - Score2DiabetesInput with demographic, lipid, and diabetes-specific variables
 * @returns Score2DiabetesResult with calibrated/uncalibrated risk, category, and region
 *
 * @example
 * const result = computeScore2Diabetes({
 *   age: 60,
 *   sex: 'female',
 *   smoking: false,
 *   sbpMmHg: 140,
 *   totalCholMgDl: 230,
 *   hdlMgDl: 45,
 *   riskRegion: 'moderate',
 *   ageAtDiabetesDiagnosis: 52,
 *   hba1cPercent: 7.2,
 *   eGFR: 68
 * });
 * // result.riskPercent ≈ 8.5, category: 'High'
 */
export function computeScore2Diabetes(input: Score2DiabetesInput): Score2DiabetesResult {
  const {
    age,
    sex,
    smoking,
    sbpMmHg,
    totalCholMgDl,
    hdlMgDl,
    riskRegion,
    ageAtDiabetesDiagnosis,
    hba1cPercent,
    eGFR,
  } = input;

  // Validate inputs
  if (age < 40 || age > 80) {
    throw new Error('SCORE2-Diabetes: Age must be between 40 and 80');
  }
  if (ageAtDiabetesDiagnosis < 18 || ageAtDiabetesDiagnosis >= age) {
    throw new Error(
      'SCORE2-Diabetes: Age at diabetes diagnosis must be between 18 and less than current age',
    );
  }
  if (sbpMmHg < 60 || sbpMmHg > 250) {
    throw new Error('SCORE2-Diabetes: SBP must be between 60 and 250 mmHg');
  }
  if (totalCholMgDl < 50 || totalCholMgDl > 400) {
    throw new Error('SCORE2-Diabetes: Total cholesterol must be between 50 and 400 mg/dL');
  }
  if (hdlMgDl < 20 || hdlMgDl > 150) {
    throw new Error('SCORE2-Diabetes: HDL must be between 20 and 150 mg/dL');
  }
  if (hba1cPercent < 3 || hba1cPercent > 15) {
    throw new Error('SCORE2-Diabetes: HbA1c must be between 3% and 15%');
  }
  if (eGFR < 15 || eGFR > 180) {
    throw new Error('SCORE2-Diabetes: eGFR must be between 15 and 180 mL/min/1.73m²');
  }

  // Get gender-specific coefficients
  const coeffs = COEFFICIENTS[sex];

  // Step 1: Convert lipids from mg/dL to mmol/L
  const tcholMmol = convertCholesterolUnits(totalCholMgDl);
  const hdlMmol = convertCholesterolUnits(hdlMgDl);

  // Step 2: Convert HbA1c from % to mmol/mol
  const hba1cMmol = convertHba1cToMmolMol(hba1cPercent);

  // Step 3: Transform all variables
  const cage = transformAge(age);
  const csbp = transformSBP(sbpMmHg);
  const ctchol = transformTotalCholesterol(tcholMmol);
  const chdl = transformHDL(hdlMmol);
  const cageDiag = transformAgeDiagnosis(age, ageAtDiabetesDiagnosis);
  const chba1c = transformHba1cMmol(hba1cMmol);
  const cegfr = transformEgfr(eGFR);

  // Step 4: Calculate logit
  const logit = calculateLogit(
    coeffs,
    cage,
    csbp,
    ctchol,
    chdl,
    cageDiag,
    chba1c,
    cegfr,
    smoking,
  );

  // Step 5: Calculate uncalibrated 10-year risk
  const s0 = BASELINE_SURVIVAL[sex];
  const uncalibratedRisk = calculateUncalibratedRisk(logit, s0);

  // Step 6: Apply region-specific calibration
  const calibration = CALIBRATION[sex][riskRegion];
  const calibratedRisk = applyCalibratedRisk(logit, calibration, s0);

  // Step 7: Categorize
  const category = categorizeRisk(calibratedRisk);

  return {
    riskPercent: parseFloat(calibratedRisk.toFixed(2)),
    category,
    calibratedRisk: parseFloat(calibratedRisk.toFixed(2)),
    uncalibratedRisk: parseFloat(uncalibratedRisk.toFixed(2)),
    region: riskRegion,
  };
}
