/**
 * Distributed rate-limit adapter — Upstash Redis REST API.
 *
 * Why:
 *   Vercel serverless invocations run on ephemeral instances. The in-memory
 *   token-bucket in `rate-limit.ts` is per-instance and therefore cannot
 *   enforce a global limit. A single burst can spin up many instances and
 *   multiply the effective limit by N. For a clinical B2B platform this is
 *   an abuse and DoS risk.
 *
 * How:
 *   - Atomic INCR on the bucket key
 *   - If INCR == 1 → set PEXPIRE (window)  [race-safe: only the first caller
 *     that creates the key triggers the expiry]
 *   - Allowed = count ≤ max
 *
 * Upstash REST API executes command pipelines over HTTPS, which is the only
 * network egress available from edge/serverless workers. We use `fetch`
 * (Node 18+) and a small signed pipeline envelope.
 *
 * Fallback:
 *   If UPSTASH_REDIS_REST_URL is missing or a request fails, we degrade
 *   gracefully and return `null` — the caller MUST then apply the
 *   in-memory limiter. This means a misconfigured prod env still rate-limits
 *   per-instance instead of leaving endpoints unbounded.
 *
 * Security:
 *   - Tokens are read from env only (never from the client)
 *   - Keys are deterministic `ratelimit:${routeId}:${subject}` — bounded length
 *   - No user PII is written to Redis; the subject is already hashed/userId
 */

import type { RateLimitConfig, RateLimitResult } from './rate-limit';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export function isUpstashConfigured(): boolean {
  return typeof REDIS_URL === 'string' && REDIS_URL.length > 0 && !!REDIS_TOKEN;
}

interface UpstashResult<T> {
  result?: T;
  error?: string;
}

async function upstashPipeline<T extends unknown[]>(
  commands: (string | number)[][],
): Promise<UpstashResult<T> | null> {
  if (!isUpstashConfigured()) return null;
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      // Small timeout to avoid holding the serverless invocation hostage.
      signal: AbortSignal.timeout(750),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('[rate-limit-upstash] pipeline non-2xx', res.status);
      return null;
    }
    const body = (await res.json()) as UpstashResult<T>[];
    // Upstash pipeline returns an array aligned with commands
    const results = body.map((r) => r.result);
    return { result: results as unknown as T };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[rate-limit-upstash] pipeline threw', (err as Error).message);
    return null;
  }
}

/**
 * Check and atomically increment the distributed bucket.
 *
 * Returns `null` if Upstash is unavailable — caller must fall back.
 */
export async function checkRateLimitUpstash(
  subject: string,
  config: RateLimitConfig,
): Promise<RateLimitResult | null> {
  if (!isUpstashConfigured()) return null;
  const key = `ratelimit:${config.routeId}:${subject}`;
  const response = await upstashPipeline<[number, number | 'OK' | null, number]>(
    [
      ['INCR', key],
      // PEXPIRE with NX only sets TTL when currently missing → idempotent
      // across the window; first caller wins the TTL.
      ['PEXPIRE', key, config.windowMs, 'NX'],
      // PTTL to report accurate reset time back to the client.
      ['PTTL', key],
    ],
  );
  if (!response?.result) return null;
  const [count, , pttl] = response.result as unknown as [number, unknown, number];
  const now = Date.now();
  // PTTL returns -1 if no TTL, -2 if missing. Both should not happen here,
  // but we defensively clamp to the window.
  const ttlMs = typeof pttl === 'number' && pttl > 0 ? pttl : config.windowMs;
  const allowed = count <= config.max;
  return {
    allowed,
    remaining: Math.max(0, config.max - count),
    resetAt: now + ttlMs,
    limit: config.max,
  };
}
