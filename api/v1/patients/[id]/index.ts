/**
 * /api/v1/patients/[id]
 *   GET    — fetch a single patient (with last assessment summary)
 *   PATCH  — update patient demographics / contact / notes
 *   DELETE — soft-delete patient (sets deleted_at, never destructive)
 *
 * All operations log audit events.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware';
import { requireTenantMember, requireClinicalWrite, requireTenantAdmin } from '../../../../backend/src/middleware/rbac';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit';
import { supabaseAdmin } from '../../../../backend/src/config/supabase';
import { recordAudit } from '../../../../backend/src/audit/audit-logger';
import { updatePatientSchema } from '../../../../shared/schemas/patient-input';

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
    res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: 'Patient not found' } });
    return null;
  }
  return data;
}

async function handleGet(req: any, res: VercelResponse, patientId: string): Promise<void> {
  const patient = await loadPatient(req, res, patientId);
  if (!patient) return;

  const { data: lastAssessment } = await supabaseAdmin
    .from('assessments')
    .select('id, created_at, composite_risk_score, composite_risk_band, status')
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
    res.status(422).json({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid payload', details: parse.error.issues },
    });
    return;
  }
  const patient = await loadPatient(req, res, patientId);
  if (!patient) return;

  const update: Record<string, unknown> = {};
  const p = parse.data;
  if (p.displayRef !== undefined) update.display_ref = p.displayRef;
  if (p.firstName !== undefined) update.first_name = p.firstName;
  if (p.lastName !== undefined) update.last_name = p.lastName;
  if (p.dateOfBirth !== undefined) update.date_of_birth = p.dateOfBirth;
  if (p.sex !== undefined) update.sex = p.sex;
  if (p.email !== undefined) update.email = p.email;
  if (p.phone !== undefined) update.phone = p.phone;
  if (p.notes !== undefined) update.notes = p.notes;

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: { code: 'NO_FIELDS', message: 'No fields to update' } });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('patients')
    .update(update)
    .eq('id', patientId)
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
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
  const patient = await loadPatient(req, res, patientId);
  if (!patient) return;

  const { error } = await supabaseAdmin
    .from('patients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', patientId);

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  await recordAudit(req.auth, {
    action: 'patient.delete',
    resourceType: 'patient',
    resourceId: patientId,
  });

  res.status(204).end();
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  const patientId = getPatientId(req);
  if (!patientId) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid patient id' } });
    return;
  }

  if (req.method === 'GET') {
    const rl = checkRateLimit(req, { routeId: 'patients.read', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireTenantMember((r, s) => handleGet(r, s, patientId))(req as any, res);
    return;
  }

  if (req.method === 'PATCH') {
    const rl = checkRateLimit(req, { routeId: 'patients.update', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireClinicalWrite((r, s) => handleUpdate(r, s, patientId))(req as any, res);
    return;
  }

  if (req.method === 'DELETE') {
    const rl = checkRateLimit(req, { routeId: 'patients.delete', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireTenantAdmin((r, s) => handleDelete(r, s, patientId))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
});
