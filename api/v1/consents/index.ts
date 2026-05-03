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
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import { recordAuditStrict, AuditWriteError, emitAccessDenialLog } from '../../../backend/src/audit/audit-logger.js';
import { replyDbError, replyValidationError, replyError } from '../../../backend/src/middleware/http-errors.js';
import { logStructured } from '../../../backend/src/observability/structured-log.js';

/**
 * B-08 — clinician → patient consent gate.
 *
 * Returns true iff the caller is allowed to grant/revoke consent on behalf
 * of `patientId` according to the role matrix:
 *
 *   - platform_admin → always allowed
 *   - tenant_admin   → allowed for patients in own tenant
 *   - clinician      → allowed iff there is an ACTIVE professional_patient_links
 *                      row tying this user to this patient
 *   - assistant_staff / patient → never (handled upstream by RBAC HOF)
 *
 * RLS gives us tenant isolation; this gate adds the per-clinician
 * relationship requirement that RLS deliberately doesn't model.
 */
async function isPplGated(
  auth: { role?: string; userId?: string; tenantId?: string },
  patientId: string,
): Promise<boolean> {
  if (auth.role === 'platform_admin') return true;
  if (auth.role === 'tenant_admin') return true;
  if (auth.role !== 'clinician') return false;
  if (!auth.userId || !auth.tenantId) return false;
  const { data, error } = await supabaseAdmin
    .from('professional_patient_links')
    .select('id')
    .eq('professional_user_id', auth.userId)
    .eq('patient_id', patientId)
    .eq('tenant_id', auth.tenantId)
    .eq('is_active', true)
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

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
    replyValidationError(res, parse.error.issues, 'consents.list.query');
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
    replyDbError(res, patientErr, 'consents.list.patient');
    return;
  }
  if (!patient) {
    replyError(res, 404, 'PATIENT_NOT_FOUND');
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    emitAccessDenialLog({
      reason: 'cross_tenant',
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      actorTenantId: req.auth.tenantId,
      ipHash: req.auth.ipHash ?? null,
      route: `${req.method ?? 'UNKNOWN'} /api/v1/consents`,
      targetResourceId: patientId,
      targetTenantId: patient.tenant_id as string,
    });
    replyError(res, 403, 'CROSS_TENANT_FORBIDDEN');
    return;
  }

  // B-08 — also require PPL for clinicians on consent listing. Reading
  // historical consent decisions is itself sensitive (reveals AI/marketing
  // preferences) and must not bypass the per-clinician relationship gate.
  if (!(await isPplGated(req.auth, patientId))) {
    replyError(res, 403, 'NO_PATIENT_LINK');
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('consent_records')
    .select('*')
    .eq('subject_type', 'patient')
    .eq('subject_id', patientId)
    .order('created_at', { ascending: false });

  if (error) {
    replyDbError(res, error, 'consents.list.select');
    return;
  }

  res.status(200).json({ consents: data ?? [] });
}

async function handleGrant(req: any, res: VercelResponse): Promise<void> {
  const parse = grantBody.safeParse(req.body);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'consents.grant.body');
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
    replyDbError(res, patientErr, 'consents.grant.patient');
    return;
  }
  if (!patient) {
    replyError(res, 404, 'PATIENT_NOT_FOUND');
    return;
  }
  if (req.auth.role !== 'platform_admin' && patient.tenant_id !== req.auth.tenantId) {
    emitAccessDenialLog({
      reason: 'cross_tenant',
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      actorTenantId: req.auth.tenantId,
      ipHash: req.auth.ipHash ?? null,
      route: `${req.method ?? 'UNKNOWN'} /api/v1/consents`,
      targetResourceId: patientId,
      targetTenantId: patient.tenant_id as string,
    });
    replyError(res, 403, 'CROSS_TENANT_FORBIDDEN');
    return;
  }

  // B-08 — clinician PPL gate. tenant_admin / platform_admin bypass.
  if (!(await isPplGated(req.auth, p.patientId))) {
    replyError(res, 403, 'NO_PATIENT_LINK');
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
    replyDbError(res, error, 'consents.grant.insert');
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

  // B-09 — audit guarantee: await + propagate. A consent grant/revoke
  // without a corresponding audit row is a regulatory hole (Art.7 §1
  // requires demonstrable consent), so we surface 500 if the audit
  // write fails and log the original PG error server-side.
  // recordAuditStrict throws AuditWriteError on persistence failure (vs.
  // recordAudit which only logs), so this catch branch is reachable.
  try {
    await recordAuditStrict(req.auth, {
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
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    logStructured('warn', 'AUDIT_BEST_EFFORT_FAILED', { context: 'consents.grant audit write failed', extra: {
      id: data.id,
      isAuditWriteError: auditErr instanceof AuditWriteError,
      auditErr,
    } });
    replyError(res, 500, 'AUDIT_WRITE_FAILED');
    return;
  }

  res.status(201).json({ consent: data });
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method === 'GET') {
    const rl = await checkRateLimitAsync(req, { routeId: 'consents.list', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireTenantMember((r, s) => handleList(r, s))(req as any, res);
    return;
  }

  if (req.method === 'POST') {
    const rl = await checkRateLimitAsync(req, { routeId: 'consents.grant', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireClinicalWrite((r, s) => handleGrant(r, s))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  replyError(res, 405, 'METHOD_NOT_ALLOWED');
});
