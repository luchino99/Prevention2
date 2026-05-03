/**
 * GET /api/v1/patients/[id]/export
 *
 * GDPR Art.15 (access) + Art.20 (portability) — returns the full, machine-
 * readable record of a patient in a structured JSON envelope.
 *
 * Who can call:
 *   - Tenant admins and clinicians linked to the patient
 *   - NOT assistant_staff (they have limited clinical access)
 *   - Platform admins cross-tenant
 *
 * What is returned:
 *   - patient demographics (what the tenant stored about them)
 *   - clinical profile
 *   - every assessment with its full input snapshot + computed snapshots
 *   - all alerts ever raised
 *   - all follow-up plans
 *   - consent records (immutable versioned rows)
 *   - recent audit trail of actions TAKEN ON the patient's data
 *
 * What is NOT returned:
 *   - other tenants' data (hard impossible via RLS + tenant filter)
 *   - raw pdf report bytes (we return metadata + a signed URL if requested)
 *   - IP hashes of actors (we keep actors' identity, redact IPs)
 *
 * Auditing: every export is logged as `patient.export` in audit_events and a
 * `data_subject_request` row is created with kind='access' for SLA tracking.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { recordAuditStrict, AuditWriteError } from '../../../../backend/src/audit/audit-logger.js';
import { logStructured } from '../../../../backend/src/observability/structured-log.js';
import {
  replyDbError,
  replyError,
} from '../../../../backend/src/middleware/http-errors.js';

const UUID_RX = /^[0-9a-fA-F-]{36}$/;

function getPatientId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string' || !UUID_RX.test(id)) return null;
  return id;
}

async function handleExport(req: any, res: VercelResponse, patientId: string): Promise<void> {
  // ----- Authorization: patient must exist + be in caller's tenant -----
  const { data: patient, error: patientErr } = await supabaseAdmin
    .from('patients')
    .select(
      'id, tenant_id, display_name, first_name, last_name, sex, birth_year, birth_date, external_code, contact_email, contact_phone, consent_status, is_active, created_at, updated_at, deleted_at, anonymized_at',
    )
    .eq('id', patientId)
    .maybeSingle();

  if (patientErr) {
    replyDbError(res, patientErr, 'patients.export.patient');
    return;
  }
  if (!patient) {
    replyError(res, 404, 'PATIENT_NOT_FOUND');
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    replyError(res, 403, 'CROSS_TENANT_FORBIDDEN');
    return;
  }

  // Role gate — assistant_staff excluded from export even if tenant-matched
  if (req.auth.role === 'assistant_staff' || req.auth.role === 'patient') {
    replyError(res, 403, 'INSUFFICIENT_ROLE');
    return;
  }

  // For clinicians, require an active professional-patient link
  if (req.auth.role === 'clinician') {
    const { data: link } = await supabaseAdmin
      .from('professional_patient_links')
      .select('id')
      .eq('professional_user_id', req.auth.userId)
      .eq('patient_id', patientId)
      .eq('is_active', true)
      .maybeSingle();
    if (!link) {
      replyError(res, 403, 'NO_PATIENT_LINK');
      return;
    }
  }

  // ----- Gather all related data (parallel reads) -----
  const [
    clinicalProfile,
    assessments,
    scoreResults,
    riskProfiles,
    measurements,
    nutritionSnapshots,
    activitySnapshots,
    followupPlans,
    alerts,
    consents,
    reportExports,
    auditEvents,
  ] = await Promise.all([
    supabaseAdmin.from('patient_clinical_profiles').select('*').eq('patient_id', patientId).maybeSingle(),
    supabaseAdmin
      .from('assessments')
      .select('id, patient_id, tenant_id, assessed_by, assessment_date, status, notes, engine_version, created_at, completed_at, reviewed_at, reviewed_by, clinical_input_snapshot, anonymized_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('score_results')
      .select('*, assessment:assessments!inner(patient_id)')
      .eq('assessments.patient_id', patientId),
    supabaseAdmin
      .from('risk_profiles')
      .select('*, assessment:assessments!inner(patient_id)')
      .eq('assessments.patient_id', patientId),
    supabaseAdmin
      .from('assessment_measurements')
      .select('*, assessment:assessments!inner(patient_id)')
      .eq('assessments.patient_id', patientId),
    supabaseAdmin
      .from('nutrition_snapshots')
      .select('*, assessment:assessments!inner(patient_id)')
      .eq('assessments.patient_id', patientId),
    supabaseAdmin
      .from('activity_snapshots')
      .select('*, assessment:assessments!inner(patient_id)')
      .eq('assessments.patient_id', patientId),
    supabaseAdmin.from('followup_plans').select('*').eq('patient_id', patientId),
    supabaseAdmin.from('alerts').select('*').eq('patient_id', patientId),
    supabaseAdmin
      .from('consent_records')
      .select('*')
      .eq('subject_type', 'patient')
      .eq('subject_id', patientId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('report_exports')
      .select(
        'id, assessment_id, export_type, storage_path, file_size_bytes, engine_version, report_version, created_at, exported_by',
      )
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('audit_events')
      .select('id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at')
      .eq('entity_type', 'patient')
      .eq('entity_id', patientId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  // ----- Record a data_subject_request for SLA tracking -----
  const { data: dsrRow } = await supabaseAdmin
    .from('data_subject_requests')
    .insert({
      tenant_id: patient.tenant_id,
      subject_patient_id: patientId,
      kind: 'access',
      status: 'fulfilled',
      requested_by_user_id: req.auth.userId,
      fulfilled_by_user_id: req.auth.userId,
      fulfilled_at: new Date().toISOString(),
      notes: 'Self-service export via /api/v1/patients/[id]/export',
    })
    .select('id')
    .maybeSingle();

  // ----- B-09 audit guarantee -----
  // GDPR Art.15/20 export is a high-impact PHI release; the audit row is the
  // primary evidence that the request was honoured (Art.30 §1 record). If we
  // can't write it, refuse to ship the envelope to the caller.
  // recordAuditStrict throws AuditWriteError on persistence failure so this
  // catch branch is reachable in practice.
  try {
    await recordAuditStrict(req.auth, {
      action: 'patient.export',
      resourceType: 'patient',
      resourceId: patientId,
      metadata: {
        dsr_id: dsrRow?.id ?? null,
        assessments_count: assessments.data?.length ?? 0,
        alerts_count: alerts.data?.length ?? 0,
        consents_count: consents.data?.length ?? 0,
        reports_count: reportExports.data?.length ?? 0,
      },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    logStructured('warn', 'AUDIT_BEST_EFFORT_FAILED', { context: 'patients.export audit write failed', extra: {
      patientId,
      isAuditWriteError: auditErr instanceof AuditWriteError,
      auditErr,
    } });
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
    return;
  }

  // ----- Envelope -----
  const envelope = {
    format: 'uelfy.patient-export/v1',
    generatedAt: new Date().toISOString(),
    generatedBy: {
      userId: req.auth.userId,
      role: req.auth.role,
    },
    tenantId: patient.tenant_id,
    patient,
    clinicalProfile: clinicalProfile.data ?? null,
    assessments: assessments.data ?? [],
    scoreResults: scoreResults.data ?? [],
    riskProfiles: riskProfiles.data ?? [],
    measurements: measurements.data ?? [],
    nutritionSnapshots: nutritionSnapshots.data ?? [],
    activitySnapshots: activitySnapshots.data ?? [],
    followupPlans: followupPlans.data ?? [],
    alerts: alerts.data ?? [],
    consents: consents.data ?? [],
    reportExports: reportExports.data ?? [],
    auditTrail: auditEvents.data ?? [],
    gdpr: {
      dataSubjectRequestId: dsrRow?.id ?? null,
      basis: ['Art.15', 'Art.20'],
      retentionPolicyNote:
        'Raw report PDF bytes are not included; request a signed URL via /api/v1/assessments/[id]/report?download=1. Audit IP hashes are omitted from this export for privacy.',
    },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="patient-${patientId}-export-${Date.now()}.json"`,
  );
  res.status(200).send(JSON.stringify(envelope, null, 2));
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const patientId = getPatientId(req);
  if (!patientId) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  // Low rate-limit: export is an expensive DB read; 5/min is plenty for legit
  const rl = await checkRateLimitAsync(req, { routeId: 'patient.export', max: 5, windowMs: 60_000 });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  await requireTenantMember((r, s) => handleExport(r, s, patientId))(req as any, res);
});
