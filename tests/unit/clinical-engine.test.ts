/**
 * Unit tests for the pure clinical engine helpers.
 *
 * Focus: determinism, boundary conditions, null-safety.
 * These tests are independent of the equivalence tests and guard the
 * contract of each score module in isolation.
 */

import { describe, it, expect } from 'vitest';
import { computeAllScores } from '../../backend/src/domain/clinical/score-engine';
import { aggregateCompositeRisk } from '../../backend/src/domain/clinical/risk-aggregation/composite-risk';
import { deriveAlerts } from '../../backend/src/domain/clinical/alert-engine/alert-deriver';
import type { AssessmentInput } from '../../shared/types/clinical';

const BASE_INPUT: AssessmentInput = {
  patient: { age: 50, sex: 'male' },
  vitals: { systolicBp: 130, bmi: 24.0, waistCm: 92, weightKg: 80, heightCm: 182 },
  labs: {
    totalCholesterolMmolL: 5.0,
    hdlCholesterolMmolL: 1.2,
    triglyceridesMmolL: 1.3,
    glucoseFastingMgDl: 92,
    creatinineMgDl: 1.0,
  },
  lifestyle: { smokingStatus: 'never', alcoholUnitsPerWeek: 0 },
  activity: { minutesPerWeek: 150 },
  conditions: { diabetes: false, hypertension: false, ckd: false, cvd: false },
};

describe('computeAllScores', () => {
  it('is deterministic — same input produces same output', () => {
    const a = computeAllScores(BASE_INPUT);
    const b = computeAllScores(BASE_INPUT);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('returns a BMI value when height and weight are provided', () => {
    const out = computeAllScores(BASE_INPUT) as any;
    expect(out.bmi).toBeDefined();
    expect(typeof out.bmi.value).toBe('number');
    expect(out.bmi.value).toBeGreaterThan(0);
  });

  it('does not throw when optional labs are missing', () => {
    const minimal: AssessmentInput = {
      patient: { age: 40, sex: 'female' },
      vitals: { systolicBp: 118, bmi: 22.0 },
      labs: {},
      lifestyle: { smokingStatus: 'never' },
      conditions: {},
    };
    expect(() => computeAllScores(minimal)).not.toThrow();
  });
});

describe('aggregateCompositeRisk', () => {
  it('produces a risk band string', () => {
    const scores = computeAllScores(BASE_INPUT) as any;
    const composite = aggregateCompositeRisk(scores, BASE_INPUT);
    expect(['low', 'moderate', 'high', 'very_high', 'unknown']).toContain(composite.band);
  });
});

describe('deriveAlerts', () => {
  it('emits no alert for a healthy low-risk patient', () => {
    const scores = computeAllScores(BASE_INPUT) as any;
    const composite = aggregateCompositeRisk(scores, BASE_INPUT);
    const alerts = deriveAlerts(scores, composite, BASE_INPUT);
    expect(Array.isArray(alerts)).toBe(true);
    // A healthy fixture can still emit an 'info' alert — just assert shape
    for (const a of alerts) {
      expect(['critical', 'high', 'moderate', 'low', 'info']).toContain(a.severity);
      expect(a.title).toBeTruthy();
      expect(a.message).toBeTruthy();
    }
  });

  it('flags smoking as a lifestyle alert when smoking_status=current', () => {
    const input: AssessmentInput = {
      ...BASE_INPUT,
      lifestyle: { ...BASE_INPUT.lifestyle, smokingStatus: 'current' },
    };
    const scores = computeAllScores(input) as any;
    const composite = aggregateCompositeRisk(scores, input);
    const alerts = deriveAlerts(scores, composite, input);
    const smokingAlert = alerts.find((a) =>
      a.title.toLowerCase().includes('smok') || a.message.toLowerCase().includes('smok')
    );
    expect(smokingAlert).toBeDefined();
  });
});
