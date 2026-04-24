/**
 * GET /api/v1/patients/[id]/due-items
 *   List materialised follow-up / screening / manual due items for a
 *   patient. Supports countdown-style UIs (patient detail page).
 *
 * Auth: tenant member. Clinicians are additionally filtered by the
 * `professional_patient_links` relation via RLS on the `due_items` table
 * (migration 007). Service-role reads here bypass RLS but we still
 * enforce tenant scoping at the application layer so cross-tenant reads
 * cannot slip through when `platform_admin` is not present.
 *
 * Query parameters
 * ----------------
 *   status          open | acknowledged | completed | dismissed
 *                   default: open,acknowledged (countdown scope)
 *   source          followup | screening | manual
 *   priority        routine | moderate | urgent
 *   dueWithinDays   integer ≥ 0 — restrict to items due within N days.
 *                   Omitted → no upper bound.
 *   includePast     true | false (default true) — include overdue items.
 *   page, pageSize  pagination (default 1 / 50, max 200).
 *
 * Response
 * --------
 *   200 OK
 *   {
 *     items: DueItem[],      // includes computed `dueInDays`
 *     pagination: { page, pageSize, total },
 *     nowIso: string         // server anchor so the client countdown
 *                            // stays monotonic across clock drift.
 *   }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import {
  checkRateLimit,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';

// ============================================================================
// Schema
// ============================================================================

const STATUS = ['open', 'acknowledged', 'completed', 'dismissed'] as const;
const SOURCE = ['followup', 'screening', 'manual'] as const;
const PRIORITY = ['routine', 'moderate', 'urgent'] as const;

const querySchema = z.object({
  status: z
    .union([z.enum(STATUS), z.array(z.enum(STATUS))])
    .optional(),
  source: z
    .union([z.enum(SOURCE), z.array(z.enum(SOURCE))])
    .optional(),
  priority: z
    .union([z.enum(PRIORITY), z.array(z.enum(PRIORITY))])
    .optional(),
  dueWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  includePast: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ============================================================================
// Helpers
// ============================================================================

function getPatientId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

function asArray<T extends string>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

/** Days between `now` and an ISO date — negative when `due_at` is past. */
function daysBetween(nowIso: string, dueIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(
    Number(nowIso.slice(0, 4)),
    Number(nowIso.slice(5, 7)) - 1,
    Number(nowIso.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(dueIso.slice(0, 4)),
    Number(dueIso.slice(5, 7)) - 1,
    Number(dueIso.slice(8, 10)),
  );
  return Math.round((b - a) / MS_PER_DAY);
}

// ============================================================================
// Handler
// ============================================================================

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.' },
    });
    return;
  }

  const patientId = getPatientId(req);
  if (!patientId) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid patient id.' },
    });
    return;
  }

  const rl = checkRateLimit(req, {
    routeId: 'due-items.list',
    ...RATE_LIMITS.read,
  });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
    });
    return;
  }

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      s.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid query parameters.',
          details: parse.error.flatten(),
        },
      });
      return;
    }
    const {
      status,
      source,
      priority,
      dueWithinDays,
      includePast,
      page,
      pageSize,
    } = parse.data;

    const statusFilter = asArray(status) ?? ['open', 'acknowledged'];
    const sourceFilter = asArray(source);
    const priorityFilter = asArray(priority);

    // Enforce tenant isolation at the application layer too. RLS remains
    // the primary gate, but belt-and-braces stops cross-tenant reads
    // even when the service role is used.
    const now = new Date();
    const nowIso = now.toISOString();
    const nowDateIso = nowIso.slice(0, 10);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = supabaseAdmin
      .from('due_items')
      .select('*', { count: 'exact' })
      .eq('patient_id', patientId)
      .in('status', statusFilter);

    if (r.auth.role !== 'platform_admin') {
      q = q.eq('tenant_id', r.auth.tenantId);
    }
    if (sourceFilter) q = q.in('source_engine', sourceFilter);
    if (priorityFilter) q = q.in('priority', priorityFilter);

    if (!includePast) q = q.gte('due_at', nowDateIso);
    if (typeof dueWithinDays === 'number') {
      const upper = new Date(now.getTime());
      upper.setUTCDate(upper.getUTCDate() + dueWithinDays);
      q = q.lte('due_at', upper.toISOString().slice(0, 10));
    }

    const { data, error, count } = await q
      .order('due_at', { ascending: true })
      .order('priority', { ascending: false })
      .range(from, to);

    if (error) {
      s.status(500).json({
        error: { code: 'DB_ERROR', message: error.message },
      });
      return;
    }

    const items = (data ?? []).map((row: any) => {
      const dueIso: string = String(row.due_at);
      return {
        id: row.id,
        tenantId: row.tenant_id,
        patientId: row.patient_id,
        assessmentId: row.assessment_id,
        sourceEngine: row.source_engine,
        itemCode: row.item_code,
        title: row.title,
        rationale: row.rationale,
        guidelineSource: row.guideline_source,
        priority: row.priority,
        domain: row.domain,
        dueAt: dueIso,
        dueInDays: daysBetween(nowDateIso, dueIso),
        recurrenceMonths: row.recurrence_months,
        status: row.status,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedBy: row.acknowledged_by,
        completedAt: row.completed_at,
        completedBy: row.completed_by,
        dismissedAt: row.dismissed_at,
        dismissedBy: row.dismissed_by,
        dismissedReason: row.dismissed_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    s.status(200).json({
      items,
      pagination: { page, pageSize, total: count ?? 0 },
      nowIso,
    });
  })(req as any, res);
});
