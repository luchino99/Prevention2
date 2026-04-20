/**
 * BMI (Body Mass Index) Calculator
 * Standard anthropometric measure of body composition
 *
 * Source: WHO. Obesity: preventing and managing the global epidemic.
 * Technical Report Series 894, 2000.
 *
 * Formula: weight_kg / (height_cm / 100)^2
 *
 * Categories (WHO):
 *   <18.5       = Underweight
 *   18.5-24.9   = Normal weight
 *   25.0-29.9   = Overweight
 *   ≥30.0       = Obese
 *     ≥30.0-34.9 = Obese Class I
 *     ≥35.0-39.9 = Obese Class II
 *     ≥40.0      = Obese Class III (severe)
 */

import { BmiInput, BmiResult } from '../../../../../shared/types/clinical';

/**
 * Compute BMI from height and weight
 * Pure function with zero side effects
 *
 * @param input - BmiInput with heightCm and weightKg
 * @returns BmiResult with calculated BMI and WHO category
 * @throws Error if height <= 0 or weight <= 0 (handled gracefully in caller)
 */
export function computeBmi(input: BmiInput): BmiResult {
  // Guard against invalid inputs
  if (input.heightCm <= 0 || input.weightKg <= 0) {
    return {
      bmi: 0,
      category: 'invalid_input',
    };
  }

  // BMI = weight(kg) / (height(m))^2
  const heightM = input.heightCm / 100;
  const bmi = input.weightKg / (heightM * heightM);

  // Categorize BMI
  let category: string;
  if (bmi < 18.5) {
    category = 'underweight';
  } else if (bmi < 25) {
    category = 'normal';
  } else if (bmi < 30) {
    category = 'overweight';
  } else if (bmi < 35) {
    category = 'obese_class_i';
  } else if (bmi < 40) {
    category = 'obese_class_ii';
  } else {
    category = 'obese_class_iii';
  }

  return {
    bmi: Math.round(bmi * 10) / 10, // Round to 1 decimal place
    category,
  };
}
