/**
 * cron-auth.ts
 * ---------------------------------------------------------------------------
 * Authentication helper shared by every cron-style serverless function in
 * `api/v1/internal/*`.
 *
 * Threat model addressed
 * ----------------------
 *  1. **Length side-channel** — the previous in-handler check did
 *     `if (token.length !== CRON_SECRET.length) return false` BEFORE running
 *     the constant-time compare. That early return turns the comparison into
 *     a length-disclosure oracle (millisecond timing differences, but also
 *     trivially observable via cleartext error responses if any branch
 *     differs). This helper allocates a fixed-size scratch buffer and always
 *     iterates over the full secret length, so no early-return shortcut
 *     exists.
 *
 *  2. **Unauthenticated invocation** — when Vercel Cron calls the endpoint
 *     it sends an `x-vercel-cron: 1` header *and* the `Authorization`
 *     bearer. We require BOTH on Vercel deployments. On a self-hosted /
 *     local invocation (no `VERCEL` env var) only the bearer is enforced.
 *
 *  3. **Replay** — out of scope here; Supabase RLS + idempotent prune/
 *     anonymize semantics make replay a no-op (already-pruned rows simply
 *     do nothing). A nonce/timestamp scheme would add bookkeeping without
 *     reducing risk meaningfully.
 *
 *  4. **Misconfiguration** — if `CRON_SIGNING_SECRET` is unset or shorter
 *     than 32 bytes the helper refuses ALL requests. This is a fail-closed
 *     default; the previous min-length was 16 which is too short for a
 *     long-lived static secret.
 *
 * Public API
 * ----------
 *   isCronAuthorized(req)  → boolean
 *   denyCron(res)          → writes a generic 401 (no message body)
 *
 * The helper deliberately avoids returning *why* auth failed in the response
 * so an attacker cannot distinguish "wrong header" from "wrong secret".
 * ---------------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

const MIN_SECRET_LEN = 32;

function getSecret(): string | null {
  const raw = process.env.CRON_SIGNING_SECRET;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_SECRET_LEN) return null;
  return trimmed;
}

/**
 * Constant-time-ish compare that does NOT branch on length.
 *
 * Approach:
 *   - Build two equally-sized buffers by copying the lesser-length value into
 *     a buffer the size of the longer one (zero-padded).
 *   - Use Node's `timingSafeEqual` on the equal-size buffers.
 *   - Combine with a separate boolean `lengthOk` so a length mismatch always
 *     fails, but the comparison itself runs even when lengths differ
 *     (so the wall-clock time is the same regardless).
 */
function safeEquals(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length, 1);
  const bufA = Buffer.alloc(max, 0);
  const bufB = Buffer.alloc(max, 0);
  bufA.write(a.slice(0, max), 'utf8');
  bufB.write(b.slice(0, max), 'utf8');
  const lengthOk = a.length === b.length;
  // timingSafeEqual throws if the buffer lengths differ, hence the alloc.
  const valueOk = timingSafeEqual(bufA, bufB);
  return lengthOk && valueOk;
}

function extractBearer(req: VercelRequest): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

/**
 * Returns `true` iff the request carries a valid cron bearer AND, when
 * running on Vercel, the `x-vercel-cron` marker header.
 *
 * Always returns `false` if the secret is missing or too short.
 */
export function isCronAuthorized(req: VercelRequest): boolean {
  const secret = getSecret();
  if (!secret) return false;

  // Defence in depth on Vercel: cron invocations carry x-vercel-cron.
  // We only enforce it when *running* on Vercel — locally / in tests the
  // header isn't present.
  const onVercel = process.env.VERCEL === '1';
  if (onVercel) {
    const cronHeader = req.headers['x-vercel-cron'];
    if (typeof cronHeader !== 'string' || cronHeader.length === 0) {
      return false;
    }
  }

  const token = extractBearer(req);
  if (!token) {
    // Still run a dummy compare to keep wall-clock time roughly constant.
    safeEquals(secret, '');
    return false;
  }
  return safeEquals(token, secret);
}

/**
 * Standard 401 emission — opaque body so failures cannot be fingerprinted.
 */
export function denyCron(res: VercelResponse): void {
  res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
}
