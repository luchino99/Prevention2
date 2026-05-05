/**
 * FIB-4 Index (Fibrosis-4 Index)
 * Non-invasive marker for liver fibrosis assessment
 *
 * Sources:
 *   - Sterling RK, et al. Development and validation of a simple index for
 *     fibrosis in hepatitis C virus infection. Hepatology. 2006;43(6):1317-25.
 *     (Original derivation; standard adult cut-offs 1.45 / 3.25)
 *   - McPherson S, et al. Age as a confounding factor for the accurate
 *     non-invasive diagnosis of advanced NAFLD fibrosis. Am J Gastroenterol.
 *     2017;112(5):740-51. (Validates raised lower cut-off ≈2.0 for ≥65y to
 *     reduce age-driven false positives.)
 *   - AASLD Practice Guidance on NAFLD 2023 §5.4 (endorses age-adjusted
 *     interpretation for adults ≥65y).
 *
 * Formula: FIB-4 = (Age × AST) / (Platelets × √(ALT))
 *
 * Where:
 *   Age = years
 *   AST = Aspartate Aminotransferase (U/L)
 *   ALT = Alanine Aminotransferase (U/L)
 *   Platelets = in 10^9/L (Giga/L), not 10^3/μL
 *
 * Interpretation (audit C-05 — age-adjusted thresholds):
 *   age < 65 (Sterling 2006 / standard adult):
 *     FIB-4 <1.45  = low_risk         (F0-F2)
 *     1.45-3.25    = intermediate
 *     ≥3.25        = high_risk        (F3-F4)
 *
 *   age ≥ 65 (McPherson 2017 / AASLD 2023):
 *     FIB-4 <2.0   = low_risk
 *     2.0-3.25     = intermediate
 *     ≥3.25        = high_risk
 *   (Lower cut-off raised from 1.45→2.0 to reduce false positives;
 *    high-risk cut-off remains 3.25.)
 *
 * The result includes the threshold-set name so downstream layers
 * (alert engine, follow-up, report) can communicate which ruleset
 * applied to the patient.
 */

import { Fib4Input, Fib4Result } from '../../../../../shared/types/clinical.js';

/**
 * Compute FIB-4 Index for liver fibrosis assessment
 * Pure function with zero side effects
 *
 * @param input - Fib4Input with age, AST, ALT, and platelets in Giga/L
 * @returns Fib4Result with FIB-4 score and risk category
 */
export function computeFib4(input: Fib4Input): Fib4Result {
  // Guard against invalid inputs
  if (
    input.age <= 0 ||
    input.astUL < 0 ||
    input.altUL < 0 ||
    input.plateletsGigaL <= 0
  ) {
    return {
      fib4: 0,
      category: 'invalid_input',
    };
  }

  // FIB-4 = (Age × AST) / (Platelets × √(ALT))
  const numerator = input.age * input.astUL;
  const denominator = input.plateletsGigaL * Math.sqrt(input.altUL);

  // Guard against division by zero or sqrt of zero
  if (denominator === 0) {
    return {
      fib4: 0,
      category: 'invalid_input',
    };
  }

  const fib4 = numerator / denominator;

  // Audit C-05: age-adjusted thresholds. Patients <65y use Sterling 2006
  // adult cut-offs (1.45/3.25); patients ≥65y use the McPherson 2017 /
  // AASLD 2023 lower cut-off (2.0/3.25) to compensate for the age-driven
  // numerator inflation that produces false-positives in the elderly.
  const isElderly = input.age >= 65;
  const lowCutoff = isElderly ? 2.0 : 1.45;
  const highCutoff = 3.25;

  let category: string;
  if (fib4 < lowCutoff) {
    category = 'low_risk';
  } else if (fib4 < highCutoff) {
    category = 'intermediate';
  } else {
    category = 'high_risk';
  }

  return {
    fib4: Math.round(fib4 * 100) / 100, // Round to 2 decimal places
    category,
    // Reflect which ruleset applied so downstream surfaces (PDF report,
    // alert messaging) can be transparent. The Fib4Result type accepts
    // additional fields via index signature in shared/types/clinical.ts.
    ...({ thresholdSet: isElderly ? 'aasld_2023_age65plus' : 'sterling_2006_adult' } as object),
  } as Fib4Result;
}
