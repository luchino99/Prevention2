/**
 * POST /api/v1/internal/alerts-auto-close
 *
 * Stale-alert auto-close cron — Sprint 4 task 4.2 (F-014).
 *
 * Authenticates via CRON_SIGNING_SECRET (`Authorization: Bearer <secret>`)
 * + `x-vercel-cron: 1` when running on Vercel. No user session, no tenant
 * context — runs as platform service role.
 *
 * Work performed
 * --------------
 * Invokes `fn_auto_close_stale_alerts(p_max_age_days)` (migration 019),
 * which transitions every `status = 'open'` alert older than the threshold
 * to `status = 'resolved'` with a structured `metadata.auto_closed = true`
 * marker. The function is idempotent: re-running it once stale rows are
 * closed is a no-op.
 *
 * Why "resolved" and not "dismissed":
 *   - `dismissed` is a clinician judgement ("not relevant"). Auto-close is
 *     not a clinical judgement — it is system housekeeping for stale rows
 *     a clinician never had a chance to triage.
 *   - The marker in `metadata` lets dashboards distinguish auto-resolution
 *     from clinician resolution without requiring a new status enum value.
 *
 * Configuration
 * -------------
 *   ALERTS_AUTO_CLOSE_MAX_AGE_DAYS — integer, default 30. Capped at 365
 *   so a misconfiguration cannot force an "auto-close everything ever"
 *   sweep on the next run.
 *
 * Safety
 * ------
 *   * Idempotent — safe to re-run on failure or schedule overlap.
 *   * Never touches validated score outputs or clinical_input_snapshot.
 *   * SQL function uses FOR UPDATE SKIP LOCKED so it interleaves cleanly
 *     with concurrent ack/resolve clinician traffic.
 *   * Audit row written via `audit.action = 'alert.auto_close'`.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { isCronAuthorized, denyCron } from '../../../backend/src/middleware/cron-auth.js';
import { replyError, replyDbError } from '../../../backend/src/middleware/http-errors.js';
import { logStructured } from '../../../backend/src/observability/structured-log.js';

const DEFAULT_MAX_AGE_DAYS = 30;
const MAX_AGE_DAYS_HARD_CAP = 365;

function resolveMaxAgeDays(): number {
  const raw = process.env.ALERTS_AUTO_CLOSE_MAX_AGE_DAYS;
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_MAX_AGE_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_AGE_DAYS;
  return Math.min(parsed, MAX_AGE_DAYS_HARD_CAP);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  if (!isCronAuthorized(req)) {
    denyCron(res);
    return;
  }

  const runId = crypto.randomUUID?.() ?? String(Date.now());
  const startedAt = new Date().toISOString();
  const maxAgeDays = resolveMaxAgeDays();

  // 1) Single transactional call → fn_auto_close_stale_alerts
  const { data: closeResult, error: closeErr } = await supabaseAdmin.rpc(
    'fn_auto_close_stale_alerts',
    { p_max_age_days: maxAgeDays },
  );
  if (closeErr) {
    // Opaque body + requestId via replyDbError. Server log keeps the full
    // PG error under `[db-error]` for ops triage.
    replyDbError(res, closeErr, 'alerts.auto_close.run');
    return;
  }

  // closed_count is the canonical count for SLOs / dashboards.
  // The fn returns a JSONB envelope: { closed_count, cutoff_at, ... }
  const closeEnvelope = (closeResult ?? {}) as {
    closed_count?: number | null;
    cutoff_at?: string | null;
    max_age_days?: number | null;
    finished_at?: string | null;
  };
  const closedCount = typeof closeEnvelope.closed_count === 'number'
    ? closeEnvelope.closed_count
    : 0;

  // 2) Audit
  // Direct INSERT (no actor JWT) — audit_events.actor_user_id stays NULL,
  // entity_type='system' marks this as a cron-emitted row. Same pattern
  // as retention.ts / anonymize.ts.
  await supabaseAdmin.from('audit_events').insert({
    tenant_id: null,
    actor_user_id: null,
    action: 'alert.auto_close',
    entity_type: 'system',
    entity_id: null,
    metadata_json: {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      max_age_days: maxAgeDays,
      closed_count: closedCount,
      close_envelope: closeEnvelope,
    },
    ip_hash: null,
  });

  // 3) Structured log — single JSON line per cron run, pivotable in Datadog.
  logStructured('info', 'ALERTS_AUTO_CLOSE_RUN', {
    runId,
    startedAt,
    maxAgeDays,
    closedCount,
  });

  res.status(200).json({
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    maxAgeDays,
    closedCount,
    closeEnvelope,
  });
}
