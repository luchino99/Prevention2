/**
 * Fatty Liver Index (FLI) — independent reference implementation.
 *
 * Source:
 *   Bedogni G, Bellentani S, Miglioli L, et al.
 *   The Fatty Liver Index: a simple and accurate predictor of hepatic
 *   steatosis in the general population.
 *   BMC Gastroenterology. 2006;6:33.
 *   doi:10.1186/1471-230X-6-33
 *
 * Formula:
 *   y = 0.953·ln(triglycerides_mg_dl)
 *     + 0.139·BMI
 *     + 0.718·ln(GGT_U_L)
 *     + 0.053·waist_cm
 *     − 15.745
 *   FLI = e^y / (1 + e^y) × 100
 *
 * Bands (Bedogni 2006, Table 4):
 *   < 30  → Excluded (low probability of hepatic steatosis)
 *   30–59 → Indeterminate (uncertain probability)
 *   ≥ 60  → Probable NAFLD (high probability)
 *
 * The engine rounds the result to two decimal places; this reference
 * does NOT pre-round, so the test asserts engine output is within a
 * documented tolerance of the reference (TOL_FLI = 0.05). The reason
 * for the tolerance: log + exponential cascade introduces ~1e-2
 * floating-point noise that is not clinically meaningful.
 */

export interface FliRefInput {
  heightCm: number;
  weightKg: number;
  waistCm: number;
  triglyceridesMgDl: number;
  ggtUL: number;
}

export interface FliRefResult {
  fli: number;
  bmi: number;
  category: 'Excluded' | 'Indeterminate' | 'Probable NAFLD';
}

export function fliReference(input: FliRefInput): FliRefResult {
  if (input.heightCm <= 0)         throw new Error('fliReference: heightCm must be positive');
  if (input.weightKg <= 0)         throw new Error('fliReference: weightKg must be positive');
  if (input.waistCm <= 0)          throw new Error('fliReference: waistCm must be positive');
  if (input.triglyceridesMgDl <= 0) throw new Error('fliReference: triglyceridesMgDl must be positive');
  if (input.ggtUL <= 0)            throw new Error('fliReference: ggtUL must be positive');

  const heightM = input.heightCm / 100;
  const bmi = input.weightKg / (heightM * heightM);

  const y =
    0.953 * Math.log(input.triglyceridesMgDl) +
    0.139 * bmi +
    0.718 * Math.log(input.ggtUL) +
    0.053 * input.waistCm -
    15.745;

  const ey = Math.exp(y);
  const fli = (ey / (1 + ey)) * 100;

  let category: FliRefResult['category'];
  if (fli < 30)      category = 'Excluded';
  else if (fli < 60) category = 'Indeterminate';
  else               category = 'Probable NAFLD';

  return { fli, bmi, category };
}
