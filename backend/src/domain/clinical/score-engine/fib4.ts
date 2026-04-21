/**
 * FIB-4 Index (Fibrosis-4 Index)
 * Non-invasive marker for liver fibrosis assessment
 *
 * Source: Sterling RK, et al. Development and validation of a simple index for
 * fibrosis in hepatitis C virus infection. Hepatology. 2006;43(6):1317-1325.
 *
 * Formula: FIB-4 = (Age × AST) / (Platelets × √(ALT))
 *
 * Where:
 *   Age = years
 *   AST = Aspartate Aminotransferase (U/L)
 *   ALT = Alanine Aminotransferase (U/L)
 *   Platelets = in 10^9/L (Giga/L), not 10^3/μL
 *
 * Interpretation (Hepatitis C):
 *   FIB-4 <1.45     = Low risk of advanced fibrosis (F0-F2)
 *   1.45-3.25       = Intermediate risk
 *   ≥3.25           = High risk of advanced fibrosis (F3-F4)
 *
 * Note: This score is primarily validated for hepatitis C patients.
 * Cut-offs vary by age and comorbidities.
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

  // Categorize risk based on thresholds
  let category: string;
  if (fib4 < 1.45) {
    category = 'low_risk';
  } else if (fib4 < 3.25) {
    category = 'intermediate';
  } else {
    category = 'high_risk';
  }

  return {
    fib4: Math.round(fib4 * 100) / 100, // Round to 2 decimal places
    category,
  };
}
