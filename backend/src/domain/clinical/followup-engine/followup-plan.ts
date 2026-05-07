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
import { GUIDELINES } from '../guideline-catalog/index.js';
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
   * Optional vitals snapshot. Used by the hypertension follow-up branch
   * (Sprint 4 task 4.3) to schedule BP rechecks at the cadence demanded
   * by ESC/ESH 2023 §6 (newly stratified Grade-1/2 HTN). When omitted no
   * HTN follow-up is emitted — missing data must never produce a
   * fabricated cadence.
   */
  vitals?: {
    sbpMmHg?: number | null;
    dbpMmHg?: number | null;
  };
  /**
   * Minimal lifestyle context used by the smoking-cessation branch
   * (Sprint 4 task 4.3, ESC 2021 §3). Smoking is a continuous lifestyle
   * variable; the engine emits a referral item only when the patient is
   * an active smoker AND a cardiovascular item is otherwise emitted —
   * piggybacking on the existing CV pathway so we never create a stand-
   * alone "smoker reminder" outside a clinical interaction window.
   */
  clinicalContext?: {
    smoking?: boolean;
  };
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
    guidelineSource: GUIDELINES.INTERNAL_CADENCE.displayString,
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
      guidelineSource: GUIDELINES.ESC_2021_PREVENTION.displayString,
    });
    items.push({
      code: 'cv_bp_target_130',
      title: 'Tight blood-pressure control (SBP < 130)',
      rationale: 'Very-high CVD risk requires SBP < 130 mmHg if tolerated.',
      dueInMonths: 1,
      priority: 'urgent',
      recurrenceMonths: 3,
      guidelineSource: GUIDELINES.ESC_2021_PREVENTION.displayString,
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
      guidelineSource: GUIDELINES.ESC_2021_PREVENTION.displayString,
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
      guidelineSource: GUIDELINES.KDIGO_2024_CKD.displayString,
    });
  } else if (v < 60) {
    items.push({
      code: 'renal_kidney_monitoring',
      title: 'Quarterly kidney monitoring (eGFR + ACR)',
      rationale: `eGFR = ${v.toFixed(0)} mL/min/1.73m² (stage G3).`,
      dueInMonths: 3,
      priority: 'moderate',
      recurrenceMonths: 3,
      guidelineSource: GUIDELINES.KDIGO_2024_CKD.displayString,
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
      guidelineSource: GUIDELINES.EASL_2024_MASLD.displayString,
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
      guidelineSource: GUIDELINES.EASL_2024_MASLD.displayString,
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
  // Sprint 4 task 4.3 — `dueInDays: 7` replaces the pre-existing comment
  // ("expressed as 0.25 is not supported; UI renders 'within 1 week'").
  // `dueInMonths` stays at 0 to preserve backward compatibility with
  // existing UI/PDF reads; the new field gives modern callers an
  // unambiguous 7-day target.
  if (undiagnosedDm) {
    items.push({
      code: 'metabolic_undiagnosed_dm_confirmation',
      title: 'Confirm diabetes diagnosis (repeat fasting glucose / HbA1c or OGTT)',
      rationale:
        'Patient not flagged as diabetic but labs meet ADA diagnostic thresholds. '
          + 'Confirm with repeat testing before initiating care pathway.',
      dueInMonths: 0,
      dueInDays: 7,
      priority: 'urgent',
      guidelineSource: GUIDELINES.ADA_SOC_2024_S2.displayString,
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
        guidelineSource: GUIDELINES.ADA_SOC_2024_S6.displayString,
      });
    } else if (severity === 'suboptimal') {
      items.push({
        code: 'metabolic_uncontrolled_glycemia',
        title: 'Therapy review — suboptimal glycemic control',
        rationale: `HbA1c ${hba1c ?? '—'}% > 7% target. Review regimen intensification.`,
        dueInMonths: 3,
        priority: 'moderate',
        recurrenceMonths: 3,
        guidelineSource: GUIDELINES.ADA_SOC_2024_S6.displayString,
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
      guidelineSource: GUIDELINES.ADA_SOC_2024_S12.displayString,
    });
    items.push({
      code: 'dm_foot_screening',
      title: 'Comprehensive foot exam — diabetic foot screening',
      rationale: 'Annual foot inspection + monofilament / vibration testing.',
      dueInMonths: 12,
      priority: 'routine',
      recurrenceMonths: 12,
      guidelineSource: GUIDELINES.ADA_SOC_2024_S12.displayString,
    });
    items.push({
      code: 'dm_annual_urine_acr',
      title: 'Annual urine ACR — diabetic nephropathy screening',
      rationale: 'Albumin-creatinine ratio annually to detect early nephropathy.',
      dueInMonths: 12,
      priority: 'routine',
      recurrenceMonths: 12,
      guidelineSource: GUIDELINES.ADA_SOC_2024_S11_KDIGO.displayString,
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
      guidelineSource: GUIDELINES.ADA_SOC.displayString,
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
      guidelineSource: GUIDELINES.NCEP_ATP_III.displayString,
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
      guidelineSource: GUIDELINES.FRAIL_SCALE_CONSENSUS.displayString,
    });
  } else if (v === 2) {
    items.push({
      code: 'frailty_prehabilitation',
      title: 'Prehabilitation program (strength, nutrition)',
      rationale: 'Pre-frail — intervene early.',
      dueInMonths: 6,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: GUIDELINES.FRAIL_SCALE_CONSENSUS.displayString,
    });
  }

  return items;
}

/**
 * Hypertension follow-up items (Sprint 4 task 4.3, ESC/ESH 2023).
 *
 * Tiered cadence per ESC/ESH 2023 §6 ("Management of hypertension"):
 *   - Hypertensive urgency (SBP ≥ 180 OR DBP ≥ 110) — same-day evaluation,
 *     BP recheck within 24 h. The corresponding RED-FLAG alert already
 *     fires from the alert engine; here we schedule the structured
 *     follow-up item so the inbox has a due-date row to track.
 *   - Stage 2 HTN (SBP 160–179 or DBP 100–109) — 1-month BP recheck.
 *   - Stage 1 HTN (SBP 140–159 or DBP 90–99)  — 3-month recheck +
 *     lifestyle intensification.
 *   - Sub-clinical (< 140/90)                  — no follow-up emitted.
 *
 * The branch is gated on `vitals` being present; when both fields are
 * missing or NaN, we emit nothing — the engine never fabricates a
 * cadence on absent data.
 */
function hypertensionItems(
  vitals: FollowupInput['vitals'],
): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const sbp = typeof vitals?.sbpMmHg === 'number' ? vitals.sbpMmHg : null;
  const dbp = typeof vitals?.dbpMmHg === 'number' ? vitals.dbpMmHg : null;
  if (sbp === null && dbp === null) return items;

  const urgency = (sbp !== null && sbp >= 180) || (dbp !== null && dbp >= 110);
  const stage2  = (sbp !== null && sbp >= 160 && sbp < 180)
    || (dbp !== null && dbp >= 100 && dbp < 110);
  const stage1  = (sbp !== null && sbp >= 140 && sbp < 160)
    || (dbp !== null && dbp >= 90  && dbp < 100);

  // Build a stable "150/95 mmHg" label only from the values that are
  // numerically defined — never substitute zero for a missing reading.
  const bpLabel = sbp !== null && dbp !== null
    ? `${sbp}/${dbp} mmHg`
    : sbp !== null
      ? `SBP ${sbp} mmHg`
      : `DBP ${dbp} mmHg`;

  if (urgency) {
    items.push({
      code: 'htn_urgency_recheck',
      title: 'Hypertensive urgency BP recheck',
      rationale:
        `BP ${bpLabel} meets ESH 2023 hypertensive-urgency threshold `
          + '(SBP ≥ 180 or DBP ≥ 110). Same-day evaluation; BP recheck '
          + 'within 24 hours.',
      dueInMonths: 0,
      dueInDays: 1,
      priority: 'urgent',
      guidelineSource: GUIDELINES.ESC_ESH_2023_HTN.displayString,
    });
  } else if (stage2) {
    items.push({
      code: 'htn_stage2_followup',
      title: 'Stage-2 hypertension review (BP recheck + therapy)',
      rationale:
        `BP ${bpLabel} (Stage 2 HTN per ESH 2023). Initiate or escalate `
          + 'antihypertensive therapy and recheck in 1 month.',
      dueInMonths: 1,
      priority: 'urgent',
      recurrenceMonths: 3,
      guidelineSource: GUIDELINES.ESC_ESH_2023_HTN.displayString,
    });
  } else if (stage1) {
    items.push({
      code: 'htn_stage1_followup',
      title: 'Stage-1 hypertension review (lifestyle + recheck)',
      rationale:
        `BP ${bpLabel} (Stage 1 HTN per ESH 2023). Lifestyle `
          + 'intensification with structured BP recheck at 3 months.',
      dueInMonths: 3,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: GUIDELINES.ESC_ESH_2023_HTN.displayString,
    });
  }

  return items;
}

/**
 * Smoking-cessation referral (Sprint 4 task 4.3, ESC 2021 §3).
 *
 * Emitted only when the patient is an active smoker AND a cardiovascular
 * item is already present in the plan. The CV gating reflects the ESC
 * 2021 framing: smoking-cessation interventions are integrated into CVD
 * prevention pathways, NOT a standalone reminder. By piggybacking on the
 * presence of `cv_*` items we avoid a perpetual unread-row in patients
 * who currently have no other CVD-active concern beyond smoking; the
 * lifestyle engine handles that population separately.
 */
function smokingCessationItems(
  smoking: boolean,
  cardiovascularItemEmitted: boolean,
): FollowUpItem[] {
  if (!smoking || !cardiovascularItemEmitted) return [];
  return [
    {
      code: 'lifestyle_smoking_cessation_referral',
      title: 'Smoking-cessation programme referral',
      rationale:
        'Active smoking with elevated cardiovascular risk. ESC 2021 §3 '
          + 'recommends structured smoking-cessation support integrated '
          + 'with CVD prevention.',
      dueInMonths: 1,
      priority: 'moderate',
      recurrenceMonths: 6,
      guidelineSource: GUIDELINES.ESC_2021_PREVENTION.displayString,
    },
  ];
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
    vitals,
    clinicalContext,
    now = new Date(),
  } = input;

  const level: RiskLevel = compositeRisk.level;
  const intervalMonths = INTERVAL_BY_LEVEL[level];
  const priorityLevel = PRIORITY_BY_LEVEL[level];
  const nextReviewDate = addMonthsISO(now, intervalMonths);

  // Structured items — the new source of truth.
  // Cardiovascular items are computed first because the smoking-cessation
  // branch is gated on whether ANY CV item was emitted (ESC 2021 framing:
  // cessation lives inside the CVD prevention pathway).
  const cvItems = cardiovascularItems(scoreResults, level);
  const items: FollowUpItem[] = [
    coreReviewItem(level),
    ...cvItems,
    ...hypertensionItems(vitals),
    ...renalItems(scoreResults),
    ...hepaticItems(scoreResults),
    ...metabolicItems(scoreResults, hasDiabetes),
    ...frailtyItems(scoreResults),
    ...smokingCessationItems(
      clinicalContext?.smoking === true,
      cvItems.length > 0,
    ),
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
