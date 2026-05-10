/**
 * SCORE2 / SCORE2-Diabetes eligibility evaluator — exhaustive unit tests.
 *
 * Sprint 6 task 6.1 follow-up: the eligibility evaluator was at 65.5% line
 * coverage — well below the 85% Tier 1 floor. The integration tests
 * exercised the orchestrator path (computeAllScores) but never hit the
 * eligibility evaluator directly, so the per-field out-of-range branches
 * were not visited.
 *
 * This file pins every public branch of the module:
 *
 *   evaluateScore2Eligibility:
 *     - all-inputs-present + valid → eligible
 *     - missing totalChol / hdl / sbp (singly + combined)
 *     - age out of range (low + high)
 *     - sbp out of range (low + high)
 *     - totalChol out of range (low + high)
 *     - hdl out of range (low + high)
 *
 *   evaluateScore2DiabetesEligibility:
 *     - non-diabetic → NOT_APPLICABLE
 *     - diabetic + all inputs present + valid → eligible
 *     - diabetic + missing core 6 inputs (combined)
 *     - diabetic + age out of range
 *     - diabetic + sbp out of range
 *     - diabetic + totalChol out of range
 *     - diabetic + hdl out of range
 *     - diabetic + hba1c out of range (low + high)
 *     - diabetic + eGFR out of range (low + high)
 *
 *   buildScore2SkipEntry / buildScore2DiabetesSkipEntry:
 *     - shape contract: scoreCode, valueNumeric=null, category, label,
 *       inputPayload pass-through, rawPayload.skipReason +
 *       missingFields + outOfRange.
 *
 * Per project rule: no formula change. The evaluator is a pure
 * pre-flight check that protects the validated SCORE2 / SCORE2-DM
 * formulas from being invoked outside their derivation domain.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateScore2Eligibility,
  evaluateScore2DiabetesEligibility,
  buildScore2SkipEntry,
  buildScore2DiabetesSkipEntry,
  SCORE2_RANGES,
} from '../../backend/src/domain/clinical/score-engine/score2-eligibility.js';
import type { AssessmentInput } from '../../shared/types/clinical.js';

/* ─────────────────────────── fixtures ─────────────────────────── */

/** Minimal AssessmentInput with every SCORE2 input present and valid. */
function validBaseInput(): AssessmentInput {
  return {
    demographics: { age: 55, sex: 'male' },
    vitals: {
      heightCm: 175,
      weightKg: 80,
      waistCm: 92,
      sbpMmHg: 130,
      dbpMmHg: 80,
    },
    labs: {
      totalCholMgDl: 200,
      hdlMgDl: 50,
      ldlMgDl: 130,
      triglyceridesMgDl: 120,
      glucoseMgDl: 95,
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
    lifestyle: { weeklyActivityMinutes: 150 },
  };
}

/**
 * Minimal AssessmentInput with every SCORE2-Diabetes input present and
 * valid. Layered on validBaseInput by enabling diabetes + adding the
 * diabetes-specific labs.
 */
function diabeticBaseInput(): AssessmentInput {
  const i = validBaseInput();
  i.clinicalContext.hasDiabetes = true;
  i.clinicalContext.ageAtDiabetesDiagnosis = 50;
  i.labs.hba1cPct = 7.0;
  i.labs.eGFR = 90;
  return i;
}

/* ─────────────────────────── SCORE2 — happy path ────────────── */

describe('evaluateScore2Eligibility', () => {
  it('eligible when every input is present and within validated range', () => {
    const r = evaluateScore2Eligibility(validBaseInput());
    expect(r.eligible).toBe(true);
  });

  /* ─────────────── missing inputs ─────────────── */

  it('SCORE2_MISSING_INPUT when totalCholMgDl is absent', () => {
    const i = validBaseInput();
    delete (i.labs as Partial<typeof i.labs>).totalCholMgDl;
    const r = evaluateScore2Eligibility(i);
    expect(r).toMatchObject({
      eligible: false,
      skipReason: 'SCORE2_MISSING_INPUT',
    });
    if (!r.eligible) {
      expect(r.missingFields).toContain('labs.totalCholMgDl');
    }
  });

  it('SCORE2_MISSING_INPUT when hdlMgDl is absent', () => {
    const i = validBaseInput();
    delete (i.labs as Partial<typeof i.labs>).hdlMgDl;
    const r = evaluateScore2Eligibility(i);
    expect(r).toMatchObject({ eligible: false, skipReason: 'SCORE2_MISSING_INPUT' });
    if (!r.eligible) expect(r.missingFields).toContain('labs.hdlMgDl');
  });

  it('SCORE2_MISSING_INPUT when sbpMmHg is absent', () => {
    const i = validBaseInput();
    delete (i.vitals as Partial<typeof i.vitals>).sbpMmHg;
    const r = evaluateScore2Eligibility(i);
    expect(r).toMatchObject({ eligible: false, skipReason: 'SCORE2_MISSING_INPUT' });
    if (!r.eligible) expect(r.missingFields).toContain('vitals.sbpMmHg');
  });

  it('SCORE2_MISSING_INPUT enumerates every absent field', () => {
    const i = validBaseInput();
    delete (i.labs as Partial<typeof i.labs>).totalCholMgDl;
    delete (i.labs as Partial<typeof i.labs>).hdlMgDl;
    delete (i.vitals as Partial<typeof i.vitals>).sbpMmHg;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_MISSING_INPUT');
    expect(r.missingFields).toEqual(
      expect.arrayContaining(['labs.totalCholMgDl', 'labs.hdlMgDl', 'vitals.sbpMmHg']),
    );
  });

  /* ─────────────── out-of-range branches ─────────────── */

  it('SCORE2_AGE_OUT_OF_RANGE when age is below 40', () => {
    const i = validBaseInput();
    i.demographics.age = 35;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_AGE_OUT_OF_RANGE');
    expect(r.outOfRange).toEqual({
      field: 'demographics.age',
      value: 35,
      min: 40,
      max: 80,
    });
  });

  it('SCORE2_AGE_OUT_OF_RANGE when age is above 80', () => {
    const i = validBaseInput();
    i.demographics.age = 85;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_AGE_OUT_OF_RANGE');
    expect(r.outOfRange?.value).toBe(85);
  });

  it('SCORE2_SBP_OUT_OF_RANGE when sbp is below 60', () => {
    const i = validBaseInput();
    i.vitals.sbpMmHg = 55;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_SBP_OUT_OF_RANGE');
    expect(r.outOfRange).toEqual({
      field: 'vitals.sbpMmHg',
      value: 55,
      min: 60,
      max: 250,
    });
  });

  it('SCORE2_SBP_OUT_OF_RANGE when sbp is above 250', () => {
    const i = validBaseInput();
    i.vitals.sbpMmHg = 260;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_SBP_OUT_OF_RANGE');
  });

  it('SCORE2_TOTAL_CHOL_OUT_OF_RANGE when totalChol is below 50', () => {
    const i = validBaseInput();
    i.labs.totalCholMgDl = 30;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_TOTAL_CHOL_OUT_OF_RANGE');
    expect(r.outOfRange).toEqual({
      field: 'labs.totalCholMgDl',
      value: 30,
      min: 50,
      max: 400,
    });
  });

  it('SCORE2_TOTAL_CHOL_OUT_OF_RANGE when totalChol is above 400', () => {
    const i = validBaseInput();
    i.labs.totalCholMgDl = 450;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_TOTAL_CHOL_OUT_OF_RANGE');
  });

  it('SCORE2_HDL_OUT_OF_RANGE when hdl is below 20', () => {
    const i = validBaseInput();
    i.labs.hdlMgDl = 15;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_HDL_OUT_OF_RANGE');
    expect(r.outOfRange).toEqual({
      field: 'labs.hdlMgDl',
      value: 15,
      min: 20,
      max: 150,
    });
  });

  it('SCORE2_HDL_OUT_OF_RANGE when hdl is above 150', () => {
    const i = validBaseInput();
    i.labs.hdlMgDl = 160;
    const r = evaluateScore2Eligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_HDL_OUT_OF_RANGE');
  });

  /* ─────────────── boundary acceptance ─────────────── */

  it('accepts age = 40 and age = 80 (inclusive bounds)', () => {
    const lo = validBaseInput(); lo.demographics.age = 40;
    const hi = validBaseInput(); hi.demographics.age = 80;
    expect(evaluateScore2Eligibility(lo).eligible).toBe(true);
    expect(evaluateScore2Eligibility(hi).eligible).toBe(true);
  });

  it('SCORE2_RANGES is the single source of truth (no drift)', () => {
    expect(SCORE2_RANGES.age).toEqual({ min: 40, max: 80 });
    expect(SCORE2_RANGES.sbpMmHg).toEqual({ min: 60, max: 250 });
    expect(SCORE2_RANGES.totalCholMgDl).toEqual({ min: 50, max: 400 });
    expect(SCORE2_RANGES.hdlMgDl).toEqual({ min: 20, max: 150 });
    expect(SCORE2_RANGES.hba1cPct).toEqual({ min: 3, max: 15 });
    expect(SCORE2_RANGES.eGFR).toEqual({ min: 15, max: 180 });
  });
});

/* ─────────────────────────── SCORE2-DM ──────────────────────── */

describe('evaluateScore2DiabetesEligibility', () => {
  it('SCORE2_DIABETES_NOT_APPLICABLE when patient is not flagged as diabetic', () => {
    const i = validBaseInput(); // hasDiabetes = false
    const r = evaluateScore2DiabetesEligibility(i);
    expect(r).toMatchObject({
      eligible: false,
      skipReason: 'SCORE2_DIABETES_NOT_APPLICABLE',
    });
    if (!r.eligible) expect(r.missingFields).toEqual([]);
  });

  it('eligible when diabetic + every input present and within range', () => {
    const r = evaluateScore2DiabetesEligibility(diabeticBaseInput());
    expect(r.eligible).toBe(true);
  });

  it('SCORE2_DIABETES_MISSING_INPUT lists every absent field', () => {
    const i = diabeticBaseInput();
    delete (i.labs as Partial<typeof i.labs>).totalCholMgDl;
    delete (i.labs as Partial<typeof i.labs>).hba1cPct;
    delete (i.labs as Partial<typeof i.labs>).eGFR;
    delete (i.clinicalContext as Partial<typeof i.clinicalContext>).ageAtDiabetesDiagnosis;
    const r = evaluateScore2DiabetesEligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_DIABETES_MISSING_INPUT');
    expect(r.missingFields).toEqual(
      expect.arrayContaining([
        'labs.totalCholMgDl',
        'labs.hba1cPct',
        'labs.eGFR',
        'clinicalContext.ageAtDiabetesDiagnosis',
      ]),
    );
  });

  it('SCORE2_DIABETES_AGE_OUT_OF_RANGE when age is below 40', () => {
    const i = diabeticBaseInput(); i.demographics.age = 35;
    const r = evaluateScore2DiabetesEligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_DIABETES_AGE_OUT_OF_RANGE');
    expect(r.outOfRange?.field).toBe('demographics.age');
  });

  it('SCORE2_DIABETES_AGE_OUT_OF_RANGE when age is above 80', () => {
    const i = diabeticBaseInput(); i.demographics.age = 85;
    const r = evaluateScore2DiabetesEligibility(i);
    if (r.eligible) throw new Error('expected ineligible');
    expect(r.skipReason).toBe('SCORE2_DIABETES_AGE_OUT_OF_RANGE');
  });

  it('SCORE2_DIABETES_SBP_OUT_OF_RANGE on extreme low and high', () => {
    const lo = diabeticBaseInput(); lo.vitals.sbpMmHg = 50;
    const hi = diabeticBaseInput(); hi.vitals.sbpMmHg = 260;
    const rLo = evaluateScore2DiabetesEligibility(lo);
    const rHi = evaluateScore2DiabetesEligibility(hi);
    if (rLo.eligible || rHi.eligible) throw new Error('expected ineligible');
    expect(rLo.skipReason).toBe('SCORE2_DIABETES_SBP_OUT_OF_RANGE');
    expect(rHi.skipReason).toBe('SCORE2_DIABETES_SBP_OUT_OF_RANGE');
  });

  it('SCORE2_DIABETES_TOTAL_CHOL_OUT_OF_RANGE on extreme low and high', () => {
    const lo = diabeticBaseInput(); lo.labs.totalCholMgDl = 30;
    const hi = diabeticBaseInput(); hi.labs.totalCholMgDl = 450;
    const rLo = evaluateScore2DiabetesEligibility(lo);
    const rHi = evaluateScore2DiabetesEligibility(hi);
    if (rLo.eligible || rHi.eligible) throw new Error('expected ineligible');
    expect(rLo.skipReason).toBe('SCORE2_DIABETES_TOTAL_CHOL_OUT_OF_RANGE');
    expect(rHi.skipReason).toBe('SCORE2_DIABETES_TOTAL_CHOL_OUT_OF_RANGE');
  });

  it('SCORE2_DIABETES_HDL_OUT_OF_RANGE on extreme low and high', () => {
    const lo = diabeticBaseInput(); lo.labs.hdlMgDl = 15;
    const hi = diabeticBaseInput(); hi.labs.hdlMgDl = 160;
    const rLo = evaluateScore2DiabetesEligibility(lo);
    const rHi = evaluateScore2DiabetesEligibility(hi);
    if (rLo.eligible || rHi.eligible) throw new Error('expected ineligible');
    expect(rLo.skipReason).toBe('SCORE2_DIABETES_HDL_OUT_OF_RANGE');
    expect(rHi.skipReason).toBe('SCORE2_DIABETES_HDL_OUT_OF_RANGE');
  });

  it('SCORE2_DIABETES_HBA1C_OUT_OF_RANGE on extreme low and high', () => {
    const lo = diabeticBaseInput(); lo.labs.hba1cPct = 2.5;
    const hi = diabeticBaseInput(); hi.labs.hba1cPct = 16;
    const rLo = evaluateScore2DiabetesEligibility(lo);
    const rHi = evaluateScore2DiabetesEligibility(hi);
    if (rLo.eligible || rHi.eligible) throw new Error('expected ineligible');
    expect(rLo.skipReason).toBe('SCORE2_DIABETES_HBA1C_OUT_OF_RANGE');
    expect(rHi.skipReason).toBe('SCORE2_DIABETES_HBA1C_OUT_OF_RANGE');
    expect(rLo.outOfRange).toEqual({
      field: 'labs.hba1cPct',
      value: 2.5,
      min: 3,
      max: 15,
    });
  });

  it('SCORE2_DIABETES_EGFR_OUT_OF_RANGE on extreme low and high', () => {
    const lo = diabeticBaseInput(); lo.labs.eGFR = 10;
    const hi = diabeticBaseInput(); hi.labs.eGFR = 200;
    const rLo = evaluateScore2DiabetesEligibility(lo);
    const rHi = evaluateScore2DiabetesEligibility(hi);
    if (rLo.eligible || rHi.eligible) throw new Error('expected ineligible');
    expect(rLo.skipReason).toBe('SCORE2_DIABETES_EGFR_OUT_OF_RANGE');
    expect(rHi.skipReason).toBe('SCORE2_DIABETES_EGFR_OUT_OF_RANGE');
    expect(rLo.outOfRange).toEqual({
      field: 'labs.eGFR',
      value: 10,
      min: 15,
      max: 180,
    });
  });
});

/* ─────────────────────────── skip-entry builders ────────────── */

describe('buildScore2SkipEntry', () => {
  it('produces a structured skip entry with valueNumeric=null + raw payload', () => {
    const inputCtx = { tenantId: 'demo', patientId: 'pt-1' };
    const entry = buildScore2SkipEntry(
      {
        eligible: false,
        skipReason: 'SCORE2_AGE_OUT_OF_RANGE',
        missingFields: [],
        outOfRange: { field: 'demographics.age', value: 35, min: 40, max: 80 },
      },
      inputCtx,
    );
    expect(entry).toMatchObject({
      scoreCode: 'SCORE2',
      valueNumeric: null,
      category: 'not_computable',
    });
    expect(entry.label).toMatch(/SCORE2/);
    expect(entry.inputPayload).toBe(inputCtx);
    const raw = entry.rawPayload as Record<string, unknown>;
    expect(raw.skipped).toBe(true);
    expect(raw.skipReason).toBe('SCORE2_AGE_OUT_OF_RANGE');
    expect(raw.missingFields).toEqual([]);
    expect(raw.outOfRange).toEqual({
      field: 'demographics.age',
      value: 35,
      min: 40,
      max: 80,
    });
  });

  it('passes outOfRange=null when the eligibility result has none', () => {
    const entry = buildScore2SkipEntry(
      {
        eligible: false,
        skipReason: 'SCORE2_MISSING_INPUT',
        missingFields: ['labs.totalCholMgDl'],
      },
      {},
    );
    const raw = entry.rawPayload as Record<string, unknown>;
    expect(raw.outOfRange).toBeNull();
    expect(raw.missingFields).toEqual(['labs.totalCholMgDl']);
  });
});

describe('buildScore2DiabetesSkipEntry', () => {
  it('produces a structured SCORE2_DIABETES skip entry', () => {
    const inputCtx = { foo: 1 };
    const entry = buildScore2DiabetesSkipEntry(
      {
        eligible: false,
        skipReason: 'SCORE2_DIABETES_NOT_APPLICABLE',
        missingFields: [],
      },
      inputCtx,
    );
    expect(entry).toMatchObject({
      scoreCode: 'SCORE2_DIABETES',
      valueNumeric: null,
      category: 'not_computable',
    });
    expect(entry.label).toMatch(/SCORE2-Diabetes/);
    expect(entry.inputPayload).toBe(inputCtx);
    const raw = entry.rawPayload as Record<string, unknown>;
    expect(raw.skipReason).toBe('SCORE2_DIABETES_NOT_APPLICABLE');
    expect(raw.outOfRange).toBeNull();
  });

  it('preserves outOfRange details when present', () => {
    const entry = buildScore2DiabetesSkipEntry(
      {
        eligible: false,
        skipReason: 'SCORE2_DIABETES_HBA1C_OUT_OF_RANGE',
        missingFields: [],
        outOfRange: { field: 'labs.hba1cPct', value: 16, min: 3, max: 15 },
      },
      {},
    );
    const raw = entry.rawPayload as Record<string, unknown>;
    expect(raw.skipReason).toBe('SCORE2_DIABETES_HBA1C_OUT_OF_RANGE');
    expect(raw.outOfRange).toEqual({
      field: 'labs.hba1cPct',
      value: 16,
      min: 3,
      max: 15,
    });
  });
});
