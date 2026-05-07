/**
 * POST /api/v1/alerts/[id]/ack
 *   Acknowledge / resolve / dismiss an alert.
 *
 *   Body:
 *     {
 *       action: 'acknowledge' | 'resolve' | 'dismiss',
 *       note?:  string  // REQUIRED for resolve and dismiss (Sprint 4 t4.2)
 *     }
 *
 * Sprint 4 task 4.2 — F-014 hardening:
 *   * `resolve` and `dismiss` now require a non-empty `note` (≥3 chars).
 *     Closing an alert without documenting why was the previous loophole
 *     that let the inbox be silently emptied with no clinical reasoning.
 *     `acknowledge` keeps `note` optional ("I see this, working on it").
 *   * Provenance is now fully symmetric: alongside the existing
 *     `acknowledged_at`/`acknowledged_by`, we set `resolved_at`/
 *     `resolved_by` for resolve and `dismissed_at`/`dismissed_by` for
 *     dismiss — so every closure has a who + when (NIS2 / IEC 62304).
 *   * `dismiss` writes the canonical `alert.dismiss` audit action (added
 *     to the audit registry in this sprint) instead of being collapsed
 *     onto `alert.acknowledge`.
 *
 * State machine (post-019):
 *
 *   open  ───acknowledge──▶ acknowledged ───resolve──▶ resolved
 *     │           │             │                         │
 *     │           └──dismiss────┴──dismiss───▶ dismissed   │
 *     │                                                    │
 *     └──resolve──▶ resolved (implicit ack-by-this-user) ──┘
 *
 * Closed states (resolved, dismissed) are terminal in this endpoint.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireClinicalWrite } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { recordAuditStrict, emitAccessDenialLog } from '../../../../backend/src/audit/audit-logger.js';
import { replyDbError, replyValidationError, replyError } from '../../../../backend/src/middleware/http-errors.js';

/**
 * Per-action body schema. We use a discriminated union so the validator
 * itself enforces the "note required for resolve/dismiss" rule — no manual
 * post-parse checks, no risk of drift between docs and code.
 *
 * `note` length cap (1000) is unchanged from the pre-019 endpoint; the
 * lower bound (3 chars) is new and prevents trivial "ok"/"x" placeholders
 * from satisfying the requirement on paper while contributing nothing to
 * the audit trail.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('acknowledge'),
    note: z.string().min(1).max(1000).optional(),
  }),
  z.object({
    action: z.literal('resolve'),
    note: z.string().trim().min(3, 'NOTE_REQUIRED').max(1000),
  }),
  z.object({
    action: z.literal('dismiss'),
    note: z.string().trim().min(3, 'NOTE_REQUIRED').max(1000),
  }),
]);

type AckAction = 'acknowledge' | 'resolve' | 'dismiss';

function getId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

const ACTION_TO_STATUS: Record<AckAction, 'acknowledged' | 'resolved' | 'dismissed'> = {
  acknowledge: 'acknowledged',
  resolve: 'resolved',
  dismiss: 'dismissed',
};

/**
 * Sprint 4 task 4.2: dismiss now has its own canonical audit action
 * instead of being silently mapped onto acknowledge.
 */
const ACTION_TO_AUDIT: Record<AckAction, 'alert.acknowledge' | 'alert.resolve' | 'alert.dismiss'> = {
  acknowledge: 'alert.acknowledge',
  resolve: 'alert.resolve',
  dismiss: 'alert.dismiss',
};

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

  const rl = await checkRateLimitAsync(req, { routeId: 'alerts.ack', ...RATE_LIMITS.write });
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
    const action = parse.data.action;
    const note = 'note' in parse.data ? parse.data.note : undefined;

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
      emitAccessDenialLog({
        reason: 'cross_tenant',
        actorUserId: r.auth.userId,
        actorRole: r.auth.role,
        actorTenantId: r.auth.tenantId,
        ipHash: r.auth.ipHash ?? null,
        route: 'POST /api/v1/alerts/[id]/ack',
        targetResourceId: id,
        targetTenantId: alert.tenant_id as string,
      });
      replyError(s, 403, 'CROSS_TENANT_FORBIDDEN');
      return;
    }

    // Terminal-state guard: resolved / dismissed alerts must NOT be
    // reopened or re-closed via this endpoint. Returning 409 lets the UI
    // surface the actual state without ambiguity.
    if (alert.status === 'resolved' || alert.status === 'dismissed') {
      replyError(s, 409, 'ALERT_ALREADY_CLOSED');
      return;
    }

    const newStatus = ACTION_TO_STATUS[action];
    const nowIso = new Date().toISOString();

    // Migration 019 added: dismissed_at, dismissed_by, resolved_by.
    // Pre-019 the schema only had acknowledged_at/by + resolved_at →
    // resolution and dismissal lacked actor provenance.
    const update: Record<string, unknown> = {
      status: newStatus,
    };

    if (action === 'acknowledge') {
      update.acknowledged_at = nowIso;
      update.acknowledged_by = r.auth.userId;
    } else if (action === 'resolve') {
      update.resolved_at = nowIso;
      update.resolved_by  = r.auth.userId;
      // If never acknowledged, treat resolution as implicit ack-by-this-user
      // so `acknowledged_by` has correct provenance for auditability.
      if (!alert.acknowledged_at) {
        update.acknowledged_at = nowIso;
        update.acknowledged_by = r.auth.userId;
      }
    } else if (action === 'dismiss') {
      update.dismissed_at = nowIso;
      update.dismissed_by = r.auth.userId;
      // Same reasoning as resolve — if no prior ack, fold one in so the
      // timeline shows the same user closed it.
      if (!alert.acknowledged_at) {
        update.acknowledged_at = nowIso;
        update.acknowledged_by = r.auth.userId;
      }
    }

    // Operator note → preserved inside the canonical metadata JSONB column.
    // We append (do not overwrite) by deep-merging onto the existing
    // metadata, so prior auto-close markers or earlier notes survive.
    if (note && note.length > 0) {
      update.metadata = {
        ...((alert.metadata as Record<string, unknown> | null) ?? {}),
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
    // alert closures to fail loudly if the audit row can't be written: the
    // alert state has changed and the reviewer needs assurance this is
    // recorded. recordAuditStrict throws AuditWriteError if the row cannot
    // be persisted (vs. recordAudit which only logs), so the catch branch
    // here is reachable in practice. The canonical AUDIT_WRITE_FAILED
    // structured event is emitted by recordAuditStrict itself; we only
    // need to fail-closed and surface the requestId via X-Request-Id for
    // operator cross-correlation with the Datadog log line.
    const auditRequestId = randomUUID();
    try {
      await recordAuditStrict(r.auth, {
        action: ACTION_TO_AUDIT[action],
        resourceType: 'alert',
        resourceId: id,
        requestId: auditRequestId,
        metadata: {
          previous_status: alert.status,
          new_status: newStatus,
          note_present: typeof note === 'string' && note.length > 0,
        },
      });
    } catch (auditErr) {
      void auditErr;
      s.setHeader('X-Request-Id', auditRequestId);
      replyError(s, 500, 'AUDIT_WRITE_FAILED');
      return;
    }

    s.status(200).json({ alert: data });
  })(req as any, res);
});
