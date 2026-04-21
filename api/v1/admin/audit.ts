/**
 * GET /api/v1/admin/audit
 *   Admin-only audit log browsing endpoint.
 *   Supports filters: actor_user_id, resource_type, resource_id, action, from, to.
 *   tenant_admin sees only their own tenant; platform_admin sees all.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware.js';
import { requireTenantAdmin } from '../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';

const querySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
  action: z.string().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'admin.audit', ...RATE_LIMITS.admin });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;

  await requireTenantAdmin(async (r: any, s: VercelResponse) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      s.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid query' } });
      return;
    }
    const q = parse.data;
    const from = (q.page - 1) * q.pageSize;
    const to = from + q.pageSize - 1;

    let query = supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (r.auth.role !== 'platform_admin') {
      query = query.eq('tenant_id', r.auth.tenantId);
    }
    if (q.actorUserId) query = query.eq('actor_user_id', q.actorUserId);
    if (q.resourceType) query = query.eq('resource_type', q.resourceType);
    if (q.resourceId) query = query.eq('resource_id', q.resourceId);
    if (q.action) query = query.eq('action', q.action);
    if (q.from) query = query.gte('created_at', q.from);
    if (q.to) query = query.lte('created_at', q.to);

    const { data, error, count } = await query;
    if (error) {
      s.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
      return;
    }

    s.status(200).json({
      logs: data ?? [],
      pagination: { page: q.page, pageSize: q.pageSize, total: count ?? 0 },
    });
  })(req as any, res);
});
