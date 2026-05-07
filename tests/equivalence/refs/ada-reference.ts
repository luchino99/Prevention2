/**
 * ADA 7-year Type-2-Diabetes Risk Score — independent reference impl.
 *
 * Source:
 *   Bang H, Edwards AM, Bomback AS, et al.
 *   Development and validation of a patient self-assessment score for
 *   diabetes risk.
 *   Ann Intern Med. 2009;151(11):775–783.
 *   doi:10.7326/0003-4819-151-11-200912010-00005
 *
 * Engine cite-bound by docs/24-FORMULA-REGISTRY.md §5.
 *
 * Component scoring (additive):
 *   AGE          < 40 → 0; 40–49 → 1; 50–59 → 2; ≥ 60 → 3
 *   SEX          male → 1; female → 0
 *   GEST DM      female + gestationalDiabetes=true → 1; else 0
 *   FAMILY HX    yes → 1; no → 0
 *   HYPERTENSION yes → 1; no → 0
 *   PHYS ACTIVE  inactive (< 150 min/wk) → 1; active → 0
 *   BMI          < 25 → 0; 25–29.9 → 1; 30–39.9 → 2; ≥ 40 → 3
 *
 * Risk bands:
 *   0–2 → Low Risk
 *   3–4 → Moderate Risk
 *   ≥ 5 → High Risk
 *
 * Independence: this reference computes BMI inline rather than re-using
 * the engine BMI helper, so a regression in the BMI module cannot
 * silently mask an ADA regression in the same test pass.
 */

export interface AdaRefInput {
  age: number;
  sex: 'male' | 'female';
  gestationalDiabetes: boolean;
  familyHistoryDiabetes: boolean;
  hypertension: boolean;
  physicallyActive: boolean;
  heightCm: number;
  weightKg: number;
}

export interface AdaRefResult {
  score: number; // 0..11
  maxScore: 11;
  category: 'Low Risk' | 'Moderate Risk' | 'High Risk';
  breakdown: {
    age: 0 | 1 | 2 | 3;
    sex: 0 | 1;
    gestationalDiabetes: 0 | 1;
    familyHistory: 0 | 1;
    hypertension: 0 | 1;
    physicalActivity: 0 | 1;
    bmi: 0 | 1 | 2 | 3;
  };
}

function scoreAge(age: number): 0 | 1 | 2 | 3 {
  if (age < 40)      return 0;
  if (age < 50)      return 1;
  if (age < 60)      return 2;
  return 3;
}

function scoreBmi(bmi: number): 0 | 1 | 2 | 3 {
  if (bmi < 25)      return 0;
  if (bmi < 30)      return 1;
  if (bmi < 40)      return 2;
  return 3;
}

export function adaReference(input: AdaRefInput): AdaRefResult {
  if (input.age < 0 || input.age > 150) {
    throw new Error('adaReference: age out of range [0,150]');
  }
  if (input.heightCm <= 0 || input.weightKg <= 0) {
    throw new Error('adaReference: height and weight must be positive');
  }

  const heightM = input.heightCm / 100;
  const bmi = input.weightKg / (heightM * heightM);

  const breakdown: AdaRefResult['breakdown'] = {
    age: scoreAge(input.age),
    sex: input.sex === 'male' ? 1 : 0,
    gestationalDiabetes:
      input.sex === 'female' && input.gestationalDiabetes ? 1 : 0,
    familyHistory: input.familyHistoryDiabetes ? 1 : 0,
    hypertension: input.hypertension ? 1 : 0,
    physicalActivity: input.physicallyActive ? 0 : 1,
    bmi: scoreBmi(bmi),
  };

  const score =
    breakdown.age +
    breakdown.sex +
    breakdown.gestationalDiabetes +
    breakdown.familyHistory +
    breakdown.hypertension +
    breakdown.physicalActivity +
    breakdown.bmi;

  let category: AdaRefResult['category'];
  if (score <= 2)      category = 'Low Risk';
  else if (score <= 4) category = 'Moderate Risk';
  else                 category = 'High Risk';

  return { score, maxScore: 11, category, breakdown };
}
