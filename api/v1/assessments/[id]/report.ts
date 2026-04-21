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
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import {
  loadAssessmentSnapshot,
  buildReportPayload,
  AssessmentServiceError,
} from '../../../../backend/src/services/assessment-service.js';
import { recordAudit } from '../../../../backend/src/audit/audit-logger.js';
import { renderAssessmentReportPdf } from '../../../../backend/src/services/pdf-report-service.js';

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
      console.error('[report] upload failed', uploadErr);
      res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: uploadErr.message } });
      return;
    }

    const { data: exportRow, error: exportErr } = await supabaseAdmin
      .from('report_exports')
      .insert({
        tenant_id: snapshot.assessment.tenantId,
        patient_id: snapshot.assessment.patientId,
        assessment_id: assessmentId,
        generated_by_user_id: req.auth.userId,
        storage_bucket: REPORT_BUCKET,
        storage_path: fileName,
        file_size_bytes: pdfBuffer.byteLength,
        content_type: 'application/pdf',
      })
      .select('id')
      .single();

    if (exportErr || !exportRow) {
      console.error('[report] export row insert failed', exportErr);
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(REPORT_BUCKET)
      .createSignedUrl(fileName, SIGNED_URL_EXPIRY_SECONDS);

    if (signErr || !signed) {
      res.status(500).json({ error: { code: 'SIGN_FAILED', message: 'Signed URL failed' } });
      return;
    }

    await recordAudit(req.auth, {
      action: 'report.generate',
      resourceType: 'report_export',
      resourceId: exportRow?.id ?? null,
      metadata: {
        assessment_id: assessmentId,
        size_bytes: pdfBuffer.byteLength,
      },
    });

    res.status(201).json({
      reportExportId: exportRow?.id ?? null,
      signedUrl: signed.signedUrl,
      expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
    });
  } catch (err: any) {
    if (err instanceof AssessmentServiceError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error('[report.generate] unexpected', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Report generation failed' } });
  }
}

async function handleGetSignedUrl(req: any, res: VercelResponse, assessmentId: string): Promise<void> {
  // Find the most recent export for this assessment within the caller's tenant
  let query = supabaseAdmin
    .from('report_exports')
    .select('id, storage_bucket, storage_path, tenant_id, patient_id')
    .eq('assessment_id', assessmentId)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data, error } = await query.maybeSingle();
  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }
  if (!data) {
    res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'No report for this assessment' } });
    return;
  }
  if (req.auth.role !== 'platform_admin' && data.tenant_id !== req.auth.tenantId) {
    res.status(403).json({ error: { code: 'CROSS_TENANT_FORBIDDEN', message: '' } });
    return;
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(data.storage_bucket)
    .createSignedUrl(data.storage_path, SIGNED_URL_EXPIRY_SECONDS);

  if (signErr || !signed) {
    res.status(500).json({ error: { code: 'SIGN_FAILED', message: 'Signed URL failed' } });
    return;
  }

  await recordAudit(req.auth, {
    action: 'report.download',
    resourceType: 'report_export',
    resourceId: data.id,
  });

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
    res.status(400).json({ error: { code: 'INVALID_ID', message: '' } });
    return;
  }

  if (req.method === 'POST') {
    const rl = checkRateLimit(req, { routeId: 'report.generate', ...RATE_LIMITS.reportExport });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireTenantMember((r, s) => handleGenerate(r, s, id))(req as any, res);
    return;
  }

  if (req.method === 'GET') {
    const rl = checkRateLimit(req, { routeId: 'report.read', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireTenantMember((r, s) => handleGetSignedUrl(r, s, id))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
});
