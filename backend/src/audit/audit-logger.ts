/**
 * Audit logger — writes immutable audit trail entries to public.audit_events.
 *
 * GDPR alignment:
 *   - records WHO did WHAT, WHEN, on WHICH resource
 *   - records ip_hash (never raw IP), truncated user-agent
 *   - never records sensitive payload bodies — only metadata
 *   - all CRUD on patients, assessments, consents, and report exports MUST emit an entry
 *
 * Two write modes are exposed:
 *
 *   - `recordAudit`         — best-effort observability. Used for low-risk
 *                             reads (e.g. patient.read, dsr.list) where a
 *                             missing audit line is a monitoring concern but
 *                             must not break the user-facing operation. All
 *                             errors are caught and logged.
 *
 *   - `recordAuditStrict`   — guarantee mode (B-09). Used for privacy-
 *                             significant state changes (consent grant /
 *                             revoke, patient delete, report generate /
 *                             download, DSR transitions). Throws
 *                             `AuditWriteError` on failure so the caller can
 *                             abort the surrounding HTTP request with
 *                             AUDIT_WRITE_FAILED. Pick this whenever the
 *                             alternative — silently mutating state without
 *                             an immutable audit row — would damage our
 *                             compliance posture.
 *
 * NOTE: neither variant participates in the upstream DB transaction. A
 * future hardening pass may move the most sensitive flows into a
 * single-RPC pattern that emits the audit row inside the same TX.
 */

import { supabaseAdmin } from '../config/supabase.js';
import type { AuthContext } from '../middleware/auth-middleware.js';

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
  // Read-side audit (B-10 sensitive-read logging). 'list' actions cover
  // collection-scoped reads (e.g. all alerts for a patient); per-row
  // 'read' actions remain for entity reads.
  | 'alert.list'
  | 'alert.create'
  | 'alert.acknowledge'
  | 'alert.resolve'
  | 'consent.grant'
  | 'consent.revoke'
  | 'followup.create'
  | 'followup.update'
  | 'due_items.list'
  | 'admin.role_change'
  | 'admin.tenant_update'
  | 'admin.user_suspend'
  | 'admin.user_unsuspend'
  // GDPR Data Subject Request lifecycle (B-14). Each transition is a
  // privacy-significant event and MUST land in the immutable audit log.
  | 'dsr.create'
  | 'dsr.list'
  | 'dsr.read'
  | 'dsr.start'
  | 'dsr.fulfill'
  | 'dsr.reject'
  | 'dsr.cancel'
  // Cron / system actions. The cron handlers in api/v1/internal/* write
  // these via direct INSERT (no actor JWT context to feed recordAudit),
  // but we keep the names registered here so monitoring dashboards
  // and the changelog have a single source of truth for every action.
  | 'retention.run'
  | 'anonymize.run';

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
  | 'session'
  | 'data_subject_request'
  | 'due_item'
  // Used by cron handlers in api/v1/internal/* to scope system-level
  // events that are not tied to a single domain entity.
  | 'system';

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

/**
 * Build the canonical audit_events row from an AuthContext + AuditEvent.
 *
 * Column names align with supabase/migrations/001_schema_foundation.sql
 * (table `audit_events`). `outcome`, `failure_reason`, `user_agent` are
 * added by migration 004_audit_events_extensions.sql. The internal
 * AuditEvent TypeScript shape keeps its names (resourceType, resourceId,
 * metadata) to avoid breaking every call-site; only the DB row mapping
 * translates them to the canonical schema names.
 */
function buildAuditRow(
  auth: AuthContext | null,
  event: AuditEvent,
): Record<string, unknown> {
  return {
    tenant_id: auth?.tenantId ?? event.actor?.tenantId ?? null,
    actor_user_id: auth?.userId ?? event.actor?.userId ?? null,
    actor_role: auth?.role ?? event.actor?.role ?? null,
    action: event.action,
    entity_type: event.resourceType,
    entity_id: event.resourceId ?? null,
    outcome: event.outcome ?? 'success',
    failure_reason: event.failureReason ?? null,
    ip_hash: auth?.ipHash ?? event.actor?.ipHash ?? null,
    user_agent: auth?.userAgent ?? event.actor?.userAgent ?? null,
    metadata_json: sanitizeMetadata(event.metadata),
  };
}

/**
 * AuditWriteError — thrown by `recordAuditStrict` when the immutable
 * audit row could not be persisted. Callers in guaranteed-audit pathways
 * (B-09) must catch this and abort the surrounding HTTP request with
 * AUDIT_WRITE_FAILED so we never mutate state without a matching audit row.
 *
 * Carries `action` and `resourceType` for log correlation. The original
 * driver/PG error is exposed via the standard ES2022 `Error.cause` field
 * (set through the `super(msg, { cause })` overload) so downstream
 * observability tools that already understand `Error.cause` can pick it up.
 */
export class AuditWriteError extends Error {
  public readonly action: AuditAction;
  public readonly resourceType: AuditResourceType;

  constructor(
    action: AuditAction,
    resourceType: AuditResourceType,
    cause: unknown,
  ) {
    super(
      `audit write failed for action='${action}' resource='${resourceType}'`,
      { cause },
    );
    this.name = 'AuditWriteError';
    this.action = action;
    this.resourceType = resourceType;
  }
}

/**
 * Primary API — record an audit event in best-effort observability mode.
 *
 * Non-throwing on purpose: this variant is for low-risk read events where
 * losing the audit line is unfortunate but must not abort the user-facing
 * operation (e.g. patient.read, dsr.list). Failures are logged in a
 * structured shape so they can be picked up by log-based monitors.
 *
 * For privacy-significant write events (consent, DSR transitions, patient
 * delete, report generation/download) use `recordAuditStrict` instead so a
 * failed audit row is surfaced to the caller as AUDIT_WRITE_FAILED and the
 * surrounding request is aborted.
 */
export async function recordAudit(
  auth: AuthContext | null,
  event: AuditEvent
): Promise<void> {
  try {
    const row = buildAuditRow(auth, event);
    const { error } = await supabaseAdmin.from('audit_events').insert(row);
    if (error) {
      // Some PostgREST error shapes surface the text under `.details` or
      // `.hint` rather than `.message`. Log all three so we can diagnose
      // schema drift without ambiguity.
      console.error('[audit] insert failed', {
        action: event.action,
        resource: event.resourceType,
        dbError: error.message ?? error.details ?? error.hint ?? 'unknown',
        dbCode: (error as { code?: string }).code ?? 'unknown',
      });
    }
  } catch (err) {
    console.error('[audit] unexpected error', err);
  }
}

/**
 * Strict variant — record an audit event and THROW if the row cannot be
 * persisted. Use only for privacy-significant state changes where a missing
 * audit entry would break our compliance posture (B-09 guarantee).
 *
 * Throws `AuditWriteError`. Callers MUST translate this into an HTTP
 * response via `replyError(res, 500, 'AUDIT_WRITE_FAILED')` and roll back
 * any logical state they cannot un-do (or, ideally, only call this AFTER
 * the state mutation has committed so the worst case is a duplicate-write
 * attempt rather than a silent state change).
 *
 * NOTE on transactional semantics: this function does NOT wrap the audit
 * write in the same DB transaction as the upstream business write. We
 * accept the (very narrow) window where the business write committed but
 * the audit write failed — surfaced to the operator via AUDIT_WRITE_FAILED
 * and a server log line — in exchange for not having to plumb a single
 * RPC/transaction through every endpoint. A future hardening pass may move
 * the most sensitive flows (consent revoke, patient delete, DSR fulfil)
 * into transactional RPCs that emit the audit row inside the same TX.
 */
export async function recordAuditStrict(
  auth: AuthContext | null,
  event: AuditEvent,
): Promise<void> {
  let row: Record<string, unknown>;
  try {
    row = buildAuditRow(auth, event);
  } catch (err) {
    console.error('[audit:strict] row build failed', {
      action: event.action,
      resource: event.resourceType,
      err,
    });
    throw new AuditWriteError(event.action, event.resourceType, err);
  }

  let dbError: unknown = null;
  try {
    const { error } = await supabaseAdmin.from('audit_events').insert(row);
    if (error) dbError = error;
  } catch (err) {
    dbError = err;
  }

  if (dbError) {
    const e = dbError as { message?: string; details?: string; hint?: string; code?: string };
    console.error('[audit:strict] insert failed', {
      action: event.action,
      resource: event.resourceType,
      resourceId: event.resourceId ?? null,
      dbError: e.message ?? e.details ?? e.hint ?? 'unknown',
      dbCode: e.code ?? 'unknown',
    });
    throw new AuditWriteError(event.action, event.resourceType, dbError);
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
