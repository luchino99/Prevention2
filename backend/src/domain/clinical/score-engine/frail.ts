/**
 * FRAIL Scale Engine
 * Pure function for frailty assessment in older adults
 *
 * Source: FRAIL.html legacy codebase
 * Reference: Morley JE et al., The Journal of Nutrition, Health & Aging 2012
 *
 * Mathematical formula (Simple additive scoring):
 * Five yes/no questions, each worth 1 point if positive:
 * 1. Fatigue: Do you feel tired more than three days a week?
 * 2. Resistance: Is climbing one flight of stairs difficult?
 * 3. Ambulation: Is walking one block difficult?
 * 4. Illnesses: Do you have more than five illnesses?
 * 5. Weight Loss: Have you lost more than 5% of body weight in the past year?
 *
 * Total Score: 0-1 = Not Frail, 2 = Intermediate Frail, 3-5 = Frail
 *
 * Zero side effects - pure calculation only
 */

import type { FrailInput, FrailResult } from '../../../../../shared/types/clinical.js';

// ============================================================================
// FRAIL Constants
// ============================================================================

const MAX_FRAIL_SCORE = 5;

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Categorize FRAIL score
 * 0-1: Not Frail
 * 2: Intermediate (Prefrail)
 * 3-5: Frail
 */
function categorizeFrailScore(totalScore: number): string {
  if (totalScore <= 1) {
    return 'Not Frail';
  }
  if (totalScore === 2) {
    return 'Intermediate Frail';
  }
  return 'Frail';
}

// ============================================================================
// Main FRAIL Compute Function (Pure)
// ============================================================================

/**
 * Calculate FRAIL Score for frailty assessment
 *
 * The FRAIL scale is a simple, easy-to-administer 5-item screening tool
 * that identifies frailty in older adults. It assesses:
 * - F = Fatigue
 * - R = Resistance
 * - A = Ambulation
 * - I = Illnesses
 * - L = Loss of weight
 *
 * Each item answered "yes" contributes 1 point.
 *
 * @param input - FrailInput with five yes/no items
 * @returns FrailResult with total score, category, and max score
 *
 * @example
 * const result = computeFrail({
 *   fatigue: true,
 *   resistance: true,
 *   ambulation: false,
 *   illnesses: false,
 *   weightLoss: false
 * });
 * // result.score = 2, category: 'Intermediate Frail'
 */
export function computeFrail(input: FrailInput): FrailResult {
  const { fatigue, resistance, ambulation, illnesses, weightLoss } = input;

  // Validate inputs
  if (
    typeof fatigue !== 'boolean' ||
    typeof resistance !== 'boolean' ||
    typeof ambulation !== 'boolean' ||
    typeof illnesses !== 'boolean' ||
    typeof weightLoss !== 'boolean'
  ) {
    throw new Error('FRAIL: All inputs must be boolean values');
  }

  // Calculate total score (1 point per positive response)
  const totalScore =
    (fatigue ? 1 : 0) +
    (resistance ? 1 : 0) +
    (ambulation ? 1 : 0) +
    (illnesses ? 1 : 0) +
    (weightLoss ? 1 : 0);

  // Categorize
  const category = categorizeFrailScore(totalScore);

  return {
    score: totalScore,
    maxScore: MAX_FRAIL_SCORE,
    category,
  };
}
