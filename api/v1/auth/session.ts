/**
 * POST /api/v1/auth/session
 * Exchange Supabase credentials for a validated session envelope.
 *
 * NOTE: Actual password verification is performed by Supabase Auth directly
 * from the frontend (supabase.auth.signInWithPassword). This endpoint exists
 * to:
 *   1. Validate the access token is live
 *   2. Load the canonical user profile (tenant, role)
 *   3. Emit an audit.login event
 *
 * Never receives passwords. Only Bearer tokens.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAccessToken } from '../../../backend/src/middleware/auth-middleware.js';
import { recordAudit, recordFailedLogin } from '../../../backend/src/audit/audit-logger.js';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit.js';
import { replyError, replyServiceError } from '../../../backend/src/middleware/http-errors.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    replyError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const rl = await checkRateLimitAsync(req, { routeId: 'auth.session', ...RATE_LIMITS.auth });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    replyError(res, 429, 'RATE_LIMITED', {
      retryAfterSec: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
    });
    return;
  }

  const authHeader = req.headers['authorization'];
  const token =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;

  if (!token) {
    await recordFailedLogin('', undefined, undefined, 'missing_bearer_token');
    replyError(res, 401, 'MISSING_TOKEN');
    return;
  }

  try {
    const auth = await validateAccessToken(token, req);
    // Best-effort audit on login: a missed audit row should not stop the user
    // logging in (auth itself is the security boundary; audit is observability).
    // recordAudit is non-throwing by contract — it catches internally and
    // emits the canonical AUDIT_WRITE_FAILED variant='best_effort' line, so we
    // do not need a wrapping try/catch here (which would only re-leak the raw
    // error object into Datadog and clash with the L-04 single-line contract).
    await recordAudit(auth, { action: 'auth.login', resourceType: 'session' });

    res.status(200).json({
      user: {
        id: auth.userId,
        email: auth.email,
        tenantId: auth.tenantId,
        role: auth.role,
      },
    });
  } catch (err: any) {
    await recordFailedLogin('', undefined, undefined, err?.code ?? 'unknown');
    // Service-error envelope: any auth-middleware error code that is on the
    // SAFE_TO_ECHO_CODES allowlist (UNAUTHORIZED, FORBIDDEN, …) gets its
    // hand-written message echoed; anything else collapses to opaque code +
    // requestId so we never reflect raw JWT-validation errors back.
    replyServiceError(res, err, 'auth.session');
  }
}
