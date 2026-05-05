/**
 * FIB-4 unit test (audit C-05 — P2).
 *
 * Verifies age-adjusted thresholds:
 *   age <65 (Sterling 2006):    <1.45 / 1.45-3.25 / ≥3.25
 *   age ≥65 (AASLD 2023):       <2.0  / 2.0-3.25  / ≥3.25
 */

import { describe, it, expect } from 'vitest';
import { computeFib4 } from '../../backend/src/domain/clinical/score-engine/fib4';

describe('computeFib4 — formula (Sterling 2006)', () => {
  it('matches the canonical formula', () => {
    // 50y, AST=40, ALT=30, plt=200
    // = (50*40)/(200*sqrt(30)) = 2000/(200*5.477) = 2000/1095.45 ≈ 1.826
    const r = computeFib4({ age: 50, astUL: 40, altUL: 30, plateletsGigaL: 200 });
    expect(r.fib4).toBeCloseTo(1.83, 1);
  });

  it('rejects invalid input safely', () => {
    expect(computeFib4({ age: 0, astUL: 40, altUL: 30, plateletsGigaL: 200 }).category).toBe('invalid_input');
    expect(computeFib4({ age: 50, astUL: 40, altUL: 0, plateletsGigaL: 200 }).fib4).toBe(0);
    expect(computeFib4({ age: 50, astUL: 40, altUL: 30, plateletsGigaL: 0 }).category).toBe('invalid_input');
  });
});

describe('computeFib4 — age-adjusted thresholds (C-05)', () => {
  describe('adult <65y (Sterling 2006 cut-offs 1.45/3.25)', () => {
    it('FIB-4 = 1.40 → low_risk', () => {
      // Build a case landing exactly on 1.40
      // age 40, AST 30, ALT 25, plt 257  → (40*30)/(257*5)=1200/1285=0.934 — too low
      // Use specific values: age 40, AST 28, ALT 25 (sqrt 5), plt 160 → (40*28)/(160*5)=1120/800=1.40
      const r = computeFib4({ age: 40, astUL: 28, altUL: 25, plateletsGigaL: 160 });
      expect(r.fib4).toBeCloseTo(1.4, 2);
      expect(r.category).toBe('low_risk');
    });

    it('FIB-4 = 1.50 → intermediate (≥1.45 cut-off)', () => {
      // age 40, AST 30, ALT 25, plt 160 → (40*30)/(160*5)=1200/800=1.50
      const r = computeFib4({ age: 40, astUL: 30, altUL: 25, plateletsGigaL: 160 });
      expect(r.fib4).toBeCloseTo(1.5, 2);
      expect(r.category).toBe('intermediate');
    });

    it('FIB-4 = 3.40 → high_risk', () => {
      // age 50, AST 50, ALT 25, plt 75 → (50*50)/(75*5)=2500/375≈6.67
      // Reduce: age 50, AST 50, ALT 25, plt 150 → 2500/750≈3.33 → use 145
      // age 50 AST 50 ALT 25 plt 147 → 2500/(147*5)=2500/735≈3.40
      const r = computeFib4({ age: 50, astUL: 50, altUL: 25, plateletsGigaL: 147 });
      expect(r.fib4).toBeGreaterThanOrEqual(3.25);
      expect(r.category).toBe('high_risk');
    });
  });

  describe('elderly ≥65y (AASLD 2023 cut-offs 2.0/3.25)', () => {
    it('FIB-4 = 1.90 in 70y → low_risk (would be intermediate under <65y rules)', () => {
      // Same FIB-4 numeric value would map differently depending on age.
      // 70y, AST 38, ALT 25 (sqrt 5), plt 140 → (70*38)/(140*5)=2660/700=3.80 — too high
      // Use 70y, AST 19, ALT 25, plt 140 → (70*19)/(140*5)=1330/700=1.90
      const r = computeFib4({ age: 70, astUL: 19, altUL: 25, plateletsGigaL: 140 });
      expect(r.fib4).toBeCloseTo(1.9, 2);
      expect(r.category).toBe('low_risk');           // ≥65 → cut-off 2.0
    });

    it('same FIB-4 = 1.90 in 50y → intermediate', () => {
      // 50y same lab → (50*19)/(140*sqrt(25))=950/700=1.357 too low
      // Use parameters chosen to land at 1.90 with age=50:
      // age 50, AST 38, ALT 25, plt 200 → (50*38)/(200*5)=1900/1000=1.90
      const r = computeFib4({ age: 50, astUL: 38, altUL: 25, plateletsGigaL: 200 });
      expect(r.fib4).toBeCloseTo(1.9, 2);
      expect(r.category).toBe('intermediate');       // <65 → cut-off 1.45
    });

    it('FIB-4 = 2.50 in 80y → intermediate', () => {
      // age 80, AST 25, ALT 25, plt 200 → (80*25)/(200*5)=2000/1000=2.0 → just at cutoff
      // age 80, AST 25, ALT 25, plt 160 → (80*25)/(160*5)=2000/800=2.50
      const r = computeFib4({ age: 80, astUL: 25, altUL: 25, plateletsGigaL: 160 });
      expect(r.fib4).toBeCloseTo(2.5, 2);
      expect(r.category).toBe('intermediate');
    });

    it('FIB-4 = 3.40 in 80y → high_risk', () => {
      // age 80, AST 34, ALT 25, plt 160 → (80*34)/(160*5)=2720/800=3.40
      const r = computeFib4({ age: 80, astUL: 34, altUL: 25, plateletsGigaL: 160 });
      expect(r.fib4).toBeCloseTo(3.4, 2);
      expect(r.category).toBe('high_risk');
    });
  });
});
