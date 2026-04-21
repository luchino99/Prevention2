/**
 * POST /api/v1/internal/anonymize
 *
 * Anonymization worker — irreversibly strips PII from soft-deleted patients
 * after a configurable grace window (default 30 days).
 *
 * Auth: CRON_SIGNING_SECRET bearer header (same as retention cron).
 *
 * Pipeline:
 *   1. SELECT patients WHERE deleted_at < NOW() - 30 days AND anonymized_at IS NULL
 *   2. For each: call fn_anonymize_patient(patient_id, NULL) — NULL actor = system
 *   3. Aggregate summary + audit
 *
 * Idempotency:
 *   fn_anonymize_patient sets anonymized_at=NOW(), so the candidate set
 *   shrinks to zero after the first successful run.
 *
 * Safety:
 *   * Never touches score_results / risk_profiles — those are anonymous by
 *     construction (no PII columns), so keeping them enables downstream
 *     aggregate analytics on legal-basis legitimate interest (Art.6(1)(f)).
 *   * Bounded MAX_PER_RUN to stay within Vercel 60s hard limit.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';

const CRON_SECRET = process.env.CRON_SIGNING_SECRET;
const GRACE_DAYS = Number(process.env.ANONYMIZE_GRACE_DAYS ?? '30');
const MAX_PER_RUN = Number(process.env.ANONYMIZE_MAX_PER_RUN ?? '100');

function authorized(req: VercelRequest): boolean {
  if (!CRON_SECRET || CRON_SECRET.length < 16) return false;
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const token = header.slice(7).trim();
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

  const startedAt = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - GRACE_DAYS * 24 * 3600 * 1000).toISOString();

  // Candidates: soft-deleted AND past grace AND not yet anonymized
  const { data: candidates, error } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id, deleted_at')
    .lt('deleted_at', cutoffIso)
    .is('anonymized_at', null)
    .limit(MAX_PER_RUN);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[anonymize] candidate query failed', error);
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  const processed: Array<{ patientId: string; tenantId: string; ok: boolean; detail?: string }> = [];
  for (const p of candidates ?? []) {
    const patientId = p.id as string;
    const tenantId = p.tenant_id as string;
    try {
      const { error: rpcErr } = await supabaseAdmin.rpc('fn_anonymize_patient', {
        p_patient_id: patientId,
        p_actor_user_id: null,
      });
      if (rpcErr) {
        processed.push({ patientId, tenantId, ok: false, detail: rpcErr.message });
      } else {
        // Also mark any outstanding DSR erasure request as fulfilled
        await supabaseAdmin
          .from('data_subject_requests')
          .update({
            status: 'fulfilled',
            fulfilled_at: new Date().toISOString(),
          })
          .eq('subject_patient_id', patientId)
          .eq('kind', 'erasure')
          .in('status', ['received', 'in_progress']);
        processed.push({ patientId, tenantId, ok: true });
      }
    } catch (err: any) {
      processed.push({ patientId, tenantId, ok: false, detail: err?.message ?? 'exception' });
    }
  }

  await supabaseAdmin.from('audit_events').insert({
    tenant_id: null,
    actor_user_id: null,
    action: 'anonymize.run',
    entity_type: 'system',
    entity_id: null,
    metadata: {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      candidates: candidates?.length ?? 0,
      processed,
      grace_days: GRACE_DAYS,
    },
    ip_address_hash: null,
  });

  res.status(200).json({
    startedAt,
    finishedAt: new Date().toISOString(),
    candidates: candidates?.length ?? 0,
    processed,
  });
}
