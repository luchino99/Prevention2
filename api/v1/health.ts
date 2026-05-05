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
