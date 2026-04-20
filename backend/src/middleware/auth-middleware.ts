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
import { supabaseAdmin } from '../config/supabase';
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

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id, role, is_suspended')
    .eq('id', userId)
    .single();

  if (userErr || !userRow) {
    throw new AuthError(401, 'USER_PROFILE_NOT_FOUND', 'User profile not found');
  }

  if (userRow.is_suspended) {
    throw new AuthError(403, 'USER_SUSPENDED', 'User account is suspended');
  }

  const role = userRow.role as UserRole;
  if (!USER_ROLES.includes(role)) {
    throw new AuthError(500, 'INVALID_ROLE', 'Invalid user configuration');
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
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      // Never leak internals
      console.error('[auth] unexpected error', err);
      res.status(500).json({ error: { code: 'AUTH_FAILURE', message: 'Authentication failed' } });
    }
  };
}
