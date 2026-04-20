/**
 * Metabolic Syndrome (MetS) Criteria Assessment
 * ATP III / IDF Modified Criteria
 *
 * Source: Grundy SM, et al. Diagnosis and management of the metabolic syndrome:
 * an American Heart Association/National Heart, Lung, and Blood Institute Scientific Statement
 * (2005). Updated harmonization with IDF criteria.
 *
 * Diagnosis: Present if ≥3 of 5 criteria are met
 *
 * Criteria:
 *   1. Waist Circumference (Abdominal Obesity)
 *      Male:   >102 cm (>40 inches)
 *      Female: >88 cm (>35 inches)
 *
 *   2. Triglycerides
 *      ≥150 mg/dL (or on triglyceride-lowering medication)
 *
 *   3. HDL Cholesterol
 *      Male:   <40 mg/dL
 *      Female: <50 mg/dL
 *      (or on HDL-raising medication)
 *
 *   4. Blood Pressure
 *      SBP ≥130 mmHg OR DBP ≥85 mmHg
 *      (or on antihypertensive medication)
 *
 *   5. Fasting Glucose
 *      ≥100 mg/dL (or on glucose-lowering medication/diabetes diagnosis)
 */

import {
  MetabolicSyndromeInput,
  MetabolicSyndromeResult,
} from '../../../../../shared/types/clinical';

/**
 * Assess Metabolic Syndrome criteria
 * Pure function with zero side effects
 *
 * @param input - MetabolicSyndromeInput with all 7 required fields
 * @returns MetabolicSyndromeResult with present flag, criteria count, and details
 */
export function computeMetabolicSyndrome(
  input: MetabolicSyndromeInput
): MetabolicSyndromeResult {
  const criteriaDetails: MetabolicSyndromeResult['criteriaDetails'] = [];
  let criteriaCount = 0;

  // Criterion 1: Waist Circumference (Abdominal Obesity)
  const waistThreshold = input.sex === 'male' ? 102 : 88;
  const waistMet = input.waistCm > waistThreshold;
  if (waistMet) criteriaCount++;
  criteriaDetails.push({
    name: 'Abdominal Obesity (Waist Circumference)',
    met: waistMet,
    value: `${input.waistCm} cm`,
    threshold: input.sex === 'male' ? '>102 cm' : '>88 cm',
  });

  // Criterion 2: Triglycerides
  const triglyceridesMet = input.triglyceridesMgDl >= 150;
  if (triglyceridesMet) criteriaCount++;
  criteriaDetails.push({
    name: 'Triglycerides',
    met: triglyceridesMet,
    value: `${input.triglyceridesMgDl} mg/dL`,
    threshold: '≥150 mg/dL',
  });

  // Criterion 3: HDL Cholesterol
  const hdlThreshold = input.sex === 'male' ? 40 : 50;
  const hdlMet = input.hdlMgDl < hdlThreshold;
  if (hdlMet) criteriaCount++;
  criteriaDetails.push({
    name: 'HDL Cholesterol',
    met: hdlMet,
    value: `${input.hdlMgDl} mg/dL`,
    threshold: input.sex === 'male' ? '<40 mg/dL' : '<50 mg/dL',
  });

  // Criterion 4: Blood Pressure
  const bpMet = input.sbpMmHg >= 130 || input.dbpMmHg >= 85;
  if (bpMet) criteriaCount++;
  criteriaDetails.push({
    name: 'Blood Pressure',
    met: bpMet,
    value: `${input.sbpMmHg}/${input.dbpMmHg} mmHg`,
    threshold: 'SBP ≥130 OR DBP ≥85',
  });

  // Criterion 5: Fasting Glucose
  const glucoseMet = input.glucoseMgDl >= 100;
  if (glucoseMet) criteriaCount++;
  criteriaDetails.push({
    name: 'Fasting Glucose',
    met: glucoseMet,
    value: `${input.glucoseMgDl} mg/dL`,
    threshold: '≥100 mg/dL',
  });

  // Metabolic Syndrome present if ≥3 criteria met
  const present = criteriaCount >= 3;

  return {
    present,
    criteriaCount,
    totalCriteria: 5,
    criteriaDetails,
  };
}
