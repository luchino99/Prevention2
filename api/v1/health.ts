/**
 * GET /api/v1/health
 *
 * Public, low-cardinality health endpoint intended for:
 *   - Vercel/uptime probes
 *   - Blue/green deploy gates
 *   - Frontend boot ping
 *
 * Contract:
 *   200  → { status: "ok", ... }           all critical deps up
 *   207  → { status: "degraded", ... }     non-critical subsystem down
 *   503  → { status: "unhealthy", ... }    primary persistence unreachable
 *
 * Security:
 *   - No auth required (must stay probe-friendly)
 *   - NEVER leaks env values, connection strings, secrets, commit SHAs
 *     beyond what the build already publishes as `APP_VERSION`
 *   - Cache-Control: no-store to avoid stale-green reporting
 *   - Rate-limited in-memory to resist probe abuse while staying fast
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../backend/src/config/supabase.js';
import { applySecurityHeaders } from '../../backend/src/middleware/security-headers.js';
import { checkRateLimitAsync, applyRateLimitHeaders } from '../../backend/src/middleware/rate-limit.js';
import { isUpstashConfigured } from '../../backend/src/middleware/rate-limit-upstash.js';

const APP_VERSION = process.env.APP_VERSION ?? '0.0.0-dev';
const APP_REGION = process.env.APP_REGION ?? 'unknown';

interface SubsystemCheck {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs?: number;
  detail?: string;
}

async function checkSupabase(): Promise<SubsystemCheck> {
  const t0 = Date.now();
  try {
    // Cheapest round-trip: count against the tenants table with HEAD
    const { error } = await supabaseAdmin
      .from('tenants')
      .select('id', { count: 'exact', head: true });
    const latencyMs = Date.now() - t0;
    if (error) {
      return { name: 'supabase', status: 'down', latencyMs, detail: 'query_error' };
    }
    return { name: 'supabase', status: 'ok', latencyMs };
  } catch {
    return { name: 'supabase', status: 'down', latencyMs: Date.now() - t0, detail: 'exception' };
  }
}

function checkUpstash(): SubsystemCheck {
  return {
    name: 'rate_limit_distributed',
    status: isUpstashConfigured() ? 'ok' : 'degraded',
    detail: isUpstashConfigured() ? undefined : 'falling_back_to_memory',
  };
}

/**
 * MFA enforcement policy probe (Sprint 2 task 2.3).
 *
 * The MFA matrix in auth-middleware.ts gates four roles via env flags:
 *   * platform_admin + tenant_admin → MFA_ENFORCEMENT_ENABLED
 *   * clinician                     → MFA_ENFORCEMENT_CLINICIAN_ENABLED
 *   * assistant_staff               → MFA_ENFORCEMENT_STAFF_ENABLED
 * In production all three flags MUST be set to "true". A flag that is
 * unset or set to "false" silently disables MFA for the relevant
 * role(s) — a high-impact policy regression that no compile-time check
 * can catch. This subsystem makes the live policy state visible at
 * /api/v1/health and lets the smoke-prod CI gate alarm on it.
 *
 * Note: this DOES NOT verify that any actual user has enrolled MFA —
 * it only verifies that the gate is configured to require it. Per-user
 * enrolment status is a different (per-tenant) operational concern.
 */
function checkMfaEnforcement(): SubsystemCheck {
  const isFlagOn = (name: string): boolean => {
    const v = process.env[name];
    return typeof v === 'string' && v.toLowerCase() === 'true';
  };
  const flags = {
    admin: isFlagOn('MFA_ENFORCEMENT_ENABLED'),
    clinician: isFlagOn('MFA_ENFORCEMENT_CLINICIAN_ENABLED'),
    staff: isFlagOn('MFA_ENFORCEMENT_STAFF_ENABLED'),
  };
  const allOn = flags.admin && flags.clinician && flags.staff;
  const noneOn = !flags.admin && !flags.clinician && !flags.staff;
  const status: 'ok' | 'degraded' | 'down' = allOn ? 'ok' : 'degraded';
  // Compose a one-line detail listing which flags are on (omit values
  // that would leak the literal env-var name patterns to anonymous
  // probes — keep it terse).
  const onFlags: string[] = [];
  if (flags.admin) onFlags.push('admin');
  if (flags.clinician) onFlags.push('clinician');
  if (flags.staff) onFlags.push('staff');
  const detail = noneOn
    ? 'all_flags_off_mfa_disabled'
    : allOn
      ? undefined
      : `partial:${onFlags.join('+')}`;
  return { name: 'mfa_enforcement', status, detail };
}

function overall(subs: SubsystemCheck[]): 'ok' | 'degraded' | 'unhealthy' {
  if (subs.some((s) => s.name === 'supabase' && s.status === 'down')) return 'unhealthy';
  if (subs.some((s) => s.status === 'down' || s.status === 'degraded')) return 'degraded';
  return 'ok';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applySecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).end();
    return;
  }

  // Light rate-limit so this endpoint can't be weaponised.
  const rl = await checkRateLimitAsync(req, { routeId: 'health', max: 60, windowMs: 60_000 });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    res.status(429).end();
    return;
  }

  // HEAD short-circuits — probes often only care about status code
  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  const t0 = Date.now();
  const subs: SubsystemCheck[] = [];
  subs.push(await checkSupabase());
  subs.push(checkUpstash());
  subs.push(checkMfaEnforcement());

  const status = overall(subs);
  const http = status === 'unhealthy' ? 503 : status === 'degraded' ? 207 : 200;

  res.status(http).json({
    status,
    version: APP_VERSION,
    region: APP_REGION,
    uptimeSeconds: Math.floor(process.uptime()),
    nowIso: new Date().toISOString(),
    totalCheckMs: Date.now() - t0,
    subsystems: subs,
  });
}
