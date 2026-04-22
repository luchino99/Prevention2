/**
 * Composite Risk Aggregation Engine
 * Aggregates individual clinical score results into a unified
 * cardio-nephro-metabolic risk profile.
 *
 * Domains:
 * - Cardiovascular: derived from SCORE2 or SCORE2-Diabetes category
 * - Metabolic: derived from metabolic syndrome, ADA score, and BMI
 * - Hepatic: derived from FLI and FIB4 indices
 * - Renal: derived from eGFR stage and KDIGO albuminuria (ACR)
 * - Frailty: derived from FRAIL score
 *
 * Composite risk = highest *stratified* domain risk. Domains marked
 * `indeterminate` are EXCLUDED from the aggregation on purpose: absence of
 * data is not evidence of safety. If every domain is indeterminate, the
 * composite itself is `indeterminate`.
 *
 * Zero side effects - pure calculation only.
 */

import type {
  AssessmentInput,
  DomainRiskEntry,
  RiskLevel,
  ScoreResultEntry,
} from '../../../../../shared/types/clinical.js';

// ============================================================================
// Type Definitions (kept here for backwards-compat with existing imports)
// ============================================================================

/**
 * @deprecated use `RiskLevel` from `shared/types/clinical`.
 * Re-exported here to avoid breaking older imports in engine adjacent code.
 */
export type { RiskLevel } from '../../../../../shared/types/clinical.js';

export type DomainRisk = DomainRiskEntry;

export interface CompositeRiskProfile {
  level: RiskLevel;
  /**
   * Numeric projection of the composite risk level.
   *   low=1, moderate=2, high=3, very_high=4, indeterminate=0
   *
   * The `0` encoding for indeterminate is intentional — sorting by numeric
   * value surfaces stratified domains above unstratified ones, while a
   * downstream layer that naively uses `numeric >= 3` will not
   * mistakenly classify indeterminate as high.
   */
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

/** low=1 moderate=2 high=3 very_high=4 indeterminate=0 */
function riskLevelToNumeric(level: RiskLevel): number {
  switch (level) {
    case 'very_high':
      return 4;
    case 'high':
      return 3;
    case 'moderate':
      return 2;
    case 'low':
      return 1;
    case 'indeterminate':
      return 0;
  }
}

function numericToRiskLevel(numeric: number): RiskLevel {
  if (numeric >= 4) return 'very_high';
  if (numeric === 3) return 'high';
  if (numeric === 2) return 'moderate';
  if (numeric === 1) return 'low';
  return 'indeterminate';
}

/**
 * Case-insensitive lookup. The underlying score engine emits canonical
 * upper-case codes (`EGFR`) while tests and some consumers still use mixed
 * case (`eGFR`). We do the normalisation here so callers stay agnostic.
 */
function findScoreByCode(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

// ============================================================================
// Domain derivations
// ============================================================================

/**
 * Cardiovascular risk from SCORE2 / SCORE2-Diabetes category.
 * Returns 'indeterminate' when neither score is available — never 'low',
 * because absence of lipid/BP data cannot be interpreted as safety.
 */
function deriveCardiovascularRisk(
  results: ScoreResultEntry[],
): DomainRiskEntry {
  const score2 = findScoreByCode(results, 'SCORE2');
  const score2Diabetes = findScoreByCode(results, 'SCORE2_DIABETES');
  const scoreResult = score2Diabetes ?? score2;

  if (!scoreResult) {
    return {
      level: 'indeterminate',
      reasoning:
        'SCORE2 / SCORE2-Diabetes not computable (missing lipid panel and/or blood pressure).',
      evidence: [],
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
    reasoning: `${scoreResult.scoreCode} category: ${scoreResult.category} (${scoreResult.valueNumeric}%)`,
    evidence: [scoreResult.scoreCode],
  };
}

/**
 * Metabolic risk from metabolic syndrome, ADA score, and BMI.
 * Returns 'indeterminate' when we have no signal at all (no MetS result,
 * no ADA, no BMI).
 */
function deriveMetabolicRisk(results: ScoreResultEntry[]): DomainRiskEntry {
  const metsResult = findScoreByCode(results, 'METABOLIC_SYNDROME');
  const adaResult = findScoreByCode(results, 'ADA');
  const bmiResult = findScoreByCode(results, 'BMI');

  if (!metsResult && !adaResult && !bmiResult) {
    return {
      level: 'indeterminate',
      reasoning:
        'Metabolic syndrome, ADA score and BMI are all unavailable.',
      evidence: [],
    };
  }

  const metsPresent =
    metsResult?.category?.toLowerCase().includes('present') || false;
  const adaScore = adaResult?.valueNumeric ?? 0;
  const bmi = bmiResult?.valueNumeric ?? 0;
  const evidence: string[] = [
    ...(metsResult ? ['METABOLIC_SYNDROME'] : []),
    ...(adaResult ? ['ADA'] : []),
    ...(bmiResult ? ['BMI'] : []),
  ];

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

  return { level, reasoning, evidence };
}

/**
 * Hepatic risk from FLI and FIB4.
 * Returns 'indeterminate' when neither FLI nor FIB4 is available.
 */
function deriveHepaticRisk(results: ScoreResultEntry[]): DomainRiskEntry {
  const fliResult = findScoreByCode(results, 'FLI');
  const fib4Result = findScoreByCode(results, 'FIB4');

  if (!fliResult && !fib4Result) {
    return {
      level: 'indeterminate',
      reasoning: 'FLI and FIB-4 are both unavailable.',
      evidence: [],
    };
  }

  const fli = fliResult?.valueNumeric ?? 0;
  const fib4 = fib4Result?.valueNumeric ?? 0;
  const evidence: string[] = [
    ...(fliResult ? ['FLI'] : []),
    ...(fib4Result ? ['FIB4'] : []),
  ];

  let level: RiskLevel = 'low';
  let reasoning = '';

  if (fib4Result && fib4 >= 3.25) {
    level = 'very_high';
    reasoning = `Advanced liver fibrosis (FIB-4 ${fib4.toFixed(2)})`;
  } else if (fliResult && fib4Result && fli >= 60 && fib4 >= 1.45) {
    level = 'high';
    reasoning = `Likely NASH with FLI ${fli.toFixed(1)} and moderate fibrosis (FIB-4 ${fib4.toFixed(2)})`;
  } else if ((fliResult && fli >= 60) || (fib4Result && fib4 >= 1.45)) {
    level = 'moderate';
    reasoning = `Elevated FLI (${fli.toFixed(1)}) or borderline FIB-4 (${fib4.toFixed(2)})`;
  } else {
    level = 'low';
    reasoning = `FLI ${fli.toFixed(1)}, FIB-4 ${fib4.toFixed(2)}`;
  }

  return { level, reasoning, evidence };
}

/**
 * Renal risk from eGFR stage + KDIGO albuminuria (ACR).
 *
 * eGFR stages are read from `rawPayload.stage` (e.g. "G3a") produced by the
 * eGFR engine. `category` carries the human-readable label
 * ("mildly_decreased") and is NOT a reliable stage detector — relying on
 * it was the root cause of a previous silent downgrade where the renal
 * domain defaulted to 'low' even for G3b/G4 patients.
 *
 * Albuminuria is read from `input.labs.albuminCreatinineRatio` when the
 * aggregator is called with an `AssessmentInput` context (the new default).
 * Legacy callers that still invoke the aggregator with only `scoreResults`
 * will get the eGFR-only stratification, which is safe but less sensitive.
 */
function deriveRenalRisk(
  results: ScoreResultEntry[],
  input?: AssessmentInput,
): DomainRiskEntry {
  const egfrResult = findScoreByCode(results, 'EGFR');

  const acrValue =
    input?.labs.albuminCreatinineRatio !== undefined
      ? Number(input.labs.albuminCreatinineRatio)
      : undefined;

  if (!egfrResult && acrValue === undefined) {
    return {
      level: 'indeterminate',
      reasoning:
        'Renal function not stratified (no eGFR, no ACR). Request serum creatinine and spot urine ACR.',
      evidence: [],
    };
  }

  // Parse stage from the raw engine output, not from the localisable
  // category label.
  const stage =
    (egfrResult?.rawPayload?.stage as string | undefined)?.toUpperCase() ??
    '';

  let baseLevelNumeric = 1; // default low
  let baseReasoning = egfrResult
    ? `eGFR ${egfrResult.valueNumeric} mL/min/1.73m²`
    : 'eGFR not available';

  if (stage === 'G1' || stage === 'G2') {
    baseLevelNumeric = 1;
    baseReasoning += ` (${stage})`;
  } else if (stage === 'G3A') {
    baseLevelNumeric = 2;
    baseReasoning += ' (G3a)';
  } else if (stage === 'G3B') {
    baseLevelNumeric = 3;
    baseReasoning += ' (G3b)';
  } else if (stage === 'G4' || stage === 'G5') {
    baseLevelNumeric = 4;
    baseReasoning += ` (${stage})`;
  }

  // KDIGO albuminuria adjustment. A2 (30-299) bumps +1 level; A3 (≥300)
  // bumps +2 levels. ACR < 30 is A1 (normal to mildly increased).
  let albAdjust = 0;
  let albNote = '';
  if (acrValue !== undefined) {
    if (acrValue >= 300) {
      albAdjust = 2;
      albNote = ' + severe albuminuria (A3)';
    } else if (acrValue >= 30) {
      albAdjust = 1;
      albNote = ' + moderate albuminuria (A2)';
    } else {
      albNote = ' + ACR A1 (normal)';
    }
  }

  const finalNumeric = Math.min(4, baseLevelNumeric + albAdjust);
  const finalLevel = numericToRiskLevel(finalNumeric);

  const evidence: string[] = [
    ...(egfrResult ? ['EGFR'] : []),
    ...(acrValue !== undefined ? ['ACR'] : []),
  ];

  return {
    level: finalLevel,
    reasoning: baseReasoning + albNote,
    evidence,
  };
}

/**
 * Frailty risk from FRAIL scale.
 * Returns null when the patient was not assessed (not the same as low risk).
 */
function deriveFrailtyRisk(
  results: ScoreResultEntry[],
): DomainRiskEntry | null {
  const frailResult = findScoreByCode(results, 'FRAIL');
  if (!frailResult) return null;

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
    evidence: ['FRAIL'],
  };
}

// ============================================================================
// Main Aggregation Function (Pure)
// ============================================================================

/**
 * Aggregate individual score results into a composite cardio-nephro-metabolic
 * risk profile.
 *
 * @param scoreResults - Array of ScoreResultEntry from all clinical scores
 * @param input - OPTIONAL canonical assessment input. Enables ACR-aware
 *                renal staging. Omit only in legacy test paths that do not
 *                care about albuminuria.
 */
export function aggregateCompositeRisk(
  scoreResults: ScoreResultEntry[],
  input?: AssessmentInput,
): CompositeRiskProfile {
  const cardiovascular = deriveCardiovascularRisk(scoreResults);
  const metabolic = deriveMetabolicRisk(scoreResults);
  const hepatic = deriveHepaticRisk(scoreResults);
  const renal = deriveRenalRisk(scoreResults, input);
  const frailty = deriveFrailtyRisk(scoreResults);

  // Collect only *stratified* domains for the composite. Indeterminate
  // domains must not be folded into the max — silence is not safety.
  const stratifiedLevels: number[] = [];
  if (cardiovascular.level !== 'indeterminate') {
    stratifiedLevels.push(riskLevelToNumeric(cardiovascular.level));
  }
  if (metabolic.level !== 'indeterminate') {
    stratifiedLevels.push(riskLevelToNumeric(metabolic.level));
  }
  if (hepatic.level !== 'indeterminate') {
    stratifiedLevels.push(riskLevelToNumeric(hepatic.level));
  }
  if (renal.level !== 'indeterminate') {
    stratifiedLevels.push(riskLevelToNumeric(renal.level));
  }
  if (frailty && frailty.level !== 'indeterminate') {
    stratifiedLevels.push(riskLevelToNumeric(frailty.level));
  }

  let compositeLevel: RiskLevel;
  let compositeNumeric: number;
  if (stratifiedLevels.length === 0) {
    compositeLevel = 'indeterminate';
    compositeNumeric = 0;
  } else {
    compositeNumeric = Math.max(...stratifiedLevels);
    compositeLevel = numericToRiskLevel(compositeNumeric);
  }

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
