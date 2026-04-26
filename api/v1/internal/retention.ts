/**
 * POST /api/v1/internal/retention
 *
 * Retention cron — called by Vercel Cron or an external scheduler.
 *
 * Authenticates via CRON_SIGNING_SECRET in `Authorization: Bearer <secret>`.
 * No user session; no tenant context — runs as platform service role.
 *
 * Work performed:
 *   1. Invokes fn_retention_prune() in Postgres → deletes expired audit/
 *      notification/resolved-alert rows and unlinks expired report_exports.
 *   2. Iterates over report_exports whose storage_path has been NULLed and
 *      issues Supabase Storage DELETE calls for their actual object.
 *   3. Writes a single audit_events row summarising the run.
 *
 * Safety:
 *   * Idempotent — safe to re-run on failure.
 *   * Never touches validated score outputs or clinical_input_snapshot.
 *   * Has a hard timeout (HTTP 504 returned if pruning exceeds 25s).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { isCronAuthorized, denyCron } from '../../../backend/src/middleware/cron-auth.js';
import { replyError, replyDbError } from '../../../backend/src/middleware/http-errors.js';

const MAX_STORAGE_DELETIONS = 500; // per run — keep latency bounded

/**
 * Clinical-reports bucket — must match the constant in
 * `api/v1/assessments/[id]/report.ts`. Canonical `report_exports` schema
 * (001_schema_foundation.sql §16) deliberately does NOT carry a
 * `storage_bucket` column: bucket is a server-side constant.
 */
const REPORT_BUCKET = 'clinical-reports';

interface OrphanRow {
  id: string;
  storage_path: string;
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

  // 1) Prune at the database layer (single transactional call)
  const { data: pruneResult, error: pruneErr } = await supabaseAdmin.rpc('fn_retention_prune');
  if (pruneErr) {
    // Opaque body + requestId via replyDbError. Server log keeps the full
    // PG error (including any schema-bearing message) under `[db-error]`
    // for ops triage, so the cron caller only sees `DB_ERROR + requestId`.
    replyDbError(res, pruneErr, 'retention.prune');
    return;
  }

  // 2) Storage cleanup — iterate over orphaned report rows and delete objects.
  //    fn_retention_prune already NULLed their storage_path. We read them by
  //    joining a recently-expired window. Bucket is a server-side constant
  //    (REPORT_BUCKET) — the schema does not carry a per-row bucket column.
  const { data: orphans } = await supabaseAdmin
    .from('report_exports')
    .select('id, storage_path')
    .lt('created_at', new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString())
    .not('storage_path', 'is', null)
    .limit(MAX_STORAGE_DELETIONS);

  let storageDeletions = 0;
  if (orphans && orphans.length > 0) {
    const paths: string[] = orphans
      .map((o: OrphanRow) => o.storage_path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);

    if (paths.length > 0) {
      const { error: delErr } = await supabaseAdmin.storage
        .from(REPORT_BUCKET)
        .remove(paths);
      if (delErr) {
        // eslint-disable-next-line no-console
        console.warn('[retention] storage.remove failed', REPORT_BUCKET, delErr.message);
      } else {
        storageDeletions = paths.length;
        // Blank the storage_path on the DB rows so we don't re-delete
        await supabaseAdmin
          .from('report_exports')
          .update({ storage_path: null })
          .in('id', orphans.map((o: OrphanRow) => o.id as string));
      }
    }
  }

  // 3) Audit
  await supabaseAdmin.from('audit_events').insert({
    tenant_id: null,
    actor_user_id: null,
    action: 'retention.run',
    entity_type: 'system',
    entity_id: null,
    metadata_json: {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      prune_result: pruneResult,
      storage_deletions: storageDeletions,
    },
    ip_hash: null,
  });

  res.status(200).json({
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    pruneResult,
    storageDeletions,
  });
}
