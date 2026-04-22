/**
 * /api/v1/consents
 *   GET  — list consents for a patient (query: ?patientId=<uuid>)
 *   POST — grant / revoke a consent
 *         body: { patientId, consentType, purpose, policyVersion, legalBasis,
 *                 action: 'grant' | 'revoke' }
 *
 * Consents are versioned and immutable: revoking creates a new row with
 * `granted = false` rather than mutating the granted row. This preserves the
 * audit trail required for GDPR accountability (Art.7 §1 + Art.30).
 *
 * Canonical schema is `consent_records` (001_schema_foundation.sql §14):
 *
 *   subject_type        'patient' | 'user'
 *   subject_id          patient_id or user_id
 *   consent_type        health_data_processing | ai_processing
 *                       | notifications | data_sharing_clinician | marketing
 *   granted             boolean
 *   legal_basis         text
 *   policy_version      text           -- versioning handle
 *   policy_url          text
 *   granted_at / revoked_at
 *   ip_hash / user_agent_hash
 *   jurisdiction        default 'EU'
 *   purpose             text
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember, requireClinicalWrite } from '../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import { recordAudit } from '../../../backend/src/audit/audit-logger.js';

const listQuery = z.object({
  patientId: z.string().uuid(),
});

/**
 * Consent type enum — MUST match the `consent_type` Postgres enum declared in
 * 001_schema_foundation.sql. Do NOT add aliases at this boundary; frontends
 * must map their UI labels to these canonical tokens.
 */
const CONSENT_TYPE_VALUES = [
  'health_data_processing',
  'ai_processing',
  'notifications',
  'data_sharing_clinician',
  'marketing',
] as const;

const grantBody = z.object({
  patientId: z.string().uuid(),
  consentType: z.enum(CONSENT_TYPE_VALUES),
  purpose: z.string().min(1).max(500),
  policyVersion: z.string().min(1).max(50),
  policyUrl: z.string().url().max(500).optional().nullable(),
  legalBasis: z.enum([
    'consent',
    'contract',
    'legal_obligation',
    'vital_interests',
    'legitimate_interests',
  ]),
  action: z.enum(['grant', 'revoke']).default('grant'),
  jurisdiction: z.string().min(2).max(10).optional(),
});

async function handleList(req: any, res: VercelResponse): Promise<void> {
  const parse = listQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid query' } });
    return;
  }
  const { patientId } = parse.data;

  // Tenant isolation: verify the patient belongs to the caller's tenant
  // BEFORE exposing any consent row. RLS also enforces this but defence-
  // in-depth keeps the code explicit.
  const { data: patient, error: patientErr } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id')
    .eq('id', patientId)
    .maybeSingle();
  if (patientErr) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: patientErr.message } });
    return;
  }
  if (!patient) {
    res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: '' } });
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    res.status(403).json({ error: { code: 'CROSS_TENANT_FORBIDDEN', message: '' } });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('consent_records')
    .select('*')
    .eq('subject_type', 'patient')
    .eq('subject_id', patientId)
    .order('created_at', { ascending: false });

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
  const { data: patient, error: patientErr } = await supabaseAdmin
    .from('patients')
    .select('id, tenant_id')
    .eq('id', p.patientId)
    .maybeSingle();
  if (patientErr) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: patientErr.message } });
    return;
  }
  if (!patient) {
    res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: '' } });
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    res.status(403).json({ error: { code: 'CROSS_TENANT_FORBIDDEN', message: '' } });
    return;
  }

  const now = new Date().toISOString();
  const granted = p.action === 'grant';

  const { data, error } = await supabaseAdmin
    .from('consent_records')
    .insert({
      subject_type: 'patient',
      subject_id: p.patientId,
      consent_type: p.consentType,
      granted,
      legal_basis: p.legalBasis,
      policy_version: p.policyVersion,
      policy_url: p.policyUrl ?? null,
      granted_at: granted ? now : now, // row timestamp either way
      revoked_at: granted ? null : now,
      ip_hash: req.auth.ipHash ?? null,
      user_agent_hash: null, // hashed upstream if UA capture is enabled
      jurisdiction: p.jurisdiction ?? 'EU',
      purpose: p.purpose,
    })
    .select('*')
    .single();

  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } });
    return;
  }

  // Patient-level consent_status is a denormalized convenience flag on
  // patients.* — keep it roughly in sync with the latest `health_data_processing`
  // grant/revoke so the rest of the app can short-circuit.
  if (p.consentType === 'health_data_processing') {
    await supabaseAdmin
      .from('patients')
      .update({ consent_status: granted ? 'active' : 'revoked' })
      .eq('id', p.patientId);
  }

  await recordAudit(req.auth, {
    action: granted ? 'consent.grant' : 'consent.revoke',
    resourceType: 'consent',
    resourceId: data.id,
    metadata: {
      consent_type: p.consentType,
      policy_version: p.policyVersion,
      legal_basis: p.legalBasis,
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
