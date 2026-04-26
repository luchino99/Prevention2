/**
 * /api/v1/patients/[id]/assessments
 *   GET  — paginated assessment history for a patient (longitudinal view)
 *   POST — create a new assessment (runs clinical engine + persists everything)
 *
 * POST is the single entry point for clinical calculations. All score
 * computation flows through AssessmentService.createAssessment so tests can
 * validate formula equivalence against the legacy engine.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember, requireClinicalWrite } from '../../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../../backend/src/middleware/security-headers.js';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../../backend/src/config/supabase.js';
import { recordAudit } from '../../../../../backend/src/audit/audit-logger.js';
import { createAssessment } from '../../../../../backend/src/services/assessment-service.js';
import { assessmentInputSchema } from '../../../../../shared/schemas/assessment-input.js';
import {
  replyDbError,
  replyValidationError,
  replyError,
  replyServiceError,
} from '../../../../../backend/src/middleware/http-errors.js';

function getPatientId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

async function handleList(req: any, res: VercelResponse, patientId: string): Promise<void> {
  const parse = listQuerySchema.safeParse(req.query);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'patients.assessments.list.query');
    return;
  }
  const { page, pageSize } = parse.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Verify tenant ownership. Collapse "row absent" and "real DB error"
  // into one opaque 404 so we don't leak whether a patient id exists in
  // a sibling tenant.
  const { data: patient, error: patientErr } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id')
    .eq('id', patientId)
    .maybeSingle();
  if (patientErr) {
    replyDbError(res, patientErr, 'patients.assessments.list.patient');
    return;
  }
  if (!patient) {
    replyError(res, 404, 'PATIENT_NOT_FOUND');
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    replyError(res, 403, 'CROSS_TENANT_FORBIDDEN');
    return;
  }

  // Join assessments → risk_profiles so the longitudinal UI can show composite
  // risk level without an extra round-trip. The schema stores composite risk in
  // a separate table to preserve immutability of the assessment header.
  const { data, error, count } = await supabaseAdmin
    .from('assessments')
    .select(
      `
        id,
        created_at,
        assessment_date,
        completed_at,
        status,
        assessed_by,
        engine_version,
        risk_profile:risk_profiles(
          composite_risk_level,
          composite_score,
          cardiovascular_risk,
          metabolic_risk,
          hepatic_risk,
          renal_risk,
          frailty_risk
        )
      `,
      { count: 'exact' },
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    replyDbError(res, error, 'patients.assessments.list.select');
    return;
  }

  // B-10 — sensitive read audit. Listing a patient's assessment history
  // is PHI access; record best-effort so audit hiccups can't block reads.
  try {
    await recordAudit(req.auth, {
      action: 'assessment.read',
      resourceType: 'patient',
      resourceId: patientId,
      metadata: {
        list_size: data?.length ?? 0,
        page,
        page_size: pageSize,
      },
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error('[patients.assessments.list] audit best-effort failed', {
      patientId,
      auditErr,
    });
  }

  // Normalize Supabase nested-relation shape (array vs single) into a single
  // `riskProfile` field for the UI. Supabase returns the join as an array even
  // for a 1:1 relation; we take the first element.
  const assessments = (data ?? []).map((row: any) => {
    const rp = Array.isArray(row.risk_profile) ? row.risk_profile[0] ?? null : row.risk_profile ?? null;
    return {
      id: row.id,
      createdAt: row.created_at,
      assessmentDate: row.assessment_date,
      completedAt: row.completed_at,
      status: row.status,
      assessedBy: row.assessed_by,
      engineVersion: row.engine_version,
      riskProfile: rp
        ? {
            compositeRiskLevel: rp.composite_risk_level,
            compositeScore: rp.composite_score,
            cardiovascularRisk: rp.cardiovascular_risk,
            metabolicRisk: rp.metabolic_risk,
            hepaticRisk: rp.hepatic_risk,
            renalRisk: rp.renal_risk,
            frailtyRisk: rp.frailty_risk,
          }
        : null,
    };
  });

  res.status(200).json({
    assessments,
    pagination: { page, pageSize, total: count ?? 0 },
  });
}

async function handleCreate(req: any, res: VercelResponse, patientId: string): Promise<void> {
  const parse = assessmentInputSchema.safeParse(req.body);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'patients.assessments.create.body');
    return;
  }

  try {
    const snapshot = await createAssessment(req.auth, patientId, parse.data);
    res.status(201).json({ snapshot });
  } catch (err) {
    // Service-layer errors (AssessmentServiceError) carry stable codes;
    // `replyServiceError` only echoes the message when the code is on
    // the SAFE_TO_ECHO_CODES allowlist. Anything unknown collapses to
    // INTERNAL_ERROR + opaque requestId so we never reflect raw PG /
    // engine errors back to the client.
    replyServiceError(res, err, 'patients.assessments.create');
  }
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);
  const patientId = getPatientId(req);
  if (!patientId) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  if (req.method === 'GET') {
    const rl = checkRateLimit(req, { routeId: 'assessments.list', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', {
        retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
      });
      return;
    }
    await requireTenantMember((r, s) => handleList(r, s, patientId))(req as any, res);
    return;
  }

  if (req.method === 'POST') {
    const rl = checkRateLimit(req, { routeId: 'assessments.create', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', {
        retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
      });
      return;
    }
    await requireClinicalWrite((r, s) => handleCreate(r, s, patientId))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  replyError(res, 405, 'METHOD_NOT_ALLOWED');
});
