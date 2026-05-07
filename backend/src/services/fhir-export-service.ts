/**
 * fhir-export-service.ts — Sprint 3 task 3.6.
 *
 * Maps the proprietary `uelfy.patient-export/v1` envelope produced by
 * `api/v1/patients/[id]/export.ts` into a FHIR R4 Bundle suitable for
 * GDPR Article 20 (portability) — the patient receives their data in
 * an interoperable format that any FHIR-aware system (other clinic,
 * personal-health-record app, second-opinion provider) can ingest
 * without bespoke parsing.
 *
 * Why FHIR R4 (not USCDI, IPS, OpenEHR, …)
 * ----------------------------------------
 * R4 is the de-facto worldwide baseline (HL7 FHIR R4 published 2019,
 * stable, supported by every major EHR vendor). EU adoption is
 * mandated by the EHDS regulation roadmap and by the Italian
 * AGENAS / FSE 2.0 guidance for clinical interop. R5 exists but
 * tooling support is still partial as of 2026.
 *
 * Scope of this MVP mapping
 * -------------------------
 * Maps the FIVE resource types that GDPR Art.20 portability typically
 * needs for a clinical risk-assessment use case:
 *   * Patient                   (demographics)
 *   * Observation               (per measurement: vitals + labs)
 *   * RiskAssessment            (per score result: SCORE2, FIB-4, etc.)
 *   * DiagnosticReport          (per assessment: groups Observations + RiskAssessments)
 *   * Consent                   (per consent record)
 *
 * Wraps everything in a `Bundle` with type `collection` (loose grouping
 * suitable for portability — type `document` would require a
 * Composition resource which is out of scope for MVP).
 *
 * What is NOT mapped (intentional)
 * --------------------------------
 *   * AuditEvent (FHIR has a resource; we keep audit trail in the
 *     proprietary envelope only — it's not patient-portable data
 *     in the Art.20 sense, it's controller accountability data)
 *   * CarePlan from `followupPlans` (planned Sprint 5 — needs richer
 *     mapping of activities and timing)
 *   * Flag / DetectedIssue from `alerts` (planned Sprint 5)
 *   * Provenance (planned Sprint 5 — useful but not required for
 *     Art.20)
 *
 * The proprietary `uelfy.patient-export/v1` envelope continues to be
 * available at the same endpoint (default format) for callers who
 * need the full audit trail and the raw clinical-profile shape; FHIR
 * is the OPT-IN format requested via `?format=fhir`.
 *
 * Determinism
 * -----------
 * Uses string template substitution instead of `randomUUID` for
 * Bundle.entry.fullUrl to keep the export deterministic-ish (same
 * envelope → same FHIR Bundle ignoring `meta.lastUpdated`). This
 * matters for diff-based audit and for the patient who re-runs the
 * export: minor noise should be limited to timestamps.
 *
 * Standards references
 * --------------------
 *   * HL7 FHIR R4: https://hl7.org/fhir/R4/
 *   * RiskAssessment: https://hl7.org/fhir/R4/riskassessment.html
 *   * Bundle: https://hl7.org/fhir/R4/bundle.html
 *   * Italian profile (FSE 2.0): https://www.fascicolosanitario.gov.it/
 */

// FHIR resource types are intentionally typed as `Record<string, unknown>`
// to avoid pulling in a multi-MB types package (e.g. @types/fhir would
// add ~50k LoC). The shape is validated by the Validator + Inspector
// tools at https://validator.fhir.org/ when the patient consumes the
// export. We hand-curate the keys that matter for portability.

type AnyRecord = Record<string, unknown>;

interface UelfyExportEnvelope {
  format: string;
  generatedAt: string;
  generatedBy: { userId: string; role: string };
  tenantId: string;
  patient: AnyRecord;
  clinicalProfile: AnyRecord | null;
  assessments: AnyRecord[];
  scoreResults: AnyRecord[];
  measurements: AnyRecord[];
  consents: AnyRecord[];
  // Other arrays (alerts, followupPlans, reportExports, auditTrail)
  // are present but not consumed by the MVP FHIR mapping.
  [key: string]: unknown;
}

/**
 * Map the proprietary envelope to a FHIR R4 Bundle.
 *
 * @param envelope the result of the existing patient export query
 * @returns a FHIR R4 Bundle JSON object (Record<string, unknown>)
 */
export function toFhirBundle(envelope: UelfyExportEnvelope): AnyRecord {
  const patientId = String(envelope.patient.id ?? 'unknown');
  const tenantId = String(envelope.tenantId);

  // Build the resources array.
  const entries: AnyRecord[] = [];

  // 1. Patient resource (demographics)
  entries.push({
    fullUrl: `urn:uuid:${patientId}`,
    resource: mapPatient(envelope.patient, tenantId),
  });

  // 2. Observation resources (one per measurement)
  for (const m of envelope.measurements ?? []) {
    const obsId = String(m.id ?? `meas-${entries.length}`);
    entries.push({
      fullUrl: `urn:uuid:${obsId}`,
      resource: mapObservation(m, patientId),
    });
  }

  // 3. RiskAssessment resources (one per score result)
  for (const s of envelope.scoreResults ?? []) {
    const raId = String(s.id ?? `risk-${entries.length}`);
    entries.push({
      fullUrl: `urn:uuid:${raId}`,
      resource: mapRiskAssessment(s, patientId),
    });
  }

  // 4. DiagnosticReport resources (one per assessment header)
  for (const a of envelope.assessments ?? []) {
    const drId = String(a.id ?? `dr-${entries.length}`);
    entries.push({
      fullUrl: `urn:uuid:${drId}`,
      resource: mapDiagnosticReport(a, patientId, envelope.scoreResults ?? []),
    });
  }

  // 5. Consent resources
  for (const c of envelope.consents ?? []) {
    const consId = String(c.id ?? `cons-${entries.length}`);
    entries.push({
      fullUrl: `urn:uuid:${consId}`,
      resource: mapConsent(c, patientId),
    });
  }

  return {
    resourceType: 'Bundle',
    id: `uelfy-export-${patientId}`,
    type: 'collection',
    timestamp: envelope.generatedAt,
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Bundle'],
      tag: [
        {
          system: 'https://uelfy.com/fhir/tag',
          code: 'gdpr-art20-portability',
          display: 'GDPR Article 20 portability export',
        },
      ],
    },
    entry: entries,
  };
}

// ---------------------------------------------------------------------------
// Resource mappers — one per FHIR resource type.
// Each is a pure function; no I/O, no exceptions on missing optional fields.
// ---------------------------------------------------------------------------

function mapPatient(p: AnyRecord, tenantId: string): AnyRecord {
  const sex = pickStr(p.sex_assigned_at_birth) ?? pickStr(p.sex) ?? null;
  const fhirGender =
    sex === 'male' ? 'male' :
    sex === 'female' ? 'female' :
    sex === 'other' ? 'other' :
    'unknown';
  const givenName = pickStr(p.first_name) ?? pickStr(p.given_name);
  const familyName = pickStr(p.last_name) ?? pickStr(p.family_name);
  const dob = pickStr(p.date_of_birth) ?? pickStr(p.dob) ?? null;

  const name: AnyRecord[] = [];
  if (givenName || familyName) {
    name.push({
      use: 'official',
      ...(familyName ? { family: familyName } : {}),
      ...(givenName ? { given: [givenName] } : {}),
    });
  }

  return {
    resourceType: 'Patient',
    id: String(p.id),
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
      tag: [{ system: 'https://uelfy.com/fhir/tenant', code: tenantId }],
    },
    identifier: [
      {
        system: 'https://uelfy.com/fhir/identifier/patient',
        value: String(p.id),
      },
    ],
    active: p.deleted_at == null,
    ...(name.length ? { name } : {}),
    gender: fhirGender,
    ...(dob ? { birthDate: dob.slice(0, 10) } : {}),
  };
}

function mapObservation(m: AnyRecord, patientId: string): AnyRecord {
  // Heuristic mapping: the legacy schema names the field `measurement_type`
  // (e.g. 'systolic_bp', 'hba1c') and `value_numeric`. We pass through
  // both as a `code` text + `valueQuantity` if numeric. A future
  // refinement can map to LOINC codes per measurement type.
  const measType = pickStr(m.measurement_type) ?? pickStr(m.kind) ?? 'unknown';
  const valueNum = pickNum(m.value_numeric) ?? pickNum(m.value);
  const unit = pickStr(m.unit) ?? null;

  return {
    resourceType: 'Observation',
    id: String(m.id),
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Observation'],
    },
    status: 'final',
    code: {
      text: measType,
      coding: [
        {
          system: 'https://uelfy.com/fhir/code/measurement',
          code: measType,
          display: measType,
        },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    ...(typeof m.measured_at === 'string' ? { effectiveDateTime: m.measured_at } : {}),
    ...(valueNum != null
      ? { valueQuantity: { value: valueNum, ...(unit ? { unit, code: unit } : {}) } }
      : {}),
  };
}

function mapRiskAssessment(s: AnyRecord, patientId: string): AnyRecord {
  // `s.score_name` ∈ {'score2', 'score2_diabetes', 'fib4', 'fli',
  // 'ckd_epi', 'frail', 'mets', 'predimed', 'bmr_tdee', 'bmi'}
  const scoreName = pickStr(s.score_name) ?? 'unknown';
  const scoreValue = pickNum(s.score_numeric) ?? pickNum(s.value);
  const category = pickStr(s.category) ?? null;
  const engineVersion = pickStr(s.engine_version) ?? null;

  return {
    resourceType: 'RiskAssessment',
    id: String(s.id),
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/RiskAssessment'],
    },
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    code: {
      text: scoreName,
      coding: [
        {
          system: 'https://uelfy.com/fhir/code/risk-score',
          code: scoreName,
          display: scoreName,
        },
      ],
    },
    ...(typeof s.computed_at === 'string' ? { occurrenceDateTime: s.computed_at } : {}),
    ...(scoreValue != null || category
      ? {
          prediction: [
            {
              ...(category
                ? { outcome: { text: category } }
                : {}),
              ...(scoreValue != null
                ? { qualitativeRisk: { text: String(scoreValue) } }
                : {}),
            },
          ],
        }
      : {}),
    ...(engineVersion
      ? {
          note: [
            {
              text: `Computed by Uelfy clinical engine version ${engineVersion}.`,
            },
          ],
        }
      : {}),
  };
}

function mapDiagnosticReport(
  a: AnyRecord,
  patientId: string,
  scoreResults: AnyRecord[],
): AnyRecord {
  // Group RiskAssessments belonging to this assessment by foreign key.
  const childRisks = scoreResults
    .filter((s) => String(s.assessment_id ?? '') === String(a.id))
    .map((s) => ({ reference: `RiskAssessment/${s.id}` }));

  return {
    resourceType: 'DiagnosticReport',
    id: String(a.id),
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/DiagnosticReport'],
    },
    status: 'final',
    code: {
      text: 'Cardio-nephro-metabolic risk assessment',
      coding: [
        {
          system: 'https://uelfy.com/fhir/code/report-type',
          code: 'cnm-risk-assessment',
          display: 'Cardio-nephro-metabolic risk assessment',
        },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    ...(typeof a.assessed_at === 'string'
      ? { effectiveDateTime: a.assessed_at }
      : typeof a.created_at === 'string'
        ? { effectiveDateTime: a.created_at }
        : {}),
    ...(typeof a.created_at === 'string' ? { issued: a.created_at } : {}),
    ...(childRisks.length ? { result: childRisks } : {}),
  };
}

function mapConsent(c: AnyRecord, patientId: string): AnyRecord {
  // FHIR Consent.status ∈ {draft, proposed, active, rejected, inactive, entered-in-error}
  const granted = c.granted === true;
  const revokedAt = pickStr(c.revoked_at);
  const status: string = revokedAt ? 'inactive' : granted ? 'active' : 'rejected';
  const consentType = pickStr(c.consent_type) ?? 'unknown';

  return {
    resourceType: 'Consent',
    id: String(c.id),
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Consent'],
    },
    status,
    scope: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'patient-privacy',
          display: 'Privacy Consent',
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: 'https://uelfy.com/fhir/code/consent-type',
            code: consentType,
            display: consentType,
          },
        ],
      },
    ],
    patient: { reference: `Patient/${patientId}` },
    ...(typeof c.granted_at === 'string' ? { dateTime: c.granted_at } : {}),
    ...(c.policy_version ? { policy: [{ uri: String(c.policy_url ?? c.policy_version) }] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers — defensive coercion to keep the mapper resilient to NULL /
// missing fields without throwing. A truly missing value renders as
// `null` (excluded from the FHIR resource via the spread idiom).
// ---------------------------------------------------------------------------

function pickStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
