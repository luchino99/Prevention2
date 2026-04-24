/**
 * Follow-up Plan Generation Engine (Phase B redesign).
 *
 * Turns a composite risk profile + individual score results into a
 * deterministic, guideline-sourced follow-up plan. The output has two
 * layers:
 *
 *   1. A legacy "flat" object (`intervalMonths`, `actions[]`,
 *      `domainMonitoring[]`) kept for backwards compatibility with the
 *      current PDF report and the existing UI card.
 *   2. A structured `items: FollowUpItem[]` stream — each entry carries
 *      `code`, `priority`, `dueInMonths`, `guidelineSource` — suitable for
 *      a future rule-based follow-up inbox and for the alerts engine to
 *      reason about due dates.
 *
 * Design rules (blueprint §6.3 + §6.4):
 *   - Deterministic: the function must be a pure function of its inputs.
 *     The caller MUST supply `now` for date anchoring so that the
 *     read-path (rehydration) produces the same `nextReviewDate` as the
 *     original write-path. The default `now = new Date()` is a
 *     convenience for the write-path only.
 *   - 'indeterminate' is NOT treated as 'low'. It triggers a short-
 *     interval reassessment (2 months) with priority 'moderate', so the
 *     clinician is actively nudged to complete the data collection.
 *     Silently falling back to 12 months would mask absence of data.
 *   - Missing-data collection nudges are NOT emitted from here — that is
 *     the completeness-checker's responsibility. This module only handles
 *     time-bound clinical follow-up.
 *
 * Zero side effects — pure calculation only.
 */

import type {
  FollowUpItem,
  RiskLevel,
  ScoreResultEntry,
} from '../../../../../shared/types/clinical.js';
import type { CompositeRiskProfile } from '../risk-aggregation/composite-risk.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface FollowupPlan {
  /** Canonical interval for the next full clinical review. */
  intervalMonths: number;
  /** ISO date (`YYYY-MM-DD`) of the next review anchored on `now`. */
  nextReviewDate: string;
  /** Overall urgency of the next review. */
  priorityLevel: 'routine' | 'moderate' | 'urgent';
  /**
   * Flat actions array, preserved for the existing PDF/UI. Treat it as a
   * rendered projection of `items` — the structured stream below is the
   * source of truth for downstream engines.
   */
  actions: string[];
  /** Per-domain monitoring strings (narrative). */
  domainMonitoring: string[];
  /**
   * Structured, guideline-sourced follow-up items. Each item is stable
   * enough to be written into a database row or cross-referenced by the
   * alert engine.
   */
  items: FollowUpItem[];
}

export interface FollowupInput {
  compositeRisk: CompositeRiskProfile;
  scoreResults: ScoreResultEntry[];
  /**
   * Whether the patient has a pre-existing diagnosis of diabetes (type 1
   * or type 2). Sourced from the clinical context, NOT from lab-derived
   * inference — so that:
   *   - chronic-care pathways (annual retinopathy, annual foot exam,
   *     annual urine ACR) are scheduled only for truly diagnosed patients,
   *   - the undiagnosed-diabetes-suspected branch (lab-based) remains
   *     distinct from the known-diabetic branch (context-based).
   * Defaults to `false` when not provided to preserve backward
   * compatibility with callers that pre-date WS4.
   */
  hasDiabetes?: boolean;
  /**
   * Optional anchor for date computations. Pass the assessment's
   * `createdAt` when rehydrating so the plan is byte-equivalent to the
   * one originally produced. Defaults to `new Date()` for convenience.
   */
  now?: Date;
}

// ============================================================================
// Constants — interval table
// ============================================================================

/**
 * Canonical follow-up intervals by composite risk level.
 *
 * Rationale:
 *   very_high     → 1 month  (ESC 2021 aggressive surveillance for high-risk CVD)
 *   high          → 3 months (ESC / KDIGO targeted follow-up)
 *   moderate      → 6 months (routine preventive recheck)
 *   low           → 12 months (standard primary care cadence)
 *   indeterminate → 2 months (short-loop to complete data collection — the
 *                             patient is NOT low risk, they are *unstratified*)
 */
const INTERVAL_BY_LEVEL: Record<RiskLevel, number> = {
  very_high: 1,
  high: 3,
  moderate: 6,
  low: 12,
  indeterminate: 2,
};

const PRIORITY_BY_LEVEL: Record<RiskLevel, 'routine' | 'moderate' | 'urgent'> = {
  very_high: 'urgent',
  high: 'urgent',
  moderate: 'moderate',
  low: 'routine',
  indeterminate: 'moderate',
};

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/** Find a score result by code (case-insensitive). */
function findScoreByCode(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

/**
 * Compute an ISO-date (`YYYY-MM-DD`) `intervalMonths` after `now`.
 *
 * We use `new Date(now)` to avoid mutating the caller's Date, then apply
 * `setUTCMonth` so the computation does not drift with the host
 * time-zone. The snapshot slice is guaranteed to be exactly 10 characters
 * because ISO 8601 dates start with `YYYY-MM-DD`.
 */
function addMonthsISO(now: Date, intervalMonths: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + intervalMonths);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Structured FollowUpItem derivation — guideline-sourced
// ============================================================================

/**
 * Core review item — always present. Its due date mirrors `intervalMonths`,
 * its priority mirrors the composite risk level.
 */
function coreReviewItem(level: RiskLevel): FollowUpItem {
  return {
    code: 'core_review',
    title: 'Scheduled clinical review',
    rationale:
      level === 'indeterminate'
        ? 'Risk stratification incomplete — short-interval review to complete missing data.'
        : `Routine cadence driven by composite risk = ${level}.`,
    dueInMonths: INTERVAL_BY_LEVEL[level],
    priority: PRIORITY_BY_LEVEL[level],
    recurrenceMonths: INTERVAL_BY_LEVEL[level],
    guidelineSource: 'Internal cadence policy',
  };
}

/**
 * Cardiovascular follow-up items. The ESC 2021 guideline drives the
 * cadence for patients with elevated SCORE2.
 */
function cardiovascularItems(
  scoreResults: ScoreResultEntry[],
  compositeLevel: RiskLevel,
): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const score2 = findScoreByCode(scoreResults, 'SCORE2')
    ?? findScoreByCode(scoreResults, 'SCORE2_DIABETES');
  if (!score2 || typeof score2.valueNumeric !== 'number') return items;

  const risk = score2.valueNumeric;

  // Very high SCORE2 → aggressive management
  if (risk >= 10 || compositeLevel === 'very_high') {
    items.push({
      code: 'cv_lipid_intensive',
      title: 'Intensive lipid management review',
      rationale:
        `10-year CVD risk ≥ 10% (SCORE2 = ${risk.toFixed(1)}%). `
          + 'Target LDL-C per ESC 2021 very-high-risk threshold.',
      dueInMonths: 1,
      priority: 'urgent',
      recurrenceMonths: 3,
      guidelineSource: 'ESC 2021 CVD prevention',
    });
    items.push({
      code: 'cv_bp_target_130',
      title: 'Tight blood-pressure control (SBP < 130)',
      rationale: 'Very-high CVD risk requires SBP < 130 mmHg if tolerated.',
      dueInMonths: 1,
      priority: 'urgent',
      recurrenceMonths: 3,
      guidelineSource: 'ESC 2021 CVD prevention',
    });
  } else if (risk >= 5) {
    items.push({
      code: 'cv_lipid_targeted',
      title: 'Targeted lipid management review',
      rationale:
        `10-year CVD risk 5–10% (SCORE2 = ${risk.toFixed(1)}%). `
          + 'Consider statin initiation and lifestyle intensification.',
      dueInMonths: 3,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: 'ESC 2021 CVD prevention',
    });
  }

  return items;
}

/**
 * Renal follow-up items based on eGFR stage and ACR when available.
 */
function renalItems(scoreResults: ScoreResultEntry[]): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const egfr = findScoreByCode(scoreResults, 'EGFR');
  if (!egfr || typeof egfr.valueNumeric !== 'number') return items;

  const v = egfr.valueNumeric;

  if (v < 30) {
    items.push({
      code: 'renal_nephrology_urgent',
      title: 'Nephrology referral',
      rationale: `eGFR = ${v.toFixed(0)} mL/min/1.73m² (stage G4–G5).`,
      dueInMonths: 1,
      priority: 'urgent',
      recurrenceMonths: 1,
      guidelineSource: 'KDIGO 2024 CKD',
    });
  } else if (v < 60) {
    items.push({
      code: 'renal_kidney_monitoring',
      title: 'Quarterly kidney monitoring (eGFR + ACR)',
      rationale: `eGFR = ${v.toFixed(0)} mL/min/1.73m² (stage G3).`,
      dueInMonths: 3,
      priority: 'moderate',
      recurrenceMonths: 3,
      guidelineSource: 'KDIGO 2024 CKD',
    });
  }

  return items;
}

/**
 * Hepatic follow-up items based on FIB-4 and FLI.
 */
function hepaticItems(scoreResults: ScoreResultEntry[]): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const fib4 = findScoreByCode(scoreResults, 'FIB4');
  const fli = findScoreByCode(scoreResults, 'FLI');

  const fib4Val = typeof fib4?.valueNumeric === 'number' ? fib4.valueNumeric : null;
  const fliVal = typeof fli?.valueNumeric === 'number' ? fli.valueNumeric : null;

  if (fib4Val !== null && fib4Val >= 3.25) {
    items.push({
      code: 'hepatic_hepatology_urgent',
      title: 'Hepatology referral',
      rationale: `FIB-4 = ${fib4Val.toFixed(2)} — advanced fibrosis likely.`,
      dueInMonths: 1,
      priority: 'urgent',
      recurrenceMonths: 6,
      guidelineSource: 'EASL 2024 MASLD',
    });
  } else if (
    (fib4Val !== null && fib4Val >= 1.45) ||
    (fliVal !== null && fliVal >= 60)
  ) {
    items.push({
      code: 'hepatic_monitor',
      title: 'Liver monitoring (repeat FIB-4 + ultrasound)',
      rationale:
        fib4Val !== null && fib4Val >= 1.45
          ? `FIB-4 = ${fib4Val.toFixed(2)} (indeterminate/intermediate).`
          : `FLI = ${fliVal!.toFixed(0)} — NAFLD likely.`,
      dueInMonths: 6,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: 'EASL 2024 MASLD',
    });
  }

  return items;
}

/**
 * Metabolic follow-up items (MetS / ADA / diabetes control).
 *
 * Diabetology-aware rules (WS4):
 *   - UNDIAGNOSED_DIABETES_SUSPECTED → urgent diagnostic confirmation
 *     within 7 days (ADA SOC 2024 §2).
 *   - GLYCEMIC_CONTROL severely_decompensated (HbA1c>9 or glucose>250)
 *     → endocrinology referral within 1 month (ADA SOC 2024 §6).
 *   - GLYCEMIC_CONTROL suboptimal (HbA1c>7) → therapy review within
 *     3 months (ADA SOC 2024 §6).
 *   - Every known diabetic → annual retinopathy exam, annual foot exam,
 *     annual urine ACR (nephropathy), lipid target review (ADA §10, §12).
 */
function metabolicItems(
  scoreResults: ScoreResultEntry[],
  hasDiabetes: boolean,
): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const ada = findScoreByCode(scoreResults, 'ADA');
  const mets = findScoreByCode(scoreResults, 'METABOLIC_SYNDROME');
  const undiagnosedDm = findScoreByCode(scoreResults, 'UNDIAGNOSED_DIABETES_SUSPECTED');
  const glycemicControl = findScoreByCode(scoreResults, 'GLYCEMIC_CONTROL');

  // WS3/WS4 — undiagnosed diabetes: URGENT confirmation.
  if (undiagnosedDm) {
    items.push({
      code: 'metabolic_undiagnosed_dm_confirmation',
      title: 'Confirm diabetes diagnosis (repeat fasting glucose / HbA1c or OGTT)',
      rationale:
        'Patient not flagged as diabetic but labs meet ADA diagnostic thresholds. '
          + 'Confirm with repeat testing before initiating care pathway.',
      dueInMonths: 0, // ~7 days — expressed as 0.25 is not supported; UI layer renders "within 1 week"
      priority: 'urgent',
      guidelineSource: 'ADA Standards of Care 2024 §2',
    });
  }

  // Glycemic control in known diabetics.
  if (glycemicControl) {
    const severity =
      ((glycemicControl.rawPayload ?? {}) as { severity?: string }).severity
      ?? glycemicControl.category;
    const hba1c = glycemicControl.valueNumeric;

    if (severity === 'severely_decompensated') {
      items.push({
        code: 'metabolic_endocrinology_urgent',
        title: 'Urgent endocrinology referral — severe glycemic decompensation',
        rationale: `HbA1c ${hba1c ?? '—'}% > 9% or fasting glucose > 250 mg/dL.`,
        dueInMonths: 1,
        priority: 'urgent',
        recurrenceMonths: 3,
        guidelineSource: 'ADA Standards of Care 2024 §6',
      });
    } else if (severity === 'suboptimal') {
      items.push({
        code: 'metabolic_uncontrolled_glycemia',
        title: 'Therapy review — suboptimal glycemic control',
        rationale: `HbA1c ${hba1c ?? '—'}% > 7% target. Review regimen intensification.`,
        dueInMonths: 3,
        priority: 'moderate',
        recurrenceMonths: 3,
        guidelineSource: 'ADA Standards of Care 2024 §6',
      });
    }
  }

  // Baseline annual screenings for every known diabetic (ADA SOC §10, §12).
  if (hasDiabetes) {
    items.push({
      code: 'dm_retinopathy_screening',
      title: 'Dilated eye exam — diabetic retinopathy screening',
      rationale: 'Annual ophthalmologic exam recommended for all diabetic patients.',
      dueInMonths: 12,
      priority: 'routine',
      recurrenceMonths: 12,
      guidelineSource: 'ADA Standards of Care 2024 §12',
    });
    items.push({
      code: 'dm_foot_screening',
      title: 'Comprehensive foot exam — diabetic foot screening',
      rationale: 'Annual foot inspection + monofilament / vibration testing.',
      dueInMonths: 12,
      priority: 'routine',
      recurrenceMonths: 12,
      guidelineSource: 'ADA Standards of Care 2024 §12',
    });
    items.push({
      code: 'dm_annual_urine_acr',
      title: 'Annual urine ACR — diabetic nephropathy screening',
      rationale: 'Albumin-creatinine ratio annually to detect early nephropathy.',
      dueInMonths: 12,
      priority: 'routine',
      recurrenceMonths: 12,
      guidelineSource: 'ADA Standards of Care 2024 §11 + KDIGO 2024',
    });
  }

  const adaVal = typeof ada?.valueNumeric === 'number' ? ada.valueNumeric : null;
  const metsPositive = (mets?.valueNumeric ?? 0) >= 3 ||
    (mets?.category ?? '').toLowerCase() === 'metabolic syndrome';

  if (adaVal !== null && adaVal >= 5) {
    items.push({
      code: 'metabolic_dm_screening',
      title: 'Diabetes screening (HbA1c ± OGTT)',
      rationale: `ADA diabetes-risk score = ${adaVal} (high risk).`,
      dueInMonths: 3,
      priority: 'moderate',
      recurrenceMonths: 12,
      guidelineSource: 'ADA Standards of Care',
    });
  }

  if (metsPositive) {
    items.push({
      code: 'metabolic_mets_management',
      title: 'Metabolic-syndrome lifestyle management review',
      rationale: 'ATP III criteria met — structured lifestyle reinforcement.',
      dueInMonths: 6,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: 'NCEP ATP III',
    });
  }

  return items;
}

/**
 * Frailty follow-up items.
 */
function frailtyItems(scoreResults: ScoreResultEntry[]): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const frail = findScoreByCode(scoreResults, 'FRAIL');
  if (!frail || typeof frail.valueNumeric !== 'number') return items;

  const v = frail.valueNumeric;
  if (v >= 3) {
    items.push({
      code: 'frailty_comprehensive_geriatric',
      title: 'Comprehensive geriatric assessment',
      rationale: `FRAIL score = ${v} — frail category.`,
      dueInMonths: 3,
      priority: 'urgent',
      recurrenceMonths: 6,
      guidelineSource: 'FRAIL scale consensus',
    });
  } else if (v === 2) {
    items.push({
      code: 'frailty_prehabilitation',
      title: 'Prehabilitation program (strength, nutrition)',
      rationale: 'Pre-frail — intervene early.',
      dueInMonths: 6,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: 'FRAIL scale consensus',
    });
  }

  return items;
}

// ============================================================================
// Narrative projections for legacy `actions` and `domainMonitoring`
// ============================================================================

function narrativeActions(level: RiskLevel): string[] {
  switch (level) {
    case 'very_high':
      return [
        'Schedule urgent appointment with primary care provider',
        'Consider multidisciplinary team review (cardiology, nephrology, hepatology as needed)',
        'Intensive lifestyle modification counseling',
        'Medication optimization review',
        'Baseline investigations if not recently done',
      ];
    case 'high':
      return [
        'Schedule appointment with primary care provider',
        'Specialist consultation consideration based on domain risks',
        'Structured lifestyle modification program',
        'Medication compliance review',
        'Target monitoring of key biomarkers',
      ];
    case 'moderate':
      return [
        'Routine clinical follow-up',
        'Lifestyle modification reinforcement',
        'Annual preventive screening',
        'Medication review as needed',
      ];
    case 'indeterminate':
      return [
        'Short-interval reassessment to complete risk stratification',
        'Prioritize collection of missing labs and history',
        'Do not assume low risk until stratification is possible',
      ];
    case 'low':
      return [
        'Routine clinical follow-up',
        'Continue preventive health measures',
        'Maintain current exercise and diet',
        'Annual preventive screening',
      ];
  }
}

function narrativeDomainMonitoring(scoreResults: ScoreResultEntry[]): string[] {
  const lines: string[] = [];

  const score2 = findScoreByCode(scoreResults, 'SCORE2')
    ?? findScoreByCode(scoreResults, 'SCORE2_DIABETES');
  if (score2 && typeof score2.valueNumeric === 'number') {
    const v = score2.valueNumeric;
    if (v >= 10) {
      lines.push('Cardiovascular: monthly risk assessment, strict lipid and SBP<130 targets');
    } else if (v >= 5) {
      lines.push('Cardiovascular: quarterly lipid panel, SBP<140, consider statin therapy');
    } else {
      lines.push('Cardiovascular: annual lipid panel, SBP monitoring');
    }
  }

  const mets = findScoreByCode(scoreResults, 'METABOLIC_SYNDROME');
  const ada = findScoreByCode(scoreResults, 'ADA');
  if (mets || ada) {
    const adaScore = ada?.valueNumeric ?? 0;
    lines.push(
      adaScore >= 5
        ? 'Metabolic: HbA1c every 3–6 months, glucose monitoring, weight loss'
        : 'Metabolic: HbA1c annually, fasting glucose, BMI monitoring',
    );
  }

  const fli = findScoreByCode(scoreResults, 'FLI');
  const fib4 = findScoreByCode(scoreResults, 'FIB4');
  if (fli || fib4) {
    const fib4Value = fib4?.valueNumeric ?? 0;
    const fliValue = fli?.valueNumeric ?? 0;
    if (fib4Value >= 3.25) {
      lines.push('Hepatic: urgent hepatology referral, ultrasound/elastography');
    } else if (fliValue >= 60 || fib4Value >= 1.45) {
      lines.push('Hepatic: repeat FIB-4 every 6 months, annual ultrasound, LFT');
    } else {
      lines.push('Hepatic: annual LFT and ultrasound if FLI persistently elevated');
    }
  }

  const egfr = findScoreByCode(scoreResults, 'EGFR');
  if (egfr && typeof egfr.valueNumeric === 'number') {
    const v = egfr.valueNumeric;
    if (v < 30) {
      lines.push('Renal: urgent nephrology referral, monthly eGFR+ACR');
    } else if (v < 60) {
      lines.push('Renal: quarterly eGFR+ACR, SBP<130/80, ACEi/ARB optimization');
    } else {
      lines.push('Renal: annual eGFR+ACR, proteinuria and BP control');
    }
  }

  const frail = findScoreByCode(scoreResults, 'FRAIL');
  if (frail && typeof frail.valueNumeric === 'number') {
    const v = frail.valueNumeric;
    if (v >= 3) {
      lines.push('Frailty: geriatric assessment, physical therapy, nutritional support');
    } else if (v === 2) {
      lines.push('Frailty: prehabilitation program, strength training');
    }
  }

  return lines.length > 0 ? lines : ['Standard preventive care monitoring'];
}

// ============================================================================
// Main entry
// ============================================================================

/**
 * Determine the follow-up plan for an assessment.
 *
 * Determinism: the function is pure. The optional `now` parameter MUST be
 * passed by consumers that expect idempotent rehydration (i.e. the
 * read-path of `loadAssessmentSnapshot`).
 */
export function determineFollowupPlan(input: FollowupInput): FollowupPlan {
  const {
    compositeRisk,
    scoreResults,
    hasDiabetes = false,
    now = new Date(),
  } = input;

  const level: RiskLevel = compositeRisk.level;
  const intervalMonths = INTERVAL_BY_LEVEL[level];
  const priorityLevel = PRIORITY_BY_LEVEL[level];
  const nextReviewDate = addMonthsISO(now, intervalMonths);

  // Structured items — the new source of truth.
  const items: FollowUpItem[] = [
    coreReviewItem(level),
    ...cardiovascularItems(scoreResults, level),
    ...renalItems(scoreResults),
    ...hepaticItems(scoreResults),
    ...metabolicItems(scoreResults, hasDiabetes),
    ...frailtyItems(scoreResults),
  ];

  // Legacy narrative projection for the PDF/UI until they migrate to
  // `items`. Building it from the level (not from `items`) preserves the
  // existing clinician-facing phrasing verbatim.
  const actions = narrativeActions(level);
  const domainMonitoring = narrativeDomainMonitoring(scoreResults);

  return {
    intervalMonths,
    nextReviewDate,
    priorityLevel,
    actions,
    domainMonitoring,
    items,
  };
}
