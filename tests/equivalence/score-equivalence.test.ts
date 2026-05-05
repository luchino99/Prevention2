/**
 * Score equivalence + regression test suite.
 *
 * For every canonical fixture in `tests/fixtures/score-cases.ts`, we run
 * `computeAllScores(input)` and assert against pinned expected values.
 *
 * Two classes of expectation co-exist (see fixture header for full
 * rationale):
 *
 *   1. Deterministic-formula scores (BMI, eGFR, FIB-4, ADA, FLI, MetS,
 *      FRAIL, PREDIMED) — values are computed independently from the
 *      published equations and pinned in the fixture. A failure here
 *      means the engine has drifted from the published formula.
 *
 *   2. SCORE2 / SCORE2-Diabetes regression values — pinned from the
 *      production engine which now matches the canonical Hageman 2021
 *      Box S5 cll-recalibration formula. The clinical-grade golden
 *      vectors live in `tests/unit/score2-golden.test.ts`, which uses
 *      an INDEPENDENT reference implementation derived directly from
 *      the paper and asserts that production output matches reference
 *      output to within ±0.1 % across 9 sex × region × age cases.
 *
 * The legacy engine import (`../../engine/index.js`) was removed —
 * legacy code lives in `_archive_legacy/` and is no longer loadable.
 * Equivalence vs legacy was structurally broken in the previous
 * version of this file: the import always returned null, so the
 * `it('agrees with legacy')` assertion was silently skipped on every
 * run, producing false confidence. Replaced with explicit fixture
 * assertions that always run.
 */

import { describe, it, expect } from 'vitest';
import { SCORE_CASES } from '../fixtures/score-cases.js';
import { computeAllScores } from '../../backend/src/domain/clinical/score-engine/index.js';
import type { ScoreResultEntry } from '../../shared/types/clinical.js';

// Tolerances per score family. Tighter than 0.01 means "must be exact".
const TOL_INTEGER = 0;
const TOL_TWO_DECIMALS = 0.01;
const TOL_ONE_DECIMAL = 0.05;

function findScore(results: ScoreResultEntry[], code: string): ScoreResultEntry | undefined {
  return results.find((r) => r.scoreCode === code);
}

describe('Clinical score equivalence (pinned expected values)', () => {
  it('exposes the orchestrator', () => {
    expect(typeof computeAllScores).toBe('function');
  });

  for (const c of SCORE_CASES) {
    describe(`fixture: ${c.name}`, () => {
      it('engine produces a non-empty result array without throwing', () => {
        const out = computeAllScores(c.input);
        expect(Array.isArray(out)).toBe(true);
        expect(out.length).toBeGreaterThan(0);
      });

      // ---- BMI ----
      if (c.expected.bmi) {
        it('BMI matches WHO formula', () => {
          const out = computeAllScores(c.input);
          const bmi = findScore(out, 'BMI');
          expect(bmi).toBeDefined();
          expect(bmi!.valueNumeric).not.toBeNull();
          expect(Math.abs((bmi!.valueNumeric as number) - c.expected.bmi!.value))
            .toBeLessThanOrEqual(TOL_ONE_DECIMAL);
          expect(bmi!.category).toBe(c.expected.bmi!.category);
        });
      }

      // ---- eGFR (CKD-EPI 2021) ----
      if (c.expected.egfr) {
        it('eGFR matches CKD-EPI 2021 formula', () => {
          const out = computeAllScores(c.input);
          const egfr = findScore(out, 'EGFR');
          expect(egfr).toBeDefined();
          expect(egfr!.valueNumeric).not.toBeNull();
          // eGFR is rounded to integer in the engine.
          expect(Math.round(egfr!.valueNumeric as number))
            .toBe(c.expected.egfr!.value);
          expect(egfr!.category).toBe(c.expected.egfr!.category);
          // The full result also exposes the KDIGO stage on rawPayload.
          expect((egfr!.rawPayload as any).stage).toBe(c.expected.egfr!.stage);
        });
      }

      // ---- FIB-4 (Sterling 2006) ----
      if (c.expected.fib4) {
        it('FIB-4 matches Sterling 2006 formula', () => {
          const out = computeAllScores(c.input);
          // Engine emits scoreCode 'FIB4' (no hyphen) — see score-engine/index.ts:489
          const fib4 = findScore(out, 'FIB4');
          expect(fib4).toBeDefined();
          expect(Math.abs((fib4!.valueNumeric as number) - c.expected.fib4!.value))
            .toBeLessThanOrEqual(TOL_TWO_DECIMALS);
          expect(fib4!.category).toBe(c.expected.fib4!.category);
        });
      }

      // ---- FLI (Bedogni 2006) ----
      if (c.expected.fli) {
        it('FLI matches Bedogni 2006 formula', () => {
          const out = computeAllScores(c.input);
          const fli = findScore(out, 'FLI');
          expect(fli).toBeDefined();
          expect(Math.abs((fli!.valueNumeric as number) - c.expected.fli!.value))
            .toBeLessThanOrEqual(0.5); // 2-decimal pinning + log rounding noise
          expect(fli!.category).toBe(c.expected.fli!.category);
        });
      }

      // ---- FRAIL (Morley 2012) ----
      if (c.expected.frail) {
        it('FRAIL matches Morley 2012 additive scoring', () => {
          const out = computeAllScores(c.input);
          const frail = findScore(out, 'FRAIL');
          expect(frail).toBeDefined();
          expect(frail!.valueNumeric).toBe(c.expected.frail!.score);
          expect(frail!.category).toBe(c.expected.frail!.category);
        });
      }

      // ---- ADA (Bang 2009) ----
      if (c.expected.ada) {
        it('ADA matches Bang 2009 additive scoring', () => {
          const out = computeAllScores(c.input);
          const ada = findScore(out, 'ADA');
          expect(ada).toBeDefined();
          expect(ada!.valueNumeric).toBe(c.expected.ada!.score);
          expect(ada!.category).toBe(c.expected.ada!.category);
        });
      }

      // ---- Metabolic Syndrome (ATP III / Harmonization 2009) ----
      if (c.expected.metSyndrome) {
        it('Metabolic Syndrome criteria count matches ATP III', () => {
          const out = computeAllScores(c.input);
          const mets = findScore(out, 'METABOLIC_SYNDROME');
          expect(mets).toBeDefined();
          // criteriaCount lives on rawPayload (engine emits valueNumeric=count).
          expect(mets!.valueNumeric).toBe(c.expected.metSyndrome!.criteriaCount);
          expect((mets!.rawPayload as any).present).toBe(c.expected.metSyndrome!.present);
        });
      }

      // ---- PREDIMED (Estruch 2018 — MEDAS 14-item) ----
      if (c.expected.predimed) {
        it('PREDIMED matches MEDAS 14-item additive scoring', () => {
          const out = computeAllScores(c.input);
          const predimed = findScore(out, 'PREDIMED');
          expect(predimed).toBeDefined();
          expect(predimed!.valueNumeric).toBe(c.expected.predimed!.score);
          expect((predimed!.rawPayload as any).adherenceBand).toBe(c.expected.predimed!.adherenceBand);
        });
      }

      // ---- SCORE2 — regression baseline (NOT clinical golden) ----
      if (c.expected.score2RegressionRiskPercent !== undefined) {
        it('SCORE2 self-consistency baseline (NOT clinical golden)', () => {
          const out = computeAllScores(c.input);
          const s2 = findScore(out, 'SCORE2');
          expect(s2).toBeDefined();
          expect(s2!.valueNumeric).not.toBeNull();
          expect(Math.abs((s2!.valueNumeric as number) - c.expected.score2RegressionRiskPercent!))
            .toBeLessThanOrEqual(TOL_TWO_DECIMALS);
        });
      }

      // ---- SCORE2-Diabetes — regression baseline (NOT clinical golden) ----
      if (c.expected.score2DiabetesRegressionRiskPercent !== undefined) {
        it('SCORE2-Diabetes self-consistency baseline (NOT clinical golden)', () => {
          const out = computeAllScores(c.input);
          const s2dm = findScore(out, 'SCORE2_DIABETES');
          expect(s2dm).toBeDefined();
          expect(s2dm!.valueNumeric).not.toBeNull();
          expect(Math.abs((s2dm!.valueNumeric as number) - c.expected.score2DiabetesRegressionRiskPercent!))
            .toBeLessThanOrEqual(TOL_TWO_DECIMALS);
        });
      }
    });
  }
});
