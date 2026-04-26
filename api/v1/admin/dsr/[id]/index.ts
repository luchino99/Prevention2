/**
 * GET /api/v1/admin/dsr/[id]
 * ---------------------------------------------------------------------------
 * Read a single Data Subject Request by id.
 *
 * Authorization
 * -------------
 *   tenant_admin → only DSRs whose tenant_id matches their tenant.
 *   platform_admin → any DSR.
 *
 * The shape returned mirrors the list endpoint plus a freshly-minted
 * signed URL when an export artefact has been produced. Signed URLs
 * carry a short TTL (5 minutes) so they cannot be re-used after the
 * admin closes the page.
 *
 * Privacy
 * -------
 *   Only structural fields are echoed (kind, status, timestamps, ids).
 *   The export bytes themselves stay in the private storage bucket
 *   behind a signed URL — never inlined into the response.
 *
 * Audit
 * -----
 *   Best-effort `dsr.read` event with the DSR id and kind. We do not
 *   include the subject id in the metadata to avoid duplicating PHI
 *   into the audit_events table; the DSR row itself carries it.
 * ---------------------------------------------------------------------------
 */

import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '../../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantAdmin } from '../../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../../backend/src/middleware/security-headers.js';
import {
  checkRateLimit,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../../backend/src/config/supabase.js';
import { recordAudit } from '../../../../../backend/src/audit/audit-logger.js';
import {
  replyDbError,
  replyError,
} from '../../../../../backend/src/middleware/http-errors.js';

/**
 * Bucket used for both clinical reports and DSR exports. Object paths are
 * namespaced by prefix (`dsr/<dsr_id>/...` for DSR artefacts, otherwise
 * the per-tenant report folder). A future migration may split this into
 * its own bucket; until then we rely on the bucket-wide service-role
 * gating policy added by migration 010 (B-15).
 */
const DSR_BUCKET = 'clinical-reports';
const SIGNED_URL_TTL_SEC = 5 * 60;

const idSchema = z.string().uuid();

export default withAuth(async (req: AuthenticatedRequest, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'admin.dsr.read', ...RATE_LIMITS.admin });
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

    const { data: row, error } = await supabaseAdmin
      .from('data_subject_requests')
      .select(
        'id, tenant_id, subject_patient_id, subject_user_id, kind, status, '
          + 'requested_by_user_id, fulfilled_by_user_id, export_storage_path, '
          + 'rejection_reason, notes, requested_at, fulfilled_at, sla_deadline',
      )
      .eq('id', dsrId)
      .maybeSingle();

    if (error) {
      replyDbError(s, error, 'admin.dsr.read.select');
      return;
    }
    if (!row) {
      // Single opaque 404 for both "doesn't exist" and "not your tenant".
      // Distinguishing them would let an admin enumerate DSR ids across
      // tenant boundaries.
      replyError(s, 404, 'NOT_FOUND');
      return;
    }

    if (r.auth.role !== 'platform_admin' && row.tenant_id !== r.auth.tenantId) {
      replyError(s, 404, 'NOT_FOUND');
      return;
    }

    let signedUrl: string | null = null;
    if (typeof row.export_storage_path === 'string' && row.export_storage_path.length > 0) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(DSR_BUCKET)
        .createSignedUrl(row.export_storage_path, SIGNED_URL_TTL_SEC);
      if (signErr) {
        // Log but do not fail the read — admins can re-trigger fulfilment
        // from the UI if the artefact is missing.
        // eslint-disable-next-line no-console
        console.error('[admin.dsr.read] signed-url failed', { signErr });
      } else if (signed?.signedUrl) {
        signedUrl = signed.signedUrl;
      }
    }

    try {
      await recordAudit(r.auth, {
        action: 'dsr.read',
        resourceType: 'data_subject_request',
        resourceId: dsrId,
        metadata: {
          kind: row.kind,
          status: row.status,
          has_export: !!row.export_storage_path,
        },
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      console.error('[admin.dsr.read] audit best-effort failed', { auditErr });
    }

    s.status(200).json({
      request: row,
      exportSignedUrl: signedUrl,
      exportTtlSec: signedUrl ? SIGNED_URL_TTL_SEC : null,
    });
  })(req, res);
});
