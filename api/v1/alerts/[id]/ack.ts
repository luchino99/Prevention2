/**
 * POST /api/v1/alerts/[id]/ack
 *   Acknowledge (or resolve / dismiss) an alert.
 *   Body: { action: 'acknowledge' | 'resolve' | 'dismiss', note?: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireClinicalWrite } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { recordAuditStrict, AuditWriteError } from '../../../../backend/src/audit/audit-logger.js';
import { replyDbError, replyValidationError, replyError } from '../../../../backend/src/middleware/http-errors.js';

const bodySchema = z.object({
  action: z.enum(['acknowledge', 'resolve', 'dismiss']),
  note: z.string().max(1000).optional(),
});

function getId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

const ACTION_TO_STATUS = {
  acknowledge: 'acknowledged',
  resolve: 'resolved',
  dismiss: 'dismissed',
} as const;

const ACTION_TO_AUDIT = {
  acknowledge: 'alert.acknowledge',
  resolve: 'alert.resolve',
  dismiss: 'alert.acknowledge', // mapped to the closest canonical audit action
} as const;

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const id = getId(req);
  if (!id) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'alerts.ack', ...RATE_LIMITS.write });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
    return;
  }

  await requireClinicalWrite(async (r: any, s: VercelResponse) => {
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      replyValidationError(s, parse.error.issues, 'alerts.ack.body');
      return;
    }
    const { action, note } = parse.data as {
      action: 'acknowledge' | 'resolve' | 'dismiss';
      note?: string;
    };

    // Load alert and verify tenant
    const { data: alert, error: loadErr } = await supabaseAdmin
      .from('alerts')
      .select('id, tenant_id, status, acknowledged_at, metadata')
      .eq('id', id)
      .single();
    if (loadErr || !alert) {
      // Collapse "real DB error" and "row absent" to a single 404 — disclosing
      // which row exists vs not is itself a tenant-leak primitive.
      replyError(s, 404, 'ALERT_NOT_FOUND');
      return;
    }
    if (r.auth.role !== 'platform_admin' && alert.tenant_id !== r.auth.tenantId) {
      replyError(s, 403, 'CROSS_TENANT_FORBIDDEN');
      return;
    }

    const newStatus = ACTION_TO_STATUS[action];
    const nowIso = new Date().toISOString();

    // Canonical schema (001_schema_foundation.sql §13 alerts) has:
    //   acknowledged_at TIMESTAMPTZ
    //   acknowledged_by UUID REFERENCES users(id)
    //   resolved_at     TIMESTAMPTZ
    // There is NO resolved_by and NO `note` column. Operator notes and
    // state-transition metadata are stored in `alerts.metadata` (JSONB).
    const update: Record<string, unknown> = {
      status: newStatus,
    };
    if (action === 'acknowledge') {
      update.acknowledged_at = nowIso;
      update.acknowledged_by = r.auth.userId;
    }
    if (action === 'resolve') {
      update.resolved_at = nowIso;
      // If never acknowledged, treat resolution as implicit ack-by-this-user
      // so `acknowledged_by` has correct provenance for auditability.
      if (!alert.acknowledged_at) {
        update.acknowledged_at = nowIso;
        update.acknowledged_by = r.auth.userId;
      }
    }
    // Preserve operator note inside the canonical metadata JSON column.
    if (note && note.length > 0) {
      update.metadata = {
        ...(alert.metadata ?? {}),
        last_action_note: {
          action,
          by_user_id: r.auth.userId,
          at: nowIso,
          text: note,
        },
      };
    }

    const { data, error } = await supabaseAdmin
      .from('alerts')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      replyDbError(s, error, 'alerts.ack.update');
      return;
    }

    // B-09 — audit guarantee for state-changing alert actions. We DO want
    // alert acks to fail loudly if the audit row can't be written; the
    // alert state has changed and the reviewer needs assurance this is
    // recorded. recordAuditStrict throws AuditWriteError if the row cannot
    // be persisted (vs. recordAudit which only logs), so the catch branch
    // here is reachable in practice.
    try {
      await recordAuditStrict(r.auth, {
        action: ACTION_TO_AUDIT[action],
        resourceType: 'alert',
        resourceId: id,
        metadata: { previous_status: alert.status, new_status: newStatus },
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      console.error('[alerts.ack] audit write failed', {
        id,
        isAuditWriteError: auditErr instanceof AuditWriteError,
        auditErr,
      });
      replyError(s, 500, 'AUDIT_WRITE_FAILED');
      return;
    }

    s.status(200).json({ alert: data });
  })(req as any, res);
});
