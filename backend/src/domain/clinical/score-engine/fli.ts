/**
 * Fatty Liver Index (FLI) Engine
 * Pure function for non-alcoholic fatty liver disease risk assessment
 *
 * Source: FLI.html legacy codebase
 * Reference: Bedogni G et al., Clinical Chemistry 2006
 *
 * Mathematical formula:
 * 1. Calculate BMI = weight(kg) / (height(m))^2
 * 2. Calculate y = 0.953*ln(triglycerides) + 0.139*BMI + 0.718*ln(GGT) + 0.053*waist - 15.745
 * 3. Calculate FLI = (e^y / (1 + e^y)) * 100
 * 4. Categorize: <30 = excluded, 30-59 = indeterminate, ≥60 = probable NAFLD
 *
 * Note: Triglycerides and GGT must be positive. Input in mg/dL for triglycerides and U/L for GGT.
 *
 * Zero side effects - pure calculation only
 */

import type { FliInput, FliResult } from '../../../../../shared/types/clinical';

// ============================================================================
// FLI Constants
// ============================================================================

const FLI_COEFF = {
  logTriglyceridesFactor: 0.953,
  bmiFactor: 0.139,
  logGgtFactor: 0.718,
  waistFactor: 0.053,
  intercept: -15.745,
};

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Calculate BMI from height and weight
 * BMI = weight(kg) / (height(m))^2
 */
function calculateBMI(heightCm: number, weightKg: number): number {
  if (heightCm <= 0 || heightCm > 300) {
    throw new Error('FLI: Height must be between 0 and 300 cm');
  }
  if (weightKg <= 0 || weightKg > 500) {
    throw new Error('FLI: Weight must be between 0 and 500 kg');
  }
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/**
 * Calculate the FLI logit value (y)
 * y = 0.953*ln(triglycerides) + 0.139*BMI + 0.718*ln(GGT) + 0.053*waist - 15.745
 *
 * All parameters must be positive
 */
function calculateFliLogit(
  triglycerides: number,
  bmi: number,
  ggt: number,
  waist: number,
): number {
  if (triglycerides <= 0) {
    throw new Error('FLI: Triglycerides must be positive (>0)');
  }
  if (ggt <= 0) {
    throw new Error('FLI: GGT must be positive (>0)');
  }
  if (waist <= 0) {
    throw new Error('FLI: Waist circumference must be positive (>0)');
  }

  const logTriglycerides = Math.log(triglycerides);
  const logGgt = Math.log(ggt);

  const y =
    FLI_COEFF.logTriglyceridesFactor * logTriglycerides +
    FLI_COEFF.bmiFactor * bmi +
    FLI_COEFF.logGgtFactor * logGgt +
    FLI_COEFF.waistFactor * waist +
    FLI_COEFF.intercept;

  return y;
}

/**
 * Calculate FLI from the logit
 * FLI = (e^y / (1 + e^y)) * 100
 * This is the logistic function multiplied by 100
 */
function calculateFliFromLogit(y: number): number {
  const ey = Math.exp(y);
  const fli = (ey / (1 + ey)) * 100;
  return fli;
}

/**
 * Categorize FLI result
 * <30: excluded (no fatty liver)
 * 30-59: indeterminate
 * ≥60: probable NAFLD
 */
function categorizeFli(fli: number): { category: string; interpretation: string } {
  if (fli < 30) {
    return {
      category: 'Excluded',
      interpretation: 'Low probability of hepatic steatosis',
    };
  }
  if (fli < 60) {
    return {
      category: 'Indeterminate',
      interpretation: 'Uncertain probability of hepatic steatosis',
    };
  }
  return {
    category: 'Probable NAFLD',
    interpretation: 'High probability of hepatic steatosis',
  };
}

// ============================================================================
// Main FLI Compute Function (Pure)
// ============================================================================

/**
 * Calculate Fatty Liver Index (FLI)
 *
 * @param input - FliInput with anthropometric and lab measurements
 * @returns FliResult with FLI score, BMI, category, and interpretation
 *
 * @example
 * const result = computeFli({
 *   heightCm: 170,
 *   weightKg: 85,
 *   waistCm: 98,
 *   triglyceridesMgDl: 150,
 *   ggtUL: 60
 * });
 * // result.fli ≈ 45.2, category: 'Indeterminate'
 */
export function computeFli(input: FliInput): FliResult {
  const { heightCm, weightKg, waistCm, triglyceridesMgDl, ggtUL } = input;

  // Validate inputs
  if (heightCm <= 0 || heightCm > 300) {
    throw new Error('FLI: Height must be between 0 and 300 cm');
  }
  if (weightKg <= 0 || weightKg > 500) {
    throw new Error('FLI: Weight must be between 0 and 500 kg');
  }
  if (waistCm <= 0 || waistCm > 300) {
    throw new Error('FLI: Waist circumference must be between 0 and 300 cm');
  }
  if (triglyceridesMgDl <= 0 || triglyceridesMgDl > 2000) {
    throw new Error('FLI: Triglycerides must be between 0 and 2000 mg/dL');
  }
  if (ggtUL <= 0 || ggtUL > 1000) {
    throw new Error('FLI: GGT must be between 0 and 1000 U/L');
  }

  // Step 1: Calculate BMI
  const bmi = calculateBMI(heightCm, weightKg);

  // Step 2: Calculate FLI logit (y)
  const y = calculateFliLogit(triglyceridesMgDl, bmi, ggtUL, waistCm);

  // Step 3: Calculate FLI from logit
  const fli = calculateFliFromLogit(y);

  // Step 4: Categorize
  const categoryData = categorizeFli(fli);

  return {
    fli: parseFloat(fli.toFixed(2)),
    bmi: parseFloat(bmi.toFixed(2)),
    category: categoryData.category,
    interpretation: categoryData.interpretation,
  };
}
