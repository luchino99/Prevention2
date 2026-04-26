/**
 * /api/v1/admin/dsr
 * ---------------------------------------------------------------------------
 * GDPR Data Subject Request (DSR) ledger — list + create.
 *
 * Audit blocker addressed
 * -----------------------
 *   B-14  GDPR Art.15/17/20 fulfilment workflow had no API surface. The
 *         table `data_subject_requests` was created in migration 003 but
 *         no endpoint existed to write into it, list pending requests,
 *         or transition state. Tenants therefore had no auditable way to
 *         fulfil a data subject request within the 30-day Art.12(3) SLA.
 *
 * Scope of this file
 * ------------------
 *   GET   /api/v1/admin/dsr            — list requests for the caller's tenant
 *   POST  /api/v1/admin/dsr            — file a new request
 *
 * Single-request reads and the state-machine processor live in
 *   - api/v1/admin/dsr/[id]/index.ts          (GET single)
 *   - api/v1/admin/dsr/[id]/process.ts        (POST transition + worker)
 *
 * Authorization
 * -------------
 *   - Only tenant_admin and platform_admin may interact with this surface.
 *   - tenant_admin is scoped to its own tenant via SELECT/INSERT filters.
 *   - platform_admin sees and writes across tenants (cross-tenant by design).
 *   - clinicians and assistants are denied at the role gate.
 *
 * Privacy notes
 * -------------
 *   - The body NEVER returns the full subject record — only identifiers.
 *     The actual PHI export is materialised by the /process endpoint and
 *     stored in a private bucket with a signed URL.
 *   - Rate-limited under the `admin` bucket so a leaked admin token cannot
 *     enumerate DSRs at line rate.
 * ---------------------------------------------------------------------------
 */

import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantAdmin } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import {
  checkRateLimit,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import {
  recordAudit,
  recordAuditStrict,
  AuditWriteError,
} from '../../../../backend/src/audit/audit-logger.js';
import {
  replyDbError,
  replyValidationError,
  replyError,
} from '../../../../backend/src/middleware/http-errors.js';

/* ------------------------------------------------------------------ types */

const DSR_KINDS = [
  'access',
  'erasure',
  'portability',
  'rectification',
  'restriction',
  'objection',
] as const;

const DSR_STATUSES = [
  'received',
  'in_progress',
  'fulfilled',
  'rejected',
  'cancelled',
] as const;

const listQuerySchema = z.object({
  status: z.enum(DSR_STATUSES).optional(),
  kind: z.enum(DSR_KINDS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Body schema for filing a new DSR. Exactly one of subjectPatientId /
 * subjectUserId must be set — the DB CHECK constraint enforces it but
 * we surface a friendlier 422 here.
 */
const createBodySchema = z
  .object({
    kind: z.enum(DSR_KINDS),
    subjectPatientId: z.string().uuid().nullable().optional(),
    subjectUserId: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.subjectPatientId && !v.subjectUserId) ||
      (!v.subjectPatientId && v.subjectUserId),
    {
      message: 'exactly one of subjectPatientId or subjectUserId must be set',
      path: ['subjectPatientId'],
    },
  );

/* ------------------------------------------------------------------ entry */

export default withAuth(async (req: AuthenticatedRequest, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'admin.dsr', ...RATE_LIMITS.admin });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  await requireTenantAdmin(async (r: AuthenticatedRequest, s: VercelResponse) => {
    if (r.method === 'GET') {
      await handleList(r, s);
    } else {
      await handleCreate(r, s);
    }
  })(req, res);
});

/* -------------------------------------------------------------------- GET */

async function handleList(req: AuthenticatedRequest, res: VercelResponse): Promise<void> {
  const parse = listQuerySchema.safeParse(req.query);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'admin.dsr.list.query');
    return;
  }
  const q = parse.data;
  const from = (q.page - 1) * q.pageSize;
  const to = from + q.pageSize - 1;

  let query = supabaseAdmin
    .from('data_subject_requests')
    .select(
      'id, tenant_id, subject_patient_id, subject_user_id, kind, status, '
        + 'requested_by_user_id, fulfilled_by_user_id, export_storage_path, '
        + 'rejection_reason, notes, requested_at, fulfilled_at, sla_deadline',
      { count: 'exact' },
    )
    .order('requested_at', { ascending: false })
    .range(from, to);

  // Tenant scoping — platform_admin bypasses by design, tenant_admin is
  // pinned to its own tenant. The matching RLS policy in migration 003
  // (`dsr_tenant_read`) is the primary boundary; this filter is
  // defence-in-depth so a future RLS misconfig does not leak rows.
  if (req.auth.role !== 'platform_admin') {
    if (!req.auth.tenantId) {
      replyError(res, 403, 'NO_TENANT');
      return;
    }
    query = query.eq('tenant_id', req.auth.tenantId);
  }

  if (q.status) query = query.eq('status', q.status);
  if (q.kind) query = query.eq('kind', q.kind);
  if (q.from) query = query.gte('requested_at', q.from);
  if (q.to) query = query.lte('requested_at', q.to);

  const { data, error, count } = await query;
  if (error) {
    replyDbError(res, error, 'admin.dsr.list.select');
    return;
  }

  // Best-effort sensitive-read audit (B-10). DSR listings reveal pending
  // privacy obligations — log who looked, when, and the filter shape.
  try {
    await recordAudit(req.auth, {
      action: 'dsr.list',
      resourceType: 'data_subject_request',
      metadata: {
        status: q.status ?? null,
        kind: q.kind ?? null,
        from: q.from ?? null,
        to: q.to ?? null,
        page: q.page,
        page_size: q.pageSize,
        result_count: data?.length ?? 0,
      },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error('[admin.dsr.list] audit best-effort failed', { auditErr });
  }

  res.status(200).json({
    requests: data ?? [],
    pagination: { page: q.page, pageSize: q.pageSize, total: count ?? 0 },
  });
}

/* -------------------------------------------------------------------- POST */

async function handleCreate(req: AuthenticatedRequest, res: VercelResponse): Promise<void> {
  const body = (() => {
    if (!req.body) return null;
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    }
    return req.body;
  })();
  if (!body || typeof body !== 'object') {
    replyError(res, 400, 'INVALID_BODY');
    return;
  }

  const parse = createBodySchema.safeParse(body);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'admin.dsr.create.body');
    return;
  }
  const v = parse.data;

  // Resolve target tenant. Platform admins may file a DSR on any tenant
  // by passing a target via the patient/user lookup; tenant_admin can
  // only file within its own tenant.
  let targetTenantId: string;

  if (v.subjectPatientId) {
    const { data: patient, error: patErr } = await supabaseAdmin
      .from('patients')
      .select('id, tenant_id')
      .eq('id', v.subjectPatientId)
      .maybeSingle();
    if (patErr) {
      replyDbError(res, patErr, 'admin.dsr.create.patient_lookup');
      return;
    }
    if (!patient) {
      replyError(res, 404, 'PATIENT_NOT_FOUND');
      return;
    }
    targetTenantId = patient.tenant_id as string;
  } else {
    // subjectUserId is set (refine() guaranteed it).
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id')
      .eq('id', v.subjectUserId as string)
      .maybeSingle();
    if (userErr) {
      replyDbError(res, userErr, 'admin.dsr.create.user_lookup');
      return;
    }
    if (!user) {
      replyError(res, 404, 'USER_NOT_FOUND');
      return;
    }
    targetTenantId = (user.tenant_id as string | null) ?? '';
    if (!targetTenantId) {
      // Subjects without a tenant (e.g. platform_admin users) cannot be
      // governed by a tenant-scoped DSR ledger. Reject deterministically.
      replyError(res, 422, 'NO_TENANT');
      return;
    }
  }

  if (req.auth.role !== 'platform_admin' && targetTenantId !== req.auth.tenantId) {
    replyError(res, 403, 'CROSS_TENANT_FORBIDDEN');
    return;
  }

  const insertRow = {
    tenant_id: targetTenantId,
    subject_patient_id: v.subjectPatientId ?? null,
    subject_user_id: v.subjectUserId ?? null,
    kind: v.kind,
    status: 'received' as const,
    requested_by_user_id: req.auth.userId,
    notes: v.notes ?? null,
    // sla_deadline default (NOW() + 30 days) is set by the schema.
  };

  // NB: select string MUST be a single string literal — see explanation
  // in api/v1/admin/dsr/[id]/index.ts. Concat collapses to `string` and
  // supabase-js v2 then types `data` as `GenericStringError`.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('data_subject_requests')
    .insert(insertRow)
    .select(
      'id, tenant_id, subject_patient_id, subject_user_id, kind, status, requested_by_user_id, requested_at, sla_deadline, notes',
    )
    .single();

  if (insErr || !inserted) {
    replyDbError(res, insErr ?? new Error('insert returned no row'), 'admin.dsr.create.insert');
    return;
  }

  // Guarantee audit (B-09). Filing a DSR is a privacy-significant event
  // that MUST be recorded — if the audit insert fails we surface the
  // failure to the caller instead of silently dropping it.
  // recordAuditStrict throws AuditWriteError on persistence failure (vs.
  // recordAudit which only logs), so this catch branch is reachable.
  try {
    await recordAuditStrict(req.auth, {
      action: 'dsr.create',
      resourceType: 'data_subject_request',
      resourceId: inserted.id as string,
      metadata: {
        kind: v.kind,
        subject_patient_id: v.subjectPatientId ?? null,
        subject_user_id: v.subjectUserId ?? null,
        target_tenant_id: targetTenantId,
        sla_deadline: inserted.sla_deadline,
      },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error('[admin.dsr.create] audit guarantee failed', {
      isAuditWriteError: auditErr instanceof AuditWriteError,
      auditErr,
    });
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
    return;
  }

  res.status(201).json({ request: inserted });
}
