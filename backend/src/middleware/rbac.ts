/**
 * Role-Based Access Control middleware.
 *
 * Enforces role policies on top of an already-authenticated request (req.auth).
 * RBAC is defence-in-depth; the primary authorization boundary is PostgreSQL RLS
 * (see supabase/migrations/002_rls_policies.sql). Both layers must agree.
 *
 * Convention:
 *   - platform_admin  → cross-tenant, platform-level (used sparingly)
 *   - tenant_admin    → full control within its own tenant
 *   - clinician       → full clinical ops on assigned patients
 *   - assistant_staff → limited read/write support ops (no clinical edits)
 *   - patient         → only their own record (self-service portal, future)
 */

import type { VercelResponse } from '@vercel/node';
import type { AuthenticatedRequest, UserRole } from './auth-middleware';

export type RbacHandler = (
  req: AuthenticatedRequest,
  res: VercelResponse
) => Promise<void> | void;

/** Higher-order helper: only the listed roles may proceed. */
export function requireRole(...allowed: UserRole[]) {
  return (handler: RbacHandler): RbacHandler => {
    return async (req, res) => {
      if (!req.auth) {
        res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' } });
        return;
      }
      if (!allowed.includes(req.auth.role)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `Role '${req.auth.role}' is not allowed for this operation`,
          },
        });
        return;
      }
      await handler(req, res);
    };
  };
}

/** Clinicians + tenant admins + platform admins. The default "clinical write" set. */
export const requireClinicalWrite = requireRole(
  'platform_admin',
  'tenant_admin',
  'clinician'
);

/** Add assistant_staff on top — useful for reads and non-clinical updates. */
export const requireTenantMember = requireRole(
  'platform_admin',
  'tenant_admin',
  'clinician',
  'assistant_staff'
);

/** Only tenant_admin and platform_admin. Used for tenant-level config. */
export const requireTenantAdmin = requireRole('platform_admin', 'tenant_admin');

/** Only platform_admin. Used for cross-tenant audit/support operations. */
export const requirePlatformAdmin = requireRole('platform_admin');

/**
 * Tenant-match guard — ensures a resource's tenant_id matches the caller's tenant.
 * Should be called AFTER loading the resource but BEFORE returning it.
 * Platform admins are exempt (cross-tenant by design).
 */
export function assertSameTenant(
  req: AuthenticatedRequest,
  resource: { tenant_id: string | null }
): boolean {
  if (req.auth.role === 'platform_admin') return true;
  if (!req.auth.tenantId) return false;
  return resource.tenant_id === req.auth.tenantId;
}
