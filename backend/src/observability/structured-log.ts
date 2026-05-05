/**
 * structured-log.ts
 * ----------------------------------------------------------------------------
 * Single source of truth for the **machine-parseable** server-side log
 * surface. Datadog (via Vercel Log Drains) and any other JSON-aware
 * aggregator can `@event:<NAME>`-filter the entire stream because every
 * line emitted through this module is ONE valid JSON object on stderr/stdout.
 *
 * Contract — frozen
 * -----------------
 *   - Every emitted line is a single `JSON.stringify({...})` call.
 *   - No prose prefix (`[xxx] foo`), no trailing text, no console.log
 *     for security events.
 *   - The first key is always `event` so a grep on `"event":"…"` is a
 *     sufficient filter.
 *   - PHI is never serialised. Callers MUST pass UUIDs, enums, and short
 *     scalar tags only. The `truncate()` helper caps strings at 256 chars
 *     so a runaway DB error message cannot bloat the log line beyond
 *     Datadog's per-line ingest budget.
 *
 * Canonical event vocabulary (do not invent new ones without updating
 * the dashboard query catalogue in `docs/27-INCIDENT-RESPONSE.md`):
 *
 *   AUDIT_WRITE_FAILED            — strict / best-effort audit insert failed
 *   ACCESS_DENIED                 — auth / RBAC denial (warn level)
 *   RATE_LIMIT_BACKEND_FAILURE    — distributed limiter unreachable / misconfigured
 *   AUDIT_BEST_EFFORT_FAILED      — best-effort audit row dropped (B-10 reads etc.)
 *   STORAGE_OPERATION_FAILED      — Supabase Storage call (signed URL, upload, …) failed
 *   AUTH_PROFILE_LOOKUP_FAILED    — withAuth could not load public.users row
 *   AUTH_UNEXPECTED_ERROR         — withAuth catch-all (no AuthError instance)
 *   ASSESSMENT_RPC_FAILED         — create_assessment_atomic RPC threw
 *
 * Severity convention
 * -------------------
 *   error → console.error → red-pillar dashboard, paging-eligible
 *   warn  → console.warn  → yellow-pillar, review queue
 *   info  → console.info  → optional / auditing-only
 *
 * The level is chosen by the caller because the same `event` may be
 * either error- or warn-level depending on context (e.g. ACCESS_DENIED
 * is warn for `role_mismatch`, error for `cross_tenant`).
 * ----------------------------------------------------------------------------
 */

export type LogLevel = 'error' | 'warn' | 'info';

const MAX_FIELD_STRING_LEN = 256;

/**
 * Defensive truncation: bounds the size of any string field so a
 * runaway error message does not bloat the log line. Object/array
 * values are passed through as-is — callers are expected to have
 * pre-sanitised them (no PHI, no full payloads).
 */
function truncate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.length > MAX_FIELD_STRING_LEN
    ? value.slice(0, MAX_FIELD_STRING_LEN)
    : value;
}

/**
 * Normalise a payload by truncating string fields, preserving order
 * with `event` first. Returns a fresh object so the caller's input
 * is not mutated.
 */
function buildPayload(
  event: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { event };
  for (const [k, v] of Object.entries(fields)) {
    out[k] = truncate(v);
  }
  return out;
}

/**
 * Emit a single structured log line. The whole line is one valid
 * JSON document — Datadog parses it without a parsing rule.
 *
 * Usage:
 *
 *   logStructured('error', 'AUDIT_WRITE_FAILED', {
 *     variant: 'strict',
 *     action: 'consent.revoke',
 *     resourceType: 'consent',
 *     resourceId: '<uuid>',
 *     dbErrorCode: '23503',
 *     dbErrorMessage: 'foreign key violation',
 *   });
 */
export function logStructured(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify(buildPayload(event, fields));
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.info(line);
  }
}

/**
 * Defensive serialisation of an `unknown` thrown value into a short,
 * PHI-safe tag suitable for the `rawErrorTag` field of an
 * `AUDIT_WRITE_FAILED` / `ASSESSMENT_RPC_FAILED` event.
 */
export function tagFromError(err: unknown): string | undefined {
  if (err instanceof Error) {
    const tag = `${err.name}: ${err.message}`;
    return tag.slice(0, MAX_FIELD_STRING_LEN);
  }
  if (typeof err === 'string') {
    return err.slice(0, MAX_FIELD_STRING_LEN);
  }
  return undefined;
}
