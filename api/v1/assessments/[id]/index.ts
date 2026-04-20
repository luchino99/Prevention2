/**
 * GET /api/v1/assessments/[id]
 * Returns the full AssessmentSnapshot for a stored assessment.
 * Used by the patient detail / assessment-detail UI and as input for PDF.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../../backend/src/middleware/rate-limit';
import {
  loadAssessmentSnapshot,
  AssessmentServiceError,
} from '../../../../backend/src/services/assessment-service';
import { recordAudit } from '../../../../backend/src/audit/audit-logger';

function getId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '' } });
    return;
  }

  const id = getId(req);
  if (!id) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: '' } });
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'assessments.read', ...RATE_LIMITS.read });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '' } }) as any;

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    try {
      const snapshot = await loadAssessmentSnapshot(r.auth, id);
      await recordAudit(r.auth, {
        action: 'assessment.read',
        resourceType: 'assessment',
        resourceId: id,
      });
      s.status(200).json({ snapshot });
    } catch (err: any) {
      if (err instanceof AssessmentServiceError) {
        s.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[assessments.read] unexpected', err);
      s.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Read failed' } });
    }
  })(req as any, res);
});
