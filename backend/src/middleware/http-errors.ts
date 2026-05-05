/**
 * http-errors.ts
 * ---------------------------------------------------------------------------
 * Centralised HTTP error envelope for every serverless handler.
 *
 * Why this exists
 * ---------------
 * Audit finding B-05: most endpoints serialise PostgREST errors directly
 * into the response body, e.g.
 *
 *   res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
 *
 * That `message` field can disclose schema details:
 *   - column names ("column patients.tax_id_hash does not exist")
 *   - relation names ("relation public.assessments_legacy does not exist")
 *   - constraint names ("violates foreign key constraint patient_consents_patient_id_fkey")
 *   - even row data in some FK violation messages
 *
 * Real-world threats:
 *   1. Schema enumeration — an attacker probes the API with crafted UUIDs /
 *      bad payloads and reads back column / relation / FK names. From those
 *      they can infer the data model (cardiovascular tables, audit tables,
 *      etc.) without touching the database directly.
 *   2. RLS-policy probing — RLS denials surface as "new row violates
 *      row-level security policy", revealing which tables have RLS at all.
 *   3. Stack traces — when an exception happens inside Vercel's runtime, the
 *      default error.message can include file paths, package versions, etc.
 *
 * Defence
 * -------
 * This module exposes:
 *   - `replyError(res, status, code, opts?)`   → opaque envelope to the client
 *   - `replyDbError(res, error, ctx)`          → 500 + DB_ERROR + server log
 *   - `replyValidationError(res, issues, ctx)` → 422 (zod-style) — safe to
 *                                                echo because issues are about
 *                                                CLIENT input, not server state
 *
 * Server logs ALWAYS get the full PG error (stack, .details, .hint, .code).
 * Clients ALWAYS get a fixed schema:
 *
 *   {
 *     "error": {
 *       "code": "<application-stable code>",
 *       "requestId": "<uuid for cross-correlation with logs>"
 *     }
 *   }
 *
 * The `requestId` lets a developer paste it into the platform logs and find
 * the matching server-side log line — but it does not contain any PII or
 * schema info, so it can be safely shown to the user.
 * ---------------------------------------------------------------------------
 */

import type { VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import type { ZodIssue } from 'zod';
import { logStructured } from '../observability/structured-log.js';

/* ----------------------------- public API ------------------------------- */

export interface ErrorReplyOptions {
  /** Optional headers to set before sending the response (e.g. WWW-Authenticate). */
  headers?: Record<string, string>;
  /** Optional opaque retry hint, e.g. "60" for Retry-After. */
  retryAfterSec?: number;
  /** Pre-existing request id (request middleware may have minted one). */
  requestId?: string;
}

/**
 * Send a generic, opaque error response.
 *
 * Always returns a `requestId` so the client can quote it when reporting an
 * incident. The id is a v4 UUID — uncorrelated with patient / tenant.
 */
export function replyError(
  res: VercelResponse,
  status: number,
  code: string,
  opts: ErrorReplyOptions = {},
): string {
  const requestId = opts.requestId ?? randomUUID();
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) res.setHeader(k, v);
  }
  if (typeof opts.retryAfterSec === 'number' && opts.retryAfterSec > 0) {
    res.setHeader('Retry-After', String(Math.ceil(opts.retryAfterSec)));
  }
  res.setHeader('X-Request-Id', requestId);
  res.status(status).json({ error: { code, requestId } });
  return requestId;
}

/**
 * Reply 500 + DB_ERROR + log full PG error server-side.
 * `ctx` is included in the server log only — never returned to the client.
 */
export function replyDbError(
  res: VercelResponse,
  error: unknown,
  ctx: string,
): string {
  const requestId = randomUUID();
  const serialised = serializeError(error);
  logStructured('error', 'HTTP_DB_ERROR', {
    requestId,
    ctx,
    dbErrorMessage:
      typeof serialised === 'object' && serialised && 'message' in serialised
        ? (serialised as { message?: string }).message ?? null
        : null,
    dbErrorCode:
      typeof serialised === 'object' && serialised && 'code' in serialised
        ? (serialised as { code?: string }).code ?? null
        : null,
  });
  res.setHeader('X-Request-Id', requestId);
  res.status(500).json({ error: { code: 'DB_ERROR', requestId } });
  return requestId;
}

/**
 * Reply 422 + VALIDATION_ERROR with the zod issue list.
 *
 * Validation issues describe what the CLIENT sent, so they are safe to echo
 * back. We deliberately do NOT include the offending value in the response
 * (only the `path` and the `code`/`message` from zod) so we don't reflect
 * potential XSS payloads or sensitive data the client mis-typed.
 */
export function replyValidationError(
  res: VercelResponse,
  issues: ReadonlyArray<ZodIssue>,
  ctx: string,
): string {
  const requestId = randomUUID();
  const safe = issues.map((i) => ({
    path: i.path,
    code: i.code,
    message: i.message,
  }));
  logStructured('warn', 'HTTP_VALIDATION_REJECTED', {
    requestId,
    ctx,
    issueCount: safe.length,
    // First-issue summary keeps the log line bounded; full list is in the
    // 422 response body for the client to render.
    firstIssueCode: safe[0]?.code ?? null,
    firstIssuePath: safe[0]?.path?.join('.') ?? null,
  });
  res.setHeader('X-Request-Id', requestId);
  res.status(422).json({
    error: { code: 'VALIDATION_ERROR', requestId, issues: safe },
  });
  return requestId;
}

/* ------------------------ service-error envelope ------------------------ */

/**
 * Domain-stable error codes whose `message` is hand-written by us and
 * therefore safe to echo to the client. Any code NOT on this list is
 * collapsed to its `code` only (no message), so we don't accidentally
 * leak `pgErr.message` even when a service throws something looking like
 * `DB_ERROR` with a PostgREST message attached.
 */
const SAFE_TO_ECHO_CODES: ReadonlySet<string> = new Set([
  'ASSESSMENT_NOT_FOUND',
  'ALERT_NOT_FOUND',
  'PATIENT_NOT_FOUND',
  'PATIENT_INACTIVE',
  'REPORT_NOT_FOUND',
  'USER_NOT_FOUND',
  'MISSING_TOKEN',
  'NO_PATIENT_LINK',
  'INSUFFICIENT_ROLE',
  'CROSS_TENANT_FORBIDDEN',
  'DELETE_FORBIDDEN',
  'CONSENT_REQUIRED',
  'NO_TENANT',
  'INVALID_ID',
  'NO_FIELDS',
  'METHOD_NOT_ALLOWED',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'AUDIT_WRITE_FAILED',
  'ALREADY_RESOLVED',
  'CONFLICT',
]);

export interface ServiceLikeError {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
  name?: unknown;
}

/**
 * Convert a thrown service-layer error into a safe HTTP response.
 *
 * Rules:
 *  - If the error has a numeric `status` AND a string `code` AND the code
 *    is in the safe-echo list, we relay the message.
 *  - Otherwise we collapse to a 500 + opaque code, log the original
 *    server-side, and return a request-id for cross-correlation.
 */
export function replyServiceError(
  res: VercelResponse,
  err: unknown,
  ctx: string,
): string {
  const e = (err ?? {}) as ServiceLikeError;
  const status = typeof e.status === 'number' ? e.status : 500;
  const code = typeof e.code === 'string' ? e.code : 'INTERNAL_ERROR';
  const messageSafe =
    SAFE_TO_ECHO_CODES.has(code) && typeof e.message === 'string'
      ? e.message
      : undefined;

  const requestId = randomUUID();
  const serialised = serializeError(err);
  logStructured('error', 'HTTP_SERVICE_ERROR', {
    requestId,
    ctx,
    status,
    code,
    errorTag:
      typeof serialised === 'object' && serialised && 'message' in serialised
        ? (serialised as { message?: string }).message ?? null
        : null,
  });

  res.setHeader('X-Request-Id', requestId);
  const body: Record<string, unknown> = { code, requestId };
  if (messageSafe) body.message = messageSafe;
  res.status(status).json({ error: body });
  return requestId;
}

/* ----------------------------- helpers ---------------------------------- */

interface PgErrorLike {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

function serializeError(err: unknown): unknown {
  if (err && typeof err === 'object') {
    const e = err as PgErrorLike & { stack?: unknown; name?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : undefined,
      message: typeof e.message === 'string' ? e.message : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
      details: typeof e.details === 'string' ? e.details : undefined,
      hint: typeof e.hint === 'string' ? e.hint : undefined,
      stack: typeof e.stack === 'string' ? e.stack : undefined,
    };
  }
  return { value: String(err) };
}
