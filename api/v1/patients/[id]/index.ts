/**
 * /api/v1/patients/[id]
 *   GET    — fetch a single patient (with last assessment summary)
 *   PATCH  — update patient demographics / contact / notes
 *   DELETE — soft-delete patient (sets deleted_at, never destructive)
 *
 * All operations log audit events.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember, requireClinicalWrite, requireTenantAdmin } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { logStructured } from '../../../../backend/src/observability/structured-log.js';
import {
  recordAudit,
  recordAuditStrict,
  AuditWriteError,
} from '../../../../backend/src/audit/audit-logger.js';
import { updatePatientSchema } from '../../../../shared/schemas/patient-input.js';
import { replyDbError, replyValidationError, replyError } from '../../../../backend/src/middleware/http-errors.js';

function getPatientId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  // UUID v4-ish format
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

async function loadPatient(req: any, res: VercelResponse, patientId: string): Promise<any | null> {
  let q = supabaseAdmin.from('patients').select('*').eq('id', patientId).is('deleted_at', null);
  if (req.auth.role !== 'platform_admin') q = q.eq('tenant_id', req.auth.tenantId);
  const { data, error } = await q.single();
  if (error || !data) {
    // Return 404 even on real DB errors — disclosing "DB error" vs "not
    // found" lets an attacker enumerate patient IDs across tenants.
    replyError(res, 404, 'PATIENT_NOT_FOUND');
    return null;
  }
  return data;
}

async function handleGet(req: any, res: VercelResponse, patientId: string): Promise<void> {
  const patient = await loadPatient(req, res, patientId);
  if (!patient) return;

  // `composite_risk_*` fields live in the separate `risk_profiles` table
  // (see 001_schema_foundation.sql §9), not on `assessments`. We join via
  // the 1:1 relation so the dashboard can still render a summary.
  const { data: lastAssessment } = await supabaseAdmin
    .from('assessments')
    .select(
      'id, created_at, assessment_date, status, engine_version, risk_profile:risk_profiles(composite_risk_level, composite_score)',
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: openAlertCount } = await supabaseAdmin
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patientId)
    .eq('status', 'open');

  await recordAudit(req.auth, {
    action: 'patient.read',
    resourceType: 'patient',
    resourceId: patientId,
  });

  res.status(200).json({
    patient,
    lastAssessment,
    openAlertCount: openAlertCount ?? 0,
  });
}

async function handleUpdate(req: any, res: VercelResponse, patientId: string): Promise<void> {
  const parse = updatePatientSchema.safeParse(req.body);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'patients.update.body');
    return;
  }
  const patient = await loadPatient(req, res, patientId);
  if (!patient) return;

  // Unpack the (partial) nested shape into the flat DB column layout.
  // `updatePatientSchema` keeps `demographics` as partial so every field
  // is individually optional; `contact` / `notes` stay optional at the
  // outer level. All keys must match canonical schema names (see
  // 001_schema_foundation.sql §4 patients).
  const update: Record<string, unknown> = {};
  const p = parse.data;
  const demo = p.demographics;
  if (demo) {
    if (demo.externalCode !== undefined) update.external_code = demo.externalCode;
    if (demo.firstName !== undefined) update.first_name = demo.firstName;
    if (demo.lastName !== undefined) update.last_name = demo.lastName;
    // If first/last name changed, refresh the canonical display_name
    if (demo.firstName !== undefined || demo.lastName !== undefined) {
      const first = demo.firstName ?? patient.first_name ?? '';
      const last = demo.lastName ?? patient.last_name ?? '';
      const combined = `${first} ${last}`.trim();
      if (combined.length > 0) update.display_name = combined;
    }
    if (demo.dateOfBirth !== undefined) {
      const birthDateStr =
        demo.dateOfBirth instanceof Date
          ? demo.dateOfBirth.toISOString().slice(0, 10)
          : demo.dateOfBirth;
      update.birth_date = birthDateStr;
      const y =
        demo.dateOfBirth instanceof Date
          ? demo.dateOfBirth.getUTCFullYear()
          : typeof demo.dateOfBirth === 'string'
            ? new Date(demo.dateOfBirth).getUTCFullYear()
            : null;
      if (Number.isFinite(y)) update.birth_year = y;
    }
    if (demo.sex !== undefined) update.sex = demo.sex;
  }
  const contact = p.contact;
  if (contact) {
    if (contact.email !== undefined) update.contact_email = contact.email;
    if (contact.phoneNumber !== undefined) update.contact_phone = contact.phoneNumber;
  }
  if (p.notes !== undefined) update.notes = p.notes;
  if (p.consentGiven !== undefined) {
    update.consent_status = p.consentGiven ? 'active' : 'pending';
  }

  if (Object.keys(update).length === 0) {
    replyError(res, 400, 'NO_FIELDS');
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('patients')
    .update(update)
    .eq('id', patientId)
    .select('*')
    .single();

  if (error) {
    replyDbError(res, error, 'patients.update');
    return;
  }

  await recordAudit(req.auth, {
    action: 'patient.update',
    resourceType: 'patient',
    resourceId: patientId,
    metadata: { fields: Object.keys(update) },
  });

  res.status(200).json({ patient: data });
}

async function handleDelete(req: any, res: VercelResponse, patientId: string): Promise<void> {
  // B-07 — DELETE patient privilege:
  //   * `requireTenantAdmin` (route-level) ensures only tenant_admin /
  //     platform_admin can call this handler.
  //   * `loadPatient` enforces same-tenant — non-platform admins cannot
  //     delete a patient outside their tenant_id.
  //   * `recordAudit` MUST succeed before we 204 (B-09); a deletion that
  //     leaves no audit trail is, for our compliance posture, worse than
  //     refusing the deletion.
  const patient = await loadPatient(req, res, patientId);
  if (!patient) return;

  const { error } = await supabaseAdmin
    .from('patients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', patientId);

  if (error) {
    replyDbError(res, error, 'patients.delete');
    return;
  }

  // B-09 — audit guarantee: await + propagate. If the audit write fails we
  // surface a 500 so the operator notices; the soft-delete is reversible
  // (anonymisation cron runs T+30d) so this is the safe direction.
  // recordAuditStrict throws AuditWriteError on persistence failure (vs.
  // recordAudit which only logs), so this catch branch is reachable.
  try {
    await recordAuditStrict(req.auth, {
      action: 'patient.delete',
      resourceType: 'patient',
      resourceId: patientId,
      metadata: { tenantId: patient.tenant_id },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    logStructured('warn', 'AUDIT_BEST_EFFORT_FAILED', { context: 'patients.delete audit write failed', extra: {
      patientId,
      isAuditWriteError: auditErr instanceof AuditWriteError,
      auditErr,
    } });
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
    return;
  }

  res.status(204).end();
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  const patientId = getPatientId(req);
  if (!patientId) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  if (req.method === 'GET') {
    const rl = await checkRateLimitAsync(req, { routeId: 'patients.read', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireTenantMember((r, s) => handleGet(r, s, patientId))(req as any, res);
    return;
  }

  if (req.method === 'PATCH') {
    const rl = await checkRateLimitAsync(req, { routeId: 'patients.update', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireClinicalWrite((r, s) => handleUpdate(r, s, patientId))(req as any, res);
    return;
  }

  if (req.method === 'DELETE') {
    const rl = await checkRateLimitAsync(req, { routeId: 'patients.delete', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireTenantAdmin((r, s) => handleDelete(r, s, patientId))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  replyError(res, 405, 'METHOD_NOT_ALLOWED');
});
