/**
 * SCORE2 / SCORE2-Diabetes eligibility evaluator.
 *
 * Why this module exists
 * ----------------------
 *   `computeScore2` and `computeScore2Diabetes` (formula modules) THROW when
 *   an input is out of validated range (age ∉ [40,80], SBP ∉ [60,250], etc.).
 *   The throw is the correct defensive behaviour INSIDE the formula — a
 *   validated ESC risk equation must not be evaluated outside its derivation
 *   domain. The previous orchestrator wrapped the call in a silent try/catch
 *   and the composite-risk aggregator fell back to a hard-coded reasoning of
 *   "missing lipid panel and/or blood pressure" — which is FALSE whenever the
 *   user provided complete data that was merely out of range.
 *
 *   This module performs a pure, non-throwing eligibility check BEFORE the
 *   formula is invoked, and produces a structured skip reason that the
 *   composite-risk layer can translate into truthful, clinically-actionable
 *   messaging.
 *
 *   The clinical formulas are NOT modified.
 */
import type {
  AssessmentInput,
  ScoreResultEntry,
} from '../../../../../shared/types/clinical.js';

// ============================================================================
// Canonical skip reason codes
// ============================================================================

export type Score2SkipReason =
  | 'SCORE2_MISSING_INPUT'
  | 'SCORE2_AGE_OUT_OF_RANGE'
  | 'SCORE2_SBP_OUT_OF_RANGE'
  | 'SCORE2_TOTAL_CHOL_OUT_OF_RANGE'
  | 'SCORE2_HDL_OUT_OF_RANGE'
  | 'SCORE2_UNEXPECTED_ERROR';

export type Score2DiabetesSkipReason =
  | 'SCORE2_DIABETES_NOT_APPLICABLE'   // patient is not flagged as diabetic
  | 'SCORE2_DIABETES_MISSING_INPUT'
  | 'SCORE2_DIABETES_AGE_OUT_OF_RANGE'
  | 'SCORE2_DIABETES_SBP_OUT_OF_RANGE'
  | 'SCORE2_DIABETES_TOTAL_CHOL_OUT_OF_RANGE'
  | 'SCORE2_DIABETES_HDL_OUT_OF_RANGE'
  | 'SCORE2_DIABETES_HBA1C_OUT_OF_RANGE'
  | 'SCORE2_DIABETES_EGFR_OUT_OF_RANGE'
  | 'SCORE2_DIABETES_UNEXPECTED_ERROR';

// Ranges kept in ONE place — match score2.ts and score2-diabetes.ts exactly.
// If those formula ranges ever change, this module must be updated in lockstep.
export const SCORE2_RANGES = {
  age: { min: 40, max: 80 },
  sbpMmHg: { min: 60, max: 250 },
  totalCholMgDl: { min: 50, max: 400 },
  hdlMgDl: { min: 20, max: 150 },
  hba1cPct: { min: 3, max: 15 },
  eGFR: { min: 15, max: 180 },
} as const;

// ============================================================================
// Eligibility output shapes
// ============================================================================

export type Score2Eligibility =
  | { eligible: true }
  | {
      eligible: false;
      skipReason: Score2SkipReason;
      missingFields: string[];
      outOfRange?: { field: string; value: number; min: number; max: number };
    };

export type Score2DiabetesEligibility =
  | { eligible: true }
  | {
      eligible: false;
      skipReason: Score2DiabetesSkipReason;
      missingFields: string[];
      outOfRange?: { field: string; value: number; min: number; max: number };
    };

// ============================================================================
// SCORE2 eligibility
// ============================================================================

export function evaluateScore2Eligibility(input: AssessmentInput): Score2Eligibility {
  const missing: string[] = [];
  if (input.labs.totalCholMgDl == null) missing.push('labs.totalCholMgDl');
  if (input.labs.hdlMgDl == null) missing.push('labs.hdlMgDl');
  if (input.vitals.sbpMmHg == null) missing.push('vitals.sbpMmHg');
  if (missing.length > 0) {
    return { eligible: false, skipReason: 'SCORE2_MISSING_INPUT', missingFields: missing };
  }

  const { age } = input.demographics;
  const sbp = input.vitals.sbpMmHg;
  const chol = input.labs.totalCholMgDl as number;
  const hdl = input.labs.hdlMgDl as number;

  if (age < SCORE2_RANGES.age.min || age > SCORE2_RANGES.age.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_AGE_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'demographics.age', value: age, ...SCORE2_RANGES.age },
    };
  }
  if (sbp < SCORE2_RANGES.sbpMmHg.min || sbp > SCORE2_RANGES.sbpMmHg.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_SBP_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'vitals.sbpMmHg', value: sbp, ...SCORE2_RANGES.sbpMmHg },
    };
  }
  if (chol < SCORE2_RANGES.totalCholMgDl.min || chol > SCORE2_RANGES.totalCholMgDl.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_TOTAL_CHOL_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'labs.totalCholMgDl', value: chol, ...SCORE2_RANGES.totalCholMgDl },
    };
  }
  if (hdl < SCORE2_RANGES.hdlMgDl.min || hdl > SCORE2_RANGES.hdlMgDl.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_HDL_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'labs.hdlMgDl', value: hdl, ...SCORE2_RANGES.hdlMgDl },
    };
  }
  return { eligible: true };
}

// ============================================================================
// SCORE2-Diabetes eligibility
// ============================================================================

export function evaluateScore2DiabetesEligibility(
  input: AssessmentInput,
): Score2DiabetesEligibility {
  if (!input.clinicalContext.hasDiabetes) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_NOT_APPLICABLE',
      missingFields: [],
    };
  }

  const missing: string[] = [];
  if (input.labs.totalCholMgDl == null) missing.push('labs.totalCholMgDl');
  if (input.labs.hdlMgDl == null) missing.push('labs.hdlMgDl');
  if (input.vitals.sbpMmHg == null) missing.push('vitals.sbpMmHg');
  if (input.clinicalContext.ageAtDiabetesDiagnosis == null)
    missing.push('clinicalContext.ageAtDiabetesDiagnosis');
  if (input.labs.hba1cPct == null) missing.push('labs.hba1cPct');
  if (input.labs.eGFR == null) missing.push('labs.eGFR');
  if (missing.length > 0) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_MISSING_INPUT',
      missingFields: missing,
    };
  }

  const { age } = input.demographics;
  const sbp = input.vitals.sbpMmHg;
  const chol = input.labs.totalCholMgDl as number;
  const hdl = input.labs.hdlMgDl as number;
  const hba1c = input.labs.hba1cPct as number;
  const egfr = input.labs.eGFR as number;

  if (age < SCORE2_RANGES.age.min || age > SCORE2_RANGES.age.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_AGE_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'demographics.age', value: age, ...SCORE2_RANGES.age },
    };
  }
  if (sbp < SCORE2_RANGES.sbpMmHg.min || sbp > SCORE2_RANGES.sbpMmHg.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_SBP_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'vitals.sbpMmHg', value: sbp, ...SCORE2_RANGES.sbpMmHg },
    };
  }
  if (chol < SCORE2_RANGES.totalCholMgDl.min || chol > SCORE2_RANGES.totalCholMgDl.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_TOTAL_CHOL_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'labs.totalCholMgDl', value: chol, ...SCORE2_RANGES.totalCholMgDl },
    };
  }
  if (hdl < SCORE2_RANGES.hdlMgDl.min || hdl > SCORE2_RANGES.hdlMgDl.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_HDL_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'labs.hdlMgDl', value: hdl, ...SCORE2_RANGES.hdlMgDl },
    };
  }
  if (hba1c < SCORE2_RANGES.hba1cPct.min || hba1c > SCORE2_RANGES.hba1cPct.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_HBA1C_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'labs.hba1cPct', value: hba1c, ...SCORE2_RANGES.hba1cPct },
    };
  }
  if (egfr < SCORE2_RANGES.eGFR.min || egfr > SCORE2_RANGES.eGFR.max) {
    return {
      eligible: false,
      skipReason: 'SCORE2_DIABETES_EGFR_OUT_OF_RANGE',
      missingFields: [],
      outOfRange: { field: 'labs.eGFR', value: egfr, ...SCORE2_RANGES.eGFR },
    };
  }
  return { eligible: true };
}

// ============================================================================
// Skip-entry builders
// ============================================================================

/**
 * Emit a "not computable" SCORE2 ScoreResultEntry with structured skip metadata.
 * valueNumeric is `null` to unambiguously signal "not stratified". Consumers
 * (composite-risk.ts, UI) inspect rawPayload.skipReason for truthful messaging.
 */
export function buildScore2SkipEntry(
  elig: Extract<Score2Eligibility, { eligible: false }>,
  inputContext: Record<string, unknown>,
): ScoreResultEntry {
  return {
    scoreCode: 'SCORE2',
    valueNumeric: null,
    category: 'not_computable',
    label: 'SCORE2 Cardiovascular Risk (not computable)',
    inputPayload: inputContext,
    rawPayload: {
      skipped: true,
      skipReason: elig.skipReason,
      missingFields: elig.missingFields,
      outOfRange: elig.outOfRange ?? null,
    },
  };
}

export function buildScore2DiabetesSkipEntry(
  elig: Extract<Score2DiabetesEligibility, { eligible: false }>,
  inputContext: Record<string, unknown>,
): ScoreResultEntry {
  return {
    scoreCode: 'SCORE2_DIABETES',
    valueNumeric: null,
    category: 'not_computable',
    label: 'SCORE2-Diabetes Cardiovascular Risk (not computable)',
    inputPayload: inputContext,
    rawPayload: {
      skipped: true,
      skipReason: elig.skipReason,
      missingFields: elig.missingFields,
      outOfRange: elig.outOfRange ?? null,
    },
  };
}
