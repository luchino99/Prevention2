/**
 * Clinical Screening Recommendations Engine (Phase B redesign).
 *
 * Deterministic, guideline-sourced list of recommended screenings based on
 * the patient's demographics, the score results, and the composite risk
 * profile produced by the risk aggregator.
 *
 * Design rules:
 *   - Pure function, no side effects.
 *   - Reads the CV/renal risk level directly from the `CompositeRiskProfile`
 *     built upstream. The previous implementation inferred it from the
 *     SCORE2 `category` free-text (e.g. `includes('very high')`), which
 *     failed for the actual snake_case canonical label `very_high`.
 *   - No phantom defaults: `eGFR ?? 90`, `fli ?? 0`, `fib4 ?? 0` are gone.
 *     When a value is missing we do NOT synthesize a "healthy" default
 *     and we do NOT emit a screening grounded in that fake value.
 *   - Emits `ScreeningItem[]` (with `guidelineSource`) so downstream
 *     consumers can show provenance and filter by guideline.
 *
 * Compatibility:
 *   - `ScreeningRecommendation` is retained as a type alias so existing
 *     callers importing the legacy name keep compiling. The shape is
 *     unchanged except that `guidelineSource` is added as an optional
 *     field on `ScreeningItem`.
 */

import type {
  RiskLevel,
  ScoreResultEntry,
  ScreeningItem,
} from '../../../../../shared/types/clinical.js';
import type { CompositeRiskProfile } from '../risk-aggregation/composite-risk.js';

// ============================================================================
// Type Definitions
// ============================================================================

/** @deprecated use `ScreeningItem` from shared/types/clinical. */
export type ScreeningRecommendation = ScreeningItem;

export interface ScreeningInput {
  age: number;
  sex: 'male' | 'female';
  scoreResults: ScoreResultEntry[];
  diagnoses: string[];
  /**
   * Optional composite risk profile. When provided, domain-level risks
   * drive the screening cadence; when absent (legacy call-sites), we fall
   * back to score-result–only heuristics and never up-grade an item to
   * "urgent" without evidence.
   */
  compositeRisk?: CompositeRiskProfile;
}

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

function findScoreByCode(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

/** Simple substring match, diagnosis-agnostic — kept for API compatibility. */
function hasDiagnosis(diagnoses: string[], target: string): boolean {
  return diagnoses.some((d) => d.toLowerCase().includes(target.toLowerCase()));
}

function priorityForCvLevel(level: RiskLevel | undefined): 'routine' | 'moderate' | 'urgent' {
  if (level === 'very_high') return 'urgent';
  if (level === 'high') return 'moderate';
  if (level === 'moderate') return 'routine';
  return 'routine';
}

// ============================================================================
// Individual Rule Derivers — each returns a `ScreeningItem | null`
// ============================================================================

function deriveLipidPanelScreening(
  age: number,
  cvLevel: RiskLevel | undefined,
): ScreeningItem | null {
  const elevated = cvLevel === 'moderate' || cvLevel === 'high' || cvLevel === 'very_high';
  if (age < 40 && !elevated) return null;

  return {
    screening: 'Lipid Panel (Total Cholesterol, LDL, HDL, Triglycerides)',
    reason: age >= 40
      ? `Standard screening for age ${age}`
      : `Elevated cardiovascular risk (${cvLevel})`,
    priority: cvLevel === 'very_high' ? 'urgent' : 'routine',
    intervalMonths: cvLevel === 'very_high' ? 3 : 12,
    guidelineSource: 'ESC 2021 CVD prevention',
  };
}

function deriveHbA1cScreening(
  scoreResults: ScoreResultEntry[],
  diagnoses: string[],
): ScreeningItem | null {
  const ada = findScoreByCode(scoreResults, 'ADA');
  const adaScore = typeof ada?.valueNumeric === 'number' ? ada.valueNumeric : null;
  const hasDiabetes = hasDiagnosis(diagnoses, 'diabetes');
  const adaHighRisk = adaScore !== null && adaScore >= 5;

  if (!hasDiabetes && !adaHighRisk) return null;

  return {
    screening: 'HbA1c (Glycated Hemoglobin)',
    reason: hasDiabetes
      ? 'Diabetes management and glycemic control'
      : `High diabetes risk (ADA score ${adaScore})`,
    priority: hasDiabetes ? 'moderate' : 'routine',
    intervalMonths: hasDiabetes ? 6 : 12,
    guidelineSource: 'ADA Standards of Care',
  };
}

function deriveRenalScreening(
  scoreResults: ScoreResultEntry[],
  diagnoses: string[],
): ScreeningItem | null {
  const egfr = findScoreByCode(scoreResults, 'EGFR');
  const egfrValue =
    typeof egfr?.valueNumeric === 'number' ? egfr.valueNumeric : null;
  const hasDiabetes = hasDiagnosis(diagnoses, 'diabetes');
  const hasHypertension = hasDiagnosis(diagnoses, 'hypertension');
  const eGFRLow = egfrValue !== null && egfrValue < 60;

  if (!hasDiabetes && !hasHypertension && !eGFRLow) return null;

  let priority: 'routine' | 'moderate' | 'urgent' = 'routine';
  let reason: string;

  if (egfrValue !== null && egfrValue < 30) {
    priority = 'urgent';
    reason = `Advanced CKD (eGFR ${egfrValue.toFixed(0)} mL/min/1.73m²)`;
  } else if (eGFRLow) {
    priority = 'moderate';
    reason = `Reduced kidney function (eGFR ${egfrValue!.toFixed(0)})`;
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
    intervalMonths:
      priority === 'urgent' ? 3 : priority === 'moderate' ? 6 : 12,
    guidelineSource: 'KDIGO 2024 CKD',
  };
}

function deriveLiverFunctionScreening(
  scoreResults: ScoreResultEntry[],
): ScreeningItem | null {
  const fli = findScoreByCode(scoreResults, 'FLI');
  const fib4 = findScoreByCode(scoreResults, 'FIB4');

  const fliVal = typeof fli?.valueNumeric === 'number' ? fli.valueNumeric : null;
  const fib4Val = typeof fib4?.valueNumeric === 'number' ? fib4.valueNumeric : null;

  const fliElevated = fliVal !== null && fliVal >= 60;
  const fib4Elevated = fib4Val !== null && fib4Val >= 1.45;
  if (!fliElevated && !fib4Elevated) return null;

  let priority: 'routine' | 'moderate' | 'urgent' = 'routine';
  let reason: string;

  if (fib4Val !== null && fib4Val >= 3.25) {
    priority = 'urgent';
    reason = `Advanced fibrosis (FIB-4 ${fib4Val.toFixed(2)})`;
  } else if (fliElevated && fib4Elevated) {
    priority = 'moderate';
    reason = `MASH likely (FLI ${fliVal!.toFixed(0)}, FIB-4 ${fib4Val!.toFixed(2)})`;
  } else if (fliElevated) {
    priority = 'moderate';
    reason = `Elevated FLI (${fliVal!.toFixed(0)}) — MASLD risk`;
  } else {
    priority = 'routine';
    reason = `Borderline FIB-4 (${fib4Val!.toFixed(2)}) — monitor for fibrosis`;
  }

  return {
    screening: 'Liver Function Tests (AST, ALT, GGT, Bilirubin)',
    reason,
    priority,
    intervalMonths:
      priority === 'urgent' ? 3 : priority === 'moderate' ? 6 : 12,
    guidelineSource: 'EASL 2024 MASLD',
  };
}

function deriveBloodPressureScreening(
  diagnoses: string[],
): ScreeningItem {
  const hasHypertension = hasDiagnosis(diagnoses, 'hypertension');
  return {
    screening: 'Blood Pressure',
    reason: hasHypertension
      ? 'Hypertension management and control'
      : 'Routine cardiovascular health screening',
    priority: hasHypertension ? 'moderate' : 'routine',
    intervalMonths: hasHypertension ? 3 : 12,
    guidelineSource: 'ESC/ESH 2023 Hypertension',
  };
}

function deriveFrailtyScreening(age: number): ScreeningItem | null {
  if (age < 65) return null;
  return {
    screening: 'Frailty Assessment (FRAIL Scale)',
    reason: `Routine geriatric assessment for age ${age}`,
    priority: 'routine',
    intervalMonths: 12,
    guidelineSource: 'FRAIL scale consensus',
  };
}

function deriveEchocardiogramScreening(
  cvLevel: RiskLevel | undefined,
): ScreeningItem | null {
  if (cvLevel !== 'very_high') return null;
  return {
    screening: 'Echocardiogram',
    reason: 'Very-high cardiovascular risk — evaluate for structural heart disease',
    priority: 'urgent',
    intervalMonths: 6,
    guidelineSource: 'ESC 2021 CVD prevention',
  };
}

function deriveABIScreening(
  age: number,
  cvLevel: RiskLevel | undefined,
): ScreeningItem | null {
  const elevated = cvLevel === 'high' || cvLevel === 'very_high';
  if (age < 65 && !elevated) return null;

  return {
    screening: 'Ankle-Brachial Index (ABI)',
    reason:
      age >= 65
        ? `Atherosclerotic disease screening for age ${age}`
        : 'Elevated cardiovascular risk',
    priority: cvLevel === 'very_high' ? 'urgent' : 'moderate',
    intervalMonths: 12,
    guidelineSource: 'ESC 2024 PAD',
  };
}

// ============================================================================
// Main entry
// ============================================================================

/**
 * Determine recommended clinical screenings.
 *
 * When `compositeRisk` is provided, CV-level–driven items (lipid cadence,
 * echocardiogram, ABI) are selected from `compositeRisk.cardiovascular`.
 * Otherwise those items fall back to the base adult cadence.
 */
export function determineRequiredScreenings(
  input: ScreeningInput,
): ScreeningItem[] {
  const { age, sex: _sex, scoreResults, diagnoses, compositeRisk } = input;
  void _sex;

  const cvLevel: RiskLevel | undefined = compositeRisk?.cardiovascular.level;

  const items: Array<ScreeningItem | null> = [
    deriveLipidPanelScreening(age, cvLevel),
    deriveHbA1cScreening(scoreResults, diagnoses),
    deriveRenalScreening(scoreResults, diagnoses),
    deriveLiverFunctionScreening(scoreResults),
    deriveBloodPressureScreening(diagnoses),
    deriveFrailtyScreening(age),
    deriveEchocardiogramScreening(cvLevel),
    deriveABIScreening(age, cvLevel),
  ];

  // Prioritize priorityForCvLevel consumer-side (kept as public helper so
  // ad-hoc callers can reuse the mapping without re-importing ESC tables).
  void priorityForCvLevel;

  return items.filter((x): x is ScreeningItem => x !== null);
}
