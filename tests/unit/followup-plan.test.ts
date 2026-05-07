/**
 * Sprint 4 task 4.3 — `determineFollowupPlan` unit-test suite.
 *
 * Pre-Sprint-4 the follow-up engine had ZERO direct unit tests — it was
 * only exercised through `assessment-service` integration paths, which are
 * mocked or skipped in CI. For a deterministic clinical interpretation
 * layer that drives the alerts inbox + PDF report, that's a clinical-grade
 * audit risk.
 *
 * This file pins:
 *   1. **Determinism** — same input → byte-identical output.
 *   2. **Read-path determinism** — passing the same `now` produces the
 *      same `nextReviewDate`.
 *   3. **Composite-risk → cadence table** — every RiskLevel maps to its
 *      canonical interval (1 / 3 / 6 / 12 months for stratified bands;
 *      `indeterminate = 2` short-loop, never 12).
 *   4. **Per-domain branches** — CV / renal / hepatic / metabolic / frailty
 *      each emit guideline-sourced items at the right thresholds.
 *   5. **Diabetic chronic-care** — the 3 annual screenings (retinopathy,
 *      foot, urine ACR) fire only when `hasDiabetes === true`.
 *   6. **Hypertension branch (Sprint 4 task 4.3, ESC/ESH 2023)** —
 *      tiered cadence by BP stage, gated on `vitals` being supplied.
 *   7. **Smoking-cessation branch (Sprint 4 task 4.3, ESC 2021 §3)** —
 *      emitted only when smoking AND a CV item is otherwise present.
 *   8. **`dueInDays` sentinel** — undiagnosed-DM uses 7-day target,
 *      hypertensive urgency uses 1-day target.
 *   9. **Catalog linkage** — every emitted `guidelineSource` traces to a
 *      registered catalog entry. Drift would silently surface as a
 *      free-text string.
 *
 * Per project rule: this file does NOT modify any clinical formula. It
 * verifies the *interpretation layer* sitting above the validated scores.
 */

import { describe, it, expect } from 'vitest';
import { determineFollowupPlan } from '../../backend/src/domain/clinical/followup-engine/followup-plan.js';
import type { FollowupInput } from '../../backend/src/domain/clinical/followup-engine/followup-plan.js';
import { findGuidelineByDisplayString } from '../../backend/src/domain/clinical/guideline-catalog/index.js';
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
  rawPayload: Record<string, unknown> = {},
): ScoreResultEntry {
  return {
    scoreCode,
    valueNumeric,
    category,
    label: `${scoreCode} ${category}`,
    inputPayload: {},
    rawPayload,
  };
}

/**
 * Minimal-viable composite-risk fixture. Only `level` is read by
 * `determineFollowupPlan`'s top-level cadence selector. Domains and
 * decision are populated to satisfy the type but not asserted here —
 * domain-level effects are exercised via `scoreResults`.
 */
function compositeOf(level: RiskLevel): CompositeRiskProfile {
  const dom = (l: RiskLevel) => ({
    level: l,
    numeric: l === 'very_high' ? 4 : l === 'high' ? 3 : l === 'moderate' ? 2 : l === 'low' ? 1 : 0,
    reasoning: 'test fixture',
    contributingScores: [] as string[],
  });
  return {
    level,
    numeric: dom(level).numeric,
    cardiovascular: dom(level),
    metabolic: dom(level),
    hepatic: dom(level),
    renal: dom(level),
    frailty: dom(level),
    decision: {
      winningDomain: level === 'indeterminate' ? 'none' : 'cardiovascular',
      contributingDomains: [],
      unstratifiedCount: 0,
      rationale: 'test fixture',
    },
  } as unknown as CompositeRiskProfile;
}

const FIXED_NOW = new Date('2026-05-07T10:00:00Z');

function plan(overrides: Partial<FollowupInput>) {
  return determineFollowupPlan({
    compositeRisk: compositeOf('moderate'),
    scoreResults: [],
    now: FIXED_NOW,
    ...overrides,
  });
}

function itemCodes(p: ReturnType<typeof plan>): string[] {
  return p.items.map((i) => i.code);
}

/* ─────────────────────────── 1. Determinism ─────────────────────────── */

describe('determineFollowupPlan — determinism contract', () => {
  it('same input → byte-identical output (no hidden state)', () => {
    const input: FollowupInput = {
      compositeRisk: compositeOf('high'),
      scoreResults: [
        score('SCORE2', 8.5, 'High'),
        score('EGFR', 45, 'mildly_decreased'),
        score('FIB4', 1.6, 'intermediate'),
      ],
      hasDiabetes: false,
      now: FIXED_NOW,
    };
    const a = determineFollowupPlan(input);
    const b = determineFollowupPlan(input);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('passing the same `now` produces the same `nextReviewDate` (read-path determinism)', () => {
    const input: FollowupInput = {
      compositeRisk: compositeOf('moderate'),
      scoreResults: [],
      now: new Date('2026-04-01T00:00:00Z'),
    };
    expect(determineFollowupPlan(input).nextReviewDate).toBe(
      determineFollowupPlan(input).nextReviewDate,
    );
  });

  it('different `now` → different `nextReviewDate` (anchor is honoured)', () => {
    const a = determineFollowupPlan({
      compositeRisk: compositeOf('moderate'),
      scoreResults: [],
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const b = determineFollowupPlan({
      compositeRisk: compositeOf('moderate'),
      scoreResults: [],
      now: new Date('2026-04-01T00:00:00Z'),
    });
    expect(a.nextReviewDate).not.toBe(b.nextReviewDate);
  });
});

/* ─────────────────────────── 2. Cadence table ─────────────────────────── */

describe('determineFollowupPlan — composite-risk cadence', () => {
  it('very_high → 1 month, urgent priority', () => {
    const p = plan({ compositeRisk: compositeOf('very_high') });
    expect(p.intervalMonths).toBe(1);
    expect(p.priorityLevel).toBe('urgent');
  });

  it('high → 3 months, urgent priority', () => {
    const p = plan({ compositeRisk: compositeOf('high') });
    expect(p.intervalMonths).toBe(3);
    expect(p.priorityLevel).toBe('urgent');
  });

  it('moderate → 6 months, moderate priority', () => {
    const p = plan({ compositeRisk: compositeOf('moderate') });
    expect(p.intervalMonths).toBe(6);
    expect(p.priorityLevel).toBe('moderate');
  });

  it('low → 12 months, routine priority', () => {
    const p = plan({ compositeRisk: compositeOf('low') });
    expect(p.intervalMonths).toBe(12);
    expect(p.priorityLevel).toBe('routine');
  });

  it('indeterminate → 2-month short-loop (NEVER collapses to 12 / low)', () => {
    // The non-negotiable invariant: missing data must NOT silently
    // produce a "low risk, see you in a year" plan. The engine forces a
    // short-interval reassessment so the clinician is nudged to complete
    // collection.
    const p = plan({ compositeRisk: compositeOf('indeterminate') });
    expect(p.intervalMonths).toBe(2);
    expect(p.intervalMonths).not.toBe(12);
    expect(p.priorityLevel).toBe('moderate');
    expect(p.priorityLevel).not.toBe('routine');
    // The core review item's rationale carries the "incomplete" framing
    // so the inbox row reads correctly.
    const core = p.items.find((i) => i.code === 'core_review');
    expect(core).toBeDefined();
    expect(core!.rationale.toLowerCase()).toMatch(/incomplete/);
  });
});

/* ─────────────────────────── 3. Per-domain branches ─────────────────── */

describe('determineFollowupPlan — cardiovascular branch (ESC 2021)', () => {
  it('SCORE2 ≥ 10 → intensive lipid + tight BP items, urgent', () => {
    const p = plan({
      compositeRisk: compositeOf('very_high'),
      scoreResults: [score('SCORE2', 14, 'Very High')],
    });
    expect(itemCodes(p)).toEqual(
      expect.arrayContaining(['cv_lipid_intensive', 'cv_bp_target_130']),
    );
  });

  it('SCORE2 5–10 → targeted lipid item only, moderate', () => {
    const p = plan({
      compositeRisk: compositeOf('moderate'),
      scoreResults: [score('SCORE2', 7, 'Moderate')],
    });
    expect(itemCodes(p)).toContain('cv_lipid_targeted');
    expect(itemCodes(p)).not.toContain('cv_lipid_intensive');
  });

  it('SCORE2 < 5 → no CV-specific items beyond core review', () => {
    const p = plan({
      compositeRisk: compositeOf('low'),
      scoreResults: [score('SCORE2', 2, 'Low')],
    });
    expect(itemCodes(p).filter((c) => c.startsWith('cv_'))).toHaveLength(0);
  });
});

describe('determineFollowupPlan — renal branch (KDIGO 2024)', () => {
  it('eGFR < 30 → urgent nephrology referral', () => {
    const p = plan({
      scoreResults: [score('EGFR', 25, 'severely_decreased')],
    });
    const item = p.items.find((i) => i.code === 'renal_nephrology_urgent');
    expect(item).toBeDefined();
    expect(item!.priority).toBe('urgent');
    expect(item!.dueInMonths).toBe(1);
  });

  it('eGFR 30–60 → quarterly monitoring', () => {
    const p = plan({
      scoreResults: [score('EGFR', 45, 'mildly_decreased')],
    });
    expect(itemCodes(p)).toContain('renal_kidney_monitoring');
  });

  it('eGFR ≥ 60 → no renal-specific item', () => {
    const p = plan({
      scoreResults: [score('EGFR', 90, 'normal')],
    });
    expect(itemCodes(p).filter((c) => c.startsWith('renal_'))).toHaveLength(0);
  });
});

describe('determineFollowupPlan — hepatic branch (EASL 2024)', () => {
  it('FIB-4 ≥ 3.25 → urgent hepatology referral', () => {
    const p = plan({
      scoreResults: [score('FIB4', 3.6, 'high')],
    });
    expect(itemCodes(p)).toContain('hepatic_hepatology_urgent');
  });

  it('FIB-4 1.45–3.25 → liver monitoring', () => {
    const p = plan({
      scoreResults: [score('FIB4', 2.0, 'intermediate')],
    });
    expect(itemCodes(p)).toContain('hepatic_monitor');
  });

  it('FLI ≥ 60 alone → liver monitoring (NAFLD likely)', () => {
    const p = plan({
      scoreResults: [score('FLI', 75, 'high')],
    });
    expect(itemCodes(p)).toContain('hepatic_monitor');
  });
});

describe('determineFollowupPlan — frailty branch', () => {
  it('FRAIL ≥ 3 → comprehensive geriatric assessment', () => {
    const p = plan({
      scoreResults: [score('FRAIL', 4, 'frail')],
    });
    const item = p.items.find((i) => i.code === 'frailty_comprehensive_geriatric');
    expect(item).toBeDefined();
    expect(item!.priority).toBe('urgent');
  });

  it('FRAIL = 2 → prehabilitation', () => {
    const p = plan({
      scoreResults: [score('FRAIL', 2, 'pre_frail')],
    });
    expect(itemCodes(p)).toContain('frailty_prehabilitation');
  });

  it('FRAIL = 0 → no frailty item (FRAIL = 0 is meaningful, not skipped)', () => {
    const p = plan({
      scoreResults: [score('FRAIL', 0, 'robust')],
    });
    expect(itemCodes(p).filter((c) => c.startsWith('frailty_'))).toHaveLength(0);
  });
});

describe('determineFollowupPlan — diabetic chronic-care annual screenings', () => {
  it('hasDiabetes=true emits retinopathy + foot + urine ACR (3 annual items)', () => {
    const p = plan({
      hasDiabetes: true,
      scoreResults: [],
    });
    const codes = itemCodes(p);
    expect(codes).toEqual(
      expect.arrayContaining([
        'dm_retinopathy_screening',
        'dm_foot_screening',
        'dm_annual_urine_acr',
      ]),
    );
    // All three are routine 12-month cadence.
    for (const code of [
      'dm_retinopathy_screening',
      'dm_foot_screening',
      'dm_annual_urine_acr',
    ]) {
      const item = p.items.find((i) => i.code === code)!;
      expect(item.dueInMonths).toBe(12);
      expect(item.priority).toBe('routine');
    }
  });

  it('hasDiabetes=false → no annual diabetic screenings', () => {
    const p = plan({ hasDiabetes: false, scoreResults: [] });
    const codes = itemCodes(p);
    expect(codes).not.toContain('dm_retinopathy_screening');
    expect(codes).not.toContain('dm_foot_screening');
    expect(codes).not.toContain('dm_annual_urine_acr');
  });
});

/* ─────────────────────────── 4. Hypertension branch (NEW) ───────────── */

describe('determineFollowupPlan — hypertension branch (Sprint 4, ESC/ESH 2023)', () => {
  it('SBP < 140 and DBP < 90 → no HTN item', () => {
    const p = plan({
      vitals: { sbpMmHg: 125, dbpMmHg: 78 },
    });
    expect(itemCodes(p).filter((c) => c.startsWith('htn_'))).toHaveLength(0);
  });

  it('SBP 140–159 → Stage-1 follow-up at 3 months', () => {
    const p = plan({
      vitals: { sbpMmHg: 148, dbpMmHg: 88 },
    });
    const item = p.items.find((i) => i.code === 'htn_stage1_followup');
    expect(item).toBeDefined();
    expect(item!.dueInMonths).toBe(3);
    expect(item!.priority).toBe('moderate');
  });

  it('SBP 160–179 → Stage-2 follow-up at 1 month, urgent', () => {
    const p = plan({
      vitals: { sbpMmHg: 168, dbpMmHg: 95 },
    });
    const item = p.items.find((i) => i.code === 'htn_stage2_followup');
    expect(item).toBeDefined();
    expect(item!.dueInMonths).toBe(1);
    expect(item!.priority).toBe('urgent');
  });

  it('SBP ≥ 180 → urgency item with `dueInDays: 1` (24-hour recheck)', () => {
    const p = plan({
      vitals: { sbpMmHg: 195, dbpMmHg: 100 },
    });
    const item = p.items.find((i) => i.code === 'htn_urgency_recheck');
    expect(item).toBeDefined();
    expect(item!.dueInMonths).toBe(0);
    expect(item!.dueInDays).toBe(1);
    expect(item!.priority).toBe('urgent');
  });

  it('DBP ≥ 110 alone (SBP normal) still triggers urgency', () => {
    const p = plan({
      vitals: { sbpMmHg: 130, dbpMmHg: 115 },
    });
    expect(itemCodes(p)).toContain('htn_urgency_recheck');
  });

  it('vitals omitted → no HTN item (engine never fabricates a cadence)', () => {
    const p = plan({});
    expect(itemCodes(p).filter((c) => c.startsWith('htn_'))).toHaveLength(0);
  });

  it('vitals with nullish fields → no HTN item', () => {
    const p = plan({
      vitals: { sbpMmHg: null, dbpMmHg: null },
    });
    expect(itemCodes(p).filter((c) => c.startsWith('htn_'))).toHaveLength(0);
  });
});

/* ─────────────────────────── 5. Smoking-cessation branch (NEW) ──────── */

describe('determineFollowupPlan — smoking-cessation branch (Sprint 4, ESC 2021 §3)', () => {
  it('smoker + CV item present → cessation referral emitted', () => {
    const p = plan({
      compositeRisk: compositeOf('moderate'),
      scoreResults: [score('SCORE2', 7, 'Moderate')], // emits cv_lipid_targeted
      clinicalContext: { smoking: true },
    });
    expect(itemCodes(p)).toContain('lifestyle_smoking_cessation_referral');
  });

  it('smoker but NO CV item → no referral (gating preserves inbox hygiene)', () => {
    const p = plan({
      compositeRisk: compositeOf('low'),
      scoreResults: [score('SCORE2', 1, 'Low')],
      clinicalContext: { smoking: true },
    });
    expect(itemCodes(p)).not.toContain('lifestyle_smoking_cessation_referral');
  });

  it('non-smoker + CV item → no referral', () => {
    const p = plan({
      compositeRisk: compositeOf('moderate'),
      scoreResults: [score('SCORE2', 7, 'Moderate')],
      clinicalContext: { smoking: false },
    });
    expect(itemCodes(p)).not.toContain('lifestyle_smoking_cessation_referral');
  });

  it('clinicalContext omitted → no referral (default-off is safe)', () => {
    const p = plan({
      compositeRisk: compositeOf('moderate'),
      scoreResults: [score('SCORE2', 7, 'Moderate')],
    });
    expect(itemCodes(p)).not.toContain('lifestyle_smoking_cessation_referral');
  });
});

/* ─────────────────────────── 6. dueInDays sentinel ──────────────────── */

describe('determineFollowupPlan — dueInDays sub-monthly granularity', () => {
  it('UNDIAGNOSED_DIABETES_SUSPECTED → dueInDays: 7 with dueInMonths: 0', () => {
    const p = plan({
      scoreResults: [
        score('UNDIAGNOSED_DIABETES_SUSPECTED', 1, 'suspected'),
      ],
    });
    const item = p.items.find((i) => i.code === 'metabolic_undiagnosed_dm_confirmation');
    expect(item).toBeDefined();
    expect(item!.dueInMonths).toBe(0);
    expect(item!.dueInDays).toBe(7);
  });

  it('items without `dueInDays` leave the field undefined (legacy compatibility)', () => {
    const p = plan({
      compositeRisk: compositeOf('low'),
      scoreResults: [],
    });
    const core = p.items.find((i) => i.code === 'core_review')!;
    expect(core.dueInDays).toBeUndefined();
  });
});

/* ─────────────────────────── 7. Catalog linkage ─────────────────────── */

describe('determineFollowupPlan — guideline-source catalog linkage', () => {
  it('every emitted `guidelineSource` traces to a registered catalog entry', () => {
    // Build a plan that exercises every domain branch + diabetic
    // chronic-care + HTN + smoking, so we hit the maximum surface in one
    // call. If a future change introduces a free-text `guidelineSource`
    // (regression: forgot to import GUIDELINES.X), this test fails.
    const p = plan({
      compositeRisk: compositeOf('high'),
      hasDiabetes: true,
      vitals: { sbpMmHg: 165, dbpMmHg: 95 },
      clinicalContext: { smoking: true },
      scoreResults: [
        score('SCORE2', 12, 'Very High'),
        score('EGFR', 28, 'severely_decreased'),
        score('FIB4', 4.0, 'high'),
        score('FRAIL', 4, 'frail'),
        score('METABOLIC_SYNDROME', 3, 'metabolic syndrome'),
        score('ADA', 6, 'high'),
        score('UNDIAGNOSED_DIABETES_SUSPECTED', 1, 'suspected'),
      ],
    });
    expect(p.items.length).toBeGreaterThan(0);
    for (const item of p.items) {
      if (!item.guidelineSource) continue;
      const ref = findGuidelineByDisplayString(item.guidelineSource);
      expect(
        ref,
        `Item ${item.code} carries an unrecognised guidelineSource "${item.guidelineSource}". `
          + 'Either register it in guideline-registry.ts or use a catalog entry.',
      ).not.toBeNull();
    }
  });
});

/* ─────────────────────────── 8. Core invariants ────────────────────── */

describe('determineFollowupPlan — core invariants', () => {
  it('always emits a `core_review` item regardless of inputs', () => {
    expect(itemCodes(plan({}))).toContain('core_review');
    expect(itemCodes(plan({ compositeRisk: compositeOf('indeterminate') }))).toContain('core_review');
    expect(itemCodes(plan({
      compositeRisk: compositeOf('very_high'),
      scoreResults: [score('SCORE2', 18, 'Very High')],
    }))).toContain('core_review');
  });

  it('every item has a non-empty title and rationale', () => {
    const p = plan({
      compositeRisk: compositeOf('high'),
      hasDiabetes: true,
      vitals: { sbpMmHg: 168 },
      clinicalContext: { smoking: true },
      scoreResults: [
        score('SCORE2', 12, 'Very High'),
        score('EGFR', 25, 'severely_decreased'),
        score('FIB4', 3.5, 'high'),
        score('FRAIL', 4, 'frail'),
      ],
    });
    for (const item of p.items) {
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
      expect(typeof item.rationale).toBe('string');
      expect(item.rationale.length).toBeGreaterThan(0);
    }
  });

  it('every item has a priority drawn from the canonical 3-tier set', () => {
    const p = plan({
      compositeRisk: compositeOf('very_high'),
      scoreResults: [score('SCORE2', 18, 'Very High')],
    });
    for (const item of p.items) {
      expect(['routine', 'moderate', 'urgent']).toContain(item.priority);
    }
  });
});
