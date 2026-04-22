/**
 * Nutrition Assessment Engine - PREDIMED & Metabolic Rate
 * Computes PREDIMED diet quality score and generates comprehensive nutrition summary
 * including Basal Metabolic Rate (Mifflin-St Jeor) and Total Daily Energy Expenditure
 *
 * Reference: Estruch et al., PREDIMED Study; Mifflin & St Jeor (1990) for BMR
 *
 * Zero side effects - pure calculation only
 */

import type { PredimedResult } from '../../../../../shared/types/clinical.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface NutritionSummary {
  predimedScore: number | null;
  adherenceBand: 'low' | 'medium' | 'high' | null;
  bmrKcal: number;
  tdeeKcal: number;
  activityFactor: number;
  activityLevel: string;
}

export interface NutritionInput {
  predimedAnswers?: boolean[];
  weightKg: number;
  heightCm: number;
  age: number;
  sex: 'male' | 'female';
  activityLevel?: string;
}

// ============================================================================
// Constants
// ============================================================================

const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  vigorous: 1.725,
  extreme: 1.9,
};

const DEFAULT_ACTIVITY_FACTOR = 1.2; // sedentary

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Maximum PREDIMED MEDAS score (14 yes/no items).
 *
 * Exported as a named constant so the score-engine orchestrator and the
 * UI can reference the same value without repeating the magic number.
 */
export const PREDIMED_MAX_SCORE = 14;

/**
 * Compute PREDIMED MEDAS score from 14 yes/no answers.
 *
 * Validated instrument from Estruch et al. (PREDIMED trial). We intentionally
 * do not alter the scoring logic — the score is simply the count of
 * positively-answered items, capped at `PREDIMED_MAX_SCORE`.
 *
 * Exported so `computeAllScores` in the score-engine orchestrator can
 * emit a canonical `ScoreResultEntry` with `scoreCode = 'PREDIMED'`
 * without duplicating the formula.
 *
 * @param answers - Array of boolean answers (expected length 14). Shorter
 *   arrays return a partial count; longer arrays are truncated to 14.
 * @returns score 0..14
 */
export function computePredimedScore(answers: boolean[] | undefined | null): number {
  if (!Array.isArray(answers)) {
    return 0;
  }
  // Count "true" answers, cap at 14
  const validAnswers = answers.slice(0, PREDIMED_MAX_SCORE);
  return validAnswers.filter((a) => a === true).length;
}

/**
 * Categorize PREDIMED adherence according to the canonical cut-offs
 * from the validation literature: low (0–4), medium (5–9), high (10–14).
 *
 * Exported for the score-engine orchestrator; returns `null` on
 * out-of-range input rather than throwing, which matches the permissive
 * semantics of the rest of the clinical engine.
 */
export function categorizePredimedAdherence(
  score: number,
): 'low' | 'medium' | 'high' | null {
  if (!Number.isFinite(score) || score < 0 || score > PREDIMED_MAX_SCORE) {
    return null;
  }
  if (score <= 4) return 'low';
  if (score <= 9) return 'medium';
  return 'high';
}

/**
 * Calculate Basal Metabolic Rate using Mifflin-St Jeor equation
 *
 * Male BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) + 5
 * Female BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) - 161
 *
 * @param weight_kg - Weight in kilograms
 * @param height_cm - Height in centimeters
 * @param age - Age in years
 * @param sex - 'male' or 'female'
 * @returns BMR in kcal/day
 */
function calculateBMRMiffinStJeor(
  weight_kg: number,
  height_cm: number,
  age: number,
  sex: 'male' | 'female',
): number {
  if (weight_kg <= 0 || height_cm <= 0 || age < 0 || age > 150) {
    throw new Error(
      'PREDIMED: Invalid inputs for BMR calculation (weight, height, age)',
    );
  }

  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;

  if (sex === 'male') {
    return base + 5;
  } else {
    return base - 161;
  }
}

/**
 * Normalize activity level string to a valid key
 */
function normalizeActivityLevel(
  input?: string,
): keyof typeof ACTIVITY_FACTORS {
  if (!input) return 'sedentary';

  const normalized = input.toLowerCase().trim();

  if (normalized === 'sedentary' || normalized === 'little') {
    return 'sedentary';
  }
  if (normalized === 'light' || normalized === 'light activity') {
    return 'light';
  }
  if (normalized === 'moderate' || normalized === 'moderate activity') {
    return 'moderate';
  }
  if (normalized === 'vigorous' || normalized === 'vigorous activity') {
    return 'vigorous';
  }
  if (normalized === 'extreme' || normalized === 'very vigorous') {
    return 'extreme';
  }

  return 'sedentary';
}

/**
 * Convert activity factor key to human-readable label
 */
function activityLevelLabel(key: keyof typeof ACTIVITY_FACTORS): string {
  const labels: Record<keyof typeof ACTIVITY_FACTORS, string> = {
    sedentary: 'Sedentary (little/no exercise)',
    light: 'Light (1-3 days/week)',
    moderate: 'Moderate (3-5 days/week)',
    vigorous: 'Vigorous (6-7 days/week)',
    extreme: 'Extreme (very vigorous, multiple times/day)',
  };
  // `key` is constrained to keyof ACTIVITY_FACTORS and labels covers every
  // key exhaustively; the index is always defined. The non-null assertion
  // narrows the `noUncheckedIndexedAccess` widening without changing logic.
  return labels[key]!;
}

// ============================================================================
// Main Nutrition Summary Function (Pure)
// ============================================================================

/**
 * Build comprehensive nutrition summary with PREDIMED score and metabolic rates
 *
 * Computes:
 * - PREDIMED score and adherence band (if answers provided)
 * - Basal Metabolic Rate using Mifflin-St Jeor equation
 * - Total Daily Energy Expenditure (BMR × activity factor)
 *
 * @param input - NutritionInput with demographics, PREDIMED answers, and activity level
 * @returns NutritionSummary with complete nutritional assessment
 *
 * @example
 * const summary = buildNutritionSummary({
 *   predimedAnswers: [true, true, false, true, ...],
 *   weightKg: 75,
 *   heightCm: 175,
 *   age: 55,
 *   sex: 'male',
 *   activityLevel: 'moderate'
 * });
 * // summary.predimedScore = 10, adherenceBand = 'high'
 * // summary.bmrKcal ≈ 1680, tdeeKcal ≈ 2604
 */
export function buildNutritionSummary(input: NutritionInput): NutritionSummary {
  const {
    predimedAnswers,
    weightKg,
    heightCm,
    age,
    sex,
    activityLevel: rawActivityLevel,
  } = input;

  // Compute PREDIMED score if answers provided
  let predimedScore: number | null = null;
  let adherenceBand: 'low' | 'medium' | 'high' | null = null;

  if (predimedAnswers && Array.isArray(predimedAnswers)) {
    predimedScore = computePredimedScore(predimedAnswers);
    adherenceBand = categorizePredimedAdherence(predimedScore);
  }

  // Normalize activity level and get factor.
  // `activityLevelKey` is constrained to keyof ACTIVITY_FACTORS, so the lookup
  // is always defined; the non-null assertion only narrows the
  // `noUncheckedIndexedAccess` widening without changing clinical logic.
  const activityLevelKey = normalizeActivityLevel(rawActivityLevel);
  const activityFactor = ACTIVITY_FACTORS[activityLevelKey]!;
  const activityLevelText = activityLevelLabel(activityLevelKey);

  // Calculate BMR using Mifflin-St Jeor
  const bmrKcal = calculateBMRMiffinStJeor(weightKg, heightCm, age, sex);

  // Calculate TDEE = BMR × activity factor
  const tdeeKcal = parseFloat((bmrKcal * activityFactor).toFixed(0));

  return {
    predimedScore,
    adherenceBand,
    bmrKcal: parseFloat(bmrKcal.toFixed(0)),
    tdeeKcal,
    activityFactor,
    activityLevel: activityLevelText,
  };
}
