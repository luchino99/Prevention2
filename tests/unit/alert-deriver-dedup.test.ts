/**
 * Alert deriver — dedup_key signature tests (Sprint 4 task 4.2 / F-014).
 *
 * Verifies that:
 *   1. Every score-backed red-flag carries the canonical, stable
 *      dedup_key from `AlertDedupKey`.
 *   2. Every guideline-threshold raw-input red-flag carries its
 *      canonical key.
 *   3. Trend alerts (diet adherence, activity decline) carry their type
 *      as the key (one open per patient at a time).
 *   4. `clinical_risk_up` is intentionally `dedupKey: null` (event-style
 *      alerts must always fire fresh — every transition is a distinct
 *      historical fact).
 *   5. The follow-up alert encodes the next review date in its key, so
 *      re-scheduling the review fires a fresh alert.
 *
 * These tests pin the deriver-side contract that migration 019 relies on
 * (`idx_alerts_dedup_inflight` + `INSERT … ON CONFLICT DO NOTHING`):
 * an emitted alert with a non-null dedupKey will be silently absorbed by
 * the persistence layer if a same-key open/acknowledged row already
 * exists for the patient.
 *
 * Per project rule: this file does NOT modify any clinical formula. It
 * only verifies the shape of the alerts the deriver produces.
 */

import { describe, it, expect } from 'vitest';
import { deriveAlerts } from '../../backend/src/domain/clinical/alert-engine/alert-deriver.js';
import type {
  AlertEntry,
  AlertDedupKey,
} from '../../backend/src/domain/clinical/alert-engine/alert-deriver.js';
import type {
  ScoreResultEntry,
  RiskLevel,
} from '../../shared/types/clinical.js';
import type { CompositeRiskProfile } from '../../backend/src/domain/clinical/risk-aggregation/composite-risk.js';

/* ─────────────────────────── helpers ─────────────────────────── */

function score(
  scoreCode: string,
  valueNumeric: number,
  category: string = 'high',
): ScoreResultEntry {
  return {
    scoreCode,
    valueNumeric,
    category,
    label: `${scoreCode} ${category}`,
    inputPayload: {},
    rawPayload: {},
  };
}

function indeterminateRisk(): CompositeRiskProfile {
  // Minimal-viable profile — only `level` is read by deriveRiskUpAlert
  // when both sides are not 'indeterminate'. We deliberately use the
  // indeterminate path here so the only alerts in the output come from
  // the score-backed and raw-input red-flag derivers we care about.
  const dom = (level: RiskLevel) => ({
    level,
    numeric: 0,
    reasoning: 'test',
    contributingScores: [] as string[],
  });
  return {
    level: 'indeterminate',
    numeric: 0,
    cardiovascular: dom('indeterminate'),
    metabolic: dom('indeterminate'),
    hepatic: dom('indeterminate'),
    renal: dom('indeterminate'),
    frailty: dom('indeterminate'),
    decision: {
      winningDomain: 'none',
      contributingDomains: [],
      unstratifiedCount: 5,
      rationale: 'test fixture',
    },
  } as unknown as CompositeRiskProfile;
}

function findByTitle(alerts: AlertEntry[], title: string): AlertEntry | undefined {
  return alerts.find((a) => a.title === title);
}

const NOW = new Date('2026-05-07T10:00:00Z');

/* ─────────────────────────── score-backed red-flags ─────────────────────── */

describe('alert-deriver — dedup_key for score-backed red-flags', () => {
  it('"Very High Cardiovascular Risk" carries red_flag::very_high_cardiovascular_risk', () => {
    const alerts = deriveAlerts({
      currentScoreResults: [score('SCORE2', 12.5, 'Very High')],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const a = findByTitle(alerts, 'Very High Cardiovascular Risk');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::very_high_cardiovascular_risk');
  });

  it('"Advanced Chronic Kidney Disease" carries red_flag::advanced_ckd', () => {
    const alerts = deriveAlerts({
      currentScoreResults: [score('EGFR', 25, 'severely_decreased')],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const a = findByTitle(alerts, 'Advanced Chronic Kidney Disease');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::advanced_ckd');
  });

  it('"Advanced Liver Fibrosis" carries red_flag::advanced_liver_fibrosis', () => {
    const alerts = deriveAlerts({
      currentScoreResults: [score('FIB4', 4.0, 'high')],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const a = findByTitle(alerts, 'Advanced Liver Fibrosis');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::advanced_liver_fibrosis');
  });

  it('"Frailty Identified" carries red_flag::frailty', () => {
    const alerts = deriveAlerts({
      currentScoreResults: [score('FRAIL', 3, 'frail')],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const a = findByTitle(alerts, 'Frailty Identified');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::frailty');
  });
});

/* ─────────────────────────── guideline-threshold red-flags ──────────────── */

describe('alert-deriver — dedup_key for raw-input red-flags', () => {
  const baseArgs = {
    currentScoreResults: [] as ScoreResultEntry[],
    compositeRisk: indeterminateRisk(),
    previousCompositeRisk: null,
    followupPlan: null,
    now: NOW,
  };

  it('Severe Hypertension → red_flag::severe_hypertension', () => {
    const alerts = deriveAlerts({
      ...baseArgs,
      vitals: { sbpMmHg: 195, dbpMmHg: 100 },
    });
    const a = findByTitle(alerts, 'Severe Hypertension');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::severe_hypertension');
  });

  it('Severe Hyperglycaemia → red_flag::hyperglycaemic_crisis', () => {
    const alerts = deriveAlerts({
      ...baseArgs,
      labs: { glucoseMgDl: 320 },
    });
    const a = findByTitle(alerts, 'Severe Hyperglycaemia');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::hyperglycaemic_crisis');
  });

  it('Very High HbA1c → red_flag::very_high_hba1c', () => {
    const alerts = deriveAlerts({
      ...baseArgs,
      labs: { hba1cPct: 11.2 },
    });
    const a = findByTitle(alerts, 'Very High HbA1c');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::very_high_hba1c');
  });

  it('Uncontrolled Diabetes → red_flag::uncontrolled_diabetes (only when diabetic)', () => {
    const alerts = deriveAlerts({
      ...baseArgs,
      labs: { hba1cPct: 9.2 },
      clinicalContext: { hasDiabetes: true },
    });
    const a = findByTitle(alerts, 'Uncontrolled Diabetes');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::uncontrolled_diabetes');
  });

  it('Severe Albuminuria → red_flag::severe_albuminuria', () => {
    const alerts = deriveAlerts({
      ...baseArgs,
      labs: { albuminCreatinineRatio: 450 },
    });
    const a = findByTitle(alerts, 'Severe Albuminuria (KDIGO A3)');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('red_flag::severe_albuminuria');
  });

  it('Severe Transaminase Elevation → red_flag::severe_transaminase_elevation', () => {
    const alerts = deriveAlerts({
      ...baseArgs,
      labs: { altUL: 200, astUL: 150 },
    });
    const a = findByTitle(alerts, 'Severe Transaminase Elevation');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>(
      'red_flag::severe_transaminase_elevation',
    );
  });
});

/* ─────────────────────────── trend + event alerts ──────────────────────── */

describe('alert-deriver — dedup_key for trend + event alerts', () => {
  it('clinical_risk_up has dedupKey: null (every transition is a distinct fact)', () => {
    const previous: CompositeRiskProfile = {
      ...indeterminateRisk(),
      level: 'low',
      numeric: 1,
    } as CompositeRiskProfile;
    const current: CompositeRiskProfile = {
      ...indeterminateRisk(),
      level: 'high',
      numeric: 3,
    } as CompositeRiskProfile;

    const alerts = deriveAlerts({
      currentScoreResults: [],
      compositeRisk: current,
      previousCompositeRisk: previous,
      followupPlan: null,
      now: NOW,
    });
    const a = alerts.find((x) => x.type === 'clinical_risk_up');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBeNull();
  });

  it('followup_due encodes the review date so reschedule re-fires', () => {
    const reviewDate = '2026-05-15';
    const alerts = deriveAlerts({
      currentScoreResults: [],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: { nextReviewDate: reviewDate },
      now: NOW, // 2026-05-07 → 8 days out → "due soon"
    });
    const a = alerts.find((x) => x.type === 'followup_due');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>(`followup_due::${reviewDate}`);
  });

  it('diet_adherence_drop carries the type as its dedup key', () => {
    const alerts = deriveAlerts({
      currentScoreResults: [score('PREDIMED', 5, 'low')],
      previousScoreResults: [score('PREDIMED', 12, 'high')],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const a = alerts.find((x) => x.type === 'diet_adherence_drop');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('diet_adherence_drop');
  });

  it('activity_decline carries the type as its dedup key', () => {
    const alerts = deriveAlerts({
      currentScoreResults: [score('ACTIVITY', 30, 'sedentary')],
      previousScoreResults: [score('ACTIVITY', 200, 'active')],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const a = alerts.find((x) => x.type === 'activity_decline');
    expect(a).toBeDefined();
    expect(a!.dedupKey).toBe<AlertDedupKey>('activity_decline');
  });
});

/* ─────────────────────────── invariants on the whole stream ──────────── */

describe('alert-deriver — universal invariants', () => {
  it('every emitted alert has a defined dedupKey field (never undefined)', () => {
    // Trigger a varied mix of alerts at once.
    const alerts = deriveAlerts({
      currentScoreResults: [
        score('SCORE2', 12.5, 'Very High'),
        score('EGFR', 25, 'severely_decreased'),
        score('FIB4', 4.0, 'high'),
        score('FRAIL', 3, 'frail'),
      ],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: { nextReviewDate: '2026-05-12' },
      now: NOW,
      vitals: { sbpMmHg: 195 },
      labs: { glucoseMgDl: 320, hba1cPct: 11.2, albuminCreatinineRatio: 450 },
    });
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      // dedupKey must be either a string OR the explicit `null` sentinel.
      // `undefined` would mean a derive helper forgot to set it — that is a
      // contract violation we want to catch in CI, not in production.
      expect(a).toHaveProperty('dedupKey');
      expect(a.dedupKey === null || typeof a.dedupKey === 'string').toBe(true);
    }
  });

  it('no two emitted alerts share the same non-null dedupKey within one assessment', () => {
    // The deriver MUST not emit twin findings in the same call. The
    // persistence layer dedup absorbs cross-assessment duplicates; the
    // in-batch dedup at the end of deriveAlerts() guarantees the single
    // call is also clean.
    const alerts = deriveAlerts({
      currentScoreResults: [
        score('SCORE2', 12.5, 'Very High'),
        score('SCORE2_DIABETES', 13.0, 'Very High'), // same finding via diabetes variant
      ],
      compositeRisk: indeterminateRisk(),
      previousCompositeRisk: null,
      followupPlan: null,
      now: NOW,
    });
    const seenKeys = new Set<string>();
    for (const a of alerts) {
      if (a.dedupKey === null) continue;
      expect(seenKeys.has(a.dedupKey)).toBe(false);
      seenKeys.add(a.dedupKey);
    }
  });
});
