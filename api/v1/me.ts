/**
 * GET /api/v1/me — returns the authenticated user profile.
 * Used by the frontend on boot to hydrate the session.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../backend/src/middleware/auth-middleware.js';
import { applySecurityHeaders } from '../../backend/src/middleware/security-headers.js';
import { supabaseAdmin } from '../../backend/src/config/supabase.js';

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
    return;
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, tenant_id, created_at')
    .eq('id', req.auth.userId)
    .single();

  if (error || !user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    return;
  }

  let tenant = null;
  if (user.tenant_id) {
    const { data: t } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, status')
      .eq('id', user.tenant_id)
      .single();
    tenant = t;
  }

  res.status(200).json({ user, tenant });
});
