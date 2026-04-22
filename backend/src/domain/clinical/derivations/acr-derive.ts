/**
 * Albumin-Creatinine Ratio (ACR) boundary derivation.
 *
 * When the clinician supplies raw urinary spot-sample values (albumin and
 * creatinine) but does not supply an explicit ACR, we compute the ACR from
 * them so downstream KDIGO albuminuria staging is able to function.
 *
 * This is a BOUNDARY derivation — it never mutates the original assessment
 * input sent over the wire. The service layer produces an augmented copy
 * used exclusively for clinical computation. The canonical persisted
 * snapshot (`clinical_input_snapshot`) still contains the user-supplied
 * values unchanged, plus the derived ACR so the computation is exactly
 * reproducible on read-back.
 *
 * Formula (spot urine):
 *
 *     ACR (mg/g) = urine_albumin_mg_per_L / urine_creatinine_g_per_L
 *                = urine_albumin_mg_per_L × 100 / urine_creatinine_mg_per_dL
 *
 * Sanity range: KDIGO operational thresholds for A1/A2/A3 are 30 and 300
 * mg/g. Any positive numeric output is valid; callers are responsible for
 * clamping if needed.
 *
 * Pure function — no side effects.
 */

export interface AcrDerivationInput {
  urineAlbuminMgL?: number;
  urineCreatinineMgDl?: number;
}

export interface AcrDerivationResult {
  /** Computed ACR (mg/g), or undefined if inputs are insufficient/invalid. */
  acrMgG: number | undefined;
  /** Human-readable trace for audit/UI (why ACR is / is not available). */
  reason: string;
}

export function deriveAcrFromUrine(input: AcrDerivationInput): AcrDerivationResult {
  const albumin = input.urineAlbuminMgL;
  const creatinine = input.urineCreatinineMgDl;

  if (albumin === undefined || creatinine === undefined) {
    return {
      acrMgG: undefined,
      reason: 'Insufficient urine data (need urine albumin mg/L and urine creatinine mg/dL)',
    };
  }

  if (creatinine <= 0) {
    return {
      acrMgG: undefined,
      reason: 'Urine creatinine must be strictly positive to compute ACR',
    };
  }

  const acr = (albumin * 100) / creatinine;

  // Round to 1 decimal place for clinical readability without losing
  // useful precision. KDIGO thresholds (30, 300) are well within this grain.
  const acrRounded = Math.round(acr * 10) / 10;

  return {
    acrMgG: acrRounded,
    reason: `Derived ACR=${acrRounded} mg/g from urine albumin ${albumin} mg/L / urine creatinine ${creatinine} mg/dL`,
  };
}
