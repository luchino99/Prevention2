/**
 * Authentication middleware for Vercel serverless functions.
 *
 * Responsibilities:
 *   - Extract Bearer token from Authorization header
 *   - Validate JWT via supabaseAdmin.auth.getUser
 *   - Load canonical user row (tenant_id, role, suspension flag) from public.users
 *   - Attach auth context to the request
 *
 * This module NEVER trusts the client for tenant_id or role.
 * All ownership metadata is re-loaded server-side from Supabase.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../config/supabase.js';
import crypto from 'crypto';

/**
 * Role values MUST match the public.user_role PostgreSQL enum defined in
 * supabase/migrations/001_schema_foundation.sql
 */
export const USER_ROLES = [
  'platform_admin',
  'tenant_admin',
  'clinician',
  'assistant_staff',
  'patient',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string | null;
  role: UserRole;
  ipHash?: string;
  userAgent?: string;
  /** Raw JWT — used to construct RLS-aware Supabase clients when needed */
  accessToken: string;
}

export interface AuthenticatedRequest extends VercelRequest {
  auth: AuthContext;
}

/** Authorization header parser. Returns the Bearer token or null. */
function extractToken(req: VercelRequest): string | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Decode a JWT payload WITHOUT verifying the signature. We rely on
 * Supabase Auth (`supabaseAdmin.auth.getUser(token)`) for the actual
 * cryptographic validation; this helper is purely for reading
 * non-security-critical claims like `aal` (Authentication Assurance
 * Level — `aal1` = single-factor / password only, `aal2` = MFA
 * verified second factor). Returns null on any parse failure.
 */
function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1] ?? '';
    if (!payloadB64) return null;
    const buf = Buffer.from(
      payloadB64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    );
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Roles that MUST present a MFA-verified session (aal2) to access any
 * authenticated endpoint when MFA enforcement is on. Patients and
 * clinicians are out of scope for now — added incrementally per
 * controller policy.
 */
const ROLES_REQUIRING_MFA: readonly UserRole[] = [
  'platform_admin',
  'tenant_admin',
];

/**
 * Feature flag that gates the MFA mandate. Default OFF so a fresh
 * deploy does not lock out admins who haven't enrolled yet. Operators
 * flip `MFA_ENFORCEMENT_ENABLED=true` after every admin in the tenant
 * has completed enrolment via /pages/mfa-enroll.html. Once flipped,
 * any admin session at aal1 is rejected with `403 MFA_REQUIRED`, and
 * the frontend redirects to the enrolment page.
 *
 * Why default-off
 * ---------------
 * If the flag was on by default, the first deploy after the upgrade
 * would lock the tenant_admin out of their own platform — and the
 * only path back in (the enrolment page) would itself be reachable
 * since it does NOT call the backend. Default-off keeps the rollout
 * voluntary: enrol first, then flip.
 */
function isMfaEnforced(): boolean {
  const v = process.env.MFA_ENFORCEMENT_ENABLED?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** SHA-256 truncated hash of client IP — used for audit logs (never raw IP). */
function hashIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function getClientIp(req: VercelRequest): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) return realIp;
  return (req.socket as any)?.remoteAddress;
}

function getUserAgent(req: VercelRequest): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 256) : undefined;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Core validation: given a JWT, return a fully validated AuthContext or throw AuthError.
 * Used both by Express-style middleware and by direct handlers.
 */
export async function validateAccessToken(
  token: string,
  req: VercelRequest
): Promise<AuthContext> {
  const { data, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !data?.user) {
    throw new AuthError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  }

  const userId = data.user.id;
  const email = data.user.email ?? '';

  // IMPORTANT: Use `.maybeSingle()` so a missing public.users row is a
  // *not-found* condition rather than a PostgREST `.single()` error. Then
  // split real DB errors (HTTP 500, DB_ERROR) from missing-profile (401,
  // USER_PROFILE_NOT_FOUND). Conflating the two masks schema drift as
  // auth failures — which is exactly the bug that blocked the dashboard
  // after the Strategy A reconciliation.
  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id, role, status')
    .eq('id', userId)
    .maybeSingle();

  if (userErr) {
    // PostgREST 42703 etc. — propagate the underlying code for diagnostics.
    const { logStructured } = await import('../observability/structured-log.js');
    logStructured('error', 'AUTH_PROFILE_LOOKUP_FAILED', {
      userId,
      dbErrorCode: (userErr as { code?: string })?.code ?? null,
      dbErrorMessage: userErr.message ?? null,
    });
    throw new AuthError(500, 'DB_ERROR', 'Could not load user profile');
  }

  if (!userRow) {
    throw new AuthError(
      401,
      'USER_PROFILE_NOT_FOUND',
      'Authenticated user has no public.users row — tenant onboarding incomplete',
    );
  }

  if (userRow.status === 'suspended') {
    throw new AuthError(403, 'USER_SUSPENDED', 'User account is suspended');
  }
  if (userRow.status === 'inactive') {
    throw new AuthError(403, 'USER_INACTIVE', 'User account is inactive');
  }

  const role = userRow.role as UserRole;
  if (!USER_ROLES.includes(role)) {
    throw new AuthError(500, 'INVALID_ROLE', 'Invalid user configuration');
  }

  // ── MFA mandate (L-09) ──────────────────────────────────────────────
  // When MFA_ENFORCEMENT_ENABLED is set and the role is in the gated
  // list, require Supabase AAL2 (MFA-verified session). A pre-MFA
  // session at aal1 is rejected with a 403 carrying a stable error
  // code so the frontend can redirect the user to /pages/mfa-enroll.html.
  //
  // The enrolment page itself never reaches this middleware — it talks
  // to Supabase Auth directly via supabase.auth.mfa.enroll/challenge/
  // verify, so an admin who hasn't enrolled yet can still complete the
  // setup even when the flag is on.
  if (isMfaEnforced() && ROLES_REQUIRING_MFA.includes(role)) {
    const claims = decodeJwtPayloadUnsafe(token);
    const aal = typeof claims?.aal === 'string' ? claims.aal : null;
    if (aal !== 'aal2') {
      throw new AuthError(
        403,
        'MFA_REQUIRED',
        'Multi-factor authentication is required for administrative roles. Complete enrolment at /pages/mfa-enroll.html.',
      );
    }
  }

  return {
    userId,
    email,
    tenantId: userRow.tenant_id,
    role,
    ipHash: hashIp(getClientIp(req)),
    userAgent: getUserAgent(req),
    accessToken: token,
  };
}

/**
 * Vercel-style helper: wraps a handler and guarantees `req.auth` is populated.
 * Returns 401/403 automatically when validation fails.
 */
export function withAuth<T extends VercelResponse = VercelResponse>(
  handler: (req: AuthenticatedRequest, res: T) => Promise<void> | void
) {
  return async (req: VercelRequest, res: T): Promise<void> => {
    try {
      const token = extractToken(req);
      if (!token) {
        res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Missing Bearer token' } });
        return;
      }
      const auth = await validateAccessToken(token, req);
      (req as AuthenticatedRequest).auth = auth;
      await handler(req as AuthenticatedRequest, res);
    } catch (err) {
      if (err instanceof AuthError) {
        // MFA mandate (L-09) — emit a structured ACCESS_DENIED log
        // line so the dashboard query catches admin-pre-MFA traffic
        // alongside the other denial reasons. We import lazily to
        // avoid a circular module load between middleware/audit.
        if (err.code === 'MFA_REQUIRED') {
          try {
            const { emitAccessDenialLog } = await import('../audit/audit-logger.js');
            emitAccessDenialLog({
              reason: 'mfa_required',
              actorUserId: null, // user was identified but session is pre-MFA
              actorRole: null,
              actorTenantId: null,
              ipHash: hashIp(getClientIp(req)) ?? null,
              route: `${(req.method ?? 'UNKNOWN').toUpperCase()} ${(req.url ?? '').split('?')[0]}`,
            });
          } catch {
            // Best-effort log — never block on the emitter.
          }
        }
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      // Never leak internals — structured event for the operator dashboard.
      try {
        const { logStructured, tagFromError } = await import('../observability/structured-log.js');
        logStructured('error', 'AUTH_UNEXPECTED_ERROR', {
          errorTag: tagFromError(err) ?? 'unknown',
        });
      } catch { /* never block */ }
      res.status(500).json({ error: { code: 'AUTH_FAILURE', message: 'Authentication failed' } });
    }
  };
}
