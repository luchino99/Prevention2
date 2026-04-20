/**
 * /api/v1/consents
 *   GET  — list consents for a patient (query: ?patientId=<uuid>)
 *   POST — grant/record a consent
 *         body: { patientId, consentType, purpose, textVersion, legalBasis }
 *
 * Consents are versioned and immutable: revoking creates a new row with
 * status='revoked' rather than mutating the granted row. This preserves the
 * audit trail required for GDPR accountability.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware';
import { requireTenantMember, requireClinicalWrite } from '../../../backend/src/middleware/rbac';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit';
import { supabaseAdmin } from '../../../backend/src/config/supabase';
import { recordAudit } from '../../../backend/src/audit/audit-logger';

const listQuery = z.object({
  patientId: z.string().uuid(),
});

const grantBody = z.object({
  patientId: z.string().uuid(),
  consentType: z.enum([
    'data_processing',
    'clinical_communication',
    'report_sharing',
    'research_anonymized',
    'marketing',
  ]),
  purpose: z.string().min(1).max(500),
  textVersion: z.string().min(1).max(50),
  legalBasis: z.enum(['consent', 'contract', 'legal_obligation', 'vital_interests', 'legitimate_interests']),
  action: z.enum(['grant', 'revoke']).default('grant'),
  evidence: z.record(z.unknown()).optional(),
});

async function handleList(req: any, res: VercelResponse): Promise<void> {
  const parse = listQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid query' } });
    return;
  }
  const { patientId } = parse.data;

  let q = supabaseAdmin
    .from('patient_consents')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  if (req.auth.role !== 'platform_admin') q = q.eq('tenant_id', req.auth.tenantId);

  const { data, error } = await q;
  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  res.status(200).json({ consents: data ?? [] });
}

async function handleGrant(req: any, res: VercelResponse): Promise<void> {
  const parse = grantBody.safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid payload', details: parse.error.issues },
    });
    return;
  }
  const p = parse.data;

  // Verify patient tenant
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id')
    .eq('id', p.patientId)
    .single();
  if (!patient) {
    res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: '' } });
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    res.status(403).json({ error: { code: 'CROSS_TENANT_FORBIDDEN', message: '' } });
    return;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('patient_consents')
    .insert({
      tenant_id: patient.tenant_id,
      patient_id: p.patientId,
      recorded_by_user_id: req.auth.userId,
      consent_type: p.consentType,
      purpose: p.purpose,
      text_version: p.textVersion,
      legal_basis: p.legalBasis,
      status: p.action === 'grant' ? 'granted' : 'revoked',
      granted_at: p.action === 'grant' ? now : null,
      revoked_at: p.action === 'revoke' ? now : null,
      evidence: p.evidence ?? null,
    })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  await recordAudit(req.auth, {
    action: p.action === 'grant' ? 'consent.grant' : 'consent.revoke',
    resourceType: 'consent',
    resourceId: data.id,
    metadata: {
      consent_type: p.consentType,
      text_version: p.textVersion,
      patient_id: p.patientId,
    },
  });

  res.status(201).json({ consent: data });
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method === 'GET') {
    const rl = checkRateLimit(req, { routeId: 'consents.list', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireTenantMember((r, s) => handleList(r, s))(req as any, res);
    return;
  }

  if (req.method === 'POST') {
    const rl = checkRateLimit(req, { routeId: 'consents.grant', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;
    await requireClinicalWrite((r, s) => handleGrant(r, s))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
});
