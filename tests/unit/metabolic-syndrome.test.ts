/**
 * Metabolic Syndrome unit test (audit C-04 — P2).
 *
 * Verifies the population-aware waist threshold introduced by Tier-5
 * fix C-04: default `IDF_EUROPEAN` (94/80) used in EU deployment;
 * `NCEP_USA` (102/88) preserved for backward-compatibility / non-EU
 * tenants.
 *
 * Source thresholds:
 *   - Alberti KGMM et al, Circulation 2009;120:1640-45 (Harmonization)
 *   - Grundy SM et al, Circulation 2005;112:2735-52 (NCEP ATP III)
 */

import { describe, it, expect } from 'vitest';
import {
  computeMetabolicSyndrome,
  MetsWaistThresholds,
} from '../../backend/src/domain/clinical/score-engine/metabolic-syndrome';
import type { MetabolicSyndromeInput } from '../../shared/types/clinical';

const baseInput: MetabolicSyndromeInput = {
  waistCm: 0,
  sex: 'male',
  triglyceridesMgDl: 100,  // <150 → not met
  hdlMgDl: 60,             // M ≥40 → not met
  sbpMmHg: 120,
  dbpMmHg: 75,             // <130/85 → not met
  glucoseMgDl: 90,         // <100 → not met
};

describe('computeMetabolicSyndrome — population-aware waist (C-04)', () => {
  // ─── Threshold table sanity ───
  it('exposes the canonical thresholds', () => {
    expect(MetsWaistThresholds.NCEP_USA.male).toBe(102);
    expect(MetsWaistThresholds.NCEP_USA.female).toBe(88);
    expect(MetsWaistThresholds.IDF_EUROPEAN.male).toBe(94);
    expect(MetsWaistThresholds.IDF_EUROPEAN.female).toBe(80);
  });

  // ─── M, waist 96 — meets EU but not USA ───
  it('M waist 96cm meets the EU waist criterion but NOT the USA one', () => {
    const input = { ...baseInput, sex: 'male' as const, waistCm: 96 };
    const eu = computeMetabolicSyndrome(input, 'IDF_EUROPEAN');
    const us = computeMetabolicSyndrome(input, 'NCEP_USA');
    expect(eu.criteriaDetails[0].met).toBe(true);
    expect(us.criteriaDetails[0].met).toBe(false);
  });

  // ─── F, waist 84 — meets EU but not USA ───
  it('F waist 84cm meets the EU waist criterion but NOT the USA one', () => {
    const input = { ...baseInput, sex: 'female' as const, waistCm: 84 };
    const eu = computeMetabolicSyndrome(input, 'IDF_EUROPEAN');
    const us = computeMetabolicSyndrome(input, 'NCEP_USA');
    expect(eu.criteriaDetails[0].met).toBe(true);
    expect(us.criteriaDetails[0].met).toBe(false);
  });

  // ─── Default policy is IDF_EUROPEAN ───
  it('default policy is IDF_EUROPEAN', () => {
    const input = { ...baseInput, sex: 'male' as const, waistCm: 95 };
    const def = computeMetabolicSyndrome(input);
    expect(def.criteriaDetails[0].met).toBe(true);
    expect(def.criteriaDetails[0].threshold).toContain('IDF_EUROPEAN');
  });

  // ─── Sub-threshold for both ───
  it('M waist 90cm meets neither policy', () => {
    const input = { ...baseInput, sex: 'male' as const, waistCm: 90 };
    expect(computeMetabolicSyndrome(input, 'IDF_EUROPEAN').criteriaDetails[0].met).toBe(false);
    expect(computeMetabolicSyndrome(input, 'NCEP_USA').criteriaDetails[0].met).toBe(false);
  });

  // ─── Above both thresholds ───
  it('M waist 110cm meets both policies', () => {
    const input = { ...baseInput, sex: 'male' as const, waistCm: 110 };
    expect(computeMetabolicSyndrome(input, 'IDF_EUROPEAN').criteriaDetails[0].met).toBe(true);
    expect(computeMetabolicSyndrome(input, 'NCEP_USA').criteriaDetails[0].met).toBe(true);
  });

  // ─── Population-invariant criteria preserved ───
  it('TG/HDL/BP/glucose criteria unchanged across policies', () => {
    const input: MetabolicSyndromeInput = {
      sex: 'female',
      waistCm: 75,           // below both
      triglyceridesMgDl: 200, // ≥150 ✓
      hdlMgDl: 40,           // F <50 ✓
      sbpMmHg: 135,          // ≥130 ✓
      dbpMmHg: 80,
      glucoseMgDl: 110,      // ≥100 ✓
    };
    const eu = computeMetabolicSyndrome(input, 'IDF_EUROPEAN');
    const us = computeMetabolicSyndrome(input, 'NCEP_USA');
    // 4/5 met, waist not met — both policies agree.
    expect(eu.criteriaCount).toBe(4);
    expect(us.criteriaCount).toBe(4);
    expect(eu.present).toBe(true);
    expect(us.present).toBe(true);
  });
});
