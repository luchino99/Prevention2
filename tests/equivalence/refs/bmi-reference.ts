/**
 * BMI — independent reference implementation.
 *
 * Source: WHO. Obesity: preventing and managing the global epidemic.
 * Technical Report Series 894, Annex 2, 2000.
 *
 * Formula:   BMI = weight_kg / (height_m)²
 *
 * WHO categories (post-2000 thresholds):
 *   < 18.5     Underweight
 *   18.5–24.9  Normal weight
 *   25.0–29.9  Overweight
 *   30.0–34.9  Obese class I
 *   35.0–39.9  Obese class II
 *   ≥ 40.0     Obese class III (severe)
 *
 * The engine rounds the numerical result to one decimal place before
 * categorisation; this reference does the same so equivalence is bit-
 * identical to the engine's contract — NOT a covert formula correction.
 *
 * Per project rule, this file does NOT alter validated calculation logic
 * — it re-derives the formula from the published source so any future
 * engine change has to defend itself against an independent baseline.
 */

export interface BmiRefInput {
  heightCm: number;
  weightKg: number;
}

export interface BmiRefResult {
  /** BMI value rounded to 1 decimal place. */
  bmi: number;
  /** WHO 2000 category, lowercase snake_case to match the engine. */
  category:
    | 'underweight'
    | 'normal'
    | 'overweight'
    | 'obese_class_i'
    | 'obese_class_ii'
    | 'obese_class_iii';
}

export function bmiReference(input: BmiRefInput): BmiRefResult {
  if (input.heightCm <= 0 || input.weightKg <= 0) {
    throw new Error('bmiReference: height and weight must be positive');
  }
  const heightM = input.heightCm / 100;
  const raw = input.weightKg / (heightM * heightM);
  const bmi = Math.round(raw * 10) / 10;

  let category: BmiRefResult['category'];
  if (bmi < 18.5)        category = 'underweight';
  else if (bmi < 25)     category = 'normal';
  else if (bmi < 30)     category = 'overweight';
  else if (bmi < 35)     category = 'obese_class_i';
  else if (bmi < 40)     category = 'obese_class_ii';
  else                   category = 'obese_class_iii';

  return { bmi, category };
}
