/**
 * /api/v1/patients
 *   GET  — paginated list of patients in the caller's tenant
 *   POST — create a new patient (clinician/tenant_admin/platform_admin)
 *
 * RLS enforces tenant isolation at the DB layer; the handler additionally
 * double-checks roles and emits audit events.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware';
import { requireTenantMember, requireClinicalWrite } from '../../../backend/src/middleware/rbac';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit';
import { supabaseAdmin } from '../../../backend/src/config/supabase';
import { recordAudit } from '../../../backend/src/audit/audit-logger';
import { createPatientSchema } from '../../../shared/schemas/patient-input';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
});

async function handleList(req: any, res: VercelResponse): Promise<void> {
  const parse = listQuerySchema.safeParse(req.query);
  if (!parse.success) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid query',
        details: parse.error.issues,
      },
    });
    return;
  }
  const { page, pageSize, search } = parse.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('patients')
    .select('id, display_ref, first_name, last_name, date_of_birth, sex, created_at, tenant_id', {
      count: 'exact',
    })
    .range(from, to)
    .order('created_at', { ascending: false });

  if (req.auth.role !== 'platform_admin') {
    query = query.eq('tenant_id', req.auth.tenantId);
  }

  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,display_ref.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  res.status(200).json({
    patients: data ?? [],
    pagination: { page, pageSize, total: count ?? 0 },
  });
}

async function handleCreate(req: any, res: VercelResponse): Promise<void> {
  const parse = createPatientSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid patient payload',
        details: parse.error.issues,
      },
    });
    return;
  }
  const payload = parse.data;

  if (!req.auth.tenantId) {
    res.status(400).json({
      error: { code: 'NO_TENANT', message: 'User is not associated with a tenant' },
    });
    return;
  }

  // Unpack the validated nested shape (demographics / contact) into the
  // flat DB column layout expected by `001_schema_foundation.sql`.
  const demo = payload.demographics;
  const contact = payload.contact;
  const dob =
    demo.dateOfBirth instanceof Date
      ? demo.dateOfBirth.toISOString().slice(0, 10)
      : demo.dateOfBirth;

  const { data, error } = await supabaseAdmin
    .from('patients')
    .insert({
      tenant_id: req.auth.tenantId,
      created_by_user_id: req.auth.userId,
      display_ref: demo.externalCode,
      first_name: demo.firstName,
      last_name: demo.lastName,
      date_of_birth: dob,
      sex: demo.sex,
      email: contact?.email ?? null,
      phone: contact?.phoneNumber ?? null,
      notes: payload.notes ?? null,
    })
    .select('id, display_ref, first_name, last_name, date_of_birth, sex, created_at')
    .single();

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  await recordAudit(req.auth, {
    action: 'patient.create',
    resourceType: 'patient',
    resourceId: data.id,
  });

  res.status(201).json({ patient: data });
}

export default withAuth(async (req: VercelRequest & { auth: any }, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method === 'GET') {
    const rl = checkRateLimit(req, { routeId: 'patients.list', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
      return;
    }
    await requireTenantMember((r, s) => handleList(r, s))(req as any, res);
    return;
  }

  if (req.method === 'POST') {
    const rl = checkRateLimit(req, { routeId: 'patients.create', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
      return;
    }
    await requireClinicalWrite((r, s) => handleCreate(r, s))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST only' } });
});
