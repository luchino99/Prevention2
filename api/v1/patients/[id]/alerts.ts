/**
 * GET /api/v1/patients/[id]/alerts
 *   Lists alerts for a patient. Filterable by status and severity.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { recordAudit } from '../../../../backend/src/audit/audit-logger.js';
import { replyDbError, replyValidationError, replyError } from '../../../../backend/src/middleware/http-errors.js';
import { logStructured } from '../../../../backend/src/observability/structured-log.js';

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
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const patientId = getPatientId(req);
  if (!patientId) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  const rl = await checkRateLimitAsync(req, { routeId: 'alerts.list', ...RATE_LIMITS.read });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
    return;
  }

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      replyValidationError(s, parse.error.issues, 'patients.alerts.query');
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
      replyDbError(s, error, 'patients.alerts.select');
      return;
    }

    // B-10 — sensitive read audit (per-patient alert listing).
    try {
      await recordAudit(r.auth, {
        action: 'alert.list',
        resourceType: 'alert',
        resourceId: null,
        metadata: {
          patient_id: patientId,
          status: status ?? null,
          severity: severity ?? null,
          result_count: data?.length ?? 0,
        },
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      logStructured('warn', 'AUDIT_BEST_EFFORT_FAILED', { context: 'patients.alerts audit best-effort failed', extra: { patientId, auditErr } });
    }

    s.status(200).json({
      alerts: data ?? [],
      pagination: { page, pageSize, total: count ?? 0 },
    });
  })(req as any, res);
});
