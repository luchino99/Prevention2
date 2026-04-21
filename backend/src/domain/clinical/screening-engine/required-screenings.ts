/**
 * Clinical Screening Recommendations Engine
 * Determines recommended clinical screenings based on demographics, scores, and risk profile
 * Evidence-based, deterministic screening logic
 *
 * Zero side effects - pure calculation only
 */

import type { ScoreResultEntry } from '../../../../../shared/types/clinical.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ScreeningRecommendation {
  screening: string;
  reason: string;
  priority: 'routine' | 'moderate' | 'urgent';
  intervalMonths: number;
}

export interface ScreeningInput {
  age: number;
  sex: 'male' | 'female';
  scoreResults: ScoreResultEntry[];
  diagnoses: string[];
}

// ============================================================================
// Constants
// ============================================================================

const SCREENING_INTERVALS = {
  ROUTINE: 12,
  MODERATE: 6,
  URGENT: 3,
  INTENSIVE: 1,
};

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Find a score result by code (case-insensitive).
 * See composite-risk.ts for rationale.
 */
function findScoreByCode(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

/**
 * Check if a diagnosis is present
 */
function hasDiagnosis(diagnoses: string[], target: string): boolean {
  return diagnoses.some((d) => d.toLowerCase().includes(target.toLowerCase()));
}

/**
 * Derive cardiovascular risk level from SCORE2
 */
function getCardiovascularRiskLevel(
  scoreResult?: ScoreResultEntry,
): 'low' | 'moderate' | 'high' | 'very_high' | null {
  if (!scoreResult) {
    return null;
  }

  const category = scoreResult.category?.toLowerCase() || '';

  if (category.includes('very high')) return 'very_high';
  if (category.includes('high')) return 'high';
  if (category.includes('moderate')) return 'moderate';
  return 'low';
}

// ============================================================================
// Screening Logic Functions (Pure)
// ============================================================================

/**
 * Lipid panel screening recommendations
 */
function deriveLipidPanelScreening(
  age: number,
  scoreResults: ScoreResultEntry[],
): ScreeningRecommendation | null {
  const score2 = findScoreByCode(scoreResults, 'SCORE2');
  const cvRiskLevel = getCardiovascularRiskLevel(score2);

  // Recommended if age>=40 or CV risk moderate+
  if (age >= 40 || cvRiskLevel === 'moderate' || cvRiskLevel === 'high' || cvRiskLevel === 'very_high') {
    return {
      screening: 'Lipid Panel (Total Cholesterol, LDL, HDL, Triglycerides)',
      reason: age >= 40
        ? `Standard screening for age ${age}`
        : `Elevated cardiovascular risk (${cvRiskLevel})`,
      priority: cvRiskLevel === 'very_high' ? 'urgent' : 'routine',
      intervalMonths: cvRiskLevel === 'very_high' ? 3 : 12,
    };
  }

  return null;
}

/**
 * HbA1c screening recommendations
 */
function deriveHbA1cScreening(
  scoreResults: ScoreResultEntry[],
  diagnoses: string[],
): ScreeningRecommendation | null {
  const adaResult = findScoreByCode(scoreResults, 'ADA');
  const adaScore = adaResult?.valueNumeric ?? 0;

  const hasDiabetes = hasDiagnosis(diagnoses, 'diabetes');
  const adaHighRisk = adaScore >= 5;

  if (hasDiabetes || adaHighRisk) {
    return {
      screening: 'HbA1c (Glycated Hemoglobin)',
      reason: hasDiabetes
        ? 'Diabetes management and glycemic control'
        : `High diabetes risk (ADA score ${adaScore})`,
      priority: hasDiabetes ? 'moderate' : 'routine',
      intervalMonths: hasDiabetes ? 6 : 12,
    };
  }

  return null;
}

/**
 * eGFR + ACR screening recommendations
 */
function deriveRenalScreening(
  scoreResults: ScoreResultEntry[],
  diagnoses: string[],
): ScreeningRecommendation | null {
  const egfrResult = findScoreByCode(scoreResults, 'eGFR');
  const egfr = egfrResult?.valueNumeric ?? 90;

  const hasDiabetes = hasDiagnosis(diagnoses, 'diabetes');
  const hasHypertension = hasDiagnosis(diagnoses, 'hypertension');
  const eGFRLow = egfr < 60;

  if (hasDiabetes || hasHypertension || eGFRLow) {
    let priority: 'routine' | 'moderate' | 'urgent' = 'routine';
    let reason = '';

    if (egfr < 30) {
      priority = 'urgent';
      reason = `Advanced CKD (eGFR ${egfr})`;
    } else if (eGFRLow) {
      priority = 'moderate';
      reason = `Reduced kidney function (eGFR ${egfr})`;
    } else if (hasDiabetes) {
      priority = 'moderate';
      reason = 'Diabetes requiring renal monitoring';
    } else {
      reason = 'Hypertension requiring renal monitoring';
    }

    return {
      screening: 'eGFR + Urine Albumin-to-Creatinine Ratio (ACR)',
      reason,
      priority,
      intervalMonths: priority === 'urgent' ? 3 : (priority === 'moderate' ? 6 : 12),
    };
  }

  return null;
}

/**
 * Liver function screening recommendations
 */
function deriveLiverFunctionScreening(
  scoreResults: ScoreResultEntry[],
): ScreeningRecommendation | null {
  const fliResult = findScoreByCode(scoreResults, 'FLI');
  const fib4Result = findScoreByCode(scoreResults, 'FIB4');

  const fli = fliResult?.valueNumeric ?? 0;
  const fib4 = fib4Result?.valueNumeric ?? 0;

  const fliElevated = fli >= 60;
  const fib4Elevated = fib4 >= 1.45;

  if (fliElevated || fib4Elevated) {
    let priority: 'routine' | 'moderate' | 'urgent' = 'routine';
    let reason = '';

    if (fib4 >= 3.25) {
      priority = 'urgent';
      reason = `Advanced fibrosis (FIB4 ${fib4.toFixed(2)})`;
    } else if (fliElevated && fib4Elevated) {
      priority = 'moderate';
      reason = `NASH likely (FLI ${fli.toFixed(0)}, FIB4 ${fib4.toFixed(2)})`;
    } else if (fliElevated) {
      priority = 'moderate';
      reason = `Elevated FLI (${fli.toFixed(0)}) - NAFLD risk`;
    } else {
      priority = 'routine';
      reason = `Borderline FIB4 (${fib4.toFixed(2)}) - monitor for fibrosis`;
    }

    return {
      screening: 'Liver Function Tests (AST, ALT, GGT, Bilirubin)',
      reason,
      priority,
      intervalMonths: priority === 'urgent' ? 3 : (priority === 'moderate' ? 6 : 12),
    };
  }

  return null;
}

/**
 * Blood pressure screening recommendations
 */
function deriveBloodPressureScreening(
  diagnoses: string[],
): ScreeningRecommendation {
  const hasHypertension = hasDiagnosis(diagnoses, 'hypertension');

  return {
    screening: 'Blood Pressure',
    reason: hasHypertension
      ? 'Hypertension management and control'
      : 'Routine cardiovascular health screening',
    priority: hasHypertension ? 'moderate' : 'routine',
    intervalMonths: hasHypertension ? 3 : 12,
  };
}

/**
 * Frailty assessment screening recommendations
 */
function deriveFrailtyScreening(age: number): ScreeningRecommendation | null {
  if (age >= 65) {
    return {
      screening: 'Frailty Assessment (FRAIL Scale)',
      reason: `Routine geriatric assessment for age ${age}`,
      priority: 'routine',
      intervalMonths: 12,
    };
  }

  return null;
}

/**
 * Echocardiogram screening recommendations for high CV risk
 */
function deriveEchocardiogramScreening(
  scoreResults: ScoreResultEntry[],
): ScreeningRecommendation | null {
  const score2 = findScoreByCode(scoreResults, 'SCORE2');
  const cvRiskLevel = getCardiovascularRiskLevel(score2);

  if (cvRiskLevel === 'very_high') {
    return {
      screening: 'Echocardiogram',
      reason: 'Very high cardiovascular risk assessment for structural heart disease',
      priority: 'urgent',
      intervalMonths: 6,
    };
  }

  return null;
}

/**
 * Ankle-Brachial Index (ABI) for atherosclerosis screening
 */
function deriveABIScreening(age: number, scoreResults: ScoreResultEntry[]): ScreeningRecommendation | null {
  const score2 = findScoreByCode(scoreResults, 'SCORE2');
  const cvRiskLevel = getCardiovascularRiskLevel(score2);

  if (age >= 65 || cvRiskLevel === 'high' || cvRiskLevel === 'very_high') {
    return {
      screening: 'Ankle-Brachial Index (ABI)',
      reason:
        age >= 65
          ? `Atherosclerotic disease screening for age ${age}`
          : 'Elevated cardiovascular risk',
      priority: cvRiskLevel === 'very_high' ? 'urgent' : 'moderate',
      intervalMonths: 12,
    };
  }

  return null;
}

// ============================================================================
// Main Screening Determination Function (Pure)
// ============================================================================

/**
 * Determine recommended clinical screenings based on demographics and risk profile
 *
 * Evidence-based screening recommendations including:
 * - Lipid panel
 * - HbA1c/fasting glucose
 * - Renal function (eGFR + ACR)
 * - Liver function
 * - Blood pressure
 * - Frailty assessment
 * - Advanced imaging for high-risk patients
 *
 * @param input - ScreeningInput with age, sex, score results, diagnoses
 * @returns Array of ScreeningRecommendation objects
 *
 * @example
 * const screenings = determineRequiredScreenings({
 *   age: 60,
 *   sex: 'male',
 *   scoreResults: [
 *     { scoreCode: 'SCORE2', valueNumeric: 8.5, category: 'High', ... },
 *     // ...
 *   ],
 *   diagnoses: ['Hypertension', 'Type 2 Diabetes']
 * });
 * // Returns recommendations for lipid panel, HbA1c, eGFR+ACR, BP, etc.
 */
export function determineRequiredScreenings(
  input: ScreeningInput,
): ScreeningRecommendation[] {
  const { age, sex: _sex, scoreResults, diagnoses } = input;

  const screenings: ScreeningRecommendation[] = [];

  // 1. Lipid panel
  const lipidPanel = deriveLipidPanelScreening(age, scoreResults);
  if (lipidPanel) {
    screenings.push(lipidPanel);
  }

  // 2. HbA1c
  const hba1c = deriveHbA1cScreening(scoreResults, diagnoses);
  if (hba1c) {
    screenings.push(hba1c);
  }

  // 3. Renal function
  const renalScreening = deriveRenalScreening(scoreResults, diagnoses);
  if (renalScreening) {
    screenings.push(renalScreening);
  }

  // 4. Liver function
  const liverFunction = deriveLiverFunctionScreening(scoreResults);
  if (liverFunction) {
    screenings.push(liverFunction);
  }

  // 5. Blood pressure (always recommended)
  const bpScreening = deriveBloodPressureScreening(diagnoses);
  screenings.push(bpScreening);

  // 6. Frailty assessment (if age >= 65)
  const frailtyScreening = deriveFrailtyScreening(age);
  if (frailtyScreening) {
    screenings.push(frailtyScreening);
  }

  // 7. Echocardiogram (if very high CV risk)
  const echoScreening = deriveEchocardiogramScreening(scoreResults);
  if (echoScreening) {
    screenings.push(echoScreening);
  }

  // 8. ABI (if age >= 65 or high CV risk)
  const abiScreening = deriveABIScreening(age, scoreResults);
  if (abiScreening) {
    screenings.push(abiScreening);
  }

  return screenings;
}
