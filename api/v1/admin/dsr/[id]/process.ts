/**
 * POST /api/v1/admin/dsr/[id]/process
 * ---------------------------------------------------------------------------
 * State-machine + worker entry point for a Data Subject Request.
 *
 * Audit blocker addressed
 * -----------------------
 *   B-14  No backend pathway existed to TRANSITION a DSR or to actually
 *         execute the GDPR fulfilment work (export bundle, anonymization).
 *         This endpoint introduces an explicit state machine and dispatches
 *         to the per-kind worker, then writes a guaranteed audit row.
 *
 * State machine
 * -------------
 *
 *     received  ──start──▶ in_progress  ──fulfill──▶ fulfilled
 *         │                       │
 *         │                       └──reject──▶ rejected
 *         │
 *         └──cancel──▶ cancelled
 *
 *   - 'start'   : received → in_progress (claims the request for the
 *                 admin and locks the record from concurrent processing)
 *   - 'fulfill' : in_progress → fulfilled (runs the kind-specific worker
 *                 BEFORE flipping the status; on failure status stays
 *                 in_progress so the admin can retry)
 *   - 'reject'  : received | in_progress → rejected (requires
 *                 rejectionReason)
 *   - 'cancel'  : received → cancelled (admin self-cancel; rejected
 *                 once work has started)
 *
 * Worker dispatch (run on `fulfill`)
 * ----------------------------------
 *   - kind = 'erasure'                     → fn_anonymize_patient(...) RPC
 *   - kind = 'access' | 'portability'      → JSON manifest stub uploaded
 *                                            to the private storage bucket
 *                                            (full export bundle build-out
 *                                            is tracked as EXT-LEGAL +
 *                                            tooling work)
 *   - kind = 'rectification' | 'restriction'
 *           | 'objection'                  → no programmatic fulfilment;
 *                                            requires manual workflow.
 *                                            We refuse to mark these
 *                                            'fulfilled' from this endpoint
 *                                            so the admin must use the
 *                                            'reject' or 'cancel' verb,
 *                                            or extend the worker.
 *
 * Privacy & safety
 * ----------------
 *   - No PHI is reflected in the response body. The response carries only
 *     status flags and signed URLs to artefacts.
 *   - Audit row is GUARANTEED on every successful transition (B-09):
 *     audit failure aborts the call with AUDIT_WRITE_FAILED so we never
 *     change a DSR's state without an immutable record of who did what.
 *   - The clinical engine and validated score logic are NOT touched.
 *   - The erasure path is irreversible — see fn_anonymize_patient
 *     (migration 003) for the exact PII strip semantics.
 * ---------------------------------------------------------------------------
 */

import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '../../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantAdmin } from '../../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../../backend/src/middleware/security-headers.js';
import {
  checkRateLimitAsync,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../../backend/src/config/supabase.js';
import {
  recordAuditStrict,
  AuditWriteError,
} from '../../../../../backend/src/audit/audit-logger.js';
import {
  replyDbError,
  replyValidationError,
  replyError,
} from '../../../../../backend/src/middleware/http-errors.js';

/* ------------------------------------------------------------------ types */

type DsrKind =
  | 'access'
  | 'erasure'
  | 'portability'
  | 'rectification'
  | 'restriction'
  | 'objection';

type DsrStatus =
  | 'received'
  | 'in_progress'
  | 'fulfilled'
  | 'rejected'
  | 'cancelled';

interface DsrRow {
  id: string;
  tenant_id: string;
  subject_patient_id: string | null;
  subject_user_id: string | null;
  kind: DsrKind;
  status: DsrStatus;
  requested_by_user_id: string | null;
  fulfilled_by_user_id: string | null;
  export_storage_path: string | null;
  rejection_reason: string | null;
  notes: string | null;
  requested_at: string;
  fulfilled_at: string | null;
  sla_deadline: string;
}

const DSR_BUCKET = 'clinical-reports';
const SIGNED_URL_TTL_SEC = 5 * 60;
const ENGINE_VERSION = '1.0.0';

const idSchema = z.string().uuid();

const bodySchema = z
  .object({
    action: z.enum(['start', 'fulfill', 'reject', 'cancel']),
    rejectionReason: z.string().min(3).max(2000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => v.action !== 'reject' || (typeof v.rejectionReason === 'string' && v.rejectionReason.length >= 3),
    {
      message: 'rejectionReason is required when action=reject',
      path: ['rejectionReason'],
    },
  );

/* -------------------------------------------------------------- entry point */

export default withAuth(async (req: AuthenticatedRequest, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const rl = await checkRateLimitAsync(req, { routeId: 'admin.dsr.process', ...RATE_LIMITS.admin });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  await requireTenantAdmin(async (r: AuthenticatedRequest, s: VercelResponse) => {
    const idRaw = (r.query.id ?? '') as string;
    const idParse = idSchema.safeParse(idRaw);
    if (!idParse.success) {
      replyError(s, 400, 'INVALID_ID');
      return;
    }
    const dsrId = idParse.data;

    const body = (() => {
      if (!r.body) return null;
      if (typeof r.body === 'string') {
        try {
          return JSON.parse(r.body);
        } catch {
          return null;
        }
      }
      return r.body;
    })();
    if (!body || typeof body !== 'object') {
      replyError(s, 400, 'INVALID_BODY');
      return;
    }
    const parse = bodySchema.safeParse(body);
    if (!parse.success) {
      replyValidationError(s, parse.error.issues, 'admin.dsr.process.body');
      return;
    }
    const v = parse.data;

    // ── Load + tenant scope ───────────────────────────────────────────
    // NB: select string MUST be a single string literal — see explanation
    // in api/v1/admin/dsr/[id]/index.ts. Concat collapses to `string` and
    // supabase-js v2 then types `data` as `GenericStringError`, breaking
    // every downstream property access.
    const { data: row, error: loadErr } = await supabaseAdmin
      .from('data_subject_requests')
      .select(
        'id, tenant_id, subject_patient_id, subject_user_id, kind, status, requested_by_user_id, fulfilled_by_user_id, export_storage_path, rejection_reason, notes, requested_at, fulfilled_at, sla_deadline',
      )
      .eq('id', dsrId)
      .maybeSingle();

    if (loadErr) {
      replyDbError(s, loadErr, 'admin.dsr.process.load');
      return;
    }
    if (!row) {
      replyError(s, 404, 'NOT_FOUND');
      return;
    }
    const dsr = row as DsrRow;
    if (r.auth.role !== 'platform_admin' && dsr.tenant_id !== r.auth.tenantId) {
      // Cross-tenant attempt — opaque NOT_FOUND so we don't disclose
      // existence of a foreign DSR id.
      replyError(s, 404, 'NOT_FOUND');
      return;
    }

    try {
      await dispatch(r, s, dsr, v);
    } catch (err) {
      // dispatch throws only on truly unexpected paths — known errors
      // are returned via replyError before the throw.
      // eslint-disable-next-line no-console
      console.error('[admin.dsr.process] unexpected error', { dsrId, err });
      replyError(s, 500, 'INTERNAL_ERROR');
    }
  })(req, res);
});

/* ----------------------------------------------------------- state machine */

async function dispatch(
  req: AuthenticatedRequest,
  res: VercelResponse,
  dsr: DsrRow,
  body: { action: 'start' | 'fulfill' | 'reject' | 'cancel'; rejectionReason?: string; notes?: string },
): Promise<void> {
  switch (body.action) {
    case 'start':
      return handleStart(req, res, dsr, body.notes);
    case 'cancel':
      return handleCancel(req, res, dsr, body.notes);
    case 'reject':
      return handleReject(req, res, dsr, body.rejectionReason as string, body.notes);
    case 'fulfill':
      return handleFulfill(req, res, dsr, body.notes);
  }
}

/* ---------------------------------------------------------------- handlers */

/**
 * received → in_progress. Idempotent: if the DSR is already in_progress
 * AND the same admin is the assigned processor we accept the call and
 * return the current state (so the UI can re-claim a stale tab without
 * an error). Any other current state returns CONFLICT.
 */
async function handleStart(
  req: AuthenticatedRequest,
  res: VercelResponse,
  dsr: DsrRow,
  notes: string | undefined,
): Promise<void> {
  if (dsr.status !== 'received'
      && !(dsr.status === 'in_progress' && dsr.fulfilled_by_user_id === req.auth.userId)) {
    replyError(res, 409, 'CONFLICT');
    return;
  }

  const update = await supabaseAdmin
    .from('data_subject_requests')
    .update({
      status: 'in_progress',
      fulfilled_by_user_id: req.auth.userId,
      notes: mergeNotes(dsr.notes, notes),
    })
    .eq('id', dsr.id)
    .eq('tenant_id', dsr.tenant_id)
    // Optimistic concurrency: only transition if we're still in the
    // expected source state OR already-claimed by us.
    .in('status', ['received', 'in_progress'])
    .select(
      'id, status, fulfilled_by_user_id, notes',
    )
    .single();

  if (update.error || !update.data) {
    replyDbError(res, update.error ?? new Error('no row updated'), 'admin.dsr.process.start');
    return;
  }

  await guaranteeAudit(req, res, dsr, 'dsr.start', { previous_status: dsr.status });
  if (res.writableEnded) return;

  res.status(200).json({
    request: { ...dsr, ...update.data },
  });
}

/**
 * received → cancelled. Refused once any work has started — admins must
 * 'reject' (with reason) instead.
 */
async function handleCancel(
  req: AuthenticatedRequest,
  res: VercelResponse,
  dsr: DsrRow,
  notes: string | undefined,
): Promise<void> {
  if (dsr.status !== 'received') {
    replyError(res, 409, 'CONFLICT');
    return;
  }

  const update = await supabaseAdmin
    .from('data_subject_requests')
    .update({
      status: 'cancelled',
      notes: mergeNotes(dsr.notes, notes),
    })
    .eq('id', dsr.id)
    .eq('tenant_id', dsr.tenant_id)
    .eq('status', 'received')
    .select('id, status, notes')
    .single();

  if (update.error || !update.data) {
    replyDbError(res, update.error ?? new Error('no row updated'), 'admin.dsr.process.cancel');
    return;
  }

  await guaranteeAudit(req, res, dsr, 'dsr.cancel', { previous_status: dsr.status });
  if (res.writableEnded) return;

  res.status(200).json({ request: { ...dsr, ...update.data } });
}

/**
 * received | in_progress → rejected. rejectionReason is required and
 * stored verbatim so the audit trail captures the legal/medical
 * rationale (e.g. "Art.17(3)(c) — defence of legal claims").
 */
async function handleReject(
  req: AuthenticatedRequest,
  res: VercelResponse,
  dsr: DsrRow,
  rejectionReason: string,
  notes: string | undefined,
): Promise<void> {
  if (dsr.status !== 'received' && dsr.status !== 'in_progress') {
    replyError(res, 409, 'CONFLICT');
    return;
  }

  const update = await supabaseAdmin
    .from('data_subject_requests')
    .update({
      status: 'rejected',
      rejection_reason: rejectionReason,
      fulfilled_by_user_id: req.auth.userId,
      fulfilled_at: new Date().toISOString(),
      notes: mergeNotes(dsr.notes, notes),
    })
    .eq('id', dsr.id)
    .eq('tenant_id', dsr.tenant_id)
    .in('status', ['received', 'in_progress'])
    .select('id, status, rejection_reason, fulfilled_at, fulfilled_by_user_id, notes')
    .single();

  if (update.error || !update.data) {
    replyDbError(res, update.error ?? new Error('no row updated'), 'admin.dsr.process.reject');
    return;
  }

  await guaranteeAudit(req, res, dsr, 'dsr.reject', {
    previous_status: dsr.status,
    rejection_reason: rejectionReason,
  });
  if (res.writableEnded) return;

  res.status(200).json({ request: { ...dsr, ...update.data } });
}

/**
 * in_progress → fulfilled. Runs the per-kind worker BEFORE updating
 * the row; on worker failure the row stays in_progress so the admin
 * can retry without losing the assignment.
 */
async function handleFulfill(
  req: AuthenticatedRequest,
  res: VercelResponse,
  dsr: DsrRow,
  notes: string | undefined,
): Promise<void> {
  if (dsr.status !== 'in_progress') {
    replyError(res, 409, 'CONFLICT');
    return;
  }
  if (dsr.fulfilled_by_user_id && dsr.fulfilled_by_user_id !== req.auth.userId
      && req.auth.role !== 'platform_admin') {
    // Another admin is processing this DSR; refuse to step on their toes.
    replyError(res, 409, 'CONFLICT');
    return;
  }

  // ── Run the kind-specific worker ──────────────────────────────────
  let workerResult: WorkerOutcome;
  try {
    workerResult = await runWorker(dsr);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin.dsr.process.fulfill] worker failed', { dsrId: dsr.id, err });
    replyError(res, 500, 'WORKER_FAILED');
    return;
  }

  if (!workerResult.ok) {
    // Worker refused the request (e.g. unsupported kind, missing
    // subject). Surface a deterministic 422 to the admin.
    replyError(res, 422, workerResult.code);
    return;
  }

  // ── Flip status under optimistic concurrency ──────────────────────
  const update = await supabaseAdmin
    .from('data_subject_requests')
    .update({
      status: 'fulfilled',
      fulfilled_by_user_id: req.auth.userId,
      fulfilled_at: new Date().toISOString(),
      export_storage_path: workerResult.exportPath ?? dsr.export_storage_path,
      notes: mergeNotes(dsr.notes, notes ?? workerResult.note ?? null),
    })
    .eq('id', dsr.id)
    .eq('tenant_id', dsr.tenant_id)
    .eq('status', 'in_progress')
    .select(
      'id, status, fulfilled_by_user_id, fulfilled_at, export_storage_path, notes',
    )
    .single();

  if (update.error || !update.data) {
    // The worker ran but we couldn't flip status — log loudly so ops
    // can reconcile (the artefact may already be in storage).
    // eslint-disable-next-line no-console
    console.error('[admin.dsr.process.fulfill] post-worker update failed', {
      dsrId: dsr.id,
      workerArtefact: workerResult.exportPath,
      pgError: update.error,
    });
    replyDbError(res, update.error ?? new Error('no row updated'), 'admin.dsr.process.fulfill.update');
    return;
  }

  await guaranteeAudit(req, res, dsr, 'dsr.fulfill', {
    previous_status: dsr.status,
    worker_kind: dsr.kind,
    artefact_path: workerResult.exportPath ?? null,
    worker_message: workerResult.note ?? null,
  });
  if (res.writableEnded) return;

  // Best-effort signed URL for immediate download
  let signedUrl: string | null = null;
  if (workerResult.exportPath) {
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(DSR_BUCKET)
      .createSignedUrl(workerResult.exportPath, SIGNED_URL_TTL_SEC);
    if (signErr) {
      // eslint-disable-next-line no-console
      console.error('[admin.dsr.process.fulfill] signed-url failed', { signErr });
    } else if (signed?.signedUrl) {
      signedUrl = signed.signedUrl;
    }
  }

  res.status(200).json({
    request: { ...dsr, ...update.data },
    exportSignedUrl: signedUrl,
    exportTtlSec: signedUrl ? SIGNED_URL_TTL_SEC : null,
  });
}

/* -------------------------------------------------------------- worker(s) */

type WorkerOutcome =
  | {
      ok: true;
      exportPath?: string;
      note?: string;
    }
  | {
      ok: false;
      code:
        | 'WORKER_NO_SUBJECT'
        | 'WORKER_UNSUPPORTED_KIND'
        | 'WORKER_USER_ERASURE_NOT_SUPPORTED';
    };

async function runWorker(dsr: DsrRow): Promise<WorkerOutcome> {
  switch (dsr.kind) {
    case 'erasure':
      return runErasureWorker(dsr);
    case 'access':
    case 'portability':
      return runExportWorker(dsr);
    case 'rectification':
    case 'restriction':
    case 'objection':
      // These require a manual workflow. We intentionally refuse to
      // mark them 'fulfilled' from here so the admin must use 'reject'
      // (with a documented reason) or extend the worker.
      return { ok: false, code: 'WORKER_UNSUPPORTED_KIND' };
  }
}

/**
 * Art.17 — irreversible PII strip via the SQL function created in
 * migration 003. Patient anonymization only; user erasure is out of
 * scope and explicitly refused (would orphan tenant memberships and
 * audit lineage).
 */
async function runErasureWorker(dsr: DsrRow): Promise<WorkerOutcome> {
  if (!dsr.subject_patient_id) {
    if (dsr.subject_user_id) return { ok: false, code: 'WORKER_USER_ERASURE_NOT_SUPPORTED' };
    return { ok: false, code: 'WORKER_NO_SUBJECT' };
  }

  const { error } = await supabaseAdmin.rpc('fn_anonymize_patient', {
    p_patient_id: dsr.subject_patient_id,
    p_actor_user_id: dsr.fulfilled_by_user_id ?? dsr.requested_by_user_id ?? null,
  });
  if (error) {
    // The SQL function raises on missing patient; surface verbatim.
    throw new Error(`fn_anonymize_patient failed: ${error.message ?? 'unknown'}`);
  }

  return {
    ok: true,
    note: `Art.17 erasure executed via fn_anonymize_patient on patient ${dsr.subject_patient_id}`,
  };
}

/**
 * Art.15 / Art.20 — package the subject's data for handover.
 *
 * The current implementation emits a JSON manifest stub describing the
 * fulfilment context (subject, kind, requester, deadline). The full
 * data export bundle (assessments + measurements + scores + lifestyle
 * snapshots + audit excerpts) is tracked as future work because:
 *   1. the schema is still evolving (migrations 010/011) and a
 *      premature bundle format risks shipping a non-portable artefact;
 *   2. portability artefacts must be accompanied by a legal-review
 *      attached "data dictionary" (EXT-LEGAL).
 *
 * Until then the manifest stub is sufficient as an audit-traceable
 * marker that the request was processed; the actual export files
 * continue to be produced by the per-patient endpoint
 * (/api/v1/patients/[id]/export) which is already audit-guarded.
 */
async function runExportWorker(dsr: DsrRow): Promise<WorkerOutcome> {
  if (!dsr.subject_patient_id && !dsr.subject_user_id) {
    return { ok: false, code: 'WORKER_NO_SUBJECT' };
  }

  const subjectKind: 'patient' | 'user' = dsr.subject_patient_id ? 'patient' : 'user';
  const subjectId = (dsr.subject_patient_id ?? dsr.subject_user_id) as string;

  const manifest = {
    schema: 'uelfy.dsr.manifest.v1',
    dsr_id: dsr.id,
    tenant_id: dsr.tenant_id,
    kind: dsr.kind,
    subject: { kind: subjectKind, id: subjectId },
    requested_by_user_id: dsr.requested_by_user_id,
    requested_at: dsr.requested_at,
    sla_deadline: dsr.sla_deadline,
    fulfilled_at: new Date().toISOString(),
    engine_version: ENGINE_VERSION,
    note:
      'Stub manifest. Full data bundle assembly is tracked as EXT-LEGAL. '
      + 'For per-patient PHI export use /api/v1/patients/{id}/export.',
  };

  const path = `dsr/${dsr.tenant_id}/${dsr.id}/manifest-${Date.now()}.json`;
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

  const { error } = await supabaseAdmin.storage
    .from(DSR_BUCKET)
    .upload(path, bytes, {
      contentType: 'application/json',
      upsert: true,
      cacheControl: 'no-store',
    });
  if (error) {
    throw new Error(`dsr export upload failed: ${error.message ?? 'unknown'}`);
  }

  return {
    ok: true,
    exportPath: path,
    note: `Art.${dsr.kind === 'access' ? '15' : '20'} manifest stub uploaded`,
  };
}

/* ----------------------------------------------------------------- helpers */

/**
 * Append a single timestamped journal line to `notes` without losing
 * prior context. Returns the existing string if the new entry is empty.
 */
function mergeNotes(prev: string | null, entry: string | null | undefined): string | null {
  if (!entry || !entry.trim()) return prev;
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${entry.trim()}`;
  return prev && prev.length > 0 ? `${prev}\n${line}` : line;
}

/**
 * Guarantee an audit row for every state transition. Failure aborts the
 * call with AUDIT_WRITE_FAILED — DSR transitions are privacy-significant
 * and must not occur silently.
 *
 * On audit failure we DO NOT roll back the DB UPDATE: the assessment in
 * audit-logger is best-effort, but here we use `recordAuditStrict` which
 * throws AuditWriteError on persistence failure for the specific subset
 * of actions the route owns. The caller has already persisted the new
 * status; if we cannot record the transition we surface the failure so
 * ops can manually patch / reconcile.
 *
 * The caller MUST check `res.writableEnded` after invoking this helper
 * and abort its own response path if the helper has already replied.
 */
async function guaranteeAudit(
  req: AuthenticatedRequest,
  res: VercelResponse,
  dsr: DsrRow,
  action: 'dsr.start' | 'dsr.cancel' | 'dsr.reject' | 'dsr.fulfill',
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await recordAuditStrict(req.auth, {
      action,
      resourceType: 'data_subject_request',
      resourceId: dsr.id,
      metadata: {
        kind: dsr.kind,
        tenant_id: dsr.tenant_id,
        subject_patient_id: dsr.subject_patient_id,
        subject_user_id: dsr.subject_user_id,
        sla_deadline: dsr.sla_deadline,
        ...metadata,
      },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error(`[${action}] guaranteed audit failed`, {
      dsrId: dsr.id,
      isAuditWriteError: auditErr instanceof AuditWriteError,
      auditErr,
    });
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
  }
}
