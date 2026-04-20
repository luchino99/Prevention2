/**
 * Composite Risk Aggregation Engine
 * Aggregates individual clinical score results into a unified cardio-nephro-metabolic risk profile
 *
 * Domains:
 * - Cardiovascular: derived from SCORE2 or SCORE2-Diabetes category
 * - Metabolic: derived from metabolic syndrome, ADA score, and BMI
 * - Hepatic: derived from FLI and FIB4 indices
 * - Renal: derived from eGFR stage and albuminuria
 * - Frailty: derived from FRAIL score
 *
 * Composite risk = highest domain risk (converted to numeric scale)
 *
 * Zero side effects - pure calculation only
 */

import type { ScoreResultEntry } from '../../../../../shared/types/clinical';

// ============================================================================
// Type Definitions
// ============================================================================

export type RiskLevel = 'low' | 'moderate' | 'high' | 'very_high';

export interface DomainRisk {
  level: RiskLevel;
  reasoning: string;
}

export interface CompositeRiskProfile {
  level: RiskLevel;
  numeric: number;
  cardiovascular: DomainRisk;
  metabolic: DomainRisk;
  hepatic: DomainRisk;
  renal: DomainRisk;
  frailty: DomainRisk | null;
}

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Convert risk level to numeric value
 * low=1, moderate=2, high=3, very_high=4
 */
function riskLevelToNumeric(level: RiskLevel): number {
  const map: Record<RiskLevel, number> = {
    low: 1,
    moderate: 2,
    high: 3,
    very_high: 4,
  };
  return map[level];
}

/**
 * Convert numeric value back to risk level
 * 1=low, 2=moderate, 3=high, 4=very_high
 */
function numericToRiskLevel(numeric: number): RiskLevel {
  if (numeric >= 4) return 'very_high';
  if (numeric >= 3) return 'high';
  if (numeric >= 2) return 'moderate';
  return 'low';
}

/**
 * Find a score result by code (case-insensitive).
 * Needed because downstream engines were written with mixed-case codes
 * ("eGFR") while the score-engine emits canonical upper-case codes ("EGFR").
 * Changing the score-engine output would violate the "protect validated score
 * logic" rule, so consumers do case-insensitive lookups instead.
 */
function findScoreByCode(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

/**
 * Derive cardiovascular risk from SCORE2 or SCORE2-Diabetes category
 * Categories: "Low" (0-2%), "Moderate" (2-5%), "High" (5-10%), "Very High" (10%+)
 */
function deriveCardiovascularRisk(results: ScoreResultEntry[]): DomainRisk {
  const score2 = findScoreByCode(results, 'SCORE2');
  const score2Diabetes = findScoreByCode(results, 'SCORE2_DIABETES');

  const scoreResult = score2 || score2Diabetes;

  if (!scoreResult) {
    return {
      level: 'low',
      reasoning: 'No SCORE2 or SCORE2-Diabetes data available',
    };
  }

  const category = scoreResult.category?.toLowerCase() || '';

  let level: RiskLevel = 'low';
  if (category.includes('very high')) level = 'very_high';
  else if (category.includes('high')) level = 'high';
  else if (category.includes('moderate')) level = 'moderate';
  else level = 'low';

  return {
    level,
    reasoning: `SCORE2 category: ${scoreResult.category} (${scoreResult.valueNumeric}%)`,
  };
}

/**
 * Derive metabolic risk from metabolic syndrome, ADA score, and BMI
 * Logic:
 * - If MetS present AND (ADA>=5 OR BMI>=30) → high
 * - If MetS present OR ADA>=3 → moderate
 * - Else → low
 */
function deriveMetabolicRisk(results: ScoreResultEntry[]): DomainRisk {
  const metsResult = findScoreByCode(results, 'METABOLIC_SYNDROME');
  const adaResult = findScoreByCode(results, 'ADA');
  const bmiResult = findScoreByCode(results, 'BMI');

  const metsPresent =
    metsResult?.category?.toLowerCase().includes('present') || false;
  const adaScore = adaResult?.valueNumeric ?? 0;
  const bmi = bmiResult?.valueNumeric ?? 0;

  let level: RiskLevel = 'low';
  let reasoning = '';

  if (metsPresent && (adaScore >= 5 || bmi >= 30)) {
    level = 'high';
    reasoning = `Metabolic syndrome present with ADA score ${adaScore} and/or BMI ${bmi.toFixed(1)}`;
  } else if (metsPresent || adaScore >= 3) {
    level = 'moderate';
    reasoning = `Metabolic syndrome or elevated ADA score (${adaScore})`;
  } else {
    level = 'low';
    reasoning = `No metabolic syndrome, ADA score ${adaScore}, BMI ${bmi.toFixed(1)}`;
  }

  return { level, reasoning };
}

/**
 * Derive hepatic risk from FLI and FIB4
 * Logic:
 * - If FIB4>=3.25 → very_high
 * - If FLI>=60 AND FIB4>=1.45 → high
 * - If FLI>=60 OR FIB4>=1.45 → moderate
 * - Else → low
 */
function deriveHepaticRisk(results: ScoreResultEntry[]): DomainRisk {
  const fliResult = findScoreByCode(results, 'FLI');
  const fib4Result = findScoreByCode(results, 'FIB4');

  const fli = fliResult?.valueNumeric ?? 0;
  const fib4 = fib4Result?.valueNumeric ?? 0;

  let level: RiskLevel = 'low';
  let reasoning = '';

  if (fib4 >= 3.25) {
    level = 'very_high';
    reasoning = `Advanced liver fibrosis (FIB4 ${fib4.toFixed(2)})`;
  } else if (fli >= 60 && fib4 >= 1.45) {
    level = 'high';
    reasoning = `Likely NASH with FLI ${fli.toFixed(1)} and moderate fibrosis (FIB4 ${fib4.toFixed(2)})`;
  } else if (fli >= 60 || fib4 >= 1.45) {
    level = 'moderate';
    reasoning = `Elevated FLI (${fli.toFixed(1)}) or borderline FIB4 (${fib4.toFixed(2)})`;
  } else {
    level = 'low';
    reasoning = `FLI ${fli.toFixed(1)}, FIB4 ${fib4.toFixed(2)}`;
  }

  return { level, reasoning };
}

/**
 * Derive renal risk from eGFR stage and albuminuria
 * eGFR stages: G1-G2=low, G3a=moderate, G3b=high, G4-G5=very_high
 * Albuminuria bumps up: A2→+1 level, A3→+2 levels
 */
function deriveRenalRisk(results: ScoreResultEntry[]): DomainRisk {
  const egfrResult = findScoreByCode(results, 'eGFR');

  if (!egfrResult) {
    return {
      level: 'low',
      reasoning: 'No eGFR data available',
    };
  }

  // Parse stage from category (e.g., "G1", "G3a", "G4")
  const stage = egfrResult.category?.toUpperCase() || '';

  let baseLevelNumeric: number = 1; // default low
  let baseReasoning = `eGFR ${egfrResult.valueNumeric} mL/min/1.73m²`;

  if (stage.includes('G1') || stage.includes('G2')) {
    baseLevelNumeric = 1;
  } else if (stage.includes('G3A')) {
    baseLevelNumeric = 2;
    baseReasoning += ' (Stage G3a)';
  } else if (stage.includes('G3B')) {
    baseLevelNumeric = 3;
    baseReasoning += ' (Stage G3b)';
  } else if (stage.includes('G4') || stage.includes('G5')) {
    baseLevelNumeric = 4;
    baseReasoning += ` (Stage ${stage})`;
  }

  // Check for albuminuria adjustment
  const acrRawPayload = egfrResult.inputPayload?.albuminCreatinineRatio;
  let albuminuriaAdjustment = 0;
  let albuminuriaNote = '';

  if (acrRawPayload !== undefined) {
    const acr = typeof acrRawPayload === 'number' ? acrRawPayload : 0;
    // A1: <30 mg/g, A2: 30-299 mg/g, A3: >=300 mg/g
    if (acr >= 300) {
      albuminuriaAdjustment = 2;
      albuminuriaNote = ' + albuminuria (A3)';
    } else if (acr >= 30) {
      albuminuriaAdjustment = 1;
      albuminuriaNote = ' + microalbuminuria (A2)';
    }
  }

  const finalLevelNumeric = Math.min(
    4,
    baseLevelNumeric + albuminuriaAdjustment,
  );
  const finalLevel = numericToRiskLevel(finalLevelNumeric);

  return {
    level: finalLevel,
    reasoning: baseReasoning + albuminuriaNote,
  };
}

/**
 * Derive frailty risk from FRAIL score category
 * robust/not_frail=low, pre_frail/intermediate=moderate, frail=high
 */
function deriveFrailtyRisk(results: ScoreResultEntry[]): DomainRisk | null {
  const frailResult = findScoreByCode(results, 'FRAIL');

  if (!frailResult) {
    return null;
  }

  const category = frailResult.category?.toLowerCase() || '';

  let level: RiskLevel = 'low';
  if (category.includes('frail') && !category.includes('intermediate')) {
    level = 'high';
  } else if (
    category.includes('intermediate') ||
    category.includes('pre_frail') ||
    category.includes('prefrail')
  ) {
    level = 'moderate';
  } else {
    level = 'low';
  }

  return {
    level,
    reasoning: `FRAIL category: ${frailResult.category} (score: ${frailResult.valueNumeric})`,
  };
}

// ============================================================================
// Main Aggregation Function (Pure)
// ============================================================================

/**
 * Aggregate individual score results into a composite cardio-nephro-metabolic risk profile
 *
 * @param scoreResults - Array of ScoreResultEntry from all clinical scores
 * @returns CompositeRiskProfile with domain-specific and composite risks
 *
 * @example
 * const profile = aggregateCompositeRisk([
 *   { scoreCode: 'SCORE2', valueNumeric: 5.2, category: 'Moderate', ... },
 *   { scoreCode: 'METABOLIC_SYNDROME', valueNumeric: null, category: 'Present', ... },
 *   { scoreCode: 'eGFR', valueNumeric: 45, category: 'G3b', ... },
 *   // ... more scores
 * ]);
 * // profile.level = 'moderate', numeric = 2
 */
export function aggregateCompositeRisk(
  scoreResults: ScoreResultEntry[],
): CompositeRiskProfile {
  // Derive domain-specific risks
  const cardiovascular = deriveCardiovascularRisk(scoreResults);
  const metabolic = deriveMetabolicRisk(scoreResults);
  const hepatic = deriveHepaticRisk(scoreResults);
  const renal = deriveRenalRisk(scoreResults);
  const frailty = deriveFrailtyRisk(scoreResults);

  // Collect all numeric levels
  const levels: number[] = [
    riskLevelToNumeric(cardiovascular.level),
    riskLevelToNumeric(metabolic.level),
    riskLevelToNumeric(hepatic.level),
    riskLevelToNumeric(renal.level),
  ];

  if (frailty) {
    levels.push(riskLevelToNumeric(frailty.level));
  }

  // Composite = max of all domains
  const compositeNumeric = Math.max(...levels);
  const compositeLevel = numericToRiskLevel(compositeNumeric);

  return {
    level: compositeLevel,
    numeric: compositeNumeric,
    cardiovascular,
    metabolic,
    hepatic,
    renal,
    frailty,
  };
}
