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
import { applyLabDerivations } from '../domain/clinical/derivations/index.js';
import { checkAssessmentCompleteness } from '../domain/clinical/completeness/completeness-checker.js';
import { deriveLifestyleRecommendations } from '../domain/clinical/lifestyle-recommendation-engine/lifestyle-recommendations.js';
import { resolvePublicGuidelineRef } from '../domain/clinical/guideline-catalog/index.js';

import type {
  AssessmentInput,
  AssessmentSnapshot,
  CompletenessWarning,
  DomainRiskEntry,
  RiskLevel,
  ScoreResultEntry,
} from '../../../shared/types/clinical.js';
import type { CompositeRiskProfile } from '../domain/clinical/risk-aggregation/composite-risk.js';

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

function findScore(
  results: ScoreResultEntry[],
  code: string,
): ScoreResultEntry | undefined {
  const needle = code.toLowerCase();
  return results.find((r) => r.scoreCode.toLowerCase() === needle);
}

/**
 * Load the composite risk profile of the most recent assessment for this
 * patient that is NOT the one being created/rehydrated right now.
 *
 * The returned shape mirrors the `CompositeRiskProfile` produced by the
 * aggregator so it can be fed back into the alert engine for risk-trend
 * comparison. When no previous assessment exists, when the previous
 * `risk_profiles` row is missing (best-effort persistence may have
 * failed), or when the query errors out, we return `null` — a missing
 * baseline is preferable to a synthetic one (the alert engine explicitly
 * refuses to emit a risk-up alert without a real baseline).
 *
 * The DB read is shielded by RLS and additionally filtered by tenant_id
 * (defence-in-depth). We also pin the query to assessments older than
 * the row being processed so we never compare the row with itself.
 */
async function loadPreviousCompositeRisk(
  tenantId: string,
  patientId: string,
  excludeAssessmentId: string | null,
  createdAt: string,
): Promise<CompositeRiskProfile | null> {
  try {
    let query = supabaseAdmin
      .from('assessments')
      .select('id, created_at, risk_profiles ( composite_risk_level, composite_score, cardiovascular_risk, metabolic_risk, hepatic_risk, renal_risk, frailty_risk, summary_json )')
      .eq('tenant_id', tenantId)
      .eq('patient_id', patientId)
      .lt('created_at', createdAt)
      .order('created_at', { ascending: false })
      .limit(1);
    if (excludeAssessmentId) {
      query = query.neq('id', excludeAssessmentId);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    // PostgREST returns the joined `risk_profiles` as an array (because
    // the FK is one-to-many on the schema even though our code keeps it
    // 1:1 via the UNIQUE constraint). Normalize to a single row.
    const rp: any = Array.isArray(data.risk_profiles)
      ? data.risk_profiles[0]
      : data.risk_profiles;
    if (!rp) return null;

    const level = rp.composite_risk_level as RiskLevel;
    const summary = (rp.summary_json ?? {}) as Record<string, unknown>;

    const toDomain = (
      col: string | null | undefined,
      key: string,
    ): DomainRiskEntry => {
      const fromSummary = summary[key] as DomainRiskEntry | undefined;
      if (fromSummary && typeof fromSummary === 'object' && 'level' in fromSummary) {
        return fromSummary;
      }
      const lvl = (col as RiskLevel | null | undefined) ?? 'indeterminate';
      return { level: lvl, reasoning: 'reconstructed from persisted column' };
    };

    const frailtyRaw = toDomain(rp.frailty_risk, 'frailty');
    const frailty: DomainRiskEntry | null =
      rp.frailty_risk == null && !summary.frailty ? null : frailtyRaw;

    return {
      level,
      numeric: Number(rp.composite_score ?? 0),
      cardiovascular: toDomain(rp.cardiovascular_risk, 'cardiovascular'),
      metabolic: toDomain(rp.metabolic_risk, 'metabolic'),
      hepatic: toDomain(rp.hepatic_risk, 'hepatic'),
      renal: toDomain(rp.renal_risk, 'renal'),
      frailty,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[assessment-service] loadPreviousCompositeRisk failed', e);
    return null;
  }
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

/**
 * Narrow projection of the enriched assessment input shape consumed by
 * the lifestyle-recommendation engine. Extracted into a helper so the
 * write-path and the read-path both build the exact same snapshot —
 * keeping the recommendations byte-equivalent across rehydrations.
 */
function buildLifestyleSnapshot(
  enrichedInput: AssessmentInput,
  scoreResults: ReturnType<typeof computeAllScores>,
) {
  const bmiEntry = scoreResults.find(
    (r) => r.scoreCode.toLowerCase() === 'bmi',
  );
  const bmi =
    bmiEntry && typeof bmiEntry.valueNumeric === 'number'
      ? bmiEntry.valueNumeric
      : undefined;

  return {
    smoking: enrichedInput.clinicalContext.smoking === true,
    hasDiabetes: enrichedInput.clinicalContext.hasDiabetes === true,
    hypertension: enrichedInput.clinicalContext.hypertension === true,
    bmi,
    waistCm: enrichedInput.vitals.waistCm,
    sex: enrichedInput.demographics.sex,
    sbpMmHg: enrichedInput.vitals.sbpMmHg,
    ldlMgDl: enrichedInput.labs.ldlMgDl,
    hba1cPct: enrichedInput.labs.hba1cPct,
    glucoseMgDl: enrichedInput.labs.glucoseMgDl,
  };
}

/**
 * Map a FollowUpItem / ScreeningItem code to a UI-friendly domain bucket.
 * The enum values match the CHECK constraint in migration 007
 * (`cardiovascular | metabolic | renal | hepatic | frailty |
 * diabetic_complications | core_review | other`).
 */
function inferDueItemDomain(code: string):
  | 'cardiovascular'
  | 'metabolic'
  | 'renal'
  | 'hepatic'
  | 'frailty'
  | 'diabetic_complications'
  | 'core_review'
  | 'other'
{
  const c = code.toLowerCase();
  if (c === 'core_review') return 'core_review';
  if (c.startsWith('cv_') || c.startsWith('cardiovascular')) return 'cardiovascular';
  if (c.startsWith('renal')) return 'renal';
  if (c.startsWith('hepatic')) return 'hepatic';
  if (c.startsWith('frailty')) return 'frailty';
  if (c.startsWith('dm_')) return 'diabetic_complications';
  if (c.startsWith('metabolic')) return 'metabolic';
  return 'other';
}

/**
 * Convert a `due_in_months` integer into an ISO date anchored on `now`.
 * `0` is treated as "today" (same-day urgent); fractional months are
 * rounded to whole-month semantics to avoid locale drift.
 */
function monthsFromNowIso(now: Date, months: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + Math.max(0, Math.round(months)));
  return d.toISOString().slice(0, 10);
}

/**
 * Build the row payload for the `due_items` upsert. Keeping this pure
 * makes the write path easier to audit and enables future unit testing
 * without database fixtures.
 */
function buildDueItemRows(args: {
  tenantId: string;
  patientId: string;
  assessmentId: string;
  followupItems: ReturnType<typeof determineFollowupPlan>['items'];
  screenings: ReturnType<typeof determineRequiredScreenings>;
  createdByUserId: string | null;
  now: Date;
}): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (const item of args.followupItems) {
    rows.push({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      assessment_id: args.assessmentId,
      source_engine: 'followup',
      item_code: item.code,
      title: item.title,
      rationale: item.rationale ?? null,
      guideline_source: item.guidelineSource ?? null,
      priority: item.priority,
      domain: inferDueItemDomain(item.code),
      due_at: monthsFromNowIso(args.now, item.dueInMonths),
      recurrence_months: item.recurrenceMonths ?? null,
      status: 'open',
      created_by: args.createdByUserId,
    });
  }

  for (const s of args.screenings) {
    // Screenings don't carry a code today; derive a stable one from the
    // screening title + guideline to avoid collisions across runs.
    const codeBase = s.screening
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'screening';
    rows.push({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      assessment_id: args.assessmentId,
      source_engine: 'screening',
      item_code: `scr_${codeBase}`,
      title: s.screening,
      rationale: s.reason ?? null,
      guideline_source: s.guidelineSource ?? null,
      priority: s.priority,
      domain: inferDueItemDomain(codeBase),
      due_at: monthsFromNowIso(args.now, s.intervalMonths),
      recurrence_months: s.intervalMonths ?? null,
      status: 'open',
      created_by: args.createdByUserId,
    });
  }

  return rows;
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

  // ─── 1. Boundary derivations ───
  // Enrich the canonical input with values that can be deterministically
  // derived (today: ACR from urine albumin + urine creatinine). The
  // original `input` is kept untouched so the persisted snapshot matches
  // exactly what the clinician submitted; `enrichedInput` drives
  // computation only.
  const { input: enrichedInput } = applyLabDerivations(input);

  // ─── 2. Run the deterministic engine BEFORE any DB write ───
  const scoreResults = computeAllScores(enrichedInput);
  const compositeRisk = aggregateCompositeRisk(scoreResults, enrichedInput);

  // Completeness is a separate signal from clinical alerts. See the
  // CompletenessWarning type documentation in shared/types/clinical.ts.
  const completenessWarnings: CompletenessWarning[] =
    checkAssessmentCompleteness(enrichedInput);

  const nutrition = buildNutritionSummary({
    predimedAnswers: enrichedInput.lifestyle.predimedAnswers,
    weightKg: enrichedInput.vitals.weightKg,
    heightCm: enrichedInput.vitals.heightCm,
    age: enrichedInput.demographics.age,
    sex: enrichedInput.demographics.sex,
    activityLevel: enrichedInput.lifestyle.intensityLevel ?? undefined,
  });

  const activity = assessActivity({
    minutesPerWeek: enrichedInput.lifestyle.weeklyActivityMinutes ?? undefined,
    moderateMinutesPerWeek:
      enrichedInput.lifestyle.moderateActivityMinutes ?? undefined,
    vigorousMinutesPerWeek:
      enrichedInput.lifestyle.vigorousActivityMinutes ?? undefined,
    sedentaryHoursPerDay:
      enrichedInput.lifestyle.sedentaryHoursPerDay ?? undefined,
    frequency: enrichedInput.lifestyle.activityFrequency ?? undefined,
    activityType: enrichedInput.lifestyle.activityType ?? undefined,
    intensityLevel: enrichedInput.lifestyle.intensityLevel ?? undefined,
  });

  const screenings = determineRequiredScreenings({
    age: enrichedInput.demographics.age,
    sex: enrichedInput.demographics.sex,
    scoreResults,
    diagnoses: enrichedInput.clinicalContext.diagnoses ?? [],
    compositeRisk,
    vitals: {
      sbpMmHg: enrichedInput.vitals.sbpMmHg ?? null,
      dbpMmHg: enrichedInput.vitals.dbpMmHg ?? null,
    },
  });

  // Anchor all date-sensitive engines to a single `now`. This is what
  // makes the pipeline deterministic across create and rehydrate paths.
  const now = new Date();

  const followupPlan = determineFollowupPlan({
    compositeRisk,
    scoreResults,
    hasDiabetes: enrichedInput.clinicalContext.hasDiabetes === true,
    now,
  });

  // WS6 — bounded lifestyle recommendations. Pure function of the
  // clinical snapshot + activity/nutrition summaries; never overrides a
  // deterministic score and is marked `authority: 'supportive'`.
  const lifestyleRecommendations = deriveLifestyleRecommendations({
    snapshot: buildLifestyleSnapshot(enrichedInput, scoreResults),
    activity,
    nutrition,
  });

  // Best-effort load of the previous composite risk for risk-trend alerts.
  // The alert engine refuses to emit a risk-up alert without a real
  // baseline, so a null here simply suppresses that single alert type —
  // every other alert category is independent.
  const previousCompositeRisk = await loadPreviousCompositeRisk(
    tenant_id,
    patientId,
    null, // no current id yet — assessment row not inserted
    now.toISOString(),
  );

  const alerts = deriveAlerts({
    currentScoreResults: scoreResults,
    compositeRisk,
    previousCompositeRisk,
    followupPlan,
    now,
    // ISSUE 5 — feed raw input so guideline-threshold red-flag rules
    // (severe HTN, hyperglycaemic crisis, very-high HbA1c, uncontrolled
    // diabetes, severe albuminuria, severe transaminase rise) can fire.
    vitals: {
      sbpMmHg: enrichedInput.vitals.sbpMmHg ?? null,
      dbpMmHg: enrichedInput.vitals.dbpMmHg ?? null,
    },
    labs: {
      glucoseMgDl: enrichedInput.labs.glucoseMgDl ?? null,
      hba1cPct: enrichedInput.labs.hba1cPct ?? null,
      astUL: enrichedInput.labs.astUL ?? null,
      altUL: enrichedInput.labs.altUL ?? null,
      albuminCreatinineRatio: enrichedInput.labs.albuminCreatinineRatio ?? null,
    },
    clinicalContext: {
      hasDiabetes: enrichedInput.clinicalContext.hasDiabetes === true,
    },
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
  // Uses `enrichedInput` so any boundary-derived value (e.g. ACR derived
  // from urine albumin + urine creatinine) is persisted into the
  // measurement projection. The canonical `clinical_input_snapshot`
  // column below keeps the clinician's original payload intact.
  const bmiScore = findScore(scoreResults, 'BMI');
  const egfrScore = findScore(scoreResults, 'EGFR');
  await bestEffort('assessment_measurements', () =>
    supabaseAdmin.from('assessment_measurements').insert({
      assessment_id: assessmentId,
      height_cm: enrichedInput.vitals.heightCm,
      weight_kg: enrichedInput.vitals.weightKg,
      bmi: bmiScore?.valueNumeric ?? null,
      waist_cm: enrichedInput.vitals.waistCm,
      sbp: enrichedInput.vitals.sbpMmHg,
      dbp: enrichedInput.vitals.dbpMmHg,
      total_chol_mgdl: enrichedInput.labs.totalCholMgDl ?? null,
      hdl_mgdl: enrichedInput.labs.hdlMgDl ?? null,
      ldl_mgdl: enrichedInput.labs.ldlMgDl ?? null,
      triglycerides_mgdl: enrichedInput.labs.triglyceridesMgDl ?? null,
      glucose_mgdl: enrichedInput.labs.glucoseMgDl ?? null,
      hba1c_pct: enrichedInput.labs.hba1cPct ?? null,
      egfr: egfrScore?.valueNumeric ?? enrichedInput.labs.eGFR ?? null,
      creatinine_mgdl: enrichedInput.labs.creatinineMgDl ?? null,
      albumin_creatinine_ratio:
        enrichedInput.labs.albuminCreatinineRatio ?? null,
      ggt: enrichedInput.labs.ggtUL ?? null,
      ast: enrichedInput.labs.astUL ?? null,
      alt: enrichedInput.labs.altUL ?? null,
      platelets: enrichedInput.labs.plateletsGigaL ?? null,
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
  // Migration 008 extends this table with the MET projection so the
  // trend charts on the patient page can plot MVPA (MET-min/week) and
  // sedentary hours/day. The legacy aggregate columns stay populated
  // for backward compatibility.
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
      // WS5 MET projection (migration 008)
      moderate_minutes_per_week: activity.moderateMinutesPerWeek,
      vigorous_minutes_per_week: activity.vigorousMinutesPerWeek,
      met_minutes_per_week: activity.metMinutesPerWeek,
      sedentary_hours_per_day: activity.sedentaryHoursPerDay,
      sedentary_risk_level: activity.sedentaryRiskLevel,
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

  // ─── 8b. Due items (WS7) ───
  // Materialise the structured follow-up and screening items as
  // `due_items` rows so the patient-detail countdown UI can render them
  // without re-running the engines on the read path.
  //
  // Why not upsert:
  //   Migration 007 enforces uniqueness with a PARTIAL unique index
  //   (`idx_due_items_open_unique ... WHERE status IN ('open',
  //   'acknowledged')`). PostgREST's `.upsert(..., { onConflict })`
  //   compiles to `INSERT ... ON CONFLICT (cols) DO UPDATE` which
  //   requires either a full unique constraint OR a simple unique
  //   index — partial indexes are NOT accepted as conflict targets.
  //   The call therefore raised PostgREST error 42P10 ("no unique or
  //   exclusion constraint matching the ON CONFLICT specification")
  //   every time an assessment was re-created, which `bestEffort`
  //   silently swallowed. Net effect: no due items ever reached the
  //   UI. See ISSUE 1 in the WS9 remediation plan.
  //
  // Strategy:
  //   DELETE open/acknowledged rows for the engine-owned codes being
  //   regenerated, then INSERT the fresh batch. This:
  //     - preserves the completed/dismissed audit trail,
  //     - leaves `manual` rows untouched (only 'followup' and
  //       'screening' codes are replaced),
  //     - restores a clean "last assessment wins" semantic.
  //
  // Best-effort wrapping is retained so a due_items write failure
  // never rolls back the already-committed assessment, but each stage
  // logs its own error for ops visibility.
  const dueItemRows = buildDueItemRows({
    tenantId: tenant_id,
    patientId,
    assessmentId,
    followupItems: followupPlan.items,
    screenings,
    createdByUserId: auth.userId,
    now,
  });
  if (dueItemRows.length > 0) {
    const engineCodes = Array.from(
      new Set(
        dueItemRows
          .filter((r) => r.source_engine === 'followup' || r.source_engine === 'screening')
          .map((r) => String(r.item_code)),
      ),
    );
    if (engineCodes.length > 0) {
      await bestEffort('due_items.delete_open', () =>
        supabaseAdmin
          .from('due_items')
          .delete()
          .eq('patient_id', patientId)
          .in('source_engine', ['followup', 'screening'])
          .in('status', ['open', 'acknowledged'])
          .in('item_code', engineCodes),
      );
    }
    await bestEffort('due_items.insert', () =>
      supabaseAdmin.from('due_items').insert(dueItemRows),
    );
  }

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
      // Stable, machine-readable completeness signal. Sourced from the
      // canonical `checkAssessmentCompleteness` projection so the audit
      // trail and the UI share a single source of truth. Codes only —
      // no free-text, no PHI.
      completeness_warning_codes: completenessWarnings.map((w) => w.code),
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
    lifestyleRecommendations,
    alerts,
    completenessWarnings,
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

  // Boundary derivations — keep read-path in lockstep with write-path so
  // the rehydrated snapshot is byte-equivalent to the one originally
  // returned by createAssessment().
  const { input: enrichedInput } = applyLabDerivations(input);
  const scoreResults = computeAllScores(enrichedInput);
  const compositeRisk = aggregateCompositeRisk(scoreResults, enrichedInput);
  const completenessWarnings: CompletenessWarning[] =
    checkAssessmentCompleteness(enrichedInput);

  const nutrition = buildNutritionSummary({
    predimedAnswers: enrichedInput.lifestyle.predimedAnswers,
    weightKg: enrichedInput.vitals.weightKg,
    heightCm: enrichedInput.vitals.heightCm,
    age: enrichedInput.demographics.age,
    sex: enrichedInput.demographics.sex,
    activityLevel: enrichedInput.lifestyle.intensityLevel ?? undefined,
  });

  const activity = assessActivity({
    minutesPerWeek: enrichedInput.lifestyle.weeklyActivityMinutes ?? undefined,
    moderateMinutesPerWeek:
      enrichedInput.lifestyle.moderateActivityMinutes ?? undefined,
    vigorousMinutesPerWeek:
      enrichedInput.lifestyle.vigorousActivityMinutes ?? undefined,
    sedentaryHoursPerDay:
      enrichedInput.lifestyle.sedentaryHoursPerDay ?? undefined,
    frequency: enrichedInput.lifestyle.activityFrequency ?? undefined,
    activityType: enrichedInput.lifestyle.activityType ?? undefined,
    intensityLevel: enrichedInput.lifestyle.intensityLevel ?? undefined,
  });

  const screenings = determineRequiredScreenings({
    age: enrichedInput.demographics.age,
    sex: enrichedInput.demographics.sex,
    scoreResults,
    diagnoses: enrichedInput.clinicalContext.diagnoses ?? [],
    compositeRisk,
    vitals: {
      sbpMmHg: enrichedInput.vitals.sbpMmHg ?? null,
      dbpMmHg: enrichedInput.vitals.dbpMmHg ?? null,
    },
  });

  // Rehydration uses the assessment's original `created_at` as the `now`
  // anchor so the follow-up plan is byte-equivalent to the one emitted at
  // creation time. Without this the `nextReviewDate` would silently drift
  // every time the snapshot is reloaded.
  const createdAtIso = (row.created_at as string) ?? new Date().toISOString();
  const now = new Date(createdAtIso);

  const followupPlan = determineFollowupPlan({
    compositeRisk,
    scoreResults,
    hasDiabetes: enrichedInput.clinicalContext.hasDiabetes === true,
    now,
  });

  // WS6 — regenerate bounded lifestyle recommendations on the read path.
  // Determinism is preserved because every input is itself deterministic.
  const lifestyleRecommendations = deriveLifestyleRecommendations({
    snapshot: buildLifestyleSnapshot(enrichedInput, scoreResults),
    activity,
    nutrition,
  });

  // Prefer persisted alerts — they carry acknowledgements and timestamps.
  const { data: persistedAlerts } = await supabaseAdmin
    .from('alerts')
    .select('type, severity, title, message, created_at')
    .eq('assessment_id', assessmentId);

  let alerts: ReturnType<typeof deriveAlerts>;
  if (persistedAlerts && persistedAlerts.length > 0) {
    alerts = persistedAlerts.map((a: any) => ({
      type: String(a.type),
      severity: (a.severity as 'info' | 'warning' | 'critical') ?? 'info',
      title: String(a.title ?? ''),
      message: String(a.message ?? ''),
      timestamp: String(a.created_at ?? new Date().toISOString()),
    }));
  } else {
    const previousCompositeRisk = await loadPreviousCompositeRisk(
      row.tenant_id as string,
      row.patient_id as string,
      assessmentId,
      createdAtIso,
    );
    alerts = deriveAlerts({
      currentScoreResults: scoreResults,
      compositeRisk,
      previousCompositeRisk,
      followupPlan,
      now,
      // ISSUE 5 — keep read-path in lockstep with the write-path so a
      // rehydrated snapshot yields the same alert set as the original
      // createAssessment call. See the write-path deriveAlerts(...) for
      // the reference wiring.
      vitals: {
        sbpMmHg: enrichedInput.vitals.sbpMmHg ?? null,
        dbpMmHg: enrichedInput.vitals.dbpMmHg ?? null,
      },
      labs: {
        glucoseMgDl: enrichedInput.labs.glucoseMgDl ?? null,
        hba1cPct: enrichedInput.labs.hba1cPct ?? null,
        astUL: enrichedInput.labs.astUL ?? null,
        altUL: enrichedInput.labs.altUL ?? null,
        albuminCreatinineRatio:
          enrichedInput.labs.albuminCreatinineRatio ?? null,
      },
      clinicalContext: {
        hasDiabetes: enrichedInput.clinicalContext.hasDiabetes === true,
      },
    });
  }

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
    lifestyleRecommendations,
    alerts,
    completenessWarnings,
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
  lifestyleRecommendations: ReturnType<typeof deriveLifestyleRecommendations>;
  alerts: ReturnType<typeof deriveAlerts>;
  completenessWarnings: CompletenessWarning[];
};

function buildSnapshot(a: SnapshotAssembly): AssessmentSnapshot {
  // WS6 — enrich every guideline-bearing item with its structured
  // `PublicGuidelineRef` projection. This is a pure read-side
  // transformation: the legacy `guidelineSource` string stays untouched
  // (so existing consumers and persisted rows keep their exact wording)
  // and `guideline` is added as optional structured metadata. Off-catalog
  // strings resolve to `null`, which the UI/PDF interpret as "fall back
  // to the raw text". No persistence side-effects here.
  const enrichedScreenings = a.screenings.map((s) => ({
    ...s,
    guideline: resolvePublicGuidelineRef(s.guidelineSource),
  }));
  const enrichedFollowupItems = a.followupPlan.items.map((it) => ({
    ...it,
    guideline: resolvePublicGuidelineRef(it.guidelineSource),
  }));
  const enrichedLifestyleRecs = a.lifestyleRecommendations.map((r) => ({
    ...r,
    guideline: resolvePublicGuidelineRef(r.guidelineSource),
  }));

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
    completenessWarnings: a.completenessWarnings,
    screenings: enrichedScreenings,
    followupPlan: {
      ...a.followupPlan,
      items: enrichedFollowupItems,
    },
    nutritionSummary: a.nutrition,
    activitySummary: a.activity,
    lifestyleRecommendations: enrichedLifestyleRecs,
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

// ============================================================================
// Delete path: deleteAssessment
// ============================================================================

/**
 * Name of the private bucket that stores generated clinical PDFs.
 * Duplicated intentionally from api/v1/assessments/[id]/report.ts — both
 * files are entry-point adapters for the same object storage folder; we
 * keep them in sync by convention (one-line constant, not worth a shared
 * module yet).
 */
const CLINICAL_REPORT_BUCKET = 'clinical-reports';

/**
 * Summary returned by `deleteAssessment` so the route can relay a
 * concrete receipt to the UI and include rich metadata in the audit log.
 */
export interface DeleteAssessmentResult {
  assessmentId: string;
  patientId: string;
  tenantId: string;
  /** Number of storage objects (PDF exports) attempted to delete. */
  storageObjectsAttempted: number;
  /** Objects that were removed from object storage successfully. */
  storageObjectsRemoved: number;
  /** Objects that FAILED to delete from storage but whose DB rows were
   *  still cascaded away. We never rollback over a storage failure —
   *  the DB is the source of truth; dangling objects are garbage and
   *  are listed here so ops can sweep them. */
  storageObjectsOrphaned: string[];
  /** Count of due_items rows proactively removed (the FK is SET NULL; we
   *  delete the sibling rows so the patient page doesn't show stale
   *  action items pointing to an assessment that no longer exists). */
  dueItemsRemoved: number;
}

/**
 * Permanently delete an assessment and its entire clinical trail.
 *
 * Authorization model (stricter than the read path):
 *   - platform_admin       — always allowed
 *   - tenant_admin         — allowed within their tenant
 *   - clinician            — allowed only on assessments they authored
 *   - assistant_staff /    — denied
 *     patient
 *
 * Side effects, in order:
 *   1. Load the assessment row (tenant check, ownership check).
 *   2. Enumerate `report_exports.storage_path` rows for this assessment
 *      and remove every object from the clinical-reports bucket.
 *   3. Delete all `due_items` rows whose `assessment_id` matches (the
 *      FK is SET NULL by design — see migration 007 — and we want a
 *      full sweep, not an orphaned projection).
 *   4. `DELETE FROM assessments WHERE id = ... AND tenant_id = ...` —
 *      migration 009 cascades assessment_measurements, score_results,
 *      risk_profiles, nutrition_snapshots, activity_snapshots, alerts,
 *      followup_plans, report_exports.
 *   5. Write an audit_event with full metadata.
 *
 * The function is idempotent in the sense that if the assessment was
 * already deleted between load and delete, it returns 404 rather than
 * silently succeeding.
 */
export async function deleteAssessment(
  auth: AuthContext,
  assessmentId: string,
): Promise<DeleteAssessmentResult> {
  // ─── 1. Load + authorize ───
  const { data: row, error: loadErr } = await supabaseAdmin
    .from('assessments')
    .select('id, tenant_id, patient_id, assessed_by, status')
    .eq('id', assessmentId)
    .maybeSingle();

  if (loadErr) {
    throw new AssessmentServiceError(500, 'DB_ERROR', loadErr.message);
  }
  if (!row) {
    throw new AssessmentServiceError(
      404,
      'ASSESSMENT_NOT_FOUND',
      'Assessment not found',
    );
  }

  const isPlatformAdmin = auth.role === 'platform_admin';
  const isTenantAdmin =
    auth.role === 'tenant_admin' && row.tenant_id === auth.tenantId;
  const isAuthoringClinician =
    auth.role === 'clinician'
    && row.tenant_id === auth.tenantId
    && row.assessed_by === auth.userId;

  if (!isPlatformAdmin && !isTenantAdmin && !isAuthoringClinician) {
    throw new AssessmentServiceError(
      403,
      'DELETE_FORBIDDEN',
      'Only the authoring clinician or a tenant administrator may delete this assessment',
    );
  }

  // ─── 2. Enumerate + remove storage objects ───
  const { data: exportRows } = await supabaseAdmin
    .from('report_exports')
    .select('id, storage_path')
    .eq('assessment_id', assessmentId);

  const storagePaths = (exportRows ?? [])
    .map((r: any) => (typeof r?.storage_path === 'string' ? r.storage_path : null))
    .filter((p: string | null): p is string => !!p);

  const orphaned: string[] = [];
  let removed = 0;
  if (storagePaths.length > 0) {
    const { data: removedData, error: removeErr } = await supabaseAdmin.storage
      .from(CLINICAL_REPORT_BUCKET)
      .remove(storagePaths);
    if (removeErr) {
      // Don't rollback — DB is source of truth. Surface the orphans so
      // ops can sweep them from a cron.
      // eslint-disable-next-line no-console
      console.error(
        '[deleteAssessment] storage.remove failed — DB delete will still proceed',
        removeErr,
      );
      orphaned.push(...storagePaths);
    } else {
      removed = Array.isArray(removedData) ? removedData.length : storagePaths.length;
      const removedPaths = new Set(
        (removedData ?? [])
          .map((o: any) => (typeof o?.name === 'string' ? o.name : null))
          .filter((n: string | null): n is string => !!n),
      );
      for (const p of storagePaths) {
        if (removedPaths.size > 0 && !removedPaths.has(p)) orphaned.push(p);
      }
    }
  }

  // ─── 3. Proactively remove materialised due_items (FK is SET NULL) ───
  const { data: dueRemoved } = await supabaseAdmin
    .from('due_items')
    .delete()
    .eq('assessment_id', assessmentId)
    .select('id');
  const dueItemsRemoved = Array.isArray(dueRemoved) ? dueRemoved.length : 0;

  // ─── 4. Cascade delete the assessment ───
  // Defense-in-depth: match BOTH id and tenant_id so a race with a
  // cross-tenant hijack attempt cannot remove the wrong row. We return
  // the deleted row (`.select('id')`) so we can distinguish a true
  // hit from a race that already removed the row between load and delete.
  const { data: deletedRows, error: delErr } = await supabaseAdmin
    .from('assessments')
    .delete()
    .eq('id', assessmentId)
    .eq('tenant_id', row.tenant_id as string)
    .select('id');

  if (delErr) {
    // eslint-disable-next-line no-console
    console.error('[deleteAssessment] assessments.delete failed', delErr);
    throw new AssessmentServiceError(
      500,
      'DELETE_FAILED',
      'Assessment delete failed',
      { pgMessage: delErr.message },
    );
  }
  if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
    // Race: row vanished between load and delete. Treat as not-found so
    // the UI can refresh cleanly.
    throw new AssessmentServiceError(
      404,
      'ASSESSMENT_NOT_FOUND',
      'Assessment was already removed',
    );
  }

  // ─── 5. Audit ───
  await recordAudit(auth, {
    action: 'assessment.delete',
    resourceType: 'assessment',
    resourceId: assessmentId,
    metadata: {
      patient_id: row.patient_id,
      tenant_id: row.tenant_id,
      prior_status: row.status,
      authoring_user_id: row.assessed_by,
      storage_objects_attempted: storagePaths.length,
      storage_objects_removed: removed,
      storage_objects_orphaned: orphaned.length,
      due_items_removed: dueItemsRemoved,
    },
  });

  return {
    assessmentId,
    patientId: row.patient_id as string,
    tenantId: row.tenant_id as string,
    storageObjectsAttempted: storagePaths.length,
    storageObjectsRemoved: removed,
    storageObjectsOrphaned: orphaned,
    dueItemsRemoved,
  };
}
