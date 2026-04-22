/**
 * Clinical Score Engine Orchestrator
 * Computes all clinical risk scores in a single assessment
 *
 * Pure function that:
 * 1. Calls individual score engines based on available data
 * 2. Wraps each score computation in try/catch to prevent cascade failures
 * 3. Returns ScoreResultEntry[] with all computed scores
 *
 * Zero side effects - all operations are pure calculations
 */

import {
  AssessmentInput,
  ScoreResultEntry,
} from '../../../../../shared/types/clinical.js';

import { computeScore2 } from './score2.js';
import { computeScore2Diabetes } from './score2-diabetes.js';
import { computeAda } from './ada.js';
import { computeFli } from './fli.js';
import { computeFrail } from './frail.js';
import { computeBmi } from './bmi.js';
import { computeMetabolicSyndrome } from './metabolic-syndrome.js';
import { computeFib4 } from './fib4.js';
import { computeEgfr } from './egfr.js';
// PREDIMED MEDAS lives in the nutrition-engine because it also feeds the
// nutrition summary (BMR/TDEE + adherence band). We reuse the pure helpers
// from there instead of re-implementing the scoring formula — keeping the
// validated logic in a single place.
import {
  computePredimedScore,
  categorizePredimedAdherence,
  PREDIMED_MAX_SCORE,
} from '../nutrition-engine/predimed.js';

/**
 * Compute all available clinical scores from a comprehensive assessment
 * Pure function with zero side effects
 *
 * @param input - AssessmentInput with demographics, vitals, labs, clinical context
 * @returns ScoreResultEntry[] containing all computed scores
 *
 * Logic:
 * - BMI: Always computed
 * - SCORE2: Computed if labs available (cholesterol, HDL, SBP)
 * - SCORE2-Diabetes: Computed only if hasDiabetes + additional labs
 * - ADA: Computed only if !hasDiabetes (screening for non-diabetics)
 * - FLI: Computed if triglycerides + GGT available
 * - FRAIL: Computed if frailty data provided
 * - Metabolic Syndrome: Computed if all 5 criteria data available
 * - FIB-4: Computed if AST, ALT, platelets available
 * - eGFR: Computed if creatinine available (or passed through)
 * - PREDIMED: Computed when all 14 MEDAS answers are provided. Emitted as a
 *            first-class ScoreResultEntry so downstream engines (alert
 *            engine for diet-adherence drop, followup for lifestyle
 *            counselling, reports) can consume it via `findScoreByCode`.
 *
 * Each score wrapped in try/catch to prevent single failure from breaking batch
 */
export function computeAllScores(input: AssessmentInput): ScoreResultEntry[] {
  const results: ScoreResultEntry[] = [];

  // =========================================================================
  // 1. BMI - Always compute
  // =========================================================================
  try {
    const bmiResult = computeBmi({
      heightCm: input.vitals.heightCm,
      weightKg: input.vitals.weightKg,
    });

    results.push({
      scoreCode: 'BMI',
      valueNumeric: bmiResult.bmi,
      category: bmiResult.category,
      label: 'Body Mass Index',
      inputPayload: {
        heightCm: input.vitals.heightCm,
        weightKg: input.vitals.weightKg,
      },
      rawPayload: bmiResult as unknown as Record<string, unknown>,
    });
  } catch (error) {
    console.error('Error computing BMI:', error);
  }

  // =========================================================================
  // 2. SCORE2 - Compute if labs available
  // =========================================================================
  if (
    input.labs.totalCholMgDl &&
    input.labs.hdlMgDl &&
    input.vitals.sbpMmHg
  ) {
    try {
      const score2Result = computeScore2({
        age: input.demographics.age,
        sex: input.demographics.sex,
        smoking: input.clinicalContext.smoking,
        sbpMmHg: input.vitals.sbpMmHg,
        totalCholMgDl: input.labs.totalCholMgDl,
        hdlMgDl: input.labs.hdlMgDl,
        riskRegion: input.clinicalContext.cvRiskRegion,
      });

      results.push({
        scoreCode: 'SCORE2',
        valueNumeric: score2Result.riskPercent,
        category: score2Result.category,
        label: 'SCORE2 Cardiovascular Risk',
        inputPayload: {
          age: input.demographics.age,
          sex: input.demographics.sex,
          smoking: input.clinicalContext.smoking,
          sbpMmHg: input.vitals.sbpMmHg,
          totalCholMgDl: input.labs.totalCholMgDl,
          hdlMgDl: input.labs.hdlMgDl,
          region: input.clinicalContext.cvRiskRegion,
        },
        rawPayload: score2Result as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing SCORE2:', error);
    }
  }

  // =========================================================================
  // 3. SCORE2-Diabetes - Only if hasDiabetes + required labs
  // =========================================================================
  if (
    input.clinicalContext.hasDiabetes &&
    input.labs.totalCholMgDl &&
    input.labs.hdlMgDl &&
    input.vitals.sbpMmHg &&
    input.clinicalContext.ageAtDiabetesDiagnosis &&
    input.labs.hba1cPct &&
    input.labs.eGFR
  ) {
    try {
      const score2DmResult = computeScore2Diabetes({
        age: input.demographics.age,
        sex: input.demographics.sex,
        smoking: input.clinicalContext.smoking,
        sbpMmHg: input.vitals.sbpMmHg,
        totalCholMgDl: input.labs.totalCholMgDl,
        hdlMgDl: input.labs.hdlMgDl,
        riskRegion: input.clinicalContext.cvRiskRegion,
        ageAtDiabetesDiagnosis: input.clinicalContext.ageAtDiabetesDiagnosis,
        hba1cPercent: input.labs.hba1cPct,
        eGFR: input.labs.eGFR,
      });

      results.push({
        scoreCode: 'SCORE2_DIABETES',
        valueNumeric: score2DmResult.riskPercent,
        category: score2DmResult.category,
        label: 'SCORE2-Diabetes Cardiovascular Risk',
        inputPayload: {
          age: input.demographics.age,
          sex: input.demographics.sex,
          smoking: input.clinicalContext.smoking,
          sbpMmHg: input.vitals.sbpMmHg,
          totalCholMgDl: input.labs.totalCholMgDl,
          hdlMgDl: input.labs.hdlMgDl,
          region: input.clinicalContext.cvRiskRegion,
          ageAtDiabetesDiagnosis: input.clinicalContext.ageAtDiabetesDiagnosis,
          hba1cPercent: input.labs.hba1cPct,
          eGFR: input.labs.eGFR,
        },
        rawPayload: score2DmResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing SCORE2-Diabetes:', error);
    }
  }

  // =========================================================================
  // 4. ADA - Only if !hasDiabetes (screening for non-diabetics)
  // =========================================================================
  if (!input.clinicalContext.hasDiabetes) {
    try {
      const adaResult = computeAda({
        age: input.demographics.age,
        sex: input.demographics.sex,
        gestationalDiabetes: input.clinicalContext.gestationalDiabetes,
        familyHistoryDiabetes: input.clinicalContext.familyHistoryDiabetes,
        hypertension: input.clinicalContext.hypertension,
        physicallyActive:
          input.lifestyle.weeklyActivityMinutes !== undefined
            ? input.lifestyle.weeklyActivityMinutes >= 150
            : false,
        heightCm: input.vitals.heightCm,
        weightKg: input.vitals.weightKg,
      });

      results.push({
        scoreCode: 'ADA',
        valueNumeric: adaResult.score,
        category: adaResult.category,
        label: 'ADA Diabetes Risk Score',
        inputPayload: {
          age: input.demographics.age,
          sex: input.demographics.sex,
          gestationalDiabetes: input.clinicalContext.gestationalDiabetes,
          familyHistoryDiabetes: input.clinicalContext.familyHistoryDiabetes,
          hypertension: input.clinicalContext.hypertension,
          physicallyActive:
            input.lifestyle.weeklyActivityMinutes !== undefined
              ? input.lifestyle.weeklyActivityMinutes >= 150
              : false,
          heightCm: input.vitals.heightCm,
          weightKg: input.vitals.weightKg,
        },
        rawPayload: adaResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing ADA:', error);
    }
  }

  // =========================================================================
  // 5. FLI - Compute if triglycerides + GGT available
  // =========================================================================
  if (input.labs.triglyceridesMgDl && input.labs.ggtUL) {
    try {
      const fliResult = computeFli({
        heightCm: input.vitals.heightCm,
        weightKg: input.vitals.weightKg,
        waistCm: input.vitals.waistCm,
        triglyceridesMgDl: input.labs.triglyceridesMgDl,
        ggtUL: input.labs.ggtUL,
      });

      results.push({
        scoreCode: 'FLI',
        valueNumeric: fliResult.fli,
        category: fliResult.category,
        label: 'Fatty Liver Index',
        inputPayload: {
          heightCm: input.vitals.heightCm,
          weightKg: input.vitals.weightKg,
          waistCm: input.vitals.waistCm,
          triglyceridesMgDl: input.labs.triglyceridesMgDl,
          ggtUL: input.labs.ggtUL,
        },
        rawPayload: fliResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing FLI:', error);
    }
  }

  // =========================================================================
  // 6. FRAIL - Compute if frailty data provided
  // =========================================================================
  if (input.frailty) {
    try {
      const frailResult = computeFrail(input.frailty);

      results.push({
        scoreCode: 'FRAIL',
        valueNumeric: frailResult.score,
        category: frailResult.category,
        label: 'FRAIL Frailty Scale',
        inputPayload: input.frailty,
        rawPayload: frailResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing FRAIL:', error);
    }
  }

  // =========================================================================
  // 7. Metabolic Syndrome - Compute if all 5 criteria data available
  // =========================================================================
  if (
    input.labs.triglyceridesMgDl &&
    input.labs.hdlMgDl &&
    input.labs.glucoseMgDl
  ) {
    try {
      const metsResult = computeMetabolicSyndrome({
        waistCm: input.vitals.waistCm,
        sex: input.demographics.sex,
        triglyceridesMgDl: input.labs.triglyceridesMgDl,
        hdlMgDl: input.labs.hdlMgDl,
        sbpMmHg: input.vitals.sbpMmHg,
        dbpMmHg: input.vitals.dbpMmHg,
        glucoseMgDl: input.labs.glucoseMgDl,
      });

      results.push({
        scoreCode: 'METABOLIC_SYNDROME',
        valueNumeric: metsResult.criteriaCount,
        category: metsResult.present ? 'present' : 'absent',
        label: 'Metabolic Syndrome',
        inputPayload: {
          waistCm: input.vitals.waistCm,
          sex: input.demographics.sex,
          triglyceridesMgDl: input.labs.triglyceridesMgDl,
          hdlMgDl: input.labs.hdlMgDl,
          sbpMmHg: input.vitals.sbpMmHg,
          dbpMmHg: input.vitals.dbpMmHg,
          glucoseMgDl: input.labs.glucoseMgDl,
        },
        rawPayload: metsResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing Metabolic Syndrome:', error);
    }
  }

  // =========================================================================
  // 8. FIB-4 - Compute if AST, ALT, platelets available
  // =========================================================================
  if (input.labs.astUL && input.labs.altUL && input.labs.plateletsGigaL) {
    try {
      const fib4Result = computeFib4({
        age: input.demographics.age,
        astUL: input.labs.astUL,
        altUL: input.labs.altUL,
        plateletsGigaL: input.labs.plateletsGigaL,
      });

      results.push({
        scoreCode: 'FIB4',
        valueNumeric: fib4Result.fib4,
        category: fib4Result.category,
        label: 'FIB-4 Liver Fibrosis Index',
        inputPayload: {
          age: input.demographics.age,
          astUL: input.labs.astUL,
          altUL: input.labs.altUL,
          plateletsGigaL: input.labs.plateletsGigaL,
        },
        rawPayload: fib4Result as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing FIB-4:', error);
    }
  }

  // =========================================================================
  // 9. eGFR - Compute from creatinine (CKD-EPI 2021) or pass-through a
  //           clinician-supplied eGFR value. In both cases we emit an EGFR
  //           score entry carrying a KDIGO stage (G1..G5) so the renal
  //           aggregator can stratify reliably.
  // =========================================================================
  if (input.labs.creatinineMgDl) {
    try {
      const egfrResult = computeEgfr({
        creatinineMgDl: input.labs.creatinineMgDl,
        age: input.demographics.age,
        sex: input.demographics.sex,
      });

      results.push({
        scoreCode: 'EGFR',
        valueNumeric: egfrResult.egfr,
        category: egfrResult.category,
        label: 'Estimated Glomerular Filtration Rate',
        inputPayload: {
          creatinineMgDl: input.labs.creatinineMgDl,
          age: input.demographics.age,
          sex: input.demographics.sex,
          source: 'ckd_epi_2021',
        },
        rawPayload: egfrResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.error('Error computing eGFR:', error);
    }
  } else if (input.labs.eGFR != null) {
    // Pass-through path: clinician supplied a direct eGFR value without
    // serum creatinine. Derive the KDIGO stage from the value so the
    // renal aggregator has a stage to read. No external equation is
    // invoked here — we trust the clinician-supplied number as-is.
    try {
      const egfr = Math.round(Number(input.labs.eGFR));
      let stage: string;
      let category: string;
      if (egfr >= 90) {
        stage = 'G1';
        category = 'normal_or_high';
      } else if (egfr >= 60) {
        stage = 'G2';
        category = 'mildly_decreased';
      } else if (egfr >= 45) {
        stage = 'G3a';
        category = 'mildly_to_moderately_decreased';
      } else if (egfr >= 30) {
        stage = 'G3b';
        category = 'moderately_to_severely_decreased';
      } else if (egfr >= 15) {
        stage = 'G4';
        category = 'severely_decreased';
      } else {
        stage = 'G5';
        category = 'kidney_failure';
      }

      results.push({
        scoreCode: 'EGFR',
        valueNumeric: egfr,
        category,
        label: 'Estimated Glomerular Filtration Rate (clinician-supplied)',
        inputPayload: {
          eGFR: egfr,
          age: input.demographics.age,
          sex: input.demographics.sex,
          source: 'clinician_supplied',
        },
        rawPayload: { egfr, stage, category },
      });
    } catch (error) {
      console.error('Error staging clinician-supplied eGFR:', error);
    }
  }

  // =========================================================================
  // 10. PREDIMED MEDAS — Compute only when all 14 items are provided.
  //
  //     We deliberately require a complete 14-item response to emit the
  //     ScoreResultEntry. A partial answer set would produce a biased
  //     adherence band (each missing item counts as "no"), which the
  //     alert engine would then interpret as a dietary drop. The
  //     completeness checker surfaces the partial-answers case as a
  //     PREDIMED_INCOMPLETE warning — that is the correct channel for
  //     nudging the clinician, not a synthetic score entry.
  // =========================================================================
  if (
    Array.isArray(input.lifestyle.predimedAnswers) &&
    input.lifestyle.predimedAnswers.length === PREDIMED_MAX_SCORE
  ) {
    try {
      const answers = input.lifestyle.predimedAnswers;
      const score = computePredimedScore(answers);
      const band = categorizePredimedAdherence(score);

      results.push({
        scoreCode: 'PREDIMED',
        valueNumeric: score,
        // `category` is the canonical adherence band expected by the alert
        // engine (`deriveDietAdherenceAlert`) and the risk aggregator.
        // Fall back to 'unknown' if the band cannot be categorised (should
        // not happen for a well-formed 14-item array, but the aggregate
        // pipeline must stay non-throwing).
        category: band ?? 'unknown',
        label: 'PREDIMED MEDAS Mediterranean Diet Adherence',
        inputPayload: {
          answers,
          itemCount: answers.length,
        },
        rawPayload: {
          score,
          adherenceBand: band,
          maxScore: PREDIMED_MAX_SCORE,
        },
      });
    } catch (error) {
      console.error('Error computing PREDIMED:', error);
    }
  }

  return results;
}
