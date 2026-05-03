/**
 * Distributed rate-limit adapter — Upstash Redis REST API.
 *
 * Why
 * ---
 * Vercel serverless invocations run on ephemeral instances. The
 * in-memory token-bucket in `rate-limit.ts` is per-instance and cannot
 * enforce a global limit; a cold-start fan-out multiplies the
 * effective limit by N. Upstash provides a same-region atomic Redis
 * pipeline (INCR + PEXPIRE NX + PTTL) reachable over HTTPS.
 *
 * Hardening (post-incident)
 * -------------------------
 * Production logs surfaced `Failed to parse URL from "https://"`
 * because `process.env.UPSTASH_REDIS_REST_URL` came back as `"https://"`
 * (a blank value, or a value wrapped in stray quotes — a common
 * Vercel-paste mistake). Three changes:
 *
 *   1. Strict URL validation via `new URL(...)` plus a `protocol`
 *      / `hostname` sanity check. A malformed value disables Upstash
 *      cleanly instead of throwing on every request.
 *   2. Sanitisation: trim whitespace, strip wrapping single/double
 *      quotes the way Vercel sometimes preserves them.
 *   3. One structured `RATE_LIMIT_BACKEND_FAILURE` event per
 *      misconfiguration (deduped per process) and one per transient
 *      runtime failure (capped at one per 60 s to avoid log spam).
 *
 * Fallback
 * --------
 * Any failure (config, network, non-2xx, JSON parse) returns `null`
 * to the caller. The async wrapper in `rate-limit.ts` then falls
 * back to the in-memory limiter — endpoints stay rate-limited (just
 * per-instance) instead of unbounded.
 *
 * Security
 * --------
 *   - Tokens are read from env only (never from the client).
 *   - Keys are deterministic `ratelimit:${routeId}:${subject}` —
 *     bounded length, no PHI (subject is a hashed IP or a UUID).
 *   - The Authorization header is set on every request — never logged.
 */

import type { RateLimitConfig, RateLimitResult } from './rate-limit.js';
import { logStructured } from '../observability/structured-log.js';

/* ────────────────────── env-var resolution + validation ───────────────── */

/**
 * Strip whitespace + accidental wrapping single/double quotes.
 * Returns null if nothing useful remains.
 */
function cleanEnv(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  // Vercel sometimes preserves quotes pasted by users; strip a single
  // matched leading/trailing pair only (don't unwrap recursively).
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.length > 0 ? s : null;
}

/**
 * Module-level memoisation. The env vars are immutable for the
 * lifetime of a serverless instance, so we resolve + validate once
 * and remember whether the misconfig event has already been logged.
 */
let cachedBaseUrl: string | null | undefined;        // undefined = unresolved
let cachedToken: string | null = null;
let configWarningEmitted = false;

/**
 * Returns the validated Upstash REST base URL (no trailing slash) or
 * null if the env var is missing / malformed. The first time we hit
 * a malformed value we emit one RATE_LIMIT_BACKEND_FAILURE event so
 * an alert fires; subsequent requests stay silent until the process
 * restarts (with potentially fixed env).
 */
function resolveBaseUrl(): string | null {
  if (cachedBaseUrl !== undefined) return cachedBaseUrl;

  const rawUrl = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const rawToken = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  cachedToken = rawToken;

  if (!rawUrl) {
    cachedBaseUrl = null;
    return null;
  }
  if (!rawToken) {
    if (!configWarningEmitted) {
      configWarningEmitted = true;
      logStructured('error', 'RATE_LIMIT_BACKEND_FAILURE', {
        provider: 'upstash',
        reason: 'missing_token_with_url_set',
      });
    }
    cachedBaseUrl = null;
    return null;
  }

  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error(`unsupported protocol ${u.protocol}`);
    }
    if (!u.hostname) {
      throw new Error('empty hostname');
    }
    // Reconstruct as origin + (optional) path with no trailing slash so
    // the call site can append `/pipeline` cleanly.
    const path = u.pathname.replace(/\/$/, '');
    cachedBaseUrl = `${u.origin}${path}`;
    return cachedBaseUrl;
  } catch (err) {
    if (!configWarningEmitted) {
      configWarningEmitted = true;
      logStructured('error', 'RATE_LIMIT_BACKEND_FAILURE', {
        provider: 'upstash',
        reason: 'invalid_url_config',
        urlLen: rawUrl.length,
        // We deliberately do NOT log the value itself — a misconfigured
        // URL might still be sensitive (e.g. credentials in path).
        errorTag: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
      });
    }
    cachedBaseUrl = null;
    return null;
  }
}

export function isUpstashConfigured(): boolean {
  return resolveBaseUrl() !== null;
}

/* ────────────────────── runtime-failure dedup ─────────────────────────── */

/**
 * Ratelimit the noisy `RATE_LIMIT_BACKEND_FAILURE` event itself: at
 * most one log line per 60 s per process per failure shape. Without
 * this, a Redis outage would fill Datadog with thousands of identical
 * events and inflate the bill.
 */
const SPAM_WINDOW_MS = 60_000;
const lastEmittedAt = new Map<string, number>();
function emitRuntimeFailure(reason: string, errorTag: string | undefined): void {
  const now = Date.now();
  const last = lastEmittedAt.get(reason) ?? 0;
  if (now - last < SPAM_WINDOW_MS) return;
  lastEmittedAt.set(reason, now);
  logStructured('error', 'RATE_LIMIT_BACKEND_FAILURE', {
    provider: 'upstash',
    reason,
    ...(errorTag ? { errorTag } : {}),
  });
}

/* ────────────────────────────── pipeline call ─────────────────────────── */

interface UpstashResult<T> {
  result?: T;
  error?: string;
}

async function upstashPipeline<T extends unknown[]>(
  commands: (string | number)[][],
): Promise<UpstashResult<T> | null> {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl || !cachedToken) return null;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cachedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      // Bounded — we will not hold the serverless invocation hostage.
      signal: AbortSignal.timeout(750),
    });
  } catch (err) {
    emitRuntimeFailure(
      err instanceof DOMException && err.name === 'TimeoutError' ? 'request_timeout' : 'request_threw',
      err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
    );
    return null;
  }

  if (!res.ok) {
    emitRuntimeFailure('non_2xx_response', `status=${res.status}`);
    return null;
  }

  let body: UpstashResult<T>[];
  try {
    body = (await res.json()) as UpstashResult<T>[];
  } catch (err) {
    emitRuntimeFailure(
      'invalid_json_response',
      err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
    );
    return null;
  }

  // Upstash pipeline returns an array aligned with commands.
  const results = body.map((r) => r.result);
  return { result: results as unknown as T };
}

/* ────────────────────────────── public API ────────────────────────────── */

/**
 * Check and atomically increment the distributed bucket.
 *
 * Returns `null` if Upstash is unavailable — caller must fall back
 * to the in-memory limiter.
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
      // PEXPIRE NX: only the first caller in the window gets the TTL,
      // so the bucket reset time is stable across concurrent INCRs.
      ['PEXPIRE', key, config.windowMs, 'NX'],
      // PTTL — accurate reset time for the response header.
      ['PTTL', key],
    ],
  );
  if (!response?.result) return null;
  const [count, , pttl] = response.result as unknown as [number, unknown, number];
  const now = Date.now();
  // PTTL returns -1 if no TTL, -2 if missing. Defensive clamp.
  const ttlMs = typeof pttl === 'number' && pttl > 0 ? pttl : config.windowMs;
  const allowed = count <= config.max;
  return {
    allowed,
    remaining: Math.max(0, config.max - count),
    resetAt: now + ttlMs,
    limit: config.max,
  };
}
