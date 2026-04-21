/**
 * eGFR (Estimated Glomerular Filtration Rate)
 * CKD-EPI 2021 Race-Free Equation
 *
 * Source: Inker LA, et al. New creatinine-and cystatin C-based predictive equations
 * for GFR: a systematic review. Am J Kidney Dis. 2023;92(1):40-53.
 *
 * CKD-EPI 2021 Formula (Race-Free):
 * eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^(-1.200) × 0.9938^age × (1.012 if female)
 *
 * Where:
 *   Scr = Serum creatinine in mg/dL
 *   κ = 0.7 (female), 0.9 (male)
 *   α = -0.241 (female), -0.302 (male)
 *   age = age in years
 *   Multiplier = 1.012 if female, 1.0 if male
 *
 * CKD Stages (KDIGO 2021):
 *   G1: eGFR ≥90 mL/min/1.73m²     (Normal or high)
 *   G2: eGFR 60-89                 (Mildly decreased)
 *   G3a: eGFR 45-59                (Mildly to moderately decreased)
 *   G3b: eGFR 30-44                (Moderately to severely decreased)
 *   G4: eGFR 15-29                 (Severely decreased)
 *   G5: eGFR <15                   (Kidney failure)
 */

import { EgfrInput, EgfrResult } from '../../../../../shared/types/clinical.js';

/**
 * Compute eGFR using CKD-EPI 2021 race-free equation
 * Pure function with zero side effects
 *
 * @param input - EgfrInput with creatinine (mg/dL), age, and sex
 * @returns EgfrResult with eGFR value, stage, and category
 */
export function computeEgfr(input: EgfrInput): EgfrResult {
  // Guard against invalid inputs
  if (input.creatinineMgDl <= 0 || input.age < 18) {
    return {
      egfr: 0,
      stage: 'invalid_input',
      category: 'invalid_input',
    };
  }

  const Scr = input.creatinineMgDl;
  const age = input.age;
  const isFemale = input.sex === 'female';

  // Sex-specific parameters
  const kappa = isFemale ? 0.7 : 0.9;
  const alpha = isFemale ? -0.241 : -0.302;
  const sexMultiplier = isFemale ? 1.012 : 1.0;

  // Calculate min(Scr/κ, 1) and max(Scr/κ, 1)
  const creatRatio = Scr / kappa;
  const minRatio = Math.min(creatRatio, 1);
  const maxRatio = Math.max(creatRatio, 1);

  // eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^(-1.200) × 0.9938^age × sexMultiplier
  const egfr =
    142 *
    Math.pow(minRatio, alpha) *
    Math.pow(maxRatio, -1.2) *
    Math.pow(0.9938, age) *
    sexMultiplier;

  // Round to nearest integer
  const egfrRounded = Math.round(egfr);

  // Determine CKD stage based on eGFR
  let stage: string;
  let category: string;

  if (egfrRounded >= 90) {
    stage = 'G1';
    category = 'normal_or_high';
  } else if (egfrRounded >= 60) {
    stage = 'G2';
    category = 'mildly_decreased';
  } else if (egfrRounded >= 45) {
    stage = 'G3a';
    category = 'mildly_to_moderately_decreased';
  } else if (egfrRounded >= 30) {
    stage = 'G3b';
    category = 'moderately_to_severely_decreased';
  } else if (egfrRounded >= 15) {
    stage = 'G4';
    category = 'severely_decreased';
  } else {
    stage = 'G5';
    category = 'kidney_failure';
  }

  return {
    egfr: egfrRounded,
    stage,
    category,
  };
}
