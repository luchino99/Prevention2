/**
 * eGFR (CKD-EPI 2021 race-free) — independent reference implementation.
 *
 * Source:
 *   Inker LA, Eneanya ND, Coresh J, et al.
 *   New Creatinine- and Cystatin C-Based Equations to Estimate GFR
 *   Without Race.
 *   N Engl J Med. 2021;385(19):1737–1749.
 *   doi:10.1056/NEJMoa2102953
 *
 * Formula (creatinine-only, race-free):
 *   eGFR = 142
 *        × min(Scr/κ, 1)^α
 *        × max(Scr/κ, 1)^(-1.200)
 *        × 0.9938^age
 *        × 1.012   (if female; 1 if male)
 *
 * Where:
 *   Scr  — serum creatinine, mg/dL
 *   κ    — 0.7 (female) | 0.9 (male)
 *   α    — −0.241 (female) | −0.302 (male)
 *
 * KDIGO 2024 staging (engine-aligned snake_case categories):
 *   ≥ 90   → G1  normal_or_high
 *   60–89  → G2  mildly_decreased
 *   45–59  → G3a mildly_to_moderately_decreased
 *   30–44  → G3b moderately_to_severely_decreased
 *   15–29  → G4  severely_decreased
 *   < 15   → G5  kidney_failure
 *
 * The engine rounds eGFR to the nearest integer for staging; this
 * reference does the same so equivalence is bit-identical.
 */

export interface EgfrRefInput {
  creatinineMgDl: number;
  age: number;
  sex: 'male' | 'female';
}

export interface EgfrRefResult {
  egfr: number;
  stage: 'G1' | 'G2' | 'G3a' | 'G3b' | 'G4' | 'G5' | 'invalid_input';
  category:
    | 'normal_or_high'
    | 'mildly_decreased'
    | 'mildly_to_moderately_decreased'
    | 'moderately_to_severely_decreased'
    | 'severely_decreased'
    | 'kidney_failure'
    | 'invalid_input';
}

export function egfrReference(input: EgfrRefInput): EgfrRefResult {
  if (input.creatinineMgDl <= 0 || input.age < 18) {
    return { egfr: 0, stage: 'invalid_input', category: 'invalid_input' };
  }

  const isFemale = input.sex === 'female';
  const kappa = isFemale ? 0.7 : 0.9;
  const alpha = isFemale ? -0.241 : -0.302;
  const sexMul = isFemale ? 1.012 : 1.0;

  const ratio = input.creatinineMgDl / kappa;
  const minR  = Math.min(ratio, 1);
  const maxR  = Math.max(ratio, 1);

  const raw =
    142 *
    Math.pow(minR, alpha) *
    Math.pow(maxR, -1.2) *
    Math.pow(0.9938, input.age) *
    sexMul;

  const egfr = Math.round(raw);

  let stage: EgfrRefResult['stage'];
  let category: EgfrRefResult['category'];
  if (egfr >= 90)      { stage = 'G1';  category = 'normal_or_high'; }
  else if (egfr >= 60) { stage = 'G2';  category = 'mildly_decreased'; }
  else if (egfr >= 45) { stage = 'G3a'; category = 'mildly_to_moderately_decreased'; }
  else if (egfr >= 30) { stage = 'G3b'; category = 'moderately_to_severely_decreased'; }
  else if (egfr >= 15) { stage = 'G4';  category = 'severely_decreased'; }
  else                 { stage = 'G5';  category = 'kidney_failure'; }

  return { egfr, stage, category };
}
