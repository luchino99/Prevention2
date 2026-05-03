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
import { logStructured } from '../../../../backend/src/observability/structured-log.js';
import {
  checkRateLimitAsync,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { resolvePublicGuidelineRef } from '../../../../backend/src/domain/clinical/guideline-catalog/index.js';
import { recordAudit } from '../../../../backend/src/audit/audit-logger.js';
import {
  replyDbError,
  replyValidationError,
  replyError,
} from '../../../../backend/src/middleware/http-errors.js';

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

/**
 * Canonical countdown status model (ISSUE 5). Computed server-side from
 * the signed `dueInDays` so every client renders the same buckets and
 * timezone ambiguity is resolved against the server anchor `nowIso`.
 *
 * Thresholds (document-once so the UI cannot drift):
 *   overdue    : dueInDays  <  0
 *   due_now    : 0 ≤ dueInDays ≤ 1     (today or tomorrow)
 *   due_soon   : 2 ≤ dueInDays ≤ 14    (within two weeks)
 *   upcoming   : dueInDays > 14
 */
export type CountdownStatus =
  | 'overdue'
  | 'due_now'
  | 'due_soon'
  | 'upcoming';

function computeCountdownStatus(dueInDays: number): CountdownStatus {
  if (dueInDays < 0) return 'overdue';
  if (dueInDays <= 1) return 'due_now';
  if (dueInDays <= 14) return 'due_soon';
  return 'upcoming';
}

// ============================================================================
// Handler
// ============================================================================

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

  const rl = await checkRateLimitAsync(req, {
    routeId: 'due-items.list',
    ...RATE_LIMITS.read,
  });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      replyValidationError(s, parse.error.issues, 'patients.due-items.query');
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
      replyDbError(s, error, 'patients.due-items.select');
      return;
    }

    // B-10 — sensitive read audit. Listing due items reveals upcoming
    // screenings / follow-ups for a specific patient. Best-effort: a
    // failed audit row must not block the read because countdown
    // refreshes are high-frequency.
    try {
      await recordAudit(r.auth, {
        action: 'due_items.list',
        resourceType: 'due_item',
        resourceId: null,
        metadata: {
          patient_id: patientId,
          status: statusFilter,
          source: sourceFilter ?? null,
          priority: priorityFilter ?? null,
          due_within_days: dueWithinDays ?? null,
          include_past: includePast,
          result_count: data?.length ?? 0,
          page,
          page_size: pageSize,
        },
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      logStructured('warn', 'AUDIT_BEST_EFFORT_FAILED', { context: 'patients.due-items audit best-effort failed', extra: {
        patientId,
        auditErr,
      } });
    }

    const items = (data ?? []).map((row: any) => {
      const dueIso: string = String(row.due_at);
      const dueInDays = daysBetween(nowDateIso, dueIso);
      const countdownStatus = computeCountdownStatus(dueInDays);
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
        // WS6 — structured projection of `guideline_source` through the
        // server catalog. Null for off-catalog legacy rows; the UI falls
        // back to the raw string in that case.
        guideline: resolvePublicGuidelineRef(row.guideline_source),
        priority: row.priority,
        domain: row.domain,
        dueAt: dueIso,
        dueInDays,
        countdownStatus,
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

    // Aggregate counts so the UI subline can be rendered without a
    // second pass over `items` and so a future "inbox" view can use the
    // buckets directly.
    const summary = {
      total: count ?? items.length,
      overdue: items.filter((i) => i.countdownStatus === 'overdue').length,
      dueNow: items.filter((i) => i.countdownStatus === 'due_now').length,
      dueSoon: items.filter((i) => i.countdownStatus === 'due_soon').length,
      upcoming: items.filter((i) => i.countdownStatus === 'upcoming').length,
    };

    s.status(200).json({
      items,
      summary,
      pagination: { page, pageSize, total: count ?? 0 },
      nowIso,
      thresholds: {
        overdue: 'dueInDays < 0',
        due_now: '0..1 days',
        due_soon: '2..14 days',
        upcoming: '> 14 days',
      },
    });
  })(req as any, res);
});
