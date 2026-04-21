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
import { createAssessment, AssessmentServiceError } from '../../../../../backend/src/services/assessment-service.js';
import { assessmentInputSchema } from '../../../../../shared/schemas/assessment-input.js';

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
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid query' } });
    return;
  }
  const { page, pageSize } = parse.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Verify tenant ownership
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id')
    .eq('id', patientId)
    .single();
  if (!patient) {
    res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: '' } });
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    res.status(403).json({ error: { code: 'CROSS_TENANT_FORBIDDEN', message: '' } });
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
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  await recordAudit(req.auth, {
    action: 'assessment.read',
    resourceType: 'patient',
    resourceId: patientId,
    metadata: { list_size: data?.length ?? 0 },
  });

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
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid assessment input',
        details: parse.error.issues,
      },
    });
    return;
  }

  try {
    const snapshot = await createAssessment(req.auth, patientId, parse.data);
    res.status(201).json({ snapshot });
  } catch (err: any) {
    if (err instanceof AssessmentServiceError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error('[assessments.create] unexpected', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Assessment creation failed' } });
  }
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);
  const patientId = getPatientId(req);
  if (!patientId) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid patient id' } });
    return;
  }

  if (req.method === 'GET') {
    const rl = checkRateLimit(req, { routeId: 'assessments.list', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireTenantMember((r, s) => handleList(r, s, patientId))(req as any, res);
    return;
  }

  if (req.method === 'POST') {
    const rl = checkRateLimit(req, { routeId: 'assessments.create', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireClinicalWrite((r, s) => handleCreate(r, s, patientId))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
});
