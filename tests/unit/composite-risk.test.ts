/**
 * Composite-risk aggregation unit tests.
 *
 * Locks in the "silence is not safety" invariant introduced in migration 006
 * + Task #14 (CWS-2). See:
 *   - 23-CLINICAL-ENGINE.md §7 (risk aggregation)
 *   - 24-FORMULA-REGISTRY.md §4 (eligibility evaluator)
 *   - 30-RISK-REGISTER.md C-02 (composite "low risk" inferred from skipped
 *     scores) — explicitly resolved
 *   - 30-RISK-REGISTER.md H-05 (out-of-range score inputs producing
 *     misleading composite risk) — mitigated
 *
 * The aggregator is a pure function so no mocking is required. We assert:
 *   - All-skipped input → composite is `indeterminate`, never `low`
 *   - One stratified `high` domain raises composite to `high` even when
 *     other domains are indeterminate
 *   - Composite is the MAX of stratified domain levels (never folds in
 *     indeterminate as a "0" that would lower the max)
 *   - The numeric encoding for indeterminate is `0` (not `1`/`low`)
 *   - The reasoning carries the truthful skip reason, not a hard-coded
 *     "missing lipid panel" placeholder
 *
 * Per project rule: this file does NOT modify any clinical formula. It only
 * verifies the *aggregation* layer that sits above the validated scores.
 */

import { describe, it, expect } from 'vitest';
import { aggregateCompositeRisk } from '../../backend/src/domain/clinical/risk-aggregation/composite-risk.js';
import type { ScoreResultEntry } from '../../shared/types/clinical.js';

/* -------------------------------------------------------- score fixtures */

function skippedScore(scoreCode: string, skipReason: string): ScoreResultEntry {
  return {
    scoreCode,
    valueNumeric: null,
    category: 'skipped',
    label: `${scoreCode} (skipped)`,
    inputPayload: {},
    rawPayload: { skipReason, missingFields: [], outOfRange: null },
  };
}

function score(
  scoreCode: string,
  valueNumeric: number,
  category: string,
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

/* --------------------------------------------------------- the invariant */

describe('aggregateCompositeRisk — silence is not safety', () => {
  it('returns indeterminate when every score was skipped (never collapses to low)', () => {
    const profile = aggregateCompositeRisk([
      skippedScore('SCORE2', 'SCORE2_MISSING_INPUT'),
      skippedScore('SCORE2_DIABETES', 'SCORE2_DIABETES_MISSING_INPUT'),
      skippedScore('FLI', 'FLI_MISSING_INPUT'),
      skippedScore('FIB4', 'FIB4_MISSING_INPUT'),
      skippedScore('EGFR', 'EGFR_MISSING_INPUT'),
      skippedScore('METABOLIC_SYNDROME', 'METS_MISSING_INPUT'),
      skippedScore('ADA', 'ADA_MISSING_INPUT'),
    ]);

    expect(profile.level).toBe('indeterminate');
    expect(profile.numeric).toBe(0);
    // Every domain must be indeterminate too — none silently downgraded.
    expect(profile.cardiovascular.level).toBe('indeterminate');
    expect(profile.metabolic.level).toBe('indeterminate');
    expect(profile.hepatic.level).toBe('indeterminate');
    expect(profile.renal.level).toBe('indeterminate');
  });

  it('returns indeterminate when the score set is empty', () => {
    const profile = aggregateCompositeRisk([]);
    expect(profile.level).toBe('indeterminate');
    expect(profile.numeric).toBe(0);
  });
});

describe('aggregateCompositeRisk — stratified domain dominates', () => {
  it('one stratified high CV domain produces high composite, even with other domains indeterminate', () => {
    const profile = aggregateCompositeRisk([
      score('SCORE2', 8.5, 'High'),
      skippedScore('FLI', 'FLI_MISSING_INPUT'),
      skippedScore('FIB4', 'FIB4_MISSING_INPUT'),
      skippedScore('EGFR', 'EGFR_MISSING_INPUT'),
    ]);

    expect(profile.cardiovascular.level).toBe('high');
    expect(profile.level).toBe('high');
    expect(profile.numeric).toBe(3);
  });

  it('takes the MAX across stratified domains (very_high beats moderate)', () => {
    const profile = aggregateCompositeRisk([
      score('SCORE2', 12, 'Very High'),
      score('METABOLIC_SYNDROME', 3, 'present'),
      skippedScore('FLI', 'FLI_MISSING_INPUT'),
    ]);

    expect(profile.cardiovascular.level).toBe('very_high');
    expect(profile.level).toBe('very_high');
    expect(profile.numeric).toBe(4);
  });

  it('does NOT let an indeterminate domain pull a high composite down to low', () => {
    // Regression test against the pre-migration-006 behaviour where missing
    // domains were treated as 0 / low and folded into a min/avg, which
    // could mask a real high-risk signal.
    const profile = aggregateCompositeRisk([
      score('SCORE2', 8, 'High'),
      skippedScore('FLI', 'FLI_MISSING_INPUT'),
      skippedScore('FIB4', 'FIB4_MISSING_INPUT'),
    ]);

    expect(profile.level).toBe('high');
    expect(profile.numeric).toBeGreaterThanOrEqual(3);
  });
});

describe('aggregateCompositeRisk — numeric encoding', () => {
  it('encodes indeterminate as 0 (so naive >= 3 checks do NOT trigger)', () => {
    const profile = aggregateCompositeRisk([
      skippedScore('SCORE2', 'SCORE2_MISSING_INPUT'),
    ]);
    expect(profile.numeric).toBe(0);
    expect(profile.numeric < 3).toBe(true);
  });

  it('encodes low=1 / moderate=2 / high=3 / very_high=4 monotonically', () => {
    const veryHigh = aggregateCompositeRisk([
      score('SCORE2', 15, 'Very High'),
    ]);
    const high = aggregateCompositeRisk([
      score('SCORE2', 8, 'High'),
    ]);
    const moderate = aggregateCompositeRisk([
      score('SCORE2', 4, 'Moderate'),
    ]);
    const low = aggregateCompositeRisk([
      score('SCORE2', 1, 'Low'),
    ]);

    expect(veryHigh.numeric).toBeGreaterThan(high.numeric);
    expect(high.numeric).toBeGreaterThan(moderate.numeric);
    expect(moderate.numeric).toBeGreaterThan(low.numeric);
  });
});

describe('aggregateCompositeRisk — truthful skip reasoning', () => {
  it('does NOT use the legacy hard-coded "missing lipid panel" reason for an out-of-range age skip', () => {
    const profile = aggregateCompositeRisk([
      {
        scoreCode: 'SCORE2',
        valueNumeric: null,
        category: 'skipped',
        label: 'SCORE2 (skipped)',
        inputPayload: {},
        rawPayload: {
          skipReason: 'SCORE2_AGE_OUT_OF_RANGE',
          missingFields: [],
          outOfRange: { field: 'age', value: 35, min: 40, max: 80 },
        },
      },
    ]);

    expect(profile.cardiovascular.level).toBe('indeterminate');
    // The reasoning must mention the actual cause — age, not lipids.
    expect(profile.cardiovascular.reasoning.toLowerCase()).toMatch(/age/);
    expect(profile.cardiovascular.reasoning.toLowerCase()).not.toMatch(
      /missing lipid panel/,
    );
  });
});

// ============================================================================
// Sprint 4 task 4.1 — composite decision audit metadata
// ============================================================================

describe('aggregateCompositeRisk — composite decision metadata', () => {
  it('decision.winningDomain = "none" when composite is indeterminate', () => {
    const profile = aggregateCompositeRisk([]);
    expect(profile.level).toBe('indeterminate');
    expect(profile.decision.winningDomain).toBe('none');
    expect(profile.decision.contributingDomains).toHaveLength(0);
    expect(profile.decision.unstratifiedCount).toBe(4);
    expect(profile.decision.rationale.toLowerCase()).toContain('could not be stratified');
  });

  it('decision.winningDomain points to the only stratified domain when composite is high', () => {
    const profile = aggregateCompositeRisk([
      {
        scoreCode: 'SCORE2',
        valueNumeric: 25,
        category: 'high',
        rawPayload: {},
      } as ScoreResultEntry,
    ]);
    expect(profile.level).toBe('high');
    expect(profile.decision.winningDomain).toBe('cardiovascular');
    expect(profile.decision.contributingDomains).toContain('cardiovascular');
    expect(profile.decision.rationale).toContain('Driven by cardiovascular domain');
  });

  it('decision tie-break priority: cardiovascular > renal when both high', () => {
    const profile = aggregateCompositeRisk(
      [
        { scoreCode: 'SCORE2', valueNumeric: 18, category: 'high', rawPayload: {} } as ScoreResultEntry,
        {
          scoreCode: 'EGFR',
          valueNumeric: 35,
          category: 'moderately_to_severely_decreased',
          rawPayload: { stage: 'G3b' },
        } as ScoreResultEntry,
      ],
    );
    expect(profile.level).toBe('high');
    expect(profile.decision.winningDomain).toBe('cardiovascular');
    expect(profile.decision.contributingDomains).toEqual(
      expect.arrayContaining(['cardiovascular', 'renal']),
    );
    expect(profile.decision.rationale).toContain('Driven by 2 domains');
    expect(profile.decision.rationale).toContain('primary actionable driver: cardiovascular');
  });

  it('decision.unstratifiedCount surfaces data-completeness gap', () => {
    // High cardio with everything else missing — composite is stratified
    // but several domains are indeterminate. Exact count depends on how
    // each deriver treats absence (some default to 'low', some to
    // 'indeterminate' — see deriver source). We assert ≥1 indeterminate
    // and that the rationale mentions the data-gap phrase.
    const profile = aggregateCompositeRisk([
      { scoreCode: 'SCORE2', valueNumeric: 22, category: 'high', rawPayload: {} } as ScoreResultEntry,
    ]);
    expect(profile.level).toBe('high');
    expect(profile.decision.unstratifiedCount).toBeGreaterThanOrEqual(1);
    expect(profile.decision.rationale).toContain('indeterminate (data gap)');
  });

  it('decision.contributingDomains lists the dominating domain(s) at the composite level', () => {
    // Multi-score input: SCORE2 high, FIB-4 elevated, EGFR G3b. Final
    // composite level depends on each deriver's mapping (e.g. FIB-4
    // ≥3.25 may bump hepatic to very_high). We assert structural
    // properties: composite is stratified (not indeterminate),
    // winningDomain is non-'none', contributingDomains includes the
    // winningDomain.
    const profile = aggregateCompositeRisk([
      { scoreCode: 'SCORE2', valueNumeric: 14, category: 'high', rawPayload: {} } as ScoreResultEntry,
      { scoreCode: 'FIB4', valueNumeric: 3.5, category: 'high', rawPayload: {} } as ScoreResultEntry,
      {
        scoreCode: 'EGFR',
        valueNumeric: 38,
        category: 'moderately_to_severely_decreased',
        rawPayload: { stage: 'G3b' },
      } as ScoreResultEntry,
    ]);
    expect(profile.level).not.toBe('indeterminate');
    expect(profile.decision.winningDomain).not.toBe('none');
    expect(profile.decision.contributingDomains.length).toBeGreaterThanOrEqual(1);
    expect(profile.decision.contributingDomains).toContain(profile.decision.winningDomain);
  });

  it('decision.rationale includes detail strings from contributing domains', () => {
    // SCORE2 valueNumeric=20 with category=very_high. The deriver may
    // or may not propagate to composite=very_high depending on its
    // category-vs-numeric thresholds. We assert structural properties:
    // composite stratified, rationale mentions Detail + cardiovascular.
    const profile = aggregateCompositeRisk([
      { scoreCode: 'SCORE2', valueNumeric: 20, category: 'very_high', rawPayload: {} } as ScoreResultEntry,
    ]);
    expect(profile.level).not.toBe('indeterminate');
    expect(profile.decision.rationale).toContain('Detail:');
    expect(profile.decision.rationale.toLowerCase()).toContain('cardiovascular');
  });
});
