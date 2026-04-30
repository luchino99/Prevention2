/**
 * /api/v1/assessments/[id]
 *
 *   GET     — loadAssessmentSnapshot() for UI + PDF rendering.
 *   DELETE  — permanently remove this assessment and its full clinical
 *             trail (measurements, scores, risk profile, nutrition/activity
 *             snapshots, follow-up plan, alerts, report exports, materialised
 *             due_items, and the PDF binaries from object storage).
 *
 * Authorization for DELETE is stricter than for GET: only platform admins,
 * tenant admins in the owning tenant, or the clinician who authored the
 * assessment may remove it. All other roles receive 403. Every successful
 * deletion emits `assessment.delete` into the audit trail with the full
 * before-image metadata (patient, tenant, status, authoring user, and the
 * storage cleanup receipt).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit.js';
import {
  loadAssessmentSnapshot,
  deleteAssessment,
} from '../../../../backend/src/services/assessment-service.js';
import { recordAudit } from '../../../../backend/src/audit/audit-logger.js';
import { replyError, replyServiceError } from '../../../../backend/src/middleware/http-errors.js';

function getId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'DELETE') {
    res.setHeader('Allow', 'GET, DELETE');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const id = getId(req);
  if (!id) {
    replyError(res, 400, 'INVALID_ID');
    return;
  }

  // Separate rate-limit buckets for read vs destructive write. Delete is
  // strictly throttled to protect against accidental bulk-delete loops.
  const rlConfig = method === 'DELETE'
    ? { routeId: 'assessments.delete', ...RATE_LIMITS.write }
    : { routeId: 'assessments.read',   ...RATE_LIMITS.read };
  const rl = await checkRateLimitAsync(req, rlConfig);
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)) });
    return;
  }

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    if (method === 'GET') {
      try {
        const snapshot = await loadAssessmentSnapshot(r.auth, id);
        // B-10 — sensitive read audit. We log every assessment snapshot
        // load, regardless of who triggered it. recordAudit is wrapped in
        // its own try so an audit failure does not block clinical reads,
        // but we DO log the failure server-side.
        try {
          await recordAudit(r.auth, {
            action: 'assessment.read',
            resourceType: 'assessment',
            resourceId: id,
          });
        } catch (auditErr) {
          // eslint-disable-next-line no-console
          console.error('[assessment.read] audit best-effort failed', { id, auditErr });
        }
        s.status(200).json({ snapshot });
      } catch (err: any) {
        replyServiceError(s, err, 'assessments.read');
      }
      return;
    }

    // method === 'DELETE'
    try {
      const receipt = await deleteAssessment(r.auth, id);
      // The audit row is written inside deleteAssessment() with the full
      // before-image; don't double-log here.
      s.status(200).json({
        assessmentId: receipt.assessmentId,
        patientId: receipt.patientId,
        storage: {
          attempted: receipt.storageObjectsAttempted,
          removed: receipt.storageObjectsRemoved,
          orphaned: receipt.storageObjectsOrphaned.length,
        },
        dueItemsRemoved: receipt.dueItemsRemoved,
      });
    } catch (err: any) {
      replyServiceError(s, err, 'assessments.delete');
    }
  })(req as any, res);
});
