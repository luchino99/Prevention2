/**
 * Clinical Alert Derivation Engine
 * Derives CLINICAL alerts from assessment results. These are time-bound,
 * clinician-actionable signals that belong in the alerts inbox.
 *
 * Alert types emitted by deriveAlerts():
 *   1. clinical_risk_up      - composite risk increased
 *   2. followup_due          - review date approaching/past
 *   3. red_flag              - critical findings
 *   4. diet_adherence_drop   - PREDIMED score decreased
 *   5. activity_decline      - activity minutes decreased significantly
 *
 * IMPORTANT — completeness vs alerts:
 *   "missing_critical_data" used to live here. It has been moved to the
 *   completeness-checker module because a data collection gap is not a
 *   clinical alert: it has no due date, no severity escalation, and no
 *   bedside action. Mixing the two concepts eroded the alerts inbox into
 *   an unfiltered noise feed. The legacy helper `deriveCompletenessAlerts`
 *   is preserved for back-compat tests but is NOT called from
 *   `deriveAlerts`.
 *
 * Zero side effects - pure calculation only
 */

import type {
  RiskLevel,
  ScoreResultEntry,
} from '../../../../../shared/types/clinical.js';
import type { CompositeRiskProfile } from '../risk-aggregation/composite-risk.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertEntry {
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
}

export interface AlertDeriverInput {
  currentScoreResults: ScoreResultEntry[];
  previousScoreResults?: ScoreResultEntry[];
  compositeRisk: CompositeRiskProfile;
  /**
   * Previous-assessment composite risk, supplied ONLY when the caller has
   * actually loaded the previous risk profile. The alert engine will NEVER
   * synthesize a placeholder baseline. If this is undefined/null, no
   * `clinical_risk_up` alert is emitted — a false positive here is worse
   * than a missed signal.
   */
  previousCompositeRisk?: CompositeRiskProfile | null;
  followupPlan?: { nextReviewDate?: string } | null;
  /**
   * @deprecated completeness flags are emitted by the completeness-checker
   * module; kept here only so legacy callers can pass the value without a
   * type error. The alert engine no longer branches on them.
   */
  missingDataFlags?: string[];
  /**
   * Optional anchor for follow-up-due alerts. Defaults to `new Date()`.
   * Passing the request timestamp keeps the alert stream deterministic
   * relative to the assessment being evaluated.
   */
  now?: Date;
}

// ============================================================================
// Constants
// ============================================================================

const CRITICAL_THRESHOLDS = {
  SCORE2_VERY_HIGH: 10, // 10%+ CVD risk
  FIB4_ADVANCED: 3.25,
  eGFR_KIDNEY_FAILURE: 30,
  FRAIL_CRITICAL: 3, // frail category
  FLI_VERY_HIGH: 80,
};

const CRITICAL_MISSING_LABS = [
  'totalCholMgDl',
  'hdlMgDl',
  'sbpMmHg',
  'creatinineMgDl',
  'eGFR',
];

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

/**
 * Find a score result by code (case-insensitive).
 * See composite-risk.ts for rationale.
 */
function findScoreByCode(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

/**
 * Extract numeric value from score
 */
function getNumericValue(score?: ScoreResultEntry): number | null {
  return score?.valueNumeric ?? null;
}

/**
 * Convert a canonical `RiskLevel` to its numeric projection.
 *
 *   indeterminate = 0  (excluded from ordering)
 *   low           = 1
 *   moderate      = 2
 *   high          = 3
 *   very_high     = 4
 *
 * The previous `includes('very high')` implementation is gone: it
 * silently mis-numbered the canonical `very_high` label because of the
 * space vs. underscore mismatch and collapsed it down to `high`.
 */
function riskLevelToNumeric(level: RiskLevel): number {
  switch (level) {
    case 'very_high':
      return 4;
    case 'high':
      return 3;
    case 'moderate':
      return 2;
    case 'low':
      return 1;
    case 'indeterminate':
      return 0;
  }
}

const LEVEL_NAMES: Record<RiskLevel, string> = {
  indeterminate: 'Indeterminate',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very High',
};

/**
 * Derive the "composite risk increased" alert.
 *
 * Emits nothing when:
 *   - the previous risk is missing (no baseline → no comparison),
 *   - either side is `indeterminate` (the transition is ambiguous and
 *     must be interpreted by a clinician, not auto-escalated),
 *   - the new level is <= the previous one.
 */
function deriveRiskUpAlert(
  currentRisk: CompositeRiskProfile | null | undefined,
  previousRisk: CompositeRiskProfile | null | undefined,
  nowISO: string,
): AlertEntry | null {
  if (!currentRisk || !previousRisk) return null;
  if (
    currentRisk.level === 'indeterminate' ||
    previousRisk.level === 'indeterminate'
  ) {
    return null;
  }

  const currentNumeric = riskLevelToNumeric(currentRisk.level);
  const previousNumeric = riskLevelToNumeric(previousRisk.level);
  if (currentNumeric <= previousNumeric) return null;

  const severity: AlertSeverity = currentNumeric >= 4 ? 'critical' : 'warning';

  return {
    type: 'clinical_risk_up',
    severity,
    title: 'Composite Risk Increased',
    message: `Composite risk level has increased from ${LEVEL_NAMES[previousRisk.level]} to ${LEVEL_NAMES[currentRisk.level]}. Recommend immediate clinical review.`,
    timestamp: nowISO,
  };
}

/**
 * Derive "follow-up due" alert.
 *
 * Fired when the follow-up plan's `nextReviewDate` is within 14 days or
 * already past. The `now` anchor MUST be passed by the caller so that the
 * alert is deterministic relative to the assessment; otherwise the read
 * path would drift (a review scheduled 3 months ago would toggle between
 * "overdue" and nothing depending on the exact minute the snapshot is
 * rehydrated).
 */
function deriveFollowupDueAlert(
  followupPlan: { nextReviewDate?: string } | null | undefined,
  now: Date,
): AlertEntry | null {
  if (!followupPlan?.nextReviewDate) return null;

  const reviewDate = new Date(followupPlan.nextReviewDate);
  if (Number.isNaN(reviewDate.getTime())) return null;

  const daysUntilReview = Math.floor(
    (reviewDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntilReview > 14) return null;

  const nowISO = now.toISOString();
  if (daysUntilReview < 0) {
    return {
      type: 'followup_due',
      severity: 'critical',
      title: 'Follow-up Overdue',
      message: `Clinical review was due ${Math.abs(daysUntilReview)} day(s) ago (${followupPlan.nextReviewDate}). Schedule appointment immediately.`,
      timestamp: nowISO,
    };
  }

  return {
    type: 'followup_due',
    severity: 'warning',
    title: 'Follow-up Due Soon',
    message: `Clinical review is due in ${daysUntilReview} day(s) (${followupPlan.nextReviewDate}). Please schedule.`,
    timestamp: nowISO,
  };
}

/**
 * Derive missing-critical-data "alerts".
 *
 * @deprecated This helper is retained only for backwards compatibility with
 * legacy consumers (a handful of older tests) that expect the old mixed
 * stream. Production code MUST use `checkAssessmentCompleteness` from
 * `domain/clinical/completeness/completeness-checker.ts` instead and keep
 * the two streams separate.
 */
export function deriveCompletenessAlerts(
  missingDataFlags: string[],
  currentScores: ScoreResultEntry[],
): AlertEntry[] {
  const alerts: AlertEntry[] = [];

  // Check for missing inputs needed for core scores.
  //
  // Important: the score-engine orchestrator now ALWAYS emits a SCORE2
  // ScoreResultEntry (computed or structured skip). So `!score2` no longer
  // means "missing data" — we must distinguish `score2 not emitted` (only
  // happens for SCORE2-Diabetes when patient is non-diabetic) from
  // `skipped due to missing input / out-of-range data` (valueNumeric=null).
  const score2 = findScoreByCode(currentScores, 'SCORE2');
  const egfr = findScoreByCode(currentScores, 'EGFR');

  const score2NotComputable =
    !score2 || (score2.valueNumeric === null);
  // When SCORE2 is skipped because of an out-of-range input (not missing
  // data), the cardiovascular reasoning already carries a truthful message;
  // we only surface this completeness alert when the skip is due to missing
  // input — i.e. the skipReason is SCORE2_MISSING_INPUT or SCORE2 is absent.
  const score2SkipReason =
    (score2?.rawPayload as { skipReason?: string } | undefined)?.skipReason;
  const score2IsMissingInput =
    !score2 || score2SkipReason === 'SCORE2_MISSING_INPUT';
  if (score2NotComputable && score2IsMissingInput) {
    const missing =
      ((score2?.rawPayload as { missingFields?: string[] } | undefined)
        ?.missingFields ?? []).join(', ') || 'lipid panel and blood pressure';
    alerts.push({
      type: 'missing_critical_data',
      severity: 'warning',
      title: 'SCORE2 Data Missing',
      message: `Cardiovascular risk assessment requires: ${missing}. Please obtain the missing inputs.`,
      timestamp: new Date().toISOString(),
    });
  }

  if (!egfr || egfr.valueNumeric === null) {
    alerts.push({
      type: 'missing_critical_data',
      severity: 'warning',
      title: 'Kidney Function Data Missing',
      message:
        'Renal risk assessment requires serum creatinine for eGFR calculation. Please obtain labs.',
      timestamp: new Date().toISOString(),
    });
  }

  // Check for flags
  missingDataFlags.forEach((flag) => {
    if (CRITICAL_MISSING_LABS.includes(flag)) {
      alerts.push({
        type: 'missing_critical_data',
        severity: 'warning',
        title: `Missing: ${flag}`,
        message: `Critical laboratory value ${flag} is missing. This affects risk stratification.`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  return alerts;
}

/**
 * Derive red-flag alerts for critical findings.
 *
 * Each branch is gated on `typeof valueNumeric === 'number'` rather than
 * a truthy check, because a valid `0` value would previously be silently
 * skipped (e.g. FRAIL = 0 is a meaningful non-frail baseline).
 */
function deriveRedFlagAlerts(
  currentScores: ScoreResultEntry[],
  nowISO: string,
): AlertEntry[] {
  const alerts: AlertEntry[] = [];

  // SCORE2 / SCORE2-Diabetes: very-high CVD risk
  const score2 =
    findScoreByCode(currentScores, 'SCORE2') ??
    findScoreByCode(currentScores, 'SCORE2_DIABETES');
  if (score2 && typeof score2.valueNumeric === 'number' &&
      score2.valueNumeric >= CRITICAL_THRESHOLDS.SCORE2_VERY_HIGH) {
    alerts.push({
      type: 'red_flag',
      severity: 'critical',
      title: 'Very High Cardiovascular Risk',
      message: `10-year SCORE2 risk is ${score2.valueNumeric.toFixed(1)}%. Urgent cardiology referral and intensive management recommended.`,
      timestamp: nowISO,
    });
  }

  // eGFR: advanced CKD
  const egfr = findScoreByCode(currentScores, 'EGFR');
  if (egfr && typeof egfr.valueNumeric === 'number' &&
      egfr.valueNumeric < CRITICAL_THRESHOLDS.eGFR_KIDNEY_FAILURE) {
    alerts.push({
      type: 'red_flag',
      severity: 'critical',
      title: 'Advanced Chronic Kidney Disease',
      message: `eGFR is ${egfr.valueNumeric.toFixed(0)} mL/min/1.73m² (Stage G4–G5). Urgent nephrology referral recommended.`,
      timestamp: nowISO,
    });
  }

  // FIB-4: advanced liver fibrosis
  const fib4 = findScoreByCode(currentScores, 'FIB4');
  if (fib4 && typeof fib4.valueNumeric === 'number' &&
      fib4.valueNumeric >= CRITICAL_THRESHOLDS.FIB4_ADVANCED) {
    alerts.push({
      type: 'red_flag',
      severity: 'critical',
      title: 'Advanced Liver Fibrosis',
      message: `FIB-4 index is ${fib4.valueNumeric.toFixed(2)}. High risk for cirrhosis. Urgent hepatology referral and ultrasound recommended.`,
      timestamp: nowISO,
    });
  }

  // FRAIL: frail category
  const frail = findScoreByCode(currentScores, 'FRAIL');
  if (frail && typeof frail.valueNumeric === 'number' &&
      frail.valueNumeric >= CRITICAL_THRESHOLDS.FRAIL_CRITICAL) {
    alerts.push({
      type: 'red_flag',
      severity: 'warning',
      title: 'Frailty Identified',
      message: `FRAIL score = ${frail.valueNumeric} (frail category). Geriatric assessment and multidisciplinary intervention recommended.`,
      timestamp: nowISO,
    });
  }

  return alerts;
}

/**
 * Derive diet-adherence drop alert.
 *
 * Both scores must be numerically available — we do NOT treat missing
 * values as "0", otherwise a patient who simply did not complete the
 * PREDIMED questionnaire at the later visit would be falsely flagged for
 * a big drop.
 */
function deriveDietAdherenceAlert(
  currentScores: ScoreResultEntry[],
  previousScores: ScoreResultEntry[] | undefined,
  nowISO: string,
): AlertEntry | null {
  if (!previousScores) return null;
  const current = findScoreByCode(currentScores, 'PREDIMED');
  const previous = findScoreByCode(previousScores, 'PREDIMED');
  if (!current || !previous) return null;

  const curr = getNumericValue(current);
  const prev = getNumericValue(previous);
  if (curr === null || prev === null) return null;

  if (prev - curr > 2) {
    return {
      type: 'diet_adherence_drop',
      severity: 'info',
      title: 'Diet Adherence Decline',
      message: `PREDIMED score decreased from ${prev} to ${curr}. Consider dietary counseling reinforcement.`,
      timestamp: nowISO,
    };
  }
  return null;
}

/**
 * Derive activity-decline alert.
 *
 * Same missing-data policy as above: if either visit is missing the
 * activity score entirely we return null; we never substitute 0 for an
 * absent measurement.
 */
function deriveActivityDeclineAlert(
  currentScores: ScoreResultEntry[],
  previousScores: ScoreResultEntry[] | undefined,
  nowISO: string,
): AlertEntry | null {
  if (!previousScores) return null;
  const current = findScoreByCode(currentScores, 'ACTIVITY');
  const previous = findScoreByCode(previousScores, 'ACTIVITY');
  if (!current || !previous) return null;

  const curr = getNumericValue(current);
  const prev = getNumericValue(previous);
  if (curr === null || prev === null) return null;

  const absoluteDecline = prev - curr;
  const percentDecline = prev > 0 ? (absoluteDecline / prev) * 100 : 0;

  if (absoluteDecline > 50 || percentDecline > 25) {
    return {
      type: 'activity_decline',
      severity: 'info',
      title: 'Significant Activity Decline',
      message: `Weekly physical activity decreased from ${prev} to ${curr} minutes. Consider exercise program review.`,
      timestamp: nowISO,
    };
  }
  return null;
}

// ============================================================================
// Main Alert Derivation Function (Pure)
// ============================================================================

/**
 * Derive clinical alerts from assessment results
 *
 * Compares current vs previous assessments and identifies critical findings,
 * missing data, and trends requiring clinical attention.
 *
 * @param input - AlertDeriverInput with current & previous score results,
 *                composite risk (current + optional previous baseline),
 *                follow-up plan, and optional `now` anchor.
 * @returns Array of AlertEntry objects
 *
 * Alerts returned here are strictly clinical / time-bound. Completeness
 * warnings live in a separate stream produced by
 * `checkAssessmentCompleteness` — never merge the two.
 *
 * @example
 * const alerts = deriveAlerts({
 *   currentScoreResults: [
 *     { scoreCode: 'SCORE2', valueNumeric: 12, category: 'Very High', ... },
 *     // ...
 *   ],
 *   previousScoreResults: [...],
 *   compositeRisk,        // CompositeRiskProfile for the current assessment
 *   previousCompositeRisk, // null when no prior assessment exists
 *   followupPlan,
 *   now: new Date(),
 * });
 */
export function deriveAlerts(input: AlertDeriverInput): AlertEntry[] {
  const {
    currentScoreResults,
    previousScoreResults,
    compositeRisk,
    previousCompositeRisk,
    followupPlan,
    now = new Date(),
    missingDataFlags,
  } = input;

  // Legacy parameter kept for type compatibility. Intentionally unused —
  // completeness is emitted by `checkAssessmentCompleteness`, not here.
  void missingDataFlags;

  const nowISO = now.toISOString();
  const alerts: AlertEntry[] = [];

  // 1. Risk-up alert (emitted only with a real previous baseline)
  const riskUpAlert = deriveRiskUpAlert(
    compositeRisk,
    previousCompositeRisk ?? null,
    nowISO,
  );
  if (riskUpAlert) alerts.push(riskUpAlert);

  // 2. Follow-up due
  const followupAlert = deriveFollowupDueAlert(followupPlan ?? null, now);
  if (followupAlert) alerts.push(followupAlert);

  // 3. Red-flag findings
  alerts.push(...deriveRedFlagAlerts(currentScoreResults, nowISO));

  // 4. Diet adherence drop (only with a previous PREDIMED)
  const dietAlert = deriveDietAdherenceAlert(
    currentScoreResults,
    previousScoreResults,
    nowISO,
  );
  if (dietAlert) alerts.push(dietAlert);

  // 5. Activity decline (only with a previous activity score)
  const activityAlert = deriveActivityDeclineAlert(
    currentScoreResults,
    previousScoreResults,
    nowISO,
  );
  if (activityAlert) alerts.push(activityAlert);

  return alerts;
}
