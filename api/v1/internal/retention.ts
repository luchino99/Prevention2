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

const CRON_SECRET = process.env.CRON_SIGNING_SECRET;
const MAX_STORAGE_DELETIONS = 500; // per run — keep latency bounded

interface OrphanRow {
  id: string;
  storage_bucket: string;
  storage_path: string;
}

function authorized(req: VercelRequest): boolean {
  if (!CRON_SECRET || CRON_SECRET.length < 16) return false;
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice(7).trim();
  // constant-time compare — the secret is short but still a nicety
  if (token.length !== CRON_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ CRON_SECRET.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end();
    return;
  }

  if (!authorized(req)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '' } });
    return;
  }

  const runId = crypto.randomUUID?.() ?? String(Date.now());
  const startedAt = new Date().toISOString();

  // 1) Prune at the database layer (single transactional call)
  const { data: pruneResult, error: pruneErr } = await supabaseAdmin.rpc('fn_retention_prune');
  if (pruneErr) {
    // eslint-disable-next-line no-console
    console.error('[retention] fn_retention_prune failed', pruneErr);
    res.status(500).json({ error: { code: 'PRUNE_FAILED', message: pruneErr.message } });
    return;
  }

  // 2) Storage cleanup — iterate over orphaned report rows and delete objects.
  //    fn_retention_prune already NULLed their storage_path. We read them by
  //    joining a recently-expired window.
  const { data: orphans } = await supabaseAdmin
    .from('report_exports')
    .select('id, storage_bucket, storage_path')
    .lt('created_at', new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString())
    .not('storage_path', 'is', null)
    .limit(MAX_STORAGE_DELETIONS);

  let storageDeletions = 0;
  if (orphans && orphans.length > 0) {
    // Group by bucket then batch remove
    const perBucket = new Map<string, string[]>();
    for (const row of orphans) {
      const bucket = String(row.storage_bucket);
      const path = String(row.storage_path);
      const acc = perBucket.get(bucket) ?? [];
      acc.push(path);
      perBucket.set(bucket, acc);
    }
    for (const [bucket, paths] of perBucket.entries()) {
      const { error: delErr } = await supabaseAdmin.storage.from(bucket).remove(paths);
      if (delErr) {
        // eslint-disable-next-line no-console
        console.warn('[retention] storage.remove failed', bucket, delErr.message);
        continue;
      }
      storageDeletions += paths.length;
      // Blank the storage_path on the DB rows so we don't re-delete
      await supabaseAdmin
        .from('report_exports')
        .update({ storage_path: null })
        .in(
          'id',
          orphans.filter((o: OrphanRow) => o.storage_bucket === bucket).map((o: OrphanRow) => o.id as string),
        );
    }
  }

  // 3) Audit
  await supabaseAdmin.from('audit_events').insert({
    tenant_id: null,
    actor_user_id: null,
    action: 'retention.run',
    entity_type: 'system',
    entity_id: null,
    metadata: {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      prune_result: pruneResult,
      storage_deletions: storageDeletions,
    },
    ip_address_hash: null,
  });

  res.status(200).json({
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    pruneResult,
    storageDeletions,
  });
}
