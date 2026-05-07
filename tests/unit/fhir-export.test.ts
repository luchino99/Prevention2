/**
 * fhir-export-service.ts unit tests — Sprint 3 task 3.6.
 *
 * Validates the structural correctness of the FHIR R4 Bundle produced
 * by `toFhirBundle()` against representative input shapes:
 *   - Patient resource emitted with correct gender mapping + identifiers
 *   - One Observation per measurement
 *   - One RiskAssessment per score result
 *   - One DiagnosticReport per assessment, linking child RiskAssessments
 *   - One Consent per consent record, with status mapped from
 *     granted/revoked_at
 *   - Bundle wrapper has type=collection, the gdpr-art20-portability
 *     tag, and a deterministic id derived from the patient id
 *
 * Pure-function service (no I/O), so no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import { toFhirBundle } from '../../backend/src/services/fhir-export-service.js';

const BASE_ENVELOPE = {
  format: 'uelfy.patient-export/v1',
  generatedAt: '2026-05-07T10:00:00.000Z',
  generatedBy: { userId: 'user-1', role: 'tenant_admin' },
  tenantId: 'tenant-A',
  patient: {
    id: 'patient-1',
    tenant_id: 'tenant-A',
    first_name: 'Mario',
    last_name: 'Rossi',
    date_of_birth: '1962-04-15',
    sex_assigned_at_birth: 'male',
    deleted_at: null,
  },
  clinicalProfile: null,
  assessments: [],
  scoreResults: [],
  measurements: [],
  consents: [],
};

describe('toFhirBundle', () => {
  it('emits a Bundle with type=collection and the GDPR Art.20 tag', () => {
    const b = toFhirBundle(BASE_ENVELOPE);
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('collection');
    expect(b.id).toBe('uelfy-export-patient-1');
    expect(b.timestamp).toBe('2026-05-07T10:00:00.000Z');

    const meta = b.meta as Record<string, unknown>;
    const tags = meta.tag as Array<Record<string, unknown>>;
    expect(tags).toHaveLength(1);
    expect(tags[0].code).toBe('gdpr-art20-portability');
  });

  it('includes a Patient resource with correct gender mapping', () => {
    const b = toFhirBundle(BASE_ENVELOPE);
    const entries = b.entry as Array<Record<string, unknown>>;
    const patientEntry = entries.find(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'Patient',
    );
    expect(patientEntry).toBeDefined();
    const p = patientEntry!.resource as Record<string, unknown>;
    expect(p.id).toBe('patient-1');
    expect(p.gender).toBe('male');
    expect(p.birthDate).toBe('1962-04-15');
    expect(p.active).toBe(true);
    const names = p.name as Array<Record<string, unknown>>;
    expect(names[0].family).toBe('Rossi');
    expect((names[0].given as string[])[0]).toBe('Mario');
  });

  it('Patient.gender = "unknown" when sex is missing or unrecognised', () => {
    const env = {
      ...BASE_ENVELOPE,
      patient: { ...BASE_ENVELOPE.patient, sex_assigned_at_birth: 'X' },
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    const p = (entries.find(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'Patient',
    )!.resource) as Record<string, unknown>;
    expect(p.gender).toBe('unknown');
  });

  it('Patient.active = false when soft-deleted', () => {
    const env = {
      ...BASE_ENVELOPE,
      patient: { ...BASE_ENVELOPE.patient, deleted_at: '2026-01-01T00:00:00Z' },
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    const p = (entries.find(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'Patient',
    )!.resource) as Record<string, unknown>;
    expect(p.active).toBe(false);
  });

  it('emits one Observation per measurement, with subject reference', () => {
    const env = {
      ...BASE_ENVELOPE,
      measurements: [
        { id: 'm1', measurement_type: 'systolic_bp', value_numeric: 142, unit: 'mmHg', measured_at: '2026-05-01T08:00:00Z' },
        { id: 'm2', measurement_type: 'hba1c', value_numeric: 6.8, unit: '%', measured_at: '2026-05-01T08:00:00Z' },
      ],
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    const obs = entries.filter(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'Observation',
    );
    expect(obs).toHaveLength(2);
    const o1 = obs[0].resource as Record<string, unknown>;
    expect(o1.id).toBe('m1');
    expect(o1.status).toBe('final');
    expect((o1.subject as Record<string, unknown>).reference).toBe('Patient/patient-1');
    expect((o1.valueQuantity as Record<string, unknown>).value).toBe(142);
    expect((o1.valueQuantity as Record<string, unknown>).unit).toBe('mmHg');
    expect(((o1.code as Record<string, unknown>).coding as Array<Record<string, unknown>>)[0].code).toBe('systolic_bp');
  });

  it('emits one RiskAssessment per score result, with subject reference', () => {
    const env = {
      ...BASE_ENVELOPE,
      scoreResults: [
        { id: 's1', assessment_id: 'a1', score_name: 'score2', score_numeric: 21.0, category: 'high', engine_version: '0.2.1', computed_at: '2026-05-01T09:00:00Z' },
      ],
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    const ra = entries.filter(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'RiskAssessment',
    );
    expect(ra).toHaveLength(1);
    const r = ra[0].resource as Record<string, unknown>;
    expect(r.id).toBe('s1');
    expect((r.subject as Record<string, unknown>).reference).toBe('Patient/patient-1');
    expect(((r.code as Record<string, unknown>).coding as Array<Record<string, unknown>>)[0].code).toBe('score2');
    const note = r.note as Array<Record<string, unknown>>;
    expect(note[0].text).toContain('0.2.1');
    const prediction = r.prediction as Array<Record<string, unknown>>;
    expect((prediction[0].outcome as Record<string, unknown>).text).toBe('high');
  });

  it('emits DiagnosticReport per assessment, linking child RiskAssessments via result[]', () => {
    const env = {
      ...BASE_ENVELOPE,
      assessments: [
        { id: 'a1', assessed_at: '2026-05-01T09:00:00Z', created_at: '2026-05-01T09:00:00Z' },
      ],
      scoreResults: [
        { id: 's1', assessment_id: 'a1', score_name: 'score2' },
        { id: 's2', assessment_id: 'a1', score_name: 'fib4' },
        { id: 's3', assessment_id: 'a-other', score_name: 'mets' },
      ],
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    const dr = entries.filter(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'DiagnosticReport',
    );
    expect(dr).toHaveLength(1);
    const r = dr[0].resource as Record<string, unknown>;
    expect(r.id).toBe('a1');
    const result = r.result as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0].reference).toBe('RiskAssessment/s1');
    expect(result[1].reference).toBe('RiskAssessment/s2');
  });

  it('Consent.status = active for granted, revoked', () => {
    const env = {
      ...BASE_ENVELOPE,
      consents: [
        { id: 'c1', consent_type: 'notifications', granted: true, revoked_at: null, granted_at: '2026-04-01T00:00:00Z', policy_version: '1.0.0' },
        { id: 'c2', consent_type: 'marketing', granted: true, revoked_at: '2026-05-01T00:00:00Z', granted_at: '2026-04-01T00:00:00Z', policy_version: '1.0.0' },
        { id: 'c3', consent_type: 'ai_processing', granted: false, revoked_at: null, granted_at: '2026-04-01T00:00:00Z', policy_version: '1.0.0' },
      ],
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    const consents = entries.filter(
      (e) => (e.resource as Record<string, unknown>).resourceType === 'Consent',
    );
    expect(consents).toHaveLength(3);
    const c1 = consents[0].resource as Record<string, unknown>;
    const c2 = consents[1].resource as Record<string, unknown>;
    const c3 = consents[2].resource as Record<string, unknown>;
    expect(c1.status).toBe('active');     // granted=true, revoked=null
    expect(c2.status).toBe('inactive');   // revoked_at set
    expect(c3.status).toBe('rejected');   // granted=false, never revoked
    // Subject reference
    expect((c1.patient as Record<string, unknown>).reference).toBe('Patient/patient-1');
  });

  it('handles an empty envelope (no measurements / scores / consents) — emits Bundle with only Patient', () => {
    const b = toFhirBundle(BASE_ENVELOPE);
    const entries = b.entry as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect((entries[0].resource as Record<string, unknown>).resourceType).toBe('Patient');
  });

  it('all emitted entries have a fullUrl with urn:uuid: prefix', () => {
    const env = {
      ...BASE_ENVELOPE,
      measurements: [{ id: 'm1', measurement_type: 'bp', value_numeric: 120 }],
      scoreResults: [{ id: 's1', score_name: 'score2', score_numeric: 5 }],
      assessments: [{ id: 'a1' }],
      consents: [{ id: 'c1', consent_type: 'notifications', granted: true }],
    };
    const b = toFhirBundle(env);
    const entries = b.entry as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.fullUrl as string).toMatch(/^urn:uuid:/);
    }
  });
});
