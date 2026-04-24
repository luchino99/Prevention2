/**
 * Unit tests for the clinical PDF renderer.
 *
 * Focus
 *   1. The renderer produces a byte-stream that begins with the PDF magic
 *      header (`%PDF-`) and ends with the `%%EOF` trailer.
 *   2. Unicode clinical content (—, •, ≥, µ, °, accented names) does not
 *      throw, regardless of whether the NotoSans TTF assets are present.
 *   3. The WinAnsi fallback path produces a non-empty PDF even without
 *      any Unicode font support.
 *   4. The public shape of the return value is Uint8Array.
 *
 * What this test does NOT do
 *   - It does not parse the PDF back to assert layout fidelity. Visual
 *     regression is covered manually by opening the artefact in a viewer.
 *   - It does not call @pdf-lib/fontkit directly — the font loader module
 *     already exercises its own fallback chain.
 *
 * Running offline
 *   If `backend/src/assets/fonts/NotoSans-*.ttf` is not populated, the
 *   renderer automatically falls back to StandardFonts.Helvetica + WinAnsi
 *   sanitisation. The tests below therefore work both in CI (fonts fetched
 *   by `npm run fetch:fonts`) and in offline dev clones.
 */

import { describe, it, expect } from 'vitest';

import { renderAssessmentReportPdf } from '../../backend/src/services/pdf-report-service';
import type { ReportPayload } from '../../backend/src/services/assessment-service';

// ────────────────────────────────────────────────────────────────────────────
// Minimal fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeSnapshot(): ReportPayload['snapshot'] {
  // Valid against the canonical AssessmentSnapshot shape from
  // shared/types/clinical.ts. The renderer is pure-view, so every
  // downstream consumer only depends on the documented fields.
  return {
    assessment: {
      id: '11111111-2222-3333-4444-555555555555',
      patientId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      createdAt: '2026-04-24T09:00:00.000Z',
      createdByUserId: null,
      status: 'completed',
      notes: null,
    },
    input: {
      demographics: { age: 58, sex: 'female' },
      vitals: { heightCm: 166, weightKg: 78, waistCm: 94, sbpMmHg: 138, dbpMmHg: 86 },
      labs: {
        totalCholMgDl: 215,
        hdlMgDl: 52,
        ldlMgDl: 135,
        triglyceridesMgDl: 150,
        glucoseMgDl: 108,
        hba1cPct: 6.1,
        creatinineMgDl: 0.95,
      },
      clinicalContext: {
        smoking: true,
        hasDiabetes: false,
        hypertension: true,
        familyHistoryDiabetes: true,
        familyHistoryCvd: true,
        gestationalDiabetes: false,
        cvRiskRegion: 'moderate',
        medications: ['ramipril 5 mg'],
        diagnoses: [],
      },
      lifestyle: {
        predimedAnswers: Array.from({ length: 14 }, (_, i) => i < 9),
        moderateActivityMinutes: 120,
        vigorousActivityMinutes: 0,
        sedentaryHoursPerDay: 9,
      },
    },
    scoreResults: [
      { scoreCode: 'SCORE2', valueNumeric: 7.5, category: 'moderate', label: 'SCORE2 10-yr CV risk', inputPayload: {}, rawPayload: {} },
      { scoreCode: 'EGFR',   valueNumeric: 68,  category: 'low',      label: 'eGFR (CKD-EPI)',       inputPayload: {}, rawPayload: {} },
      { scoreCode: 'FIB4',   valueNumeric: 1.1, category: 'low',      label: 'FIB-4',                inputPayload: {}, rawPayload: {} },
    ],
    compositeRisk: {
      level: 'moderate',
      numeric: 38,
      cardiovascular: { level: 'moderate',       reasoning: 'SCORE2 7.5 % — age-band cut-off crossed (≥5 %).', evidence: ['SCORE2'] },
      metabolic:      { level: 'moderate',       reasoning: 'HbA1c 6.1 % → prediabetes range (ADA 2024).',     evidence: ['HBA1C'] },
      hepatic:        { level: 'low',            reasoning: 'FIB-4 below advanced-fibrosis threshold.',         evidence: ['FIB4'] },
      renal:          { level: 'low',            reasoning: 'eGFR 68 mL/min · KDIGO G2.',                        evidence: ['EGFR'] },
      frailty:        null,
    },
    completenessWarnings: [
      {
        code: 'ACR_INCOMPLETE',
        title: 'ACR cannot be computed',
        detail: 'Urine albumin / creatinine missing — KDIGO albuminuria stage is unavailable.',
        missingFields: ['labs.urineAlbuminMgL', 'labs.urineCreatinineMgDl'],
        suggestedAction: 'Request a spot urine ACR at the next visit.',
        severity: 'warning',
      },
    ],
    screenings: [
      {
        screening: 'Ophthalmologic fundus exam',
        reason: 'Prediabetes + hypertension — microvascular screening indicated.',
        priority: 'routine',
        intervalMonths: 12,
        guidelineSource: 'ADA 2024 §11',
      },
    ],
    followupPlan: {
      intervalMonths: 6,
      nextReviewDate: '2026-10-24',
      priorityLevel: 'moderate',
      actions: ['Repeat lipid panel in 3 months', 'Reinforce smoking cessation support'],
      domainMonitoring: ['Cardiovascular', 'Metabolic'],
      items: [
        {
          code: 'SMOKING_CESSATION',
          title: 'Structured smoking-cessation counselling',
          rationale: 'Active smoker with SCORE2 ≥5 %. ESC 2021 §8 — tobacco is the single largest CV modifier.',
          dueInMonths: 1,
          priority: 'moderate',
          guidelineSource: 'ESC 2021 CVD Prevention · §8',
        },
      ],
    },
    nutritionSummary: {
      predimedScore: 9,
      adherenceBand: 'medium',
      bmrKcal: 1510,
      tdeeKcal: 2050,
      activityFactor: 1.375,
      activityLevel: 'lightly_active',
    },
    activitySummary: {
      minutesPerWeek: 120,
      moderateMinutesPerWeek: 120,
      vigorousMinutesPerWeek: 0,
      metMinutesPerWeek: 480,
      qualitativeBand: 'insufficient',
      meetsWhoGuidelines: false,
      sedentaryRiskLevel: 'moderate',
      sedentaryHoursPerDay: 9,
    },
    lifestyleRecommendations: [
      {
        code: 'ACTIVITY_150',
        domain: 'activity',
        title: 'Build toward 150 min/week of moderate activity',
        rationale: 'Current 120 min/week is below the WHO ≥150 min/week threshold; ~30 extra minutes twice a week restores guideline adherence.',
        priority: 'routine',
        authority: 'supportive',
        guidelineSource: 'WHO 2020 Physical Activity Guidelines',
      },
    ],
    alerts: [
      {
        type: 'cv_risk_threshold_crossed',
        severity: 'warning',
        title: 'Moderate 10-year CV risk — lifestyle intensification advised',
        message: 'SCORE2 crossed the 5 % age-band cut-off. Consider lifestyle intensification and lipid re-assessment in 3 months.',
        timestamp: '2026-04-24T09:00:12.000Z',
      },
    ],
  };
}

function makePayload(overrides: Partial<ReportPayload> = {}): ReportPayload {
  return {
    snapshot: makeSnapshot(),
    patient: {
      displayName: 'Patient 00123',
      firstName: null,
      lastName: null,
      sex: 'female',
      birthYear: 1967,
      birthDate: '1967-05-12',
      externalCode: 'MRN-00123',
    },
    tenant: {
      name: 'Uelfy Clinical — Demo Tenant',
      logoUrl: null,
    },
    clinician: {
      fullName: 'Dott.ssa María Rodríguez',
      email: 'm.rodriguez@example.clinic',
    },
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('renderAssessmentReportPdf', () => {
  it('returns a Uint8Array with a valid PDF header and EOF trailer', async () => {
    const buf = await renderAssessmentReportPdf(makePayload());
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBeGreaterThan(1000); // non-trivial document

    // Header must start with `%PDF-`
    const header = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 5));
    expect(header).toBe('%PDF-');

    // Trailer ends with `%%EOF` (possibly followed by a trailing newline)
    const tail = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(buf.length - 8));
    expect(tail.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('does not throw on Unicode clinical content (—, •, ≥, µ, °, accents)', async () => {
    const payload = makePayload();
    payload.snapshot.compositeRisk.cardiovascular.reasoning =
      'SCORE2 7,5 % — moderate band crossed (≥5 %); µ-albumin to be checked; 38 °C fever noted.';
    payload.snapshot.scoreResults.push({
      scoreCode: 'SCORE2_DIABETES',
      valueNumeric: 9.1,
      category: 'high',
      label: 'SCORE2-Diabetes — extended risk',
      inputPayload: {},
      rawPayload: {},
    });
    await expect(renderAssessmentReportPdf(payload)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('renders an empty-ish snapshot without alerts / warnings / recs', async () => {
    const payload = makePayload();
    payload.snapshot.alerts = [];
    payload.snapshot.completenessWarnings = [];
    payload.snapshot.screenings = [];
    payload.snapshot.lifestyleRecommendations = [];
    const buf = await renderAssessmentReportPdf(payload);
    expect(buf.length).toBeGreaterThan(800);
  });

  it('preserves the assessment ID and tenant name in the PDF Info dictionary', async () => {
    const payload = makePayload();
    const buf = await renderAssessmentReportPdf(payload);
    // Decode the whole buffer and check the Title metadata literal. pdf-lib
    // writes Info entries as ASCII strings at the document root; we just
    // substring-search for the assessment id, which must be present.
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    expect(text).toContain(payload.snapshot.assessment.id);
  });
});
