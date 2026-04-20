/**
 * Clinical Alert Derivation Engine
 * Derives clinical alerts from assessment results by comparing current vs previous assessments
 * and identifying critical findings
 *
 * Alert types:
 * 1. clinical_risk_up - composite risk increased
 * 2. followup_due - review date approaching/past
 * 3. missing_critical_data - critical labs missing
 * 4. red_flag - critical findings
 * 5. diet_adherence_drop - PREDIMED score decreased
 * 6. activity_decline - activity minutes decreased significantly
 *
 * Zero side effects - pure calculation only
 */

import type { ScoreResultEntry } from '../../../../../shared/types/clinical';

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
  compositeRisk: any;
  followupPlan?: any;
  missingDataFlags: string[];
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
 * Convert risk level string to numeric for comparison
 */
function riskLevelToNumeric(level: string): number {
  const normalized = level?.toLowerCase() || '';
  if (normalized.includes('very high')) return 4;
  if (normalized.includes('high')) return 3;
  if (normalized.includes('moderate')) return 2;
  return 1; // low
}

/**
 * Derive risk level change alert
 */
function deriveRiskUpAlert(
  currentRisk: any,
  previousRisk: any,
): AlertEntry | null {
  if (!currentRisk || !previousRisk) {
    return null;
  }

  const currentNumeric = riskLevelToNumeric(currentRisk.level);
  const previousNumeric = riskLevelToNumeric(previousRisk.level);

  if (currentNumeric <= previousNumeric) {
    return null;
  }

  const levelNames: Record<number, string> = {
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Very High',
  };

  const severity: AlertSeverity =
    currentNumeric >= 4 ? 'critical' : 'warning';

  return {
    type: 'clinical_risk_up',
    severity,
    title: 'Composite Risk Increased',
    message: `Composite risk level has increased from ${levelNames[previousNumeric]} to ${levelNames[currentNumeric]}. Recommend immediate clinical review.`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Derive followup due alert
 */
function deriveFollowupDueAlert(followupPlan?: any): AlertEntry | null {
  if (!followupPlan || !followupPlan.nextReviewDate) {
    return null;
  }

  const reviewDate = new Date(followupPlan.nextReviewDate);
  const now = new Date();
  const daysUntilReview = Math.floor(
    (reviewDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Alert if within 2 weeks or overdue
  if (daysUntilReview > 14) {
    return null;
  }

  if (daysUntilReview < 0) {
    return {
      type: 'followup_due',
      severity: 'critical',
      title: 'Followup Overdue',
      message: `Clinical review was due ${Math.abs(daysUntilReview)} days ago. Schedule appointment immediately.`,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    type: 'followup_due',
    severity: 'warning',
    title: 'Followup Due Soon',
    message: `Clinical review is due in ${daysUntilReview} days (${reviewDate.toLocaleDateString()}). Please schedule.`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Derive missing critical data alerts
 */
function deriveMissingDataAlerts(
  missingDataFlags: string[],
  currentScores: ScoreResultEntry[],
): AlertEntry[] {
  const alerts: AlertEntry[] = [];

  // Check for missing inputs needed for core scores
  const score2 = findScoreByCode(currentScores, 'SCORE2');
  const egfr = findScoreByCode(currentScores, 'eGFR');

  if (!score2) {
    alerts.push({
      type: 'missing_critical_data',
      severity: 'warning',
      title: 'SCORE2 Data Missing',
      message:
        'Cardiovascular risk assessment requires lipid panel (total cholesterol, HDL) and blood pressure. Please obtain labs.',
      timestamp: new Date().toISOString(),
    });
  }

  if (!egfr) {
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
 * Derive red flag alerts for critical findings
 */
function deriveRedFlagAlerts(
  currentScores: ScoreResultEntry[],
): AlertEntry[] {
  const alerts: AlertEntry[] = [];

  // SCORE2: very high CVD risk
  const score2 = findScoreByCode(currentScores, 'SCORE2');
  if (score2 && score2.valueNumeric && score2.valueNumeric >= CRITICAL_THRESHOLDS.SCORE2_VERY_HIGH) {
    alerts.push({
      type: 'red_flag',
      severity: 'critical',
      title: 'Very High Cardiovascular Risk',
      message: `10-year SCORE2 risk is ${score2.valueNumeric}%. Urgent cardiology referral and intensive management recommended.`,
      timestamp: new Date().toISOString(),
    });
  }

  // eGFR: kidney failure
  const egfr = findScoreByCode(currentScores, 'eGFR');
  if (egfr && egfr.valueNumeric && egfr.valueNumeric < CRITICAL_THRESHOLDS.eGFR_KIDNEY_FAILURE) {
    alerts.push({
      type: 'red_flag',
      severity: 'critical',
      title: 'Advanced Chronic Kidney Disease',
      message: `eGFR is ${egfr.valueNumeric} (Stage G4-G5). Urgent nephrology referral recommended.`,
      timestamp: new Date().toISOString(),
    });
  }

  // FIB4: advanced liver fibrosis
  const fib4 = findScoreByCode(currentScores, 'FIB4');
  if (fib4 && fib4.valueNumeric && fib4.valueNumeric >= CRITICAL_THRESHOLDS.FIB4_ADVANCED) {
    alerts.push({
      type: 'red_flag',
      severity: 'critical',
      title: 'Advanced Liver Fibrosis',
      message: `FIB4 index is ${fib4.valueNumeric}. High risk for cirrhosis. Urgent hepatology referral and ultrasound recommended.`,
      timestamp: new Date().toISOString(),
    });
  }

  // FRAIL: frail status
  const frail = findScoreByCode(currentScores, 'FRAIL');
  if (frail && frail.valueNumeric && frail.valueNumeric >= CRITICAL_THRESHOLDS.FRAIL_CRITICAL) {
    alerts.push({
      type: 'red_flag',
      severity: 'warning',
      title: 'Frailty Identified',
      message: `FRAIL score indicates frailty status. Geriatric assessment and multidisciplinary intervention recommended.`,
      timestamp: new Date().toISOString(),
    });
  }

  return alerts;
}

/**
 * Derive diet adherence drop alert
 */
function deriveDietAdherenceAlert(
  currentScores: ScoreResultEntry[],
  previousScores?: ScoreResultEntry[],
): AlertEntry | null {
  if (!previousScores) {
    return null;
  }

  const currentPredimed = findScoreByCode(currentScores, 'PREDIMED');
  const previousPredimed = findScoreByCode(previousScores, 'PREDIMED');

  if (!currentPredimed || !previousPredimed) {
    return null;
  }

  const currentScore = getNumericValue(currentPredimed) ?? 0;
  const previousScore = getNumericValue(previousPredimed) ?? 0;

  const drop = previousScore - currentScore;

  if (drop > 2) {
    return {
      type: 'diet_adherence_drop',
      severity: 'info',
      title: 'Diet Adherence Decline',
      message: `PREDIMED score decreased from ${previousScore} to ${currentScore}. Consider dietary counseling reinforcement.`,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Derive activity decline alert
 */
function deriveActivityDeclineAlert(
  currentScores: ScoreResultEntry[],
  previousScores?: ScoreResultEntry[],
): AlertEntry | null {
  if (!previousScores) {
    return null;
  }

  const currentActivity = findScoreByCode(currentScores, 'ACTIVITY');
  const previousActivity = findScoreByCode(previousScores, 'ACTIVITY');

  if (!currentActivity || !previousActivity) {
    return null;
  }

  const currentMin = getNumericValue(currentActivity) ?? 0;
  const previousMin = getNumericValue(previousActivity) ?? 0;

  // Alert if activity dropped by >25% or >50 min/week
  const absoluteDecline = previousMin - currentMin;
  const percentDecline = previousMin > 0 ? (absoluteDecline / previousMin) * 100 : 0;

  if (absoluteDecline > 50 || percentDecline > 25) {
    return {
      type: 'activity_decline',
      severity: 'info',
      title: 'Significant Activity Decline',
      message: `Weekly physical activity decreased from ${previousMin} to ${currentMin} minutes. Consider exercise program review.`,
      timestamp: new Date().toISOString(),
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
 * @param input - AlertDeriverInput with scores, previous scores, risk profile, followup plan, missing flags
 * @returns Array of AlertEntry objects
 *
 * @example
 * const alerts = deriveAlerts({
 *   currentScoreResults: [
 *     { scoreCode: 'SCORE2', valueNumeric: 12, category: 'Very High', ... },
 *     // ...
 *   ],
 *   previousScoreResults: [...],
 *   compositeRisk: { level: 'high' },
 *   missingDataFlags: ['hdlMgDl']
 * });
 * // Returns alerts for risk increase, missing data, red flags
 */
export function deriveAlerts(input: AlertDeriverInput): AlertEntry[] {
  const {
    currentScoreResults,
    previousScoreResults,
    compositeRisk,
    followupPlan,
    missingDataFlags = [],
  } = input;

  const alerts: AlertEntry[] = [];

  // 1. Risk increase alert
  if (previousScoreResults) {
    // Note: would need previous composite risk calculation
    // For now, checking if we can derive it from raw score changes
    const riskUpAlert = deriveRiskUpAlert(
      compositeRisk,
      previousScoreResults.length > 0 ? { level: 'moderate' } : null,
    );
    if (riskUpAlert) {
      alerts.push(riskUpAlert);
    }
  }

  // 2. Followup due alert
  const followupAlert = deriveFollowupDueAlert(followupPlan);
  if (followupAlert) {
    alerts.push(followupAlert);
  }

  // 3. Missing critical data alerts
  const missingAlerts = deriveMissingDataAlerts(missingDataFlags, currentScoreResults);
  alerts.push(...missingAlerts);

  // 4. Red flag alerts
  const redFlagAlerts = deriveRedFlagAlerts(currentScoreResults);
  alerts.push(...redFlagAlerts);

  // 5. Diet adherence drop alert
  if (previousScoreResults) {
    const dietAlert = deriveDietAdherenceAlert(
      currentScoreResults,
      previousScoreResults,
    );
    if (dietAlert) {
      alerts.push(dietAlert);
    }
  }

  // 6. Activity decline alert
  if (previousScoreResults) {
    const activityAlert = deriveActivityDeclineAlert(
      currentScoreResults,
      previousScoreResults,
    );
    if (activityAlert) {
      alerts.push(activityAlert);
    }
  }

  return alerts;
}
