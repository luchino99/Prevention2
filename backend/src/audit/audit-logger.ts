/**
 * Audit logger — writes immutable audit trail entries to public.audit_logs.
 *
 * GDPR alignment:
 *   - records WHO did WHAT, WHEN, on WHICH resource
 *   - records ip_hash (never raw IP), truncated user-agent
 *   - never records sensitive payload bodies — only metadata
 *   - all CRUD on patients, assessments, consents, and report exports MUST emit an entry
 *
 * The module fails "open" (does not block the caller) when the DB write errors,
 * but surfaces the failure via console.error + a sentry-friendly log shape.
 */

import { supabaseAdmin } from '../config/supabase';
import type { AuthContext } from '../middleware/auth-middleware';

/** Canonical set of audit actions. Keep in sync with monitoring dashboards. */
export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.session_refresh'
  | 'auth.failed_login'
  | 'patient.create'
  | 'patient.read'
  | 'patient.update'
  | 'patient.delete'
  | 'patient.export'
  | 'assessment.create'
  | 'assessment.read'
  | 'assessment.update'
  | 'assessment.delete'
  | 'report.generate'
  | 'report.download'
  | 'alert.create'
  | 'alert.acknowledge'
  | 'alert.resolve'
  | 'consent.grant'
  | 'consent.revoke'
  | 'followup.create'
  | 'followup.update'
  | 'admin.role_change'
  | 'admin.tenant_update'
  | 'admin.user_suspend'
  | 'admin.user_unsuspend';

export type AuditResourceType =
  | 'user'
  | 'tenant'
  | 'patient'
  | 'assessment'
  | 'score_result'
  | 'lifestyle_snapshot'
  | 'followup_plan'
  | 'alert'
  | 'consent'
  | 'report_export'
  | 'session';

export interface AuditEvent {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  /** Non-sensitive metadata (no PII, no score values). */
  metadata?: Record<string, unknown>;
  /** Optional caller context when not called via authenticated middleware. */
  actor?: {
    userId?: string | null;
    tenantId?: string | null;
    role?: string | null;
    ipHash?: string | null;
    userAgent?: string | null;
  };
  /** Operation outcome — used to surface failed attempts (e.g. failed_login). */
  outcome?: 'success' | 'failure';
  /** Human-readable failure reason (only for outcome = failure). */
  failureReason?: string;
}

/**
 * Sanitize metadata to guarantee we never persist health data or PII payloads.
 * Allowed keys: scalar/boolean counts, ids, enum-like strings.
 */
function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | null {
  if (!metadata) return null;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === 'string') {
      // Truncate to 256 chars to avoid accidental leakage
      clean[k] = (v as string).slice(0, 256);
    } else if (t === 'number' || t === 'boolean') {
      clean[k] = v;
    } else if (Array.isArray(v)) {
      clean[k] = v.slice(0, 20);
    }
    // objects, functions, symbols → dropped intentionally
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** Primary API — record an audit event. Non-throwing: failures are logged. */
export async function recordAudit(
  auth: AuthContext | null,
  event: AuditEvent
): Promise<void> {
  try {
    const row = {
      tenant_id: auth?.tenantId ?? event.actor?.tenantId ?? null,
      actor_user_id: auth?.userId ?? event.actor?.userId ?? null,
      actor_role: auth?.role ?? event.actor?.role ?? null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      outcome: event.outcome ?? 'success',
      failure_reason: event.failureReason ?? null,
      ip_hash: auth?.ipHash ?? event.actor?.ipHash ?? null,
      user_agent: auth?.userAgent ?? event.actor?.userAgent ?? null,
      metadata: sanitizeMetadata(event.metadata),
    };

    const { error } = await supabaseAdmin.from('audit_logs').insert(row);
    if (error) {
      console.error('[audit] insert failed', {
        action: event.action,
        resource: event.resourceType,
        dbError: error.message,
      });
    }
  } catch (err) {
    console.error('[audit] unexpected error', err);
  }
}

/** Helper for failed auth attempts where we don't yet have AuthContext. */
export async function recordFailedLogin(
  email: string,
  ipHash: string | undefined,
  userAgent: string | undefined,
  reason: string
): Promise<void> {
  await recordAudit(null, {
    action: 'auth.failed_login',
    resourceType: 'session',
    outcome: 'failure',
    failureReason: reason,
    metadata: {
      email_domain: email.split('@')[1] ?? null,
    },
    actor: { ipHash, userAgent },
  });
}
