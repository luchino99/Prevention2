/**
 * Unit tests for the pure clinical engine helpers.
 *
 * Focus: determinism, boundary conditions, null-safety, and the contracts
 * that downstream consumers (persistence, UI, reports) rely on.
 *
 * This suite is intentionally independent of `score-equivalence.test.ts`
 * — that one proves formula parity with the legacy engine; this one
 * guards the *shape* of the orchestrator output and the wiring between
 * the score engine, the risk aggregator, and the alert engine.
 *
 * All inputs must conform to the canonical `AssessmentInput` shape
 * exported from `shared/types/clinical.ts`. If you find yourself
 * reaching for the legacy `patient` / `systolicBp` / `smokingStatus`
 * property names the test is obsolete — rewrite it.
 */

import { describe, it, expect } from 'vitest';

import { computeAllScores } from '../../backend/src/domain/clinical/score-engine';
import { aggregateCompositeRisk } from '../../backend/src/domain/clinical/risk-aggregation/composite-risk';
import { deriveAlerts } from '../../backend/src/domain/clinical/alert-engine/alert-deriver';
import type {
  AssessmentInput,
  RiskLevel,
  ScoreResultEntry,
} from '../../shared/types/clinical';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Base fixture: 50-year-old male, non-diabetic, non-smoker, borderline
 * SBP, fasting glucose normal. Labs are sufficient to trigger SCORE2,
 * eGFR (via creatinine), and Metabolic Syndrome.
 *
 * Every test that needs a valid baseline should `structuredClone` this
 * fixture and mutate the clone — the shared reference must stay pristine
 * so determinism tests can rely on it.
 */
function makeBaseInput(): AssessmentInput {
  return {
    demographics: { age: 50, sex: 'male' },
    vitals: {
      heightCm: 180,
      weightKg: 80,
      waistCm: 92,
      sbpMmHg: 130,
      dbpMmHg: 82,
    },
    labs: {
      totalCholMgDl: 200,
      hdlMgDl: 50,
      ldlMgDl: 120,
      triglyceridesMgDl: 130,
      glucoseMgDl: 92,
      creatinineMgDl: 1.0,
    },
    clinicalContext: {
      smoking: false,
      hasDiabetes: false,
      hypertension: false,
      familyHistoryDiabetes: false,
      familyHistoryCvd: false,
      gestationalDiabetes: false,
      cvRiskRegion: 'moderate',
      medications: [],
      diagnoses: [],
    },
    lifestyle: {
      weeklyActivityMinutes: 180,
    },
  };
}

/** True answers for all 14 PREDIMED MEDAS items (high adherence). */
const PREDIMED_ALL_TRUE: boolean[] = Array.from({ length: 14 }, () => true);

/** Mixed answers: 8 true / 6 false → medium adherence band. */
const PREDIMED_MEDIUM: boolean[] = [
  true, true, true, true, true, true, true, true,
  false, false, false, false, false, false,
];

function findScore(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

// ============================================================================
// computeAllScores
// ============================================================================

describe('computeAllScores', () => {
  it('is deterministic — same input produces byte-identical output', () => {
    const a = computeAllScores(makeBaseInput());
    const b = computeAllScores(makeBaseInput());
    // Use JSON as a structural-equality shortcut. Any drift in ordering
    // or in any nested payload field will show up here.
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('always emits a BMI entry when height and weight are provided', () => {
    const out = computeAllScores(makeBaseInput());
    const bmi = findScore(out, 'BMI');
    expect(bmi).toBeDefined();
    expect(typeof bmi!.valueNumeric).toBe('number');
    expect(bmi!.valueNumeric).toBeGreaterThan(0);
    expect(bmi!.label).toMatch(/body mass index/i);
  });

  it('emits SCORE2 when age is in range and lipid/BP panel is present', () => {
    const out = computeAllScores(makeBaseInput());
    const score2 = findScore(out, 'SCORE2');
    expect(score2).toBeDefined();
    expect(typeof score2!.valueNumeric).toBe('number');
    expect(score2!.valueNumeric!).toBeGreaterThanOrEqual(0);
  });

  it('emits SCORE2 as a structured skip entry (NOT a fake numeric value) when required inputs are missing', () => {
    // Architectural decision (audit C-02 + composite-risk invariant):
    // a missing-input case must NOT silently disappear from the output —
    // the UI / PDF / audit trail need an explicit "not computable" entry
    // with a structured skipReason so the clinician sees WHY the score
    // is absent. The composite-risk aggregator treats this entry as
    // `indeterminate` (silence is not safety).
    const input = makeBaseInput();
    input.labs.totalCholMgDl = undefined;
    input.labs.hdlMgDl = undefined;

    const out = computeAllScores(input);
    const score2 = findScore(out, 'SCORE2');

    // Entry MUST be present — otherwise downstream layers cannot tell
    // "missing data" from "not assessed".
    expect(score2).toBeDefined();
    // Numeric value MUST be null — never a misleading 0 or stale value.
    expect(score2!.valueNumeric).toBeNull();
    // Category MUST mark the entry as non-stratifiable.
    expect(['not_computable', 'skipped']).toContain(score2!.category);
    // rawPayload MUST carry the structured skipReason so the UI can
    // render truthful messaging and the audit can log the cause.
    const raw = score2!.rawPayload as { skipped?: boolean; skipReason?: string };
    expect(raw.skipped).toBe(true);
    expect(raw.skipReason).toBe('SCORE2_MISSING_INPUT');
  });

  it('does not throw when optional labs are entirely missing', () => {
    const minimal: AssessmentInput = {
      demographics: { age: 40, sex: 'female' },
      vitals: {
        heightCm: 165,
        weightKg: 60,
        waistCm: 78,
        sbpMmHg: 118,
        dbpMmHg: 76,
      },
      labs: {},
      clinicalContext: {
        smoking: false,
        hasDiabetes: false,
        hypertension: false,
        familyHistoryDiabetes: false,
        familyHistoryCvd: false,
        gestationalDiabetes: false,
        cvRiskRegion: 'moderate',
        medications: [],
        diagnoses: [],
      },
      lifestyle: {},
    };

    expect(() => computeAllScores(minimal)).not.toThrow();
    // BMI is the only score guaranteed with no labs at all.
    const out = computeAllScores(minimal);
    expect(findScore(out, 'BMI')).toBeDefined();
  });
});

// ============================================================================
// PREDIMED wiring (CWS-6)
// ============================================================================

describe('computeAllScores — PREDIMED wiring', () => {
  it('does NOT emit a PREDIMED entry when no answers are provided', () => {
    const out = computeAllScores(makeBaseInput());
    expect(findScore(out, 'PREDIMED')).toBeUndefined();
  });

  it('does NOT emit a PREDIMED entry with a partial (non-14) answer set', () => {
    const input = makeBaseInput();
    // Partial response must be rejected by the orchestrator — a biased
    // adherence band would be worse than a missing entry. The completeness
    // checker will surface `PREDIMED_INCOMPLETE` in this case.
    input.lifestyle.predimedAnswers = [true, true, false];
    const out = computeAllScores(input);
    expect(findScore(out, 'PREDIMED')).toBeUndefined();
  });

  it('emits a PREDIMED entry with category "high" for 14 positive answers', () => {
    const input = makeBaseInput();
    input.lifestyle.predimedAnswers = PREDIMED_ALL_TRUE;
    const out = computeAllScores(input);
    const p = findScore(out, 'PREDIMED');
    expect(p).toBeDefined();
    expect(p!.valueNumeric).toBe(14);
    expect(p!.category).toBe('high');
    // rawPayload must carry the canonical max and the adherence band.
    expect(p!.rawPayload).toMatchObject({
      score: 14,
      adherenceBand: 'high',
      maxScore: 14,
    });
  });

  it('emits a PREDIMED entry with category "medium" for an 8/14 adherence', () => {
    const input = makeBaseInput();
    input.lifestyle.predimedAnswers = PREDIMED_MEDIUM;
    const out = computeAllScores(input);
    const p = findScore(out, 'PREDIMED');
    expect(p).toBeDefined();
    expect(p!.valueNumeric).toBe(8);
    expect(p!.category).toBe('medium');
  });
});

// ============================================================================
// aggregateCompositeRisk
// ============================================================================

describe('aggregateCompositeRisk', () => {
  const VALID_LEVELS: readonly RiskLevel[] = [
    'low',
    'moderate',
    'high',
    'very_high',
    'indeterminate',
  ] as const;

  it('returns a canonical RiskLevel string in `level`', () => {
    const input = makeBaseInput();
    const scores = computeAllScores(input);
    const composite = aggregateCompositeRisk(scores, input);
    expect(VALID_LEVELS).toContain(composite.level);
  });

  it('exposes a `numeric` projection aligned with the level', () => {
    const input = makeBaseInput();
    const scores = computeAllScores(input);
    const composite = aggregateCompositeRisk(scores, input);
    // indeterminate → 0; low=1..very_high=4. The projection is documented
    // in the CompositeRiskProfile JSDoc and is contract, not implementation.
    expect([0, 1, 2, 3, 4]).toContain(composite.numeric);
    if (composite.level === 'indeterminate') {
      expect(composite.numeric).toBe(0);
    }
  });

  it('always surfaces a DomainRiskEntry for cardiovascular/metabolic/hepatic/renal', () => {
    const input = makeBaseInput();
    const scores = computeAllScores(input);
    const composite = aggregateCompositeRisk(scores, input);
    for (const domain of ['cardiovascular', 'metabolic', 'hepatic', 'renal'] as const) {
      const entry = composite[domain];
      expect(entry).toBeDefined();
      expect(VALID_LEVELS).toContain(entry.level);
      expect(typeof entry.reasoning).toBe('string');
    }
    // Frailty is nullable by contract when no FRAIL fixture is provided.
    expect(composite.frailty === null || typeof composite.frailty === 'object').toBe(true);
  });
});

// ============================================================================
// deriveAlerts
// ============================================================================

describe('deriveAlerts', () => {
  it('accepts the object-style AlertDeriverInput signature', () => {
    const input = makeBaseInput();
    const scores = computeAllScores(input);
    const composite = aggregateCompositeRisk(scores, input);

    // The now anchor is passed explicitly so the alert stream is
    // deterministic even if the test runs across a second boundary.
    const alerts = deriveAlerts({
      currentScoreResults: scores,
      compositeRisk: composite,
      previousCompositeRisk: null,
      followupPlan: null,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(Array.isArray(alerts)).toBe(true);
    for (const a of alerts) {
      expect(['info', 'warning', 'critical']).toContain(a.severity);
      expect(typeof a.title).toBe('string');
      expect(a.title.length).toBeGreaterThan(0);
      expect(typeof a.message).toBe('string');
      expect(typeof a.timestamp).toBe('string');
    }
  });

  it('does NOT emit a clinical_risk_up alert when no previous baseline is supplied', () => {
    const input = makeBaseInput();
    const scores = computeAllScores(input);
    const composite = aggregateCompositeRisk(scores, input);

    const alerts = deriveAlerts({
      currentScoreResults: scores,
      compositeRisk: composite,
      previousCompositeRisk: null,
      followupPlan: null,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    // The alert engine refuses to synthesize a baseline — this is the
    // non-negotiable guard against spurious "risk increased" alerts on a
    // patient's very first assessment.
    expect(alerts.find((a) => a.type === 'clinical_risk_up')).toBeUndefined();
  });

  it('emits a diet_adherence_drop alert when PREDIMED score decreases across assessments', () => {
    const prevInput = makeBaseInput();
    prevInput.lifestyle.predimedAnswers = PREDIMED_ALL_TRUE;         // score 14
    const prevScores = computeAllScores(prevInput);

    const currInput = makeBaseInput();
    currInput.lifestyle.predimedAnswers = PREDIMED_MEDIUM;           // score 8
    const currScores = computeAllScores(currInput);
    const composite = aggregateCompositeRisk(currScores, currInput);

    const alerts = deriveAlerts({
      currentScoreResults: currScores,
      previousScoreResults: prevScores,
      compositeRisk: composite,
      previousCompositeRisk: null,
      followupPlan: null,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    const diet = alerts.find((a) => a.type === 'diet_adherence_drop');
    expect(diet).toBeDefined();
    expect(diet!.message).toMatch(/predimed/i);
  });
});
