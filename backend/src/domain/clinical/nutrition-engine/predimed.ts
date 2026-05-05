/**
 * Nutrition Assessment Engine — PREDIMED MEDAS + Metabolic Rate
 *
 * Two independent computations:
 *   1. PREDIMED MEDAS adherence score (14-item Mediterranean Diet
 *      Adherence Screener)
 *   2. Basal Metabolic Rate (Mifflin-St Jeor) and Total Daily Energy
 *      Expenditure (BMR × activity factor)
 *
 * Sources (primary):
 *   - Schroder H, et al. A Short Screener Is Valid for Assessing
 *     Mediterranean Diet Adherence among Older Spanish Men and Women.
 *     J Nutr. 2011;141(6):1140-5. doi:10.3945/jn.110.135566
 *     (Original 14-item MEDAS validation; introduces the ≤7 / 8-9 / ≥10
 *     stratification used by all subsequent PREDIMED analyses.)
 *   - Estruch R, et al. Primary Prevention of Cardiovascular Disease
 *     with a Mediterranean Diet Supplemented with Extra-Virgin Olive Oil
 *     or Nuts. N Engl J Med. 2018;378(25):e34. doi:10.1056/NEJMoa1800389
 *     (Trial used MEDAS ≥10 as the high-adherence intervention target.)
 *   - Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO.
 *     A new predictive equation for resting energy expenditure in healthy
 *     individuals. Am J Clin Nutr. 1990;51(2):241-7. doi:10.1093/ajcn/51.2.241
 *
 * MEDAS adherence bands (Schroder 2011 — canonical):
 *   0..7   = low      (control / pre-intervention)
 *   8..9   = medium   (intermediate)
 *  10..14  = high     (PREDIMED intervention target)
 *
 * Audit AUD-2026-05-04 follow-up (PREDIMED): the previous code used
 * 0-4 / 5-9 / 10-14, which is not the published MEDAS stratification.
 * Bands aligned to Schroder 2011 in Tier-5 fix; the formula
 * (count of "yes" answers) is unchanged.
 *
 * Mifflin-St Jeor formulas:
 *   Male:    BMR = 10·W + 6.25·H − 5·age + 5     (W=kg, H=cm)
 *   Female:  BMR = 10·W + 6.25·H − 5·age − 161
 *   TDEE  = BMR × activityFactor
 *   Activity factors (WHO/FAO 2001 Harris-Benedict reference set):
 *     sedentary 1.2 · light 1.375 · moderate 1.55 · vigorous 1.725 · extreme 1.9
 *
 * Zero side effects — pure calculation only.
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
 * Categorize MEDAS adherence per Schroder 2011 / Estruch 2018:
 *   0..7  = low      (control or pre-intervention)
 *   8..9  = medium   (intermediate)
 *  10..14 = high     (PREDIMED intervention target)
 *
 * Returns `null` on out-of-range / non-finite input rather than throwing,
 * matching the permissive semantics of the rest of the clinical engine.
 */
export function categorizePredimedAdherence(
  score: number,
): 'low' | 'medium' | 'high' | null {
  if (!Number.isFinite(score) || score < 0 || score > PREDIMED_MAX_SCORE) {
    return null;
  }
  if (score <= 7) return 'low';
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
