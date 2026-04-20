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
import { validateAccessToken } from '../../../backend/src/middleware/auth-middleware';
import { recordAudit, recordFailedLogin } from '../../../backend/src/audit/audit-logger';
import { applySecurityHeaders } from '../../../backend/src/middleware/security-headers';
import { checkRateLimit, RATE_LIMITS, applyRateLimitHeaders } from '../../../backend/src/middleware/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } });
    return;
  }

  const rl = checkRateLimit(req, { routeId: 'auth.session', ...RATE_LIMITS.auth });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    return;
  }

  const authHeader = req.headers['authorization'];
  const token =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;

  if (!token) {
    await recordFailedLogin('', undefined, undefined, 'missing_bearer_token');
    res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Missing Bearer token' } });
    return;
  }

  try {
    const auth = await validateAccessToken(token, req);
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
    const status = err?.status ?? 401;
    const code = err?.code ?? 'AUTH_FAILED';
    res.status(status).json({ error: { code, message: err?.message ?? 'Auth failed' } });
  }
}
