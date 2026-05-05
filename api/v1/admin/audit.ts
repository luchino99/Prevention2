/**
 * GET /api/v1/admin/audit
 *   Admin-only audit log browsing endpoint.
 *   Supports filters: actor_user_id, resource_type, resource_id, action,
 *   outcome, from, to.
 *   format=csv returns a downloadable text/csv body for offline review;
 *   default is JSON paginated listing.
 *   tenant_admin sees only their own tenant; platform_admin sees all.
 *
 * Response shape (json)
 * ---------------------
 *   {
 *     events: AuditEventRow[],          // canonical key — used to be 'logs'
 *     pagination: { page, pageSize, total }
 *   }
 *
 * The previous shape used `logs` for the array; the live frontend
 * (`pages/audit.js`) destructures `events`, so the page silently rendered
 * an empty table. Renamed here to align contract with the frontend
 * consumer (M-09 Tier 2 fix).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware.js';
import { requireTenantAdmin } from '../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import {
  replyDbError,
  replyValidationError,
  replyError,
} from '../../../backend/src/middleware/http-errors.js';

const querySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
  action: z.string().max(80).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  // CSV exports may need to dump up to 5000 rows in a single fetch.
  // The 200-row limit applies to JSON paginated listings.
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
  format: z.enum(['json', 'csv']).default('json'),
});

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const rl = await checkRateLimitAsync(req, { routeId: 'admin.audit', ...RATE_LIMITS.admin });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  await requireTenantAdmin(async (r: any, s: VercelResponse) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      replyValidationError(s, parse.error.issues, 'admin.audit.query');
      return;
    }
    const q = parse.data;
    const from = (q.page - 1) * q.pageSize;
    const to = from + q.pageSize - 1;

    // Table name and column names aligned with
    // supabase/migrations/001_schema_foundation.sql.
    // The public query-param names (resourceType/resourceId) are kept stable
    // as the API contract; only the DB column names are mapped internally.
    let query = supabaseAdmin
      .from('audit_events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (r.auth.role !== 'platform_admin') {
      query = query.eq('tenant_id', r.auth.tenantId);
    }
    if (q.actorUserId)  query = query.eq('actor_user_id', q.actorUserId);
    if (q.resourceType) query = query.eq('entity_type',   q.resourceType);
    if (q.resourceId)   query = query.eq('entity_id',     q.resourceId);
    if (q.action)       query = query.eq('action',        q.action);
    if (q.outcome)      query = query.eq('outcome',       q.outcome);
    if (q.from)         query = query.gte('created_at', q.from);
    if (q.to)           query = query.lte('created_at', q.to);

    const { data, error, count } = await query;
    if (error) {
      replyDbError(s, error, 'admin.audit.select');
      return;
    }

    if (q.format === 'csv') {
      const rows = data ?? [];
      const csv = renderAuditCsv(rows);
      const filename = `uelfy-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      s.setHeader('Content-Type', 'text/csv; charset=utf-8');
      s.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      s.status(200).send(csv);
      return;
    }

    s.status(200).json({
      events: data ?? [],
      pagination: { page: q.page, pageSize: q.pageSize, total: count ?? 0 },
    });
  })(req as any, res);
});

/**
 * Render an audit_events recordset as RFC 4180-ish CSV with a stable
 * column order. The `metadata_json` column is JSON-encoded into a single
 * cell — tools like Excel / Google Sheets render it as a string, but
 * `python -c "import csv,json"` round-trips it cleanly for forensic
 * analysis. We DO NOT explode the JSON into per-key columns: it is
 * polymorphic by audit action and would break tabular shape.
 */
function renderAuditCsv(rows: Array<Record<string, unknown>>): string {
  const columns = [
    'created_at',
    'tenant_id',
    'action',
    'entity_type',
    'entity_id',
    'actor_user_id',
    'actor_role',
    'outcome',
    'failure_reason',
    'ip_hash',
    'user_agent',
    'metadata_json',
  ];

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    // RFC 4180: enclose any field that contains "  ,  \r  \n in quotes;
    // double internal quotes.
    if (/[",\r\n]/.test(s)) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.join(',');
  const body = rows
    .map((r) => columns.map((c) => escape(r[c])).join(','))
    .join('\r\n');
  return `${header}\r\n${body}\r\n`;
}
