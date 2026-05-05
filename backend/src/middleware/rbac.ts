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
import type { AuthenticatedRequest, UserRole } from './auth-middleware.js';
import { emitAccessDenialLog } from '../audit/audit-logger.js';

/**
 * Build a canonical route tag for the access-denial log without leaking
 * PHI / opaque ids. Vercel exposes the matched route via `req.url`, but
 * `req.url` carries the actual ids (e.g. `/api/v1/patients/<uuid>`).
 * For dashboard grouping we strip UUIDs to a `[id]` placeholder so
 * heatmaps aggregate cleanly across all callers.
 */
function canonicaliseRoute(req: AuthenticatedRequest): string {
  const method = (req.method ?? 'UNKNOWN').toUpperCase();
  const url = (req.url ?? '').split('?')[0] ?? '';
  // Replace any UUID v4-shaped segment with [id]. Tolerant on hyphens.
  const stripped = url.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '[id]',
  );
  return `${method} ${stripped}`;
}

export type RbacHandler = (
  req: AuthenticatedRequest,
  res: VercelResponse
) => Promise<void> | void;

/** Higher-order helper: only the listed roles may proceed. */
export function requireRole(...allowed: UserRole[]) {
  return (handler: RbacHandler): RbacHandler => {
    return async (req, res) => {
      if (!req.auth) {
        // Unauthenticated path — emit ACCESS_DENIED for dashboard
        // heatmaps before returning the opaque 401.
        emitAccessDenialLog({
          reason: 'unauthenticated',
          actorUserId: null,
          actorRole: null,
          actorTenantId: null,
          ipHash: null,
          route: canonicaliseRoute(req),
          allowedRoles: allowed,
        });
        res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' } });
        return;
      }
      if (!allowed.includes(req.auth.role)) {
        // Authenticated but wrong role — the canonical role-mismatch
        // signal. The HTTP response stays a generic FORBIDDEN; the
        // structured log line below carries the truthful reason
        // (which roles WOULD have passed) for the operator.
        emitAccessDenialLog({
          reason: 'role_mismatch',
          actorUserId: req.auth.userId,
          actorRole: req.auth.role,
          actorTenantId: req.auth.tenantId,
          ipHash: req.auth.ipHash ?? null,
          route: canonicaliseRoute(req),
          allowedRoles: allowed,
        });
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
 *
 * On denial, this function emits an `ACCESS_DENIED` log line with
 * `reason="cross_tenant"`. Callers MUST still translate the boolean
 * into the right HTTP response (typically `replyError(404, 'NOT_FOUND')`
 * — opaque, to avoid disclosing the existence of cross-tenant
 * resources to the caller). The structured log line gives the
 * operator the truthful reason that the response intentionally hides.
 */
export function assertSameTenant(
  req: AuthenticatedRequest,
  resource: { tenant_id: string | null; id?: string | null }
): boolean {
  if (req.auth.role === 'platform_admin') return true;
  if (!req.auth.tenantId) {
    emitAccessDenialLog({
      reason: 'cross_tenant',
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      actorTenantId: null,
      ipHash: req.auth.ipHash ?? null,
      route: canonicaliseRoute(req),
      targetResourceId: resource.id ?? null,
      targetTenantId: resource.tenant_id ?? null,
    });
    return false;
  }
  if (resource.tenant_id !== req.auth.tenantId) {
    emitAccessDenialLog({
      reason: 'cross_tenant',
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      actorTenantId: req.auth.tenantId,
      ipHash: req.auth.ipHash ?? null,
      route: canonicaliseRoute(req),
      targetResourceId: resource.id ?? null,
      targetTenantId: resource.tenant_id ?? null,
    });
    return false;
  }
  return true;
}
