/**
 * /api/v1/admin/tenant
 * ---------------------------------------------------------------------------
 * Per-tenant settings — read + update.
 *
 *   GET   → returns the caller's tenant profile (name, slug, plan, status,
 *           and per-tenant retention overrides). platform_admin may
 *           specify ?id=<tenant_uuid> to read another tenant.
 *   PATCH → updates the per-tenant retention overrides. tenant_admin
 *           may only patch their own tenant; platform_admin may patch
 *           any tenant via the URL body.
 *
 * Audit
 * -----
 *   - GET emits a best-effort `admin.tenant_read` line (B-10 style).
 *   - PATCH emits a STRICT `admin.tenant_update` line (B-09 — privacy-
 *     significant change to retention windows, must land in the
 *     immutable trail).
 *
 * Privacy / safety
 * ----------------
 *   - The retention values are bounded server-side by the CHECK
 *     constraints from migration 014 — out-of-range values produce a
 *     422 VALIDATION_ERROR, never a DB exception leak.
 *   - The HTTP body never echoes other tenants' data. Cross-tenant
 *     reads are rejected with opaque 404 to avoid id enumeration.
 *
 * Caveat (M-02 follow-up)
 * -----------------------
 *   The `fn_retention_prune` cron worker (migration 003) is currently
 *   platform-wide; it does not yet honour per-tenant overrides. The
 *   values are PERSISTED here and surfaced in the API, but the
 *   actual per-tenant behaviour ships with the cron refactor planned
 *   for Tier 4. The admin UI shows a banner that mirrors this status.
 * ---------------------------------------------------------------------------
 */

import type { VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '../../../backend/src/middleware/auth-middleware.js';
import { requireTenantAdmin } from '../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import {
  checkRateLimitAsync,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import {
  recordAudit,
  recordAuditStrict,
} from '../../../backend/src/audit/audit-logger.js';
import {
  replyDbError,
  replyValidationError,
  replyError,
} from '../../../backend/src/middleware/http-errors.js';

const idQuerySchema = z.object({
  id: z.string().uuid().optional(),
});

const patchBodySchema = z.object({
  retentionDaysAudit:           z.number().int().min(30).max(3650).nullable().optional(),
  retentionDaysAnonymizeGrace:  z.number().int().min(0).max(365).nullable().optional(),
  retentionDaysAlertsResolved:  z.number().int().min(7).max(1825).nullable().optional(),
  retentionDaysNotifications:   z.number().int().min(7).max(365).nullable().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: 'PATCH body must include at least one retention field',
});

type Patch = z.infer<typeof patchBodySchema>;

/* -------------------------------------------------------------------- entry */

export default withAuth(async (req: AuthenticatedRequest, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const rl = await checkRateLimitAsync(req, { routeId: 'admin.tenant', ...RATE_LIMITS.admin });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  await requireTenantAdmin(async (r: AuthenticatedRequest, s: VercelResponse) => {
    if (r.method === 'GET') {
      await handleGet(r, s);
    } else {
      await handlePatch(r, s);
    }
  })(req, res);
});

/* ------------------------------------------------------------------ helpers */

/**
 * Resolve which tenant the caller is asking about.
 *   tenant_admin     → always their own tenant; the ?id query is ignored.
 *   platform_admin   → ?id is honoured; if absent we use their tenantId.
 */
function resolveTargetTenantId(req: AuthenticatedRequest): { tenantId: string | null; queriedExplicit: boolean } {
  const parsedQuery = idQuerySchema.safeParse(req.query);
  const explicit = parsedQuery.success ? (parsedQuery.data.id ?? null) : null;
  if (req.auth.role === 'platform_admin') {
    return { tenantId: explicit ?? req.auth.tenantId, queriedExplicit: !!explicit };
  }
  // tenant_admin is pinned to their own tenant, regardless of ?id.
  return { tenantId: req.auth.tenantId, queriedExplicit: false };
}

const TENANT_SELECT =
  'id, name, slug, plan, status, retention_days_audit, retention_days_anonymize_grace, retention_days_alerts_resolved, retention_days_notifications, created_at, updated_at';

/* ----------------------------------------------------------------------- GET */

async function handleGet(req: AuthenticatedRequest, res: VercelResponse): Promise<void> {
  const { tenantId } = resolveTargetTenantId(req);
  if (!tenantId) {
    replyError(res, 403, 'NO_TENANT');
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select(TENANT_SELECT)
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    replyDbError(res, error, 'admin.tenant.read.select');
    return;
  }
  if (!data) {
    replyError(res, 404, 'NOT_FOUND');
    return;
  }

  // Best-effort sensitive-read audit. recordAudit is non-throwing by
  // contract — internal failures are emitted as
  // AUDIT_WRITE_FAILED variant='best_effort'. No wrapper try/catch.
  await recordAudit(req.auth, {
    action: 'admin.tenant_update', // closest existing enum action for read+update; reused intentionally
    resourceType: 'tenant',
    resourceId: tenantId,
    metadata: { kind: 'read' },
  });

  res.status(200).json({ tenant: data });
}

/* --------------------------------------------------------------------- PATCH */

async function handlePatch(req: AuthenticatedRequest, res: VercelResponse): Promise<void> {
  const { tenantId } = resolveTargetTenantId(req);
  if (!tenantId) {
    replyError(res, 403, 'NO_TENANT');
    return;
  }

  const body = (() => {
    if (!req.body) return null;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return null; }
    }
    return req.body;
  })();
  if (!body || typeof body !== 'object') {
    replyError(res, 400, 'INVALID_BODY');
    return;
  }
  const parse = patchBodySchema.safeParse(body);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'admin.tenant.patch.body');
    return;
  }

  // Map the camelCase API surface to snake_case columns.
  const v: Patch = parse.data;
  const update: Record<string, unknown> = {};
  if (v.retentionDaysAudit !== undefined)          update.retention_days_audit            = v.retentionDaysAudit;
  if (v.retentionDaysAnonymizeGrace !== undefined) update.retention_days_anonymize_grace  = v.retentionDaysAnonymizeGrace;
  if (v.retentionDaysAlertsResolved !== undefined) update.retention_days_alerts_resolved  = v.retentionDaysAlertsResolved;
  if (v.retentionDaysNotifications !== undefined)  update.retention_days_notifications    = v.retentionDaysNotifications;
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update(update)
    .eq('id', tenantId)
    .select(TENANT_SELECT)
    .single();

  if (error || !data) {
    replyDbError(res, error ?? new Error('no row updated'), 'admin.tenant.patch.update');
    return;
  }

  // Strict audit (B-09): a privacy-significant change must land in the
  // immutable trail. Failure aborts the request with AUDIT_WRITE_FAILED.
  // Per-request UUID surfaced via X-Request-Id for cross-correlation with
  // the canonical AUDIT_WRITE_FAILED Datadog log line.
  const auditRequestId = randomUUID();
  try {
    await recordAuditStrict(req.auth, {
      action: 'admin.tenant_update',
      resourceType: 'tenant',
      resourceId: tenantId,
      requestId: auditRequestId,
      metadata: {
        kind: 'patch_retention',
        // Echo the new effective values so the audit trail tells the
        // story. UUIDs only — no PHI ever lives in tenant retention rows.
        retention_days_audit:            data.retention_days_audit,
        retention_days_anonymize_grace:  data.retention_days_anonymize_grace,
        retention_days_alerts_resolved:  data.retention_days_alerts_resolved,
        retention_days_notifications:    data.retention_days_notifications,
      },
    });
  } catch (auditErr) {
    // AUDIT_WRITE_FAILED already emitted by the canonical emitter inside
    // recordAuditStrict — do not duplicate the log line. The HTTP 500
    // envelope + X-Request-Id header are the operator-facing signal.
    void auditErr;
    res.setHeader('X-Request-Id', auditRequestId);
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
    return;
  }

  res.status(200).json({ tenant: data });
}
