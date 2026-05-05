/**
 * Metabolic Syndrome (MetS) Criteria Assessment
 * ATP III / IDF Harmonization 2009
 *
 * Sources:
 *   - Grundy SM, Cleeman JI, Daniels SR, et al. Diagnosis and management
 *     of the metabolic syndrome: an AHA/NHLBI Scientific Statement.
 *     Circulation. 2005;112(17):2735-52.  (NCEP ATP III update — USA waist 102/88)
 *   - Alberti KGMM, Eckel RH, Grundy SM, et al. Harmonizing the
 *     Metabolic Syndrome. A Joint Interim Statement of IDF/AHA/NHLBI/
 *     World Heart Federation/IAS/IASO. Circulation 2009;120:1640-45.
 *     (Per-population waist; for European-Caucasian: 94/80)
 *
 * Diagnosis: Present if ≥3 of 5 criteria are met. The ≥3-of-5 rule is
 * identical between ATP III and Harmonization; only the waist threshold
 * is population-specific.
 *
 * Audit AUD-2026-05-04 finding C-04: previous default `'NCEP_USA'` was
 * inappropriate for the EU target market. We now accept a
 * `populationThresholds` parameter and default to `'IDF_EUROPEAN'`
 * (94/80) so European-Caucasian populations are stratified per the
 * Harmonization 2009 guidance. Tenants with USA / non-EU cohorts can
 * pass `'NCEP_USA'` to opt back into the historical 102/88 cut-offs.
 *
 * Criteria:
 *   1. Waist Circumference (Abdominal Obesity)
 *      NCEP_USA:        Male >102 cm, Female >88 cm
 *      IDF_EUROPEAN:    Male >94 cm,  Female >80 cm   (default)
 *
 *   2. Triglycerides    ≥150 mg/dL                  (population-invariant)
 *   3. HDL Cholesterol  Male <40, Female <50 mg/dL  (population-invariant)
 *   4. Blood Pressure   SBP ≥130 OR DBP ≥85         (population-invariant)
 *   5. Fasting Glucose  ≥100 mg/dL                  (population-invariant)
 */

import {
  MetabolicSyndromeInput,
  MetabolicSyndromeResult,
} from '../../../../../shared/types/clinical.js';

/**
 * Waist threshold population sets. `IDF_EUROPEAN` is the default for
 * the EU-targeted deployment of this platform.
 */
export const MetsWaistThresholds = {
  NCEP_USA:     { male: 102, female: 88 },
  IDF_EUROPEAN: { male: 94,  female: 80 },
} as const;

export type MetsWaistPolicy = keyof typeof MetsWaistThresholds;

/**
 * Assess Metabolic Syndrome criteria.
 * Pure function with zero side effects.
 *
 * @param input  MetabolicSyndromeInput with the 7 required fields
 * @param policy 'IDF_EUROPEAN' (default) or 'NCEP_USA' — selects the
 *               waist circumference threshold per Harmonization 2009.
 * @returns MetabolicSyndromeResult with present flag, criteria count, details
 */
export function computeMetabolicSyndrome(
  input: MetabolicSyndromeInput,
  policy: MetsWaistPolicy = 'IDF_EUROPEAN',
): MetabolicSyndromeResult {
  const criteriaDetails: MetabolicSyndromeResult['criteriaDetails'] = [];
  let criteriaCount = 0;

  // Criterion 1: Waist Circumference (Abdominal Obesity) — population-aware.
  const waistThreshold = MetsWaistThresholds[policy][input.sex];
  const waistMet = input.waistCm > waistThreshold;
  if (waistMet) criteriaCount++;
  criteriaDetails.push({
    name: 'Abdominal Obesity (Waist Circumference)',
    met: waistMet,
    value: `${input.waistCm} cm`,
    threshold: `>${waistThreshold} cm (${policy})`,
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
