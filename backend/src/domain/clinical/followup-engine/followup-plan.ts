/**
 * Followup Plan Generation Engine
 * Determines optimal follow-up schedule and monitoring actions based on composite risk
 * and individual domain results
 *
 * Follow-up interval rules:
 * - Very high composite risk → 1 month
 * - High composite risk → 3 months
 * - Moderate composite risk → 6 months
 * - Low composite risk → 12 months
 *
 * Actions generated based on elevated scores requiring monitoring
 *
 * Zero side effects - pure calculation only
 */

import type { ScoreResultEntry } from '../../../../../shared/types/clinical';

// ============================================================================
// Type Definitions
// ============================================================================

export interface FollowupPlan {
  intervalMonths: number;
  nextReviewDate: string;
  priorityLevel: 'routine' | 'moderate' | 'urgent';
  actions: string[];
  domainMonitoring: string[];
}

export interface FollowupInput {
  compositeRisk: any;
  scoreResults: ScoreResultEntry[];
  missingDataFlags: string[];
}

// ============================================================================
// Constants
// ============================================================================

const FOLLOWUP_INTERVALS = {
  very_high: 1,
  high: 3,
  moderate: 6,
  low: 12,
};

const PRIORITY_MAP = {
  very_high: 'urgent' as const,
  high: 'urgent' as const,
  moderate: 'moderate' as const,
  low: 'routine' as const,
};

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
 * Calculate next review date from interval months
 */
function calculateNextReviewDate(intervalMonths: number): string {
  const nextDate = new Date();
  nextDate.setMonth(nextDate.getMonth() + intervalMonths);
  // ISO 8601 format: `YYYY-MM-DDTHH:mm:ss.sssZ` → first 10 chars is always the date
  return nextDate.toISOString().slice(0, 10);
}

/**
 * Generate actions based on composite risk level
 */
function generateActions(compositeRiskLevel: string): string[] {
  const actions: string[] = [];

  const riskLevel = compositeRiskLevel?.toLowerCase() || 'low';

  if (riskLevel === 'very_high') {
    actions.push(
      'Schedule urgent appointment with primary care provider',
      'Consider multidisciplinary team review (cardiology, nephrology, hepatology as needed)',
      'Intensive lifestyle modification counseling',
      'Medication optimization review',
      'Baseline investigations if not recently done'
    );
  } else if (riskLevel === 'high') {
    actions.push(
      'Schedule appointment with primary care provider',
      'Specialist consultation consideration based on domain risks',
      'Structured lifestyle modification program',
      'Medication compliance review',
      'Target monitoring of key biomarkers'
    );
  } else if (riskLevel === 'moderate') {
    actions.push(
      'Routine clinical follow-up',
      'Lifestyle modification reinforcement',
      'Annual preventive screening',
      'Medication review as needed'
    );
  } else {
    actions.push(
      'Routine clinical follow-up',
      'Continue preventive health measures',
      'Maintain current exercise and diet',
      'Annual preventive screening'
    );
  }

  return actions;
}

/**
 * Generate domain-specific monitoring recommendations
 */
function generateDomainMonitoring(scoreResults: ScoreResultEntry[]): string[] {
  const monitoring: string[] = [];

  // Cardiovascular monitoring
  const score2 = findScoreByCode(scoreResults, 'SCORE2');
  if (score2) {
    const riskValue = score2.valueNumeric ?? 0;
    if (riskValue >= 10) {
      monitoring.push('Cardiovascular: Monthly risk assessment, lipid targets SBP <130');
    } else if (riskValue >= 5) {
      monitoring.push('Cardiovascular: Quarterly lipid panel, SBP <140, consider statin therapy');
    } else {
      monitoring.push('Cardiovascular: Annual lipid panel, SBP monitoring');
    }
  }

  // Metabolic monitoring
  const mets = findScoreByCode(scoreResults, 'METABOLIC_SYNDROME');
  const ada = findScoreByCode(scoreResults, 'ADA');
  if (mets || ada) {
    const adaScore = ada?.valueNumeric ?? 0;
    if (adaScore >= 5) {
      monitoring.push('Metabolic: HbA1c every 3-6 months, glucose monitoring, intensive weight loss');
    } else {
      monitoring.push('Metabolic: HbA1c annually, fasting glucose, BMI monitoring');
    }
  }

  // Hepatic monitoring
  const flib = findScoreByCode(scoreResults, 'FLI');
  const fib4 = findScoreByCode(scoreResults, 'FIB4');
  if (flib || fib4) {
    const fib4Value = fib4?.valueNumeric ?? 0;
    const fliValue = flib?.valueNumeric ?? 0;
    if (fib4Value >= 3.25) {
      monitoring.push('Hepatic: Urgent hepatology referral, liver ultrasound/elastography, portal HTN screening');
    } else if (fliValue >= 60 || fib4Value >= 1.45) {
      monitoring.push('Hepatic: Repeat FIB4 every 6 months, ultrasound annually, liver enzyme panel');
    } else {
      monitoring.push('Hepatic: Annual liver function tests and ultrasound if FLI remains elevated');
    }
  }

  // Renal monitoring
  const egfr = findScoreByCode(scoreResults, 'eGFR');
  if (egfr) {
    const egfrValue = egfr.valueNumeric ?? 90;
    if (egfrValue < 30) {
      monitoring.push('Renal: Urgent nephrology referral, monthly eGFR+ACR, prepare for renal replacement therapy');
    } else if (egfrValue < 60) {
      monitoring.push('Renal: Quarterly eGFR+ACR, target BP <130/80, ACEi/ARB optimization');
    } else {
      monitoring.push('Renal: Annual eGFR+ACR, monitor proteinuria, BP control');
    }
  }

  // Frailty monitoring
  const frail = findScoreByCode(scoreResults, 'FRAIL');
  if (frail) {
    const frailValue = frail.valueNumeric ?? 0;
    if (frailValue >= 3) {
      monitoring.push('Frailty: Geriatric assessment, physical therapy, nutritional support, regular monitoring');
    } else if (frailValue === 2) {
      monitoring.push('Frailty: Prehabilitation program, strength training, routine assessment');
    }
  }

  return monitoring.length > 0 ? monitoring : ['Standard preventive care monitoring'];
}

/**
 * Generate data collection actions based on missing flags
 */
function generateMissingDataActions(missingFlags: string[]): string[] {
  const actions: string[] = [];

  if (missingFlags.length > 0) {
    actions.push(`Obtain missing data: ${missingFlags.join(', ')}`);
  }

  return actions;
}

// ============================================================================
// Main Followup Plan Function (Pure)
// ============================================================================

/**
 * Determine follow-up plan based on composite risk and individual scores
 *
 * Generates:
 * - Follow-up interval (1, 3, 6, or 12 months)
 * - Next review date
 * - Priority level
 * - Clinical actions
 * - Domain-specific monitoring recommendations
 *
 * @param input - FollowupInput with composite risk, scores, missing data flags
 * @returns FollowupPlan with interval, actions, and monitoring details
 *
 * @example
 * const plan = determineFollowupPlan({
 *   compositeRisk: { level: 'high' },
 *   scoreResults: [
 *     { scoreCode: 'SCORE2', valueNumeric: 8.5, ... },
 *     { scoreCode: 'eGFR', valueNumeric: 45, ... },
 *   ],
 *   missingDataFlags: []
 * });
 * // plan.intervalMonths = 3, plan.nextReviewDate = "2026-07-19"
 * // plan.priorityLevel = "urgent"
 * // plan.actions contains medication optimization, specialist consideration, etc.
 */
export function determineFollowupPlan(input: FollowupInput): FollowupPlan {
  const {
    compositeRisk,
    scoreResults,
    missingDataFlags = [],
  } = input;

  // Get risk level (default to low if not specified)
  const riskLevel = (compositeRisk?.level || 'low').toLowerCase();

  // Determine interval months based on risk
  const intervalMonths =
    FOLLOWUP_INTERVALS[riskLevel as keyof typeof FOLLOWUP_INTERVALS] || 12;

  // Calculate next review date
  const nextReviewDate = calculateNextReviewDate(intervalMonths);

  // Get priority level
  const priorityLevel =
    PRIORITY_MAP[riskLevel as keyof typeof PRIORITY_MAP] || 'routine';

  // Generate actions
  const baseActions = generateActions(riskLevel);
  const missingDataActions = generateMissingDataActions(missingDataFlags);
  const allActions = [...baseActions, ...missingDataActions];

  // Generate domain monitoring recommendations
  const domainMonitoring = generateDomainMonitoring(scoreResults);

  return {
    intervalMonths,
    nextReviewDate,
    priorityLevel,
    actions: allActions,
    domainMonitoring,
  };
}
