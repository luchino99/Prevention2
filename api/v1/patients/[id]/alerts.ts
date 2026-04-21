/**
 * GET /api/v1/patients/[id]/alerts
 *   Lists alerts for a patient. Filterable by status and severity.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';

const querySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional(),
  severity: z.enum(['info', 'low', 'moderate', 'high', 'critical']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

function getPatientId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
    return;
  }

  const patientId = getPatientId(req);
  if (!patientId) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: '' } });
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'alerts.list', ...RATE_LIMITS.read });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      s.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid query' } });
      return;
    }
    const { status, severity, page, pageSize } = parse.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = supabaseAdmin
      .from('alerts')
      .select('*', { count: 'exact' })
      .eq('patient_id', patientId);

    if (r.auth.role !== 'platform_admin') q = q.eq('tenant_id', r.auth.tenantId);
    if (status) q = q.eq('status', status);
    if (severity) q = q.eq('severity', severity);

    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      s.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
      return;
    }

    s.status(200).json({
      alerts: data ?? [],
      pagination: { page, pageSize, total: count ?? 0 },
    });
  })(req as any, res);
});
