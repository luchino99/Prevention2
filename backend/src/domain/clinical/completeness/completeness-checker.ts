/**
 * Clinical completeness checker.
 *
 * Emits CompletenessWarning[] describing which scores could not be
 * computed and which input fields would unlock them. These warnings are
 * shown to the clinician as a "data collection punch list" in the
 * assessment view, but they are deliberately NOT merged into the
 * time-bound clinical alerts table.
 *
 * Why separate from alerts:
 *   - Alerts are action items with a due date (e.g. "follow-up overdue").
 *   - Completeness warnings are soft nudges that the assessment would be
 *     more informative with additional data. Mixing them erodes the
 *     signal-to-noise ratio of the alerts inbox, which is the single most
 *     important clinician workspace in a B2B monitoring product.
 *
 * Pure function — no side effects.
 *
 * Severity policy:
 *   - 'warning' when the missing score is directly in scope for the
 *     assessment (e.g. SCORE2 with cvAssessmentFocus=true, or eGFR in any
 *     assessment because renal risk is always part of the vertical).
 *   - 'info' otherwise.
 *   - NEVER 'critical' — a critical clinical finding is an alert.
 */

import type {
  AssessmentInput,
  CompletenessWarning,
} from '../../../../../shared/types/clinical.js';

/**
 * Small helper — collect into an array only the fields that are actually
 * undefined/null, preserving insertion order for stable UI output.
 */
function missing(
  input: AssessmentInput,
  keys: Array<{ path: string; value: unknown }>,
): string[] {
  const out: string[] = [];
  for (const { path, value } of keys) {
    if (value === undefined || value === null) out.push(path);
  }
  return out;
}

export function checkAssessmentCompleteness(
  input: AssessmentInput,
): CompletenessWarning[] {
  const warnings: CompletenessWarning[] = [];
  const cvFocus = input.meta?.cvAssessmentFocus === true;

  // -----------------------------------------------------------------------
  // SCORE2 readiness — applicable to the whole non-diabetic adult cohort.
  // Required inputs: total cholesterol, HDL, systolic BP, smoking flag.
  // (Age, sex, region are always present because the schema requires them.)
  // -----------------------------------------------------------------------
  if (!input.clinicalContext.hasDiabetes) {
    const score2Missing = missing(input, [
      { path: 'labs.totalCholMgDl', value: input.labs.totalCholMgDl },
      { path: 'labs.hdlMgDl', value: input.labs.hdlMgDl },
      { path: 'vitals.sbpMmHg', value: input.vitals.sbpMmHg },
    ]);
    if (score2Missing.length > 0) {
      warnings.push({
        code: 'SCORE2_INCOMPLETE',
        title: 'SCORE2 cannot be computed',
        detail:
          'Cardiovascular 10-year risk (SCORE2, ESC 2021) requires a fasting lipid panel (total cholesterol, HDL) and a current systolic blood pressure.',
        missingFields: score2Missing,
        suggestedAction:
          'Order a fasting lipid panel and record systolic blood pressure at the next visit.',
        severity: cvFocus ? 'warning' : 'info',
      });
    }
  } else {
    // SCORE2-Diabetes requires SCORE2 basics + diabetes-specific inputs.
    const s2dMissing = missing(input, [
      { path: 'labs.totalCholMgDl', value: input.labs.totalCholMgDl },
      { path: 'labs.hdlMgDl', value: input.labs.hdlMgDl },
      { path: 'vitals.sbpMmHg', value: input.vitals.sbpMmHg },
      { path: 'labs.hba1cPct', value: input.labs.hba1cPct },
      { path: 'labs.eGFR', value: input.labs.eGFR },
      {
        path: 'clinicalContext.ageAtDiabetesDiagnosis',
        value: input.clinicalContext.ageAtDiabetesDiagnosis,
      },
    ]);
    // eGFR may be derivable from creatinine — don't flag it as missing in
    // that case, the score engine will compute it.
    const s2dFiltered = s2dMissing.filter(
      (f) => !(f === 'labs.eGFR' && input.labs.creatinineMgDl !== undefined),
    );
    if (s2dFiltered.length > 0) {
      warnings.push({
        code: 'SCORE2_DIABETES_INCOMPLETE',
        title: 'SCORE2-Diabetes cannot be computed',
        detail:
          'SCORE2-Diabetes (ESC 2021) requires lipid panel, systolic BP, HbA1c, eGFR/creatinine and age at diabetes diagnosis.',
        missingFields: s2dFiltered,
        suggestedAction:
          'Collect the missing diabetes-specific inputs; eGFR can be derived from serum creatinine.',
        severity: 'warning',
      });
    }
  }

  // -----------------------------------------------------------------------
  // eGFR — we always want renal stratification in the cardio-nephro-metabolic
  // vertical. Accept either explicit eGFR or serum creatinine.
  // -----------------------------------------------------------------------
  if (
    input.labs.eGFR === undefined &&
    input.labs.creatinineMgDl === undefined
  ) {
    warnings.push({
      code: 'EGFR_INCOMPLETE',
      title: 'Renal function not stratified',
      detail:
        'eGFR cannot be computed without serum creatinine (or a direct eGFR value). Renal risk is central to the cardio-nephro-metabolic assessment.',
      missingFields: ['labs.creatinineMgDl'],
      suggestedAction:
        'Order serum creatinine (CKD-EPI 2021, KDIGO). eGFR will be derived automatically.',
      severity: 'warning',
    });
  }

  // -----------------------------------------------------------------------
  // ACR — required for KDIGO A1/A2/A3 staging. Accept explicit ACR, or a
  // derivable pair (urine albumin + urine creatinine).
  // -----------------------------------------------------------------------
  const hasAcr = input.labs.albuminCreatinineRatio !== undefined;
  const hasUrinePair =
    input.labs.urineAlbuminMgL !== undefined &&
    input.labs.urineCreatinineMgDl !== undefined;
  if (!hasAcr && !hasUrinePair) {
    warnings.push({
      code: 'ACR_INCOMPLETE',
      title: 'Albuminuria not assessed',
      detail:
        'KDIGO stages albuminuria as A1 (<30), A2 (30-299), A3 (≥300) mg/g. Without ACR the renal domain risk may be under-estimated.',
      missingFields: [
        'labs.albuminCreatinineRatio',
        'labs.urineAlbuminMgL',
        'labs.urineCreatinineMgDl',
      ],
      suggestedAction:
        'Order a spot urine albumin + urine creatinine (morning sample) — ACR is derived automatically.',
      severity: input.clinicalContext.hasDiabetes ? 'warning' : 'info',
    });
  }

  // -----------------------------------------------------------------------
  // FIB-4 — optional but recommended for any patient with metabolic risk.
  // -----------------------------------------------------------------------
  const fib4Missing = missing(input, [
    { path: 'labs.astUL', value: input.labs.astUL },
    { path: 'labs.altUL', value: input.labs.altUL },
    { path: 'labs.plateletsGigaL', value: input.labs.plateletsGigaL },
  ]);
  if (fib4Missing.length > 0) {
    warnings.push({
      code: 'FIB4_INCOMPLETE',
      title: 'FIB-4 liver fibrosis index not computed',
      detail:
        'FIB-4 requires AST, ALT and platelet count. Recommended in metabolic risk follow-up.',
      missingFields: fib4Missing,
      suggestedAction:
        'Order AST, ALT and CBC (for platelets) with the next fasting panel.',
      severity: 'info',
    });
  }

  // -----------------------------------------------------------------------
  // FLI — needs triglycerides + GGT (waist/BMI already on file).
  // -----------------------------------------------------------------------
  const fliMissing = missing(input, [
    { path: 'labs.triglyceridesMgDl', value: input.labs.triglyceridesMgDl },
    { path: 'labs.ggtUL', value: input.labs.ggtUL },
  ]);
  if (fliMissing.length > 0) {
    warnings.push({
      code: 'FLI_INCOMPLETE',
      title: 'Fatty Liver Index (FLI) not computed',
      detail:
        'FLI requires triglycerides and GGT in addition to waist and BMI (already on file).',
      missingFields: fliMissing,
      suggestedAction:
        'Order triglycerides and GGT at the next lipid panel.',
      severity: 'info',
    });
  }

  // -----------------------------------------------------------------------
  // Metabolic syndrome — needs triglycerides, HDL, glucose (waist + BP are
  // part of vitals and always present).
  // -----------------------------------------------------------------------
  const metsMissing = missing(input, [
    { path: 'labs.triglyceridesMgDl', value: input.labs.triglyceridesMgDl },
    { path: 'labs.hdlMgDl', value: input.labs.hdlMgDl },
    { path: 'labs.glucoseMgDl', value: input.labs.glucoseMgDl },
  ]);
  if (metsMissing.length > 0) {
    warnings.push({
      code: 'METABOLIC_SYNDROME_INCOMPLETE',
      title: 'Metabolic syndrome criteria incomplete',
      detail:
        'Metabolic syndrome (NCEP ATP III / IDF) needs triglycerides, HDL and fasting glucose.',
      missingFields: metsMissing,
      suggestedAction:
        'Complete the metabolic panel (TG, HDL, fasting glucose) at the next visit.',
      severity: 'info',
    });
  }

  // -----------------------------------------------------------------------
  // PREDIMED — missing questionnaire answers are low-severity.
  // -----------------------------------------------------------------------
  if (
    !input.lifestyle.predimedAnswers ||
    input.lifestyle.predimedAnswers.length !== 14
  ) {
    warnings.push({
      code: 'PREDIMED_INCOMPLETE',
      title: 'Mediterranean diet adherence not measured',
      detail:
        'PREDIMED MEDAS 14-item questionnaire is used to monitor Mediterranean diet adherence over time.',
      missingFields: ['lifestyle.predimedAnswers'],
      suggestedAction:
        'Administer the PREDIMED MEDAS 14-item questionnaire at the next visit.',
      severity: 'info',
    });
  }

  // -----------------------------------------------------------------------
  // Frailty — only relevant in older patients.
  // -----------------------------------------------------------------------
  if (!input.frailty && input.demographics.age >= 65) {
    warnings.push({
      code: 'FRAILTY_NOT_ASSESSED',
      title: 'Frailty not assessed',
      detail:
        'Patients ≥65 benefit from FRAIL scale screening. Frailty materially changes the risk/benefit calculus of aggressive pharmacotherapy.',
      missingFields: ['frailty'],
      suggestedAction:
        'Administer the 5-item FRAIL scale at the next visit.',
      severity: 'info',
    });
  }

  return warnings;
}
