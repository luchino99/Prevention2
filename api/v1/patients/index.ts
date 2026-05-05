/**
 * /api/v1/patients
 *   GET  — paginated list of patients in the caller's tenant
 *   POST — create a new patient (clinician/tenant_admin/platform_admin)
 *
 * RLS enforces tenant isolation at the DB layer; the handler additionally
 * double-checks roles and emits audit events.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth } from '../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember, requireClinicalWrite } from '../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../backend/src/config/supabase.js';
import { recordAudit } from '../../../backend/src/audit/audit-logger.js';
import { createPatientSchema, getPatientDisplayName } from '../../../shared/schemas/patient-input.js';
import { replyDbError, replyValidationError, replyError } from '../../../backend/src/middleware/http-errors.js';
import { logStructured } from '../../../backend/src/observability/structured-log.js';

/**
 * Search input is interpolated into a PostgREST `or(...)` filter via
 * the supabase-js client. Audit S-02 flagged predicate-injection risk:
 * a value containing `,`, `)`, `(`, `*`, `:`, newline, tab, etc.
 * could compose extra filters within the same OR group.
 *
 * The whitelist below admits only:
 *   - Unicode letters (\p{L})
 *   - Unicode combining marks (\p{M}, e.g. accents on N)
 *   - Unicode digits (\p{N})
 *   - the single ASCII space U+0020 (NOT \s — \s also includes
 *     tab/newline/carriage return/form feed/vertical tab, which
 *     could break the OR group or smuggle log-injection sequences)
 *   - hyphen, apostrophe, dot, middle-dot
 *
 * Anything else (newline, tab, comma, parenthesis, asterisk, colon,
 * full-width unicode comma, etc.) is rejected at validation time so
 * the supabase-js client never sees it.
 */
const SEARCH_WHITELIST_RE = /^[\p{L}\p{M}\p{N} \-'.·]{1,100}$/u;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).regex(SEARCH_WHITELIST_RE,
    'Search may contain only letters, digits, spaces and basic punctuation').optional(),
});

async function handleList(req: any, res: VercelResponse): Promise<void> {
  const parse = listQuerySchema.safeParse(req.query);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'patients.list.query');
    return;
  }
  const { page, pageSize, search } = parse.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('patients')
    .select(
      'id, external_code, display_name, first_name, last_name, birth_date, birth_year, sex, contact_email, contact_phone, is_active, created_at, tenant_id',
      {
        count: 'exact',
      },
    )
    .is('deleted_at', null)
    .range(from, to)
    .order('created_at', { ascending: false });

  if (req.auth.role !== 'platform_admin') {
    query = query.eq('tenant_id', req.auth.tenantId);
  }

  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,display_name.ilike.%${search}%,external_code.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    replyDbError(res, error, 'patients.list.select');
    return;
  }

  res.status(200).json({
    patients: data ?? [],
    pagination: { page, pageSize, total: count ?? 0 },
  });
}

async function handleCreate(req: any, res: VercelResponse): Promise<void> {
  const parse = createPatientSchema.safeParse(req.body);
  if (!parse.success) {
    replyValidationError(res, parse.error.issues, 'patients.create.body');
    return;
  }
  const payload = parse.data;

  if (!req.auth.tenantId) {
    replyError(res, 400, 'NO_TENANT');
    return;
  }

  // Unpack the validated nested shape (demographics / contact) into the
  // flat DB column layout expected by `001_schema_foundation.sql`.
  const demo = payload.demographics;
  const contact = payload.contact;
  const dob =
    demo.dateOfBirth instanceof Date
      ? demo.dateOfBirth.toISOString().slice(0, 10)
      : demo.dateOfBirth;

  // Schema requires `display_name NOT NULL`. Derive it from demographics
  // (identical to the helper `getPatientDisplayName`), and compute
  // birth_year from the parsed DOB for data minimization alignment.
  const displayName = getPatientDisplayName(demo);
  const birthYear =
    demo.dateOfBirth instanceof Date
      ? demo.dateOfBirth.getUTCFullYear()
      : typeof demo.dateOfBirth === 'string'
        ? new Date(demo.dateOfBirth).getUTCFullYear()
        : null;

  const { data, error } = await supabaseAdmin
    .from('patients')
    .insert({
      tenant_id: req.auth.tenantId,
      created_by: req.auth.userId,
      external_code: demo.externalCode,
      display_name: displayName,
      first_name: demo.firstName,
      last_name: demo.lastName,
      birth_date: dob,
      birth_year: birthYear,
      sex: demo.sex,
      contact_email: contact?.email ?? null,
      contact_phone: contact?.phoneNumber ?? null,
      notes: payload.notes ?? null,
      consent_status: payload.consentGiven ? 'active' : 'pending',
    })
    .select(
      'id, external_code, display_name, first_name, last_name, birth_date, birth_year, sex, contact_email, contact_phone, consent_status, is_active, created_at',
    )
    .single();

  if (error) {
    replyDbError(res, error, 'patients.create.insert');
    return;
  }

  // Auto-create a `professional_patient_links` row when a clinician
  // creates a patient. Without this, the clinician can create a patient
  // but immediately fails `assertCanWritePatient` on the next assessment
  // with NO_PATIENT_LINK (see assessment-service.ts). Best-effort: we
  // never fail the patient-create response on a link insertion error
  // because:
  //   - the patient row is already committed;
  //   - `ppl_unique_active (professional_user_id, patient_id, is_active)`
  //     guarantees idempotency, so a retry won't duplicate rows;
  //   - tenant_admin / platform_admin do not need a link (they bypass
  //     the check in assertCanWritePatient);
  //   - the cross-tenant trigger guarantees this insert can never cross
  //     tenant boundaries even if the handler were ever misconfigured.
  if (req.auth.role === 'clinician') {
    const { error: linkErr } = await supabaseAdmin
      .from('professional_patient_links')
      .insert({
        tenant_id: req.auth.tenantId,
        professional_user_id: req.auth.userId,
        patient_id: data.id,
        relationship_type: 'primary',
        is_active: true,
        assigned_by: req.auth.userId,
      });
    if (linkErr) {
      // eslint-disable-next-line no-console
      logStructured('warn', 'PPL_AUTOLINK_FAILED', { context: 'patients.create auto-link PPL failed', extra: {
        patientId: data.id,
        userId: req.auth.userId,
        pg: { code: (linkErr as any).code, message: linkErr.message },
      } });
    }
  }

  await recordAudit(req.auth, {
    action: 'patient.create',
    resourceType: 'patient',
    resourceId: data.id,
  });

  res.status(201).json({ patient: data });
}

export default withAuth(async (req: VercelRequest & { auth: any }, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method === 'GET') {
    const rl = await checkRateLimitAsync(req, { routeId: 'patients.list', ...RATE_LIMITS.read });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireTenantMember((r, s) => handleList(r, s))(req as any, res);
    return;
  }

  if (req.method === 'POST') {
    const rl = await checkRateLimitAsync(req, { routeId: 'patients.create', ...RATE_LIMITS.write });
    applyRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
      return;
    }
    await requireClinicalWrite((r, s) => handleCreate(r, s))(req as any, res);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  replyError(res, 405, 'METHOD_NOT_ALLOWED');
});
