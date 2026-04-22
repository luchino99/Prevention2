/**
 * Assessment Service — the clinical orchestrator.
 *
 * Wraps the deterministic pure-function clinical engine and persists its
 * outputs into the B2B multi-tenant schema.
 *
 * Pipeline (blueprint §6.2):
 *   1. validate input  — done at the route layer (Zod)
 *   2. authorize      — caller must have clinical-write rights on the patient
 *   3. compute         — run the full engine BEFORE any DB write
 *   4. persist         — assessments + measurements + score_results + risk_profile
 *                        + nutrition_snapshot + activity_snapshot + followup_plan
 *                        + alerts, in best-effort ordering
 *   5. audit           — record the action against audit_events
 *
 * The service returns an AssessmentSnapshot so the route layer can reply in a
 * single round-trip and the PDF service can consume the same object.
 *
 * Determinism / safety:
 *   - No validated score formula is touched here. Only engine orchestration.
 *   - All derived logic (risk aggregation, alerts, follow-up) is called
 *     through the shared pure-function engine.
 *   - The full canonical input is persisted into
 *     `assessments.clinical_input_snapshot` (added in migration 003) so the
 *     computation is exactly reproducible.
 */

import { supabaseAdmin } from '../config/supabase.js';
import type { AuthContext } from '../middleware/auth-middleware.js';
import { recordAudit } from '../audit/audit-logger.js';

import { computeAllScores } from '../domain/clinical/score-engine/index.js';
import { aggregateCompositeRisk } from '../domain/clinical/risk-aggregation/composite-risk.js';
import { buildNutritionSummary } from '../domain/clinical/nutrition-engine/predimed.js';
import { assessActivity } from '../domain/clinical/activity-engine/activity-assessment.js';
import { deriveAlerts } from '../domain/clinical/alert-engine/alert-deriver.js';
import { determineRequiredScreenings } from '../domain/clinical/screening-engine/required-screenings.js';
import { determineFollowupPlan } from '../domain/clinical/followup-engine/followup-plan.js';

import type {
  AssessmentInput,
  AssessmentSnapshot,
  ScoreResultEntry,
} from '../../../shared/types/clinical.js';

// ============================================================================
// Errors
// ============================================================================

export class AssessmentServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AssessmentServiceError';
  }
}

/**
 * Map a Supabase/PostgREST insert error into a crisp `AssessmentServiceError`.
 *
 * The generic "DB_ERROR" bucket hides the two most common operational
 * failures (missing migration, RLS misconfiguration). Detecting them
 * explicitly gives the clinician an actionable message instead of a blank
 * 500, and lets Vercel logs retain the full PostgREST payload for
 * post-mortem.
 */
function classifyAssessmentInsertError(
  assessErr: { message?: string; code?: string; details?: string; hint?: string } | null,
): AssessmentServiceError {
  const msg = assessErr?.message ?? '';
  const pgCode = assessErr?.code ?? '';

  // PostgREST schema-cache / missing column signals. When migration 003
  // was not applied to the target database, the `clinical_input_snapshot`
  // column does not exist and we surface a targeted message so ops can
  // fix it in one step.
  const isSchemaCacheMiss =
    pgCode === 'PGRST204' ||
    /Could not find the '?clinical_input_snapshot'? column/i.test(msg) ||
    /column .*clinical_input_snapshot.* does not exist/i.test(msg);

  if (isSchemaCacheMiss) {
    return new AssessmentServiceError(
      500,
      'MIGRATION_REQUIRED',
      'Database migration 003 (clinical_input_snapshot) is not applied to this project. '
        + 'Run supabase/migrations/003_retention_anonymization_snapshot.sql on the target database.',
      { pgCode, pgMessage: msg, hint: assessErr?.hint, details: assessErr?.details },
    );
  }

  return new AssessmentServiceError(
    500,
    'ASSESSMENT_INSERT_FAILED',
    `Failed to create assessment: ${msg || 'unknown'}`,
    { pgCode, pgMessage: msg, hint: assessErr?.hint, details: assessErr?.details },
  );
}

// ============================================================================
// Authorization (defence-in-depth on top of RLS)
// ============================================================================

/**
 * Ensure the caller has clinical-write access to the patient:
 *  - patient must belong to the caller's tenant, AND
 *  - clinicians must also have an active professional_patient_links row,
 *  - assistant_staff and patient roles may not write clinical assessments.
 */
async function assertCanWritePatient(
  auth: AuthContext,
  patientId: string,
): Promise<{ tenant_id: string }> {
  if (auth.role === 'assistant_staff' || auth.role === 'patient') {
    throw new AssessmentServiceError(
      403,
      'INSUFFICIENT_ROLE',
      'Role cannot create assessments',
    );
  }

  const { data: patient, error } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id, is_active')
    .eq('id', patientId)
    .maybeSingle();

  if (error) {
    throw new AssessmentServiceError(500, 'DB_ERROR', error.message);
  }
  if (!patient) {
    throw new AssessmentServiceError(
      404,
      'PATIENT_NOT_FOUND',
      'Patient not found',
    );
  }
  if (patient.is_active === false) {
    throw new AssessmentServiceError(
      410,
      'PATIENT_INACTIVE',
      'Patient is inactive',
    );
  }
  if (auth.role !== 'platform_admin' && patient.tenant_id !== auth.tenantId) {
    throw new AssessmentServiceError(
      403,
      'CROSS_TENANT_FORBIDDEN',
      'Patient not in your tenant',
    );
  }

  if (auth.role === 'clinician') {
    const { data: link, error: linkErr } = await supabaseAdmin
      .from('professional_patient_links')
      .select('id')
      .eq('professional_user_id', auth.userId)
      .eq('patient_id', patientId)
      .eq('is_active', true)
      .maybeSingle();

    // Distinguish "table/migration missing" from "no link row". Without
    // this, a missing migration 005 would masquerade as NO_PATIENT_LINK
    // and send ops on a wild goose chase. PostgREST returns PGRST205 /
    // "could not find the table" in that case.
    if (linkErr) {
      const code = (linkErr as any).code as string | undefined;
      const msg = linkErr.message ?? '';
      const isMissingTable =
        code === 'PGRST205' ||
        /relation .*professional_patient_links.* does not exist/i.test(msg) ||
        /Could not find the table '?public\.professional_patient_links'?/i.test(msg);
      if (isMissingTable) {
        throw new AssessmentServiceError(
          500,
          'MIGRATION_REQUIRED',
          'Database migration 005 (professional_patient_links) is not applied. '
            + 'Run supabase/migrations/005_professional_patient_links.sql on the target database.',
          { pgCode: code, pgMessage: msg },
        );
      }
      throw new AssessmentServiceError(500, 'DB_ERROR', msg, { pgCode: code });
    }

    if (!link) {
      throw new AssessmentServiceError(
        403,
        'NO_PATIENT_LINK',
        'You are not linked to this patient. Ask a tenant admin to assign the patient to you.',
      );
    }
  }

  return { tenant_id: patient.tenant_id };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Identify which clinically important inputs are missing from the assessment.
 * Feeds the alert-deriver so the clinician is nudged to collect them.
 */
function computeMissingDataFlags(input: AssessmentInput): string[] {
  const flags: string[] = [];
  if (input.labs.totalCholMgDl == null) flags.push('totalCholMgDl');
  if (input.labs.hdlMgDl == null) flags.push('hdlMgDl');
  if (input.vitals.sbpMmHg == null) flags.push('sbpMmHg');
  if (input.labs.creatinineMgDl == null && input.labs.eGFR == null) {
    flags.push('creatinineMgDl');
  }
  if (input.labs.glucoseMgDl == null && input.labs.hba1cPct == null) {
    flags.push('glucoseMgDl');
  }
  return flags;
}

function findScore(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

function bestEffort(
  label: string,
  // PostgREST query builders returned by `supabase.from(...).insert(...)` are
  // `PromiseLike`, not full `Promise` (they lack `.catch` / `.finally` /
  // `Symbol.toStringTag`). Accepting `PromiseLike<unknown>` keeps the call
  // sites free of `Promise.resolve(...)` wrappers while still triggering
  // execution via the wrapper below.
  fn: () => PromiseLike<unknown>,
): Promise<void> {
  return Promise.resolve(fn()).then(
    () => undefined,
    (err: unknown) => {
      // Non-fatal subsystem failures are logged so the caller still gets a
      // snapshot; the assessment itself is already committed.
      // eslint-disable-next-line no-console
      console.error(`[assessment-service] ${label} failed`, err);
    },
  );
}

// ============================================================================
// Core: createAssessment
// ============================================================================

export async function createAssessment(
  auth: AuthContext,
  patientId: string,
  input: AssessmentInput,
): Promise<AssessmentSnapshot> {
  const { tenant_id } = await assertCanWritePatient(auth, patientId);

  // ─── 1. Run the deterministic engine BEFORE any DB write ───
  const scoreResults = computeAllScores(input);
  const compositeRisk = aggregateCompositeRisk(scoreResults);

  const nutrition = buildNutritionSummary({
    predimedAnswers: input.lifestyle.predimedAnswers,
    weightKg: input.vitals.weightKg,
    heightCm: input.vitals.heightCm,
    age: input.demographics.age,
    sex: input.demographics.sex,
    activityLevel: input.lifestyle.intensityLevel ?? undefined,
  });

  const activity = assessActivity({
    minutesPerWeek: input.lifestyle.weeklyActivityMinutes ?? undefined,
    frequency: input.lifestyle.activityFrequency ?? undefined,
    activityType: input.lifestyle.activityType ?? undefined,
    intensityLevel: input.lifestyle.intensityLevel ?? undefined,
  });

  const screenings = determineRequiredScreenings({
    age: input.demographics.age,
    sex: input.demographics.sex,
    scoreResults,
    diagnoses: input.clinicalContext.diagnoses ?? [],
  });

  const missingDataFlags = computeMissingDataFlags(input);

  const followupPlan = determineFollowupPlan({
    compositeRisk,
    scoreResults,
    missingDataFlags,
  });

  const alerts = deriveAlerts({
    currentScoreResults: scoreResults,
    compositeRisk,
    followupPlan,
    missingDataFlags,
  });

  // ─── 2. Persist assessment header ───
  const { data: assessmentRow, error: assessErr } = await supabaseAdmin
    .from('assessments')
    .insert({
      tenant_id,
      patient_id: patientId,
      assessed_by: auth.userId,
      status: 'completed',
      completed_at: new Date().toISOString(),
      engine_version: '1.0.0',
      clinical_input_snapshot: input, // added by migration 003
    })
    .select('id, created_at, assessment_date, status')
    .single();

  if (assessErr || !assessmentRow) {
    // Log the full PostgREST error server-side so ops can see pgCode + hint
    // without leaking them to unauthenticated callers.
    // eslint-disable-next-line no-console
    console.error('[assessment-service] assessments.insert failed', assessErr);
    throw classifyAssessmentInsertError(assessErr as any);
  }
  const assessmentId: string = assessmentRow.id as string;

  // ─── 3. Persist normalized assessment_measurements ───
  const bmiScore = findScore(scoreResults, 'BMI');
  await bestEffort('assessment_measurements', () =>
    supabaseAdmin.from('assessment_measurements').insert({
      assessment_id: assessmentId,
      height_cm: input.vitals.heightCm,
      weight_kg: input.vitals.weightKg,
      bmi: bmiScore?.valueNumeric ?? null,
      waist_cm: input.vitals.waistCm,
      sbp: input.vitals.sbpMmHg,
      dbp: input.vitals.dbpMmHg,
      total_chol_mgdl: input.labs.totalCholMgDl ?? null,
      hdl_mgdl: input.labs.hdlMgDl ?? null,
      ldl_mgdl: input.labs.ldlMgDl ?? null,
      triglycerides_mgdl: input.labs.triglyceridesMgDl ?? null,
      glucose_mgdl: input.labs.glucoseMgDl ?? null,
      hba1c_pct: input.labs.hba1cPct ?? null,
      egfr: input.labs.eGFR ?? null,
      creatinine_mgdl: input.labs.creatinineMgDl ?? null,
      albumin_creatinine_ratio: input.labs.albuminCreatinineRatio ?? null,
      ggt: input.labs.ggtUL ?? null,
      ast: input.labs.astUL ?? null,
      alt: input.labs.altUL ?? null,
      platelets: input.labs.plateletsGigaL ?? null,
    }),
  );

  // ─── 4. Persist score_results ───
  if (scoreResults.length > 0) {
    const scoreRows = scoreResults.map((s) => ({
      assessment_id: assessmentId,
      score_code: s.scoreCode.toLowerCase(),
      value_numeric: s.valueNumeric,
      category: s.category,
      label: s.label,
      input_payload: s.inputPayload,
      raw_payload: s.rawPayload,
      engine_version: '1.0.0',
    }));
    await bestEffort('score_results', () =>
      supabaseAdmin.from('score_results').insert(scoreRows),
    );
  }

  // ─── 5. Risk profile ───
  await bestEffort('risk_profiles', () =>
    supabaseAdmin.from('risk_profiles').insert({
      assessment_id: assessmentId,
      composite_risk_level: compositeRisk.level,
      composite_score: compositeRisk.numeric,
      cardiovascular_risk: compositeRisk.cardiovascular.level,
      metabolic_risk: compositeRisk.metabolic.level,
      hepatic_risk: compositeRisk.hepatic.level,
      renal_risk: compositeRisk.renal.level,
      frailty_risk: compositeRisk.frailty?.level ?? null,
      summary_json: {
        cardiovascular: compositeRisk.cardiovascular,
        metabolic: compositeRisk.metabolic,
        hepatic: compositeRisk.hepatic,
        renal: compositeRisk.renal,
        frailty: compositeRisk.frailty,
      },
      action_flags: alerts
        .filter((a) => a.severity === 'critical')
        .map((a) => ({ type: a.type, title: a.title })),
    }),
  );

  // ─── 6. Nutrition snapshot ───
  await bestEffort('nutrition_snapshots', () =>
    supabaseAdmin.from('nutrition_snapshots').insert({
      assessment_id: assessmentId,
      predimed_score: nutrition.predimedScore,
      predimed_answers: input.lifestyle.predimedAnswers ?? null,
      adherence_band: nutrition.adherenceBand,
      bmr_kcal: nutrition.bmrKcal,
      tdee_kcal: nutrition.tdeeKcal,
      activity_factor: nutrition.activityFactor,
    }),
  );

  // ─── 7. Activity snapshot ───
  await bestEffort('activity_snapshots', () =>
    supabaseAdmin.from('activity_snapshots').insert({
      assessment_id: assessmentId,
      minutes_per_week: activity.minutesPerWeek,
      frequency_per_week: input.lifestyle.activityFrequency ?? null,
      activity_type: input.lifestyle.activityType ?? null,
      intensity_level: input.lifestyle.intensityLevel ?? null,
      sedentary_level: input.lifestyle.sedentaryLevel ?? null,
      qualitative_band: activity.qualitativeBand,
      meets_who_guidelines: activity.meetsWhoGuidelines,
    }),
  );

  // ─── 8. Follow-up plan ───
  await bestEffort('followup_plans', () =>
    supabaseAdmin.from('followup_plans').insert({
      patient_id: patientId,
      assessment_id: assessmentId,
      next_review_date: followupPlan.nextReviewDate,
      review_interval_months: followupPlan.intervalMonths,
      timeline_json: followupPlan.actions.map((action) => ({
        action,
        due_date: followupPlan.nextReviewDate,
        priority: followupPlan.priorityLevel,
        completed: false,
      })),
      recommended_screenings: screenings,
      owner_user_id: auth.userId,
      is_active: true,
    }),
  );

  // ─── 9. Alerts ───
  if (alerts.length > 0) {
    const alertRows = alerts.map((a) => ({
      tenant_id,
      patient_id: patientId,
      assessment_id: assessmentId,
      type: a.type,
      severity: a.severity,
      status: 'open' as const,
      audience: 'clinician' as const,
      title: a.title,
      message: a.message,
    }));
    await bestEffort('alerts', () =>
      supabaseAdmin.from('alerts').insert(alertRows),
    );
  }

  // ─── 10. Audit log ───
  await recordAudit(auth, {
    action: 'assessment.create',
    resourceType: 'assessment',
    resourceId: assessmentId,
    metadata: {
      patient_id: patientId,
      composite_risk_level: compositeRisk.level,
      alert_count: alerts.length,
      score_count: scoreResults.length,
    },
  });

  // ─── 11. Return AssessmentSnapshot ───
  return buildSnapshot({
    assessmentId,
    tenantId: tenant_id,
    patientId,
    createdAt: (assessmentRow.created_at as string) ?? new Date().toISOString(),
    createdByUserId: auth.userId,
    status: (assessmentRow.status as string) ?? 'completed',
    input,
    scoreResults,
    compositeRisk,
    screenings,
    followupPlan,
    nutrition,
    activity,
    alerts,
  });
}

// ============================================================================
// Read path: loadAssessmentSnapshot
// ============================================================================

/**
 * Load a persisted assessment and return it as an AssessmentSnapshot.
 *
 * The primary source of truth is the canonical clinical_input_snapshot
 * column (added by migration 003). Computed fields are rehydrated by
 * re-running the pure engine on the stored input — this is byte-equivalent
 * to the original computation because the engine is deterministic and has
 * no side effects.
 */
export async function loadAssessmentSnapshot(
  auth: AuthContext,
  assessmentId: string,
): Promise<AssessmentSnapshot> {
  const { data: row, error } = await supabaseAdmin
    .from('assessments')
    .select('id, tenant_id, patient_id, assessed_by, status, created_at, notes, clinical_input_snapshot')
    .eq('id', assessmentId)
    .maybeSingle();

  if (error) {
    throw new AssessmentServiceError(500, 'DB_ERROR', error.message);
  }
  if (!row) {
    throw new AssessmentServiceError(
      404,
      'ASSESSMENT_NOT_FOUND',
      'Assessment not found',
    );
  }
  if (auth.role !== 'platform_admin' && row.tenant_id !== auth.tenantId) {
    throw new AssessmentServiceError(
      403,
      'CROSS_TENANT_FORBIDDEN',
      'Cross-tenant read blocked',
    );
  }

  const input = row.clinical_input_snapshot as AssessmentInput | null;
  if (!input) {
    throw new AssessmentServiceError(
      409,
      'SNAPSHOT_MISSING',
      'Assessment has no stored clinical input snapshot (pre-migration-003 record)',
    );
  }

  const scoreResults = computeAllScores(input);
  const compositeRisk = aggregateCompositeRisk(scoreResults);

  const nutrition = buildNutritionSummary({
    predimedAnswers: input.lifestyle.predimedAnswers,
    weightKg: input.vitals.weightKg,
    heightCm: input.vitals.heightCm,
    age: input.demographics.age,
    sex: input.demographics.sex,
    activityLevel: input.lifestyle.intensityLevel ?? undefined,
  });

  const activity = assessActivity({
    minutesPerWeek: input.lifestyle.weeklyActivityMinutes ?? undefined,
    frequency: input.lifestyle.activityFrequency ?? undefined,
    activityType: input.lifestyle.activityType ?? undefined,
    intensityLevel: input.lifestyle.intensityLevel ?? undefined,
  });

  const screenings = determineRequiredScreenings({
    age: input.demographics.age,
    sex: input.demographics.sex,
    scoreResults,
    diagnoses: input.clinicalContext.diagnoses ?? [],
  });

  const missingDataFlags = computeMissingDataFlags(input);
  const followupPlan = determineFollowupPlan({
    compositeRisk,
    scoreResults,
    missingDataFlags,
  });

  // Prefer persisted alerts — they carry acknowledgements and timestamps.
  const { data: persistedAlerts } = await supabaseAdmin
    .from('alerts')
    .select('type, severity, title, message, created_at')
    .eq('assessment_id', assessmentId);

  const alerts =
    persistedAlerts && persistedAlerts.length > 0
      ? persistedAlerts.map((a: any) => ({
          type: String(a.type),
          severity: (a.severity as 'info' | 'warning' | 'critical') ?? 'info',
          title: String(a.title ?? ''),
          message: String(a.message ?? ''),
          timestamp: String(a.created_at ?? new Date().toISOString()),
        }))
      : deriveAlerts({
          currentScoreResults: scoreResults,
          compositeRisk,
          followupPlan,
          missingDataFlags,
        });

  return buildSnapshot({
    assessmentId,
    tenantId: row.tenant_id as string,
    patientId: row.patient_id as string,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    createdByUserId: (row.assessed_by as string | null) ?? null,
    status: (row.status as string) ?? 'completed',
    notes: (row.notes as string | null) ?? null,
    input,
    scoreResults,
    compositeRisk,
    screenings,
    followupPlan,
    nutrition,
    activity,
    alerts,
  });
}

// ============================================================================
// Snapshot assembly
// ============================================================================

type SnapshotAssembly = {
  assessmentId: string;
  tenantId: string;
  patientId: string;
  createdAt: string;
  createdByUserId: string | null;
  status: string;
  notes?: string | null;
  input: AssessmentInput;
  scoreResults: ReturnType<typeof computeAllScores>;
  compositeRisk: ReturnType<typeof aggregateCompositeRisk>;
  screenings: ReturnType<typeof determineRequiredScreenings>;
  followupPlan: ReturnType<typeof determineFollowupPlan>;
  nutrition: ReturnType<typeof buildNutritionSummary>;
  activity: ReturnType<typeof assessActivity>;
  alerts: ReturnType<typeof deriveAlerts>;
};

function buildSnapshot(a: SnapshotAssembly): AssessmentSnapshot {
  return {
    assessment: {
      id: a.assessmentId,
      patientId: a.patientId,
      tenantId: a.tenantId,
      createdAt: a.createdAt,
      createdByUserId: a.createdByUserId,
      status: a.status,
      notes: a.notes ?? null,
    },
    input: a.input,
    scoreResults: a.scoreResults,
    compositeRisk: {
      level: a.compositeRisk.level,
      numeric: a.compositeRisk.numeric,
      cardiovascular: a.compositeRisk.cardiovascular,
      metabolic: a.compositeRisk.metabolic,
      hepatic: a.compositeRisk.hepatic,
      renal: a.compositeRisk.renal,
      frailty: a.compositeRisk.frailty,
    },
    screenings: a.screenings,
    followupPlan: a.followupPlan,
    nutritionSummary: a.nutrition,
    activitySummary: a.activity,
    alerts: a.alerts,
  };
}

// ============================================================================
// Report payload passthrough
// ============================================================================

/**
 * Build a report-friendly payload from an AssessmentSnapshot. The actual
 * rendering lives in `pdf-report-service.ts`. We also fetch tenant/patient
 * display metadata here so the PDF doesn't have to round-trip again.
 */
export async function buildReportPayload(
  snapshot: AssessmentSnapshot,
): Promise<ReportPayload> {
  const [{ data: patient }, { data: tenant }, { data: clinician }] = await Promise.all([
    supabaseAdmin
      .from('patients')
      .select('display_name, first_name, last_name, sex, birth_year, birth_date, external_code')
      .eq('id', snapshot.assessment.patientId)
      .maybeSingle(),
    supabaseAdmin
      .from('tenants')
      .select('name, logo_url')
      .eq('id', snapshot.assessment.tenantId)
      .maybeSingle(),
    snapshot.assessment.createdByUserId
      ? supabaseAdmin
          .from('users')
          .select('full_name, email')
          .eq('id', snapshot.assessment.createdByUserId)
          .maybeSingle()
      : Promise.resolve({ data: null as null }),
  ]);

  return {
    snapshot,
    patient: {
      displayName: (patient?.display_name as string) ?? 'Unknown patient',
      firstName: (patient?.first_name as string | null) ?? null,
      lastName: (patient?.last_name as string | null) ?? null,
      sex: (patient?.sex as 'male' | 'female' | null) ?? snapshot.input.demographics.sex,
      birthYear: (patient?.birth_year as number | null) ?? null,
      birthDate: (patient?.birth_date as string | null) ?? null,
      externalCode: (patient?.external_code as string | null) ?? null,
    },
    tenant: {
      name: (tenant?.name as string) ?? 'Clinical Assessment',
      logoUrl: (tenant?.logo_url as string | null) ?? null,
    },
    clinician: clinician
      ? {
          fullName: (clinician.full_name as string) ?? '',
          email: (clinician.email as string) ?? '',
        }
      : null,
  };
}

export interface ReportPayload {
  snapshot: AssessmentSnapshot;
  patient: {
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    sex: 'male' | 'female';
    birthYear: number | null;
    birthDate: string | null;
    externalCode: string | null;
  };
  tenant: {
    name: string;
    logoUrl: string | null;
  };
  clinician: {
    fullName: string;
    email: string;
  } | null;
}
