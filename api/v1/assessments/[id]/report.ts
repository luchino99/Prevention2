/**
 * POST /api/v1/assessments/[id]/report
 *   Generates a clinical PDF report server-side.
 *   Uploads it to Supabase Storage (private bucket 'clinical-reports')
 *   and returns a short-lived signed URL.
 *
 * GET /api/v1/assessments/[id]/report?download=1
 *   Issues a fresh signed URL for an existing stored report.
 *
 * Reports are strictly signed-URL gated — never public — and each issuance
 * is audit-logged with the caller identity and report_export id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import {
  loadAssessmentSnapshot,
  buildReportPayload,
} from '../../../../backend/src/services/assessment-service.js';
import { recordAuditStrict, AuditWriteError } from '../../../../backend/src/audit/audit-logger.js';
import { renderAssessmentReportPdf } from '../../../../backend/src/services/pdf-report-service.js';
import {
  replyDbError,
  replyError,
  replyServiceError,
} from '../../../../backend/src/middleware/http-errors.js';

const REPORT_BUCKET = 'clinical-reports';
const SIGNED_URL_EXPIRY_SECONDS = 60 * 5; // 5 minutes

function getId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

async function handleGenerate(req: any, res: VercelResponse, assessmentId: string): Promise<void> {
  try {
    const snapshot = await loadAssessmentSnapshot(req.auth, assessmentId);
    const payload = await buildReportPayload(snapshot);
    const pdfBuffer = await renderAssessmentReportPdf(payload);

    const fileName = `${snapshot.assessment.tenantId}/${snapshot.assessment.patientId}/${assessmentId}-${Date.now()}.pdf`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(REPORT_BUCKET)
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
        cacheControl: 'no-store',
      });

    if (uploadErr) {
      // Server log keeps the full storage error (path, content-type, etc.).
      // Client gets only the opaque code + a requestId for support.
      replyDbError(res, uploadErr, 'report.generate.upload');
      return;
    }

    // Canonical schema (001_schema_foundation.sql §16): exported_by FK to
    // users(id), storage_path TEXT, file_size_bytes, engine_version,
    // report_version, export_type. There is no storage_bucket / content_type
    // column — the bucket name is a server-side constant (REPORT_BUCKET).
    const { data: exportRow, error: exportErr } = await supabaseAdmin
      .from('report_exports')
      .insert({
        tenant_id: snapshot.assessment.tenantId,
        patient_id: snapshot.assessment.patientId,
        assessment_id: assessmentId,
        exported_by: req.auth.userId,
        export_type: 'pdf_clinical',
        storage_path: fileName,
        file_size_bytes: pdfBuffer.byteLength,
        engine_version: '1.0.0',
        report_version: '1.0.0',
      })
      .select('id')
      .single();

    if (exportErr || !exportRow) {
      // We tolerate a missing report_exports row only because the file
      // was already written. Surface the failure server-side so ops can
      // reconcile, but keep the client flow alive (signed URL still works).
      // eslint-disable-next-line no-console
      console.error('[report] export row insert failed', { exportErr });
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(fileName, SIGNED_URL_EXPIRY_SECONDS);

    if (signErr || !signed) {
      replyDbError(res, signErr ?? new Error('sign-failed'), 'report.generate.sign');
      return;
    }

    // B-09 — audit guarantee for report exports. PHI is leaving the system
    // boundary (PDF bytes uploaded to storage + signed URL minted). A
    // missing audit row would defeat Art.30 traceability, so we fail loudly
    // and rely on the existing storage object being reconciled out-of-band.
    // recordAuditStrict throws AuditWriteError on persistence failure so
    // this catch branch is reachable in practice.
    try {
      await recordAuditStrict(req.auth, {
        action: 'report.generate',
        resourceType: 'report_export',
        resourceId: exportRow?.id ?? null,
        metadata: {
          assessment_id: assessmentId,
          size_bytes: pdfBuffer.byteLength,
          storage_path: fileName,
        },
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      console.error('[report.generate] audit write failed', {
        assessmentId,
        exportId: exportRow?.id ?? null,
        isAuditWriteError: auditErr instanceof AuditWriteError,
        auditErr,
      });
      replyError(res, 500, 'AUDIT_WRITE_FAILED');
      return;
    }

    res.status(201).json({
      reportExportId: exportRow?.id ?? null,
      signedUrl: signed.signedUrl,
      expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
    });
  } catch (err) {
    // Wraps loadAssessmentSnapshot / buildReportPayload / pdf render. Echoes
    // only allow-listed service-error codes; everything else collapses to
    // INTERNAL_ERROR + opaque requestId.
    replyServiceError(res, err, 'report.generate');
  }
}

async function handleGetSignedUrl(req: any, res: VercelResponse, assessmentId: string): Promise<void> {
  // Find the most recent export for this assessment within the caller's tenant
  let query = supabaseAdmin
    .from('report_exports')
    .select('id, storage_path, tenant_id, patient_id')
    .eq('assessment_id', assessmentId)
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data, error } = await query.maybeSingle();
  if (error) {
    replyDbError(res, error, 'report.read.select');
    return;
  }
  if (!data) {
    replyError(res, 404, 'REPORT_NOT_FOUND');
    return;
  }
  if (req.auth.role !== 'platform_admin' && data.tenant_id !== req.auth.tenantId) {
    replyError(res, 403, 'CROSS_TENANT_FORBIDDEN');
    return;
  }

  // Bucket is a server-side constant, not a per-row column.
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(REPORT_BUCKET)
    .createSignedUrl(String(data.storage_path), SIGNED_URL_EXPIRY_SECONDS);

  if (signErr || !signed) {
    replyDbError(res, signErr ?? new Error('sign-failed'), 'report.read.sign');
    return;
  }

  // B-09 — audit guarantee. Issuing a fresh signed URL for stored PHI is
  // a download event; we must record who and when. Failure to log is a
  // 500 so the URL doesn't reach the client without a corresponding
  // audit row. recordAuditStrict throws AuditWriteError on failure so the
  // catch branch is reachable.
  try {
    await recordAuditStrict(req.auth, {
      action: 'report.download',
      resourceType: 'report_export',
      resourceId: data.id,
      metadata: { assessment_id: assessmentId },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error('[report.download] audit write failed', {
      assessmentId,
      reportId: data.id,
      isAuditWriteError: auditErr instanceof AuditWriteError,
      auditErr,
    });
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
    return;
  }

  res.status(200).json({
    reportExportId: data.id,
    signedUrl: signed.signedUrl,
    expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
  });
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);
  const id = getId(req);
  if (!id) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  if (req.method === 'POST') {
    const rl = await checkRateLimitAsync(req, { routeId: 'report.generate', ...RATE_LIMITS.reportExport });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', {
        retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
      });
      return;
    }
    await requireTenantMember((r, s) => handleGenerate(r, s, id))(req as any, res);
    return;
  }

  if (req.method === 'GET') {
    const rl = await checkRateLimitAsync(req, { routeId: 'report.read', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', {
        retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
      });
      return;
    }
    await requireTenantMember((r, s) => handleGetSignedUrl(r, s, id))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  replyError(res, 405, 'METHOD_NOT_ALLOWED');
});
