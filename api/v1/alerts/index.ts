/**
 * /api/v1/alerts
 *   GET — paginated list of alerts in the caller's tenant, filtered by
 *   status and severity. Used by the Alerts page and the Dashboard's
 *   "Open high-severity alerts" card.
 *
 * RLS enforces tenant isolation at the DB layer; the handler additionally
 * filters explicitly by tenant_id as defence-in-depth.
 *
 * Query:
 *   ?status=open|acknowledged|resolved|dismissed    (default: open)
 *   ?severity=info|warning|critical                 (optional)
 *   ?audience=clinician|patient|both|system         (optional)
 *   ?patientId=<uuid>                               (optional filter)
 *   ?page=1&pageSize=50
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';

const querySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).default('open'),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  audience: z.enum(['clinician', 'patient', 'both', 'system']).optional(),
  patientId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

async function handleList(req: any, res: VercelResponse): Promise<void> {
  const parse = querySchema.safeParse(req.query);
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
  const q = parse.data;

  const from = (q.page - 1) * q.pageSize;
  const to = from + q.pageSize - 1;

  let query = supabaseAdmin
    .from('alerts')
    .select(
      'id, tenant_id, patient_id, assessment_id, type, severity, status, audience, title, message, metadata, due_at, acknowledged_at, acknowledged_by, resolved_at, created_at, patient:patients(id, display_name, external_code)',
      { count: 'exact' },
    )
    .eq('status', q.status)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (req.auth.role !== 'platform_admin') {
    query = query.eq('tenant_id', req.auth.tenantId);
  }
  if (q.severity) query = query.eq('severity', q.severity);
  if (q.audience) query = query.eq('audience', q.audience);
  if (q.patientId) query = query.eq('patient_id', q.patientId);

  const { data, error, count } = await query;
  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  res.status(200).json({
    alerts: data ?? [],
    pagination: { page: q.page, pageSize: q.pageSize, total: count ?? 0 },
  });
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'alerts.list', ...RATE_LIMITS.read });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    return;
  }

  await requireTenantMember((r, s) => handleList(r, s))(req as any, res);
});
