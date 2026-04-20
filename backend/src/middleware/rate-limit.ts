/**
 * Rate limiting — in-memory token bucket.
 *
 * This implementation is suitable for a single Vercel serverless instance as a
 * minimal defensive layer. For production-grade, distributed rate limiting the
 * blueprint mandates migration to Upstash Redis or a Supabase-backed bucket;
 * the public API of this module is stable across implementations.
 *
 * Key strategy:
 *   - Authenticated calls:   key = `${userId}:${routeId}`
 *   - Unauthenticated calls: key = `${ipHash}:${routeId}`
 * Never the raw IP — privacy by design.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import type { AuthenticatedRequest } from './auth-middleware';

export interface RateLimitConfig {
  /** Route identifier, e.g. 'assessments.create' */
  routeId: string;
  /** Max requests allowed in the window */
  max: number;
  /** Window length in milliseconds */
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Reap expired buckets periodically to avoid unbounded memory growth. */
const REAP_INTERVAL_MS = 60_000;
let lastReapAt = 0;
function maybeReap(now: number): void {
  if (now - lastReapAt < REAP_INTERVAL_MS) return;
  lastReapAt = now;
  for (const [k, b] of buckets.entries()) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

function hashIpFromReq(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const ip =
    (typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : undefined) ||
    (req.headers['x-real-ip'] as string | undefined) ||
    (req.socket as any)?.remoteAddress ||
    'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function keyFor(req: VercelRequest, routeId: string): string {
  const auth = (req as AuthenticatedRequest).auth;
  if (auth?.userId) return `u:${auth.userId}:${routeId}`;
  return `i:${hashIpFromReq(req)}:${routeId}`;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function checkRateLimit(
  req: VercelRequest,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  maybeReap(now);
  const key = keyFor(req, config.routeId);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= config.max;
  return {
    allowed,
    remaining: Math.max(0, config.max - bucket.count),
    resetAt: bucket.resetAt,
    limit: config.max,
  };
}

export function applyRateLimitHeaders(res: VercelResponse, r: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', String(r.limit));
  res.setHeader('X-RateLimit-Remaining', String(r.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(r.resetAt / 1000)));
}

/** HOF: reject with 429 if over the limit. */
export function withRateLimit<Req extends VercelRequest, Res extends VercelResponse>(
  config: RateLimitConfig,
  handler: (req: Req, res: Res) => Promise<void> | void
) {
  return async (req: Req, res: Res): Promise<void> => {
    const result = checkRateLimit(req, config);
    applyRateLimitHeaders(res, result);
    if (!result.allowed) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
      });
      return;
    }
    await handler(req, res);
  };
}

/** Preset configurations aligned with blueprint sensitivity levels. */
export const RATE_LIMITS = {
  auth:          { max: 10,  windowMs: 60_000  }, // login / session
  read:          { max: 120, windowMs: 60_000  },
  write:         { max: 30,  windowMs: 60_000  },
  reportExport:  { max: 10,  windowMs: 60_000  },
  admin:         { max: 60,  windowMs: 60_000  },
} as const;

// ============================================================================
// Distributed (Upstash Redis) path
// ============================================================================
//
// The `checkRateLimit` above is per-instance (serverless). In production the
// Upstash-backed async path should be preferred. This section exposes:
//
//   checkRateLimitAsync(req, config)  → tries Upstash, falls back to memory
//   withRateLimitAsync(config, h)     → async middleware HOF
//
// The sync API remains for backward compat and as the fallback implementation.
// ============================================================================

import { checkRateLimitUpstash, isUpstashConfigured } from './rate-limit-upstash';

function subjectFor(req: VercelRequest): string {
  const auth = (req as AuthenticatedRequest).auth;
  if (auth?.userId) return `u:${auth.userId}`;
  return `i:${hashIpFromReq(req)}`;
}

export async function checkRateLimitAsync(
  req: VercelRequest,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  if (isUpstashConfigured()) {
    const subject = subjectFor(req);
    const distributed = await checkRateLimitUpstash(subject, config);
    if (distributed) return distributed;
    // Upstash misconfigured or transiently down → fallback below
  }
  return checkRateLimit(req, config);
}

/** HOF: async variant, uses distributed bucket when available. */
export function withRateLimitAsync<Req extends VercelRequest, Res extends VercelResponse>(
  config: RateLimitConfig,
  handler: (req: Req, res: Res) => Promise<void> | void,
) {
  return async (req: Req, res: Res): Promise<void> => {
    const result = await checkRateLimitAsync(req, config);
    applyRateLimitHeaders(res, result);
    if (!result.allowed) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
      });
      return;
    }
    await handler(req, res);
  };
}
