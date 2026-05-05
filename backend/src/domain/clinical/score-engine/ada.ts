/**
 * ADA Diabetes Risk Score Engine
 * Pure function for 7-year type 2 diabetes risk assessment
 *
 * Source: ADA-score.html legacy codebase
 * Reference: American Diabetes Association Risk Assessment Tool
 *
 * Mathematical formula (Simple additive scoring):
 * 1. Age: 0 pts if <40; 1 pt if 40-49; 2 pts if 50-59; 3 pts if ≥60
 * 2. Sex: 1 pt if male; 0 pts if female
 * 3. Gestational diabetes (female only): 1 pt if yes
 * 4. Family history of diabetes: 1 pt if yes
 * 5. Hypertension: 1 pt if yes
 * 6. Physical inactivity (<150 min/week): 1 pt if yes
 * 7. BMI: 1 pt if 25-29.9; 2 pts if 30-39.9; 3 pts if ≥40
 *
 * Risk categories: 0-2 = low, 3-4 = moderate, ≥5 = high
 *
 * Zero side effects - pure calculation only
 */

import type { AdaInput, AdaResult } from '../../../../../shared/types/clinical.js';

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Calculate BMI from height and weight
 * BMI = weight(kg) / (height(m))^2
 */
function calculateBMI(heightCm: number, weightKg: number): number {
  if (heightCm <= 0 || weightKg <= 0) {
    throw new Error('ADA: Height and weight must be positive values');
  }
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/**
 * Score age component
 * 40-49: 1 pt, 50-59: 2 pts, ≥60: 3 pts, <40: 0 pts
 */
function scoreAge(age: number): { points: number; label: string } {
  if (age < 0 || age > 150) {
    throw new Error('ADA: Age must be between 0 and 150');
  }
  if (age < 40) {
    return { points: 0, label: '<40 years' };
  }
  if (age < 50) {
    return { points: 1, label: '40-49 years' };
  }
  if (age < 60) {
    return { points: 2, label: '50-59 years' };
  }
  return { points: 3, label: '≥60 years' };
}

/**
 * Score sex component
 * Male: 1 pt, Female: 0 pts
 */
function scoreSex(sex: 'male' | 'female'): { points: number; label: string } {
  return sex === 'male'
    ? { points: 1, label: 'Male' }
    : { points: 0, label: 'Female' };
}

/**
 * Score gestational diabetes (female only)
 * Yes: 1 pt, No: 0 pts
 */
function scoreGestationalDiabetes(
  gestationalDiabetes: boolean,
  sex: 'male' | 'female',
): { points: number; label: string } {
  if (sex === 'male') {
    return { points: 0, label: 'Not applicable (male)' };
  }
  return gestationalDiabetes
    ? { points: 1, label: 'Yes' }
    : { points: 0, label: 'No' };
}

/**
 * Score family history of diabetes
 * Yes: 1 pt, No: 0 pts
 */
function scoreFamilyHistory(
  familyHistoryDiabetes: boolean,
): { points: number; label: string } {
  return familyHistoryDiabetes
    ? { points: 1, label: 'Yes' }
    : { points: 0, label: 'No' };
}

/**
 * Score hypertension
 * Yes: 1 pt, No: 0 pts
 */
function scoreHypertension(hypertension: boolean): { points: number; label: string } {
  return hypertension
    ? { points: 1, label: 'Yes' }
    : { points: 0, label: 'No' };
}

/**
 * Score physical activity
 * Inactive (<150 min/week): 1 pt, Active (≥150 min/week): 0 pts
 */
function scorePhysicalActivity(
  physicallyActive: boolean,
): { points: number; label: string } {
  return !physicallyActive
    ? { points: 1, label: 'Inactive (<150 min/week)' }
    : { points: 0, label: 'Active (≥150 min/week)' };
}

/**
 * Score BMI component
 * <25: 0 pts, 25-29.9: 1 pt, 30-39.9: 2 pts, ≥40: 3 pts
 */
function scoreBMI(bmi: number): { points: number; label: string } {
  if (bmi < 18.5) {
    return { points: 0, label: '<25 kg/m² (underweight/normal)' };
  }
  if (bmi < 25) {
    return { points: 0, label: '<25 kg/m² (normal)' };
  }
  if (bmi < 30) {
    return { points: 1, label: '25-29.9 kg/m² (overweight)' };
  }
  if (bmi < 40) {
    return { points: 2, label: '30-39.9 kg/m² (obese)' };
  }
  return { points: 3, label: '≥40 kg/m² (severely obese)' };
}

/**
 * Categorize total ADA score
 * 0-2 = low, 3-4 = moderate, ≥5 = high
 */
function categorizeAdaScore(totalScore: number): string {
  if (totalScore <= 2) {
    return 'Low Risk';
  }
  if (totalScore <= 4) {
    return 'Moderate Risk';
  }
  return 'High Risk';
}

/**
 * Maximum possible score
 * Age: 3 + Sex: 1 + Gest: 1 + Family: 1 + HTN: 1 + Activity: 1 + BMI: 3 = 11
 */
const MAX_ADA_SCORE = 11;

// ============================================================================
// Main ADA Compute Function (Pure)
// ============================================================================

/**
 * Calculate ADA 7-year type 2 diabetes risk score
 *
 * @param input - AdaInput with demographics and risk factors
 * @returns AdaResult with total score, breakdown, and risk category
 *
 * @example
 * const result = computeAda({
 *   age: 52,
 *   sex: 'female',
 *   gestationalDiabetes: false,
 *   familyHistoryDiabetes: true,
 *   hypertension: true,
 *   physicallyActive: true,
 *   heightCm: 165,
 *   weightKg: 75
 * });
 * // result.score = 5, category: 'High Risk'
 */
export function computeAda(input: AdaInput): AdaResult {
  const {
    age,
    sex,
    gestationalDiabetes,
    familyHistoryDiabetes,
    hypertension,
    physicallyActive,
    heightCm,
    weightKg,
  } = input;

  // Validate inputs
  if (age < 0 || age > 150) {
    throw new Error('ADA: Age must be between 0 and 150');
  }
  if (heightCm <= 0 || heightCm > 250) {
    throw new Error('ADA: Height must be between 0 and 250 cm');
  }
  if (weightKg <= 0 || weightKg > 300) {
    throw new Error('ADA: Weight must be between 0 and 300 kg');
  }

  // Calculate BMI
  const bmi = calculateBMI(heightCm, weightKg);

  // Score each component
  const ageScore = scoreAge(age);
  const sexScore = scoreSex(sex);
  const gestScore = scoreGestationalDiabetes(gestationalDiabetes, sex);
  const familyScore = scoreFamilyHistory(familyHistoryDiabetes);
  const htnScore = scoreHypertension(hypertension);
  const activityScore = scorePhysicalActivity(physicallyActive);
  const bmiScore = scoreBMI(bmi);

  // Calculate total score
  const totalScore =
    ageScore.points +
    sexScore.points +
    gestScore.points +
    familyScore.points +
    htnScore.points +
    activityScore.points +
    bmiScore.points;

  // Categorize
  const category = categorizeAdaScore(totalScore);

  // Build breakdown for transparency
  const breakdown: Record<string, number> = {
    age: ageScore.points,
    sex: sexScore.points,
    gestationalDiabetes: gestScore.points,
    familyHistory: familyScore.points,
    hypertension: htnScore.points,
    physicalActivity: activityScore.points,
    bmi: bmiScore.points,
  };

  return {
    score: totalScore,
    maxScore: MAX_ADA_SCORE,
    category,
    breakdown,
  };
}
