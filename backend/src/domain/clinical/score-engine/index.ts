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
import { GUIDELINES } from '../guideline-catalog/index.js';
import { logStructured, tagFromError } from '../../../observability/structured-log.js';

/**
 * Single emitter for all score-engine failures. Produces the canonical
 * `SCORE_ENGINE_FAILURE` structured event consumed by Datadog / Vercel
 * log drains. The event carries the score code (so a Datadog facet
 * filter can pivot per-score) and an `errorTag` summary derived from
 * the JS Error — never the raw error object (PHI / stack trace leak
 * risk). See `30-RISK-REGISTER` C-02.
 */
function emitScoreFailure(scoreCode: string, error: unknown): void {
  logStructured('error', 'SCORE_ENGINE_FAILURE', {
    scoreCode,
    errorTag: tagFromError(error) ?? 'unknown',
  });
}

import { computeScore2 } from './score2.js';
import { computeScore2Diabetes } from './score2-diabetes.js';
import {
  evaluateScore2Eligibility,
  evaluateScore2DiabetesEligibility,
  buildScore2SkipEntry,
  buildScore2DiabetesSkipEntry,
} from './score2-eligibility.js';
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
    emitScoreFailure('BMI', error);
  }

  // =========================================================================
  // 2. SCORE2 — range-aware orchestration
  // -------------------------------------------------------------------------
  // `computeScore2` throws when an input is outside the validated domain
  // (age ∉ [40,80], SBP ∉ [60,250], chol ∉ [50,400], HDL ∉ [20,150]).
  // Previously the throw was swallowed by a blanket try/catch and no entry
  // was emitted, which caused the composite-risk aggregator to fall back to
  // a misleading "missing lipid panel and/or blood pressure" reasoning — a
  // lie whenever the clinician had provided complete but out-of-range data.
  //
  // We now evaluate eligibility explicitly. If ineligible we emit a SCORE2
  // ScoreResultEntry with valueNumeric=null and a structured skipReason so
  // downstream layers can produce truthful, clinically-actionable messaging.
  // =========================================================================
  {
    const inputContext = {
      age: input.demographics.age,
      sex: input.demographics.sex,
      smoking: input.clinicalContext.smoking,
      sbpMmHg: input.vitals.sbpMmHg,
      totalCholMgDl: input.labs.totalCholMgDl ?? null,
      hdlMgDl: input.labs.hdlMgDl ?? null,
      region: input.clinicalContext.cvRiskRegion,
    };

    const elig = evaluateScore2Eligibility(input);
    if (elig.eligible) {
      try {
        const score2Result = computeScore2({
          age: input.demographics.age,
          sex: input.demographics.sex,
          smoking: input.clinicalContext.smoking,
          sbpMmHg: input.vitals.sbpMmHg,
          totalCholMgDl: input.labs.totalCholMgDl as number,
          hdlMgDl: input.labs.hdlMgDl as number,
          riskRegion: input.clinicalContext.cvRiskRegion,
        });

        results.push({
          scoreCode: 'SCORE2',
          valueNumeric: score2Result.riskPercent,
          category: score2Result.category,
          label: 'SCORE2 Cardiovascular Risk',
          inputPayload: inputContext,
          rawPayload: score2Result as unknown as Record<string, unknown>,
        });
      } catch (error) {
        // Defensive: eligibility passed but formula still threw (schema
        // drift, coefficient bug). Emit structured skip so the UI never
        // silently loses CV stratification.
        emitScoreFailure('SCORE2', error);
        results.push(
          buildScore2SkipEntry(
            { eligible: false, skipReason: 'SCORE2_UNEXPECTED_ERROR', missingFields: [] },
            inputContext,
          ),
        );
      }
    } else {
      results.push(buildScore2SkipEntry(elig, inputContext));
    }
  }

  // =========================================================================
  // 3. SCORE2-Diabetes — range-aware orchestration.
  // -------------------------------------------------------------------------
  // Same defensive pattern as SCORE2: evaluate eligibility, emit skip entry
  // for ineligible cases. We DO NOT emit a SCORE2_DIABETES entry when the
  // patient is not flagged as diabetic — that is the normal path, not a
  // data gap, and polluting the results array with SCORE2_DIABETES_NOT_APPLICABLE
  // rows would only noise up the UI.
  // =========================================================================
  {
    const dmElig = evaluateScore2DiabetesEligibility(input);
    if (dmElig.eligible) {
      const inputContext = {
        age: input.demographics.age,
        sex: input.demographics.sex,
        smoking: input.clinicalContext.smoking,
        sbpMmHg: input.vitals.sbpMmHg,
        totalCholMgDl: input.labs.totalCholMgDl as number,
        hdlMgDl: input.labs.hdlMgDl as number,
        region: input.clinicalContext.cvRiskRegion,
        ageAtDiabetesDiagnosis: input.clinicalContext.ageAtDiabetesDiagnosis as number,
        hba1cPercent: input.labs.hba1cPct as number,
        eGFR: input.labs.eGFR as number,
      };
      try {
        const score2DmResult = computeScore2Diabetes({
          age: input.demographics.age,
          sex: input.demographics.sex,
          smoking: input.clinicalContext.smoking,
          sbpMmHg: input.vitals.sbpMmHg,
          totalCholMgDl: input.labs.totalCholMgDl as number,
          hdlMgDl: input.labs.hdlMgDl as number,
          riskRegion: input.clinicalContext.cvRiskRegion,
          ageAtDiabetesDiagnosis: input.clinicalContext.ageAtDiabetesDiagnosis as number,
          hba1cPercent: input.labs.hba1cPct as number,
          eGFR: input.labs.eGFR as number,
        });

        results.push({
          scoreCode: 'SCORE2_DIABETES',
          valueNumeric: score2DmResult.riskPercent,
          category: score2DmResult.category,
          label: 'SCORE2-Diabetes Cardiovascular Risk',
          inputPayload: inputContext,
          rawPayload: score2DmResult as unknown as Record<string, unknown>,
        });
      } catch (error) {
        emitScoreFailure('SCORE2_DIABETES', error);
        results.push(
          buildScore2DiabetesSkipEntry(
            {
              eligible: false,
              skipReason: 'SCORE2_DIABETES_UNEXPECTED_ERROR',
              missingFields: [],
            },
            inputContext,
          ),
        );
      }
    } else if (dmElig.skipReason !== 'SCORE2_DIABETES_NOT_APPLICABLE') {
      // Patient IS diabetic but data is missing or out of range — this is an
      // actionable data gap, surface it as a structured skip entry.
      const inputContext = {
        age: input.demographics.age,
        sex: input.demographics.sex,
        smoking: input.clinicalContext.smoking,
        sbpMmHg: input.vitals.sbpMmHg,
        totalCholMgDl: input.labs.totalCholMgDl ?? null,
        hdlMgDl: input.labs.hdlMgDl ?? null,
        region: input.clinicalContext.cvRiskRegion,
        ageAtDiabetesDiagnosis: input.clinicalContext.ageAtDiabetesDiagnosis ?? null,
        hba1cPercent: input.labs.hba1cPct ?? null,
        eGFR: input.labs.eGFR ?? null,
      };
      results.push(buildScore2DiabetesSkipEntry(dmElig, inputContext));
    }
    // Not applicable case: silently skip — the patient has no diabetes flag.
  }

  // =========================================================================
  // 4. Diabetology-aware interpretation layer (WS3).
  // -------------------------------------------------------------------------
  // Previous behaviour: the ADA risk-of-diabetes screening score was
  // emitted for every non-diabetic patient — including those whose
  // glucose/HbA1c values ALREADY satisfied ADA SOC diagnostic criteria
  // (fasting glucose ≥ 126 mg/dL, HbA1c ≥ 6.5%). This produced
  // misleading "low/moderate risk of developing diabetes" messaging for
  // patients who already meet the diagnostic threshold and have merely
  // not been formally diagnosed yet — a dangerous interpretive error.
  //
  // New behaviour:
  //   * If the patient is not flagged as diabetic AND labs show overt
  //     hyperglycemia → emit an `UNDIAGNOSED_DIABETES_SUSPECTED` entry
  //     (valueNumeric=null, category='suspected') and SUPPRESS the ADA
  //     screening score. The composite-risk layer reads this entry to
  //     drive metabolic stratification and downstream follow-up.
  //   * If the patient is not flagged as diabetic AND no overt
  //     hyperglycemia → run ADA as before.
  //   * If the patient IS flagged as diabetic → emit a
  //     `GLYCEMIC_CONTROL` entry describing the degree of control
  //     (well_controlled / suboptimal / severely_decompensated).
  //     Deterministic thresholds from ADA SOC 2024 §6.
  //
  // Thresholds (ADA SOC 2024):
  //   - fasting glucose ≥ 126 mg/dL  → diabetes
  //   - HbA1c            ≥ 6.5%      → diabetes
  //   - HbA1c > 7%                   → suboptimal glycemic control
  //   - HbA1c > 9% or glucose > 250  → severe decompensation
  // =========================================================================
  {
    const glucose = input.labs.glucoseMgDl;
    const hba1c = input.labs.hba1cPct;
    const hasOvertHyperglycemia =
      (glucose != null && glucose >= 126) || (hba1c != null && hba1c >= 6.5);

    if (!input.clinicalContext.hasDiabetes && hasOvertHyperglycemia) {
      // Suppress ADA screening (it is not appropriate when the patient
      // already meets diagnostic criteria) and emit a diabetology finding.
      results.push({
        scoreCode: 'UNDIAGNOSED_DIABETES_SUSPECTED',
        valueNumeric: null,
        category: 'suspected',
        label: 'Undiagnosed diabetes suspected',
        inputPayload: {
          glucoseMgDl: glucose ?? null,
          hba1cPct: hba1c ?? null,
          hasDiabetesFlag: false,
        },
        rawPayload: {
          skipped: false,
          diabetologyFlag: 'UNDIAGNOSED_DIABETES_SUSPECTED',
          triggers: {
            fastingGlucoseOverThreshold: glucose != null && glucose >= 126,
            hba1cOverThreshold: hba1c != null && hba1c >= 6.5,
            glucoseMgDl: glucose ?? null,
            hba1cPct: hba1c ?? null,
          },
          guidelineSource: GUIDELINES.ADA_SOC_2024_S2_CLASSIFICATION.displayString,
          suggestedAction:
            'Confirm diagnosis with repeat testing (fasting glucose, HbA1c or OGTT) '
            + 'per ADA SOC §2. Initiate diabetology pathway.',
        },
      });
    } else if (!input.clinicalContext.hasDiabetes) {
      // Standard ADA screening path (unchanged clinical logic).
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
        emitScoreFailure('ADA', error);
      }
    } else {
      // Known diabetic — emit glycemic-control entry if HbA1c / glucose
      // are available. The composite-risk metabolic domain reads this to
      // drive stratification.
      let controlCategory: string | null = null;
      let severity: 'well_controlled' | 'suboptimal' | 'severely_decompensated' | null = null;

      if (hba1c != null && hba1c > 9) {
        severity = 'severely_decompensated';
        controlCategory = 'severely_decompensated';
      } else if (glucose != null && glucose > 250) {
        severity = 'severely_decompensated';
        controlCategory = 'severely_decompensated';
      } else if (hba1c != null && hba1c > 7) {
        severity = 'suboptimal';
        controlCategory = 'suboptimal';
      } else if (hba1c != null) {
        severity = 'well_controlled';
        controlCategory = 'well_controlled';
      }

      if (severity) {
        results.push({
          scoreCode: 'GLYCEMIC_CONTROL',
          valueNumeric: hba1c ?? null,
          category: controlCategory as string,
          label: 'Glycemic control (HbA1c-based)',
          inputPayload: {
            glucoseMgDl: glucose ?? null,
            hba1cPct: hba1c ?? null,
            hasDiabetesFlag: true,
          },
          rawPayload: {
            severity,
            hba1cPct: hba1c ?? null,
            glucoseMgDl: glucose ?? null,
            guidelineSource: GUIDELINES.ADA_SOC_2024_S6_GLYCEMIC.displayString,
          },
        });
      }
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
      emitScoreFailure('FLI', error);
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
      emitScoreFailure('FRAIL', error);
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
      emitScoreFailure('METABOLIC_SYNDROME', error);
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
      emitScoreFailure('FIB4', error);
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
      emitScoreFailure('EGFR', error);
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
      emitScoreFailure('EGFR_STAGE', error);
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
      emitScoreFailure('PREDIMED', error);
    }
  }

  return results;
}
