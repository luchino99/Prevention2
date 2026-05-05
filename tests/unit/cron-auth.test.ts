/**
 * Cron-auth unit tests.
 *
 * Covers B-04 (cron hardening) — see `30-RISK-REGISTER.md`. The helper is
 * pure-function-ish (depends only on env + request headers + `node:crypto`),
 * so no Supabase mock is required. The tests assert the security-sensitive
 * branches of `isCronAuthorized` and the opaque body of `denyCron`.
 *
 * What we explicitly test:
 *   - Missing CRON_SIGNING_SECRET → fail-closed
 *   - Too-short secret (< 32 bytes) → fail-closed
 *   - Wrong bearer token → reject
 *   - Wrong-length bearer token → reject (no length-disclosure oracle)
 *   - Correct bearer token → accept
 *   - On Vercel without `x-vercel-cron` header → reject
 *   - On Vercel with `x-vercel-cron` + correct token → accept
 *   - `denyCron` writes 401 with opaque body
 *
 * What we do NOT test here:
 *   - Wall-clock timing of `safeEquals` (would be flaky under CI noise; the
 *     code-level review verifies the constant-time property).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { isCronAuthorized, denyCron } from '../../backend/src/middleware/cron-auth.js';

const VALID_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef'; // 48 bytes ≥ 32

function makeReq(overrides: Partial<{
  authorization?: string;
  vercelCron?: string;
}> = {}): VercelRequest {
  const headers: Record<string, string> = {};
  if (overrides.authorization !== undefined) {
    headers['authorization'] = overrides.authorization;
  }
  if (overrides.vercelCron !== undefined) {
    headers['x-vercel-cron'] = overrides.vercelCron;
  }
  return {
    method: 'POST',
    url: '/api/v1/internal/retention',
    headers: headers as VercelRequest['headers'],
    query: {},
    body: {},
  } as unknown as VercelRequest;
}

function makeRes() {
  const res: {
    statusCode: number;
    jsonBody: unknown;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
  } = {
    statusCode: 200,
    jsonBody: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.jsonBody = b; return this; },
  };
  return res;
}

describe('isCronAuthorized — secret hygiene', () => {
  beforeEach(() => {
    delete process.env.CRON_SIGNING_SECRET;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    delete process.env.CRON_SIGNING_SECRET;
    delete process.env.VERCEL;
  });

  it('fails closed when CRON_SIGNING_SECRET is unset', () => {
    const req = makeReq({ authorization: `Bearer ${VALID_SECRET}` });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('fails closed when CRON_SIGNING_SECRET is too short (< 32 bytes)', () => {
    process.env.CRON_SIGNING_SECRET = 'shortsecret-only-12-bytes';
    const req = makeReq({ authorization: `Bearer ${process.env.CRON_SIGNING_SECRET}` });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('accepts a 32-byte secret with a valid bearer', () => {
    process.env.CRON_SIGNING_SECRET = '0'.repeat(32);
    const req = makeReq({ authorization: `Bearer ${process.env.CRON_SIGNING_SECRET}` });
    expect(isCronAuthorized(req)).toBe(true);
  });
});

describe('isCronAuthorized — bearer token comparison', () => {
  beforeEach(() => {
    process.env.CRON_SIGNING_SECRET = VALID_SECRET;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    delete process.env.CRON_SIGNING_SECRET;
    delete process.env.VERCEL;
  });

  it('rejects when Authorization header is missing', () => {
    const req = makeReq({});
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('rejects when Authorization header lacks the Bearer prefix', () => {
    const req = makeReq({ authorization: VALID_SECRET });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('rejects when bearer token is empty', () => {
    const req = makeReq({ authorization: 'Bearer ' });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('rejects a wrong-but-same-length token', () => {
    const wrong = 'f'.repeat(VALID_SECRET.length);
    const req = makeReq({ authorization: `Bearer ${wrong}` });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('rejects a wrong-and-shorter token (no length-disclosure oracle)', () => {
    const wrong = '0'.repeat(VALID_SECRET.length - 8);
    const req = makeReq({ authorization: `Bearer ${wrong}` });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('rejects a wrong-and-longer token', () => {
    const wrong = VALID_SECRET + 'extra-padding-bytes';
    const req = makeReq({ authorization: `Bearer ${wrong}` });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('accepts the correct token', () => {
    const req = makeReq({ authorization: `Bearer ${VALID_SECRET}` });
    expect(isCronAuthorized(req)).toBe(true);
  });
});

describe('isCronAuthorized — Vercel-only x-vercel-cron header gate', () => {
  beforeEach(() => {
    process.env.CRON_SIGNING_SECRET = VALID_SECRET;
    process.env.VERCEL = '1';
  });

  afterEach(() => {
    delete process.env.CRON_SIGNING_SECRET;
    delete process.env.VERCEL;
  });

  it('rejects on Vercel when x-vercel-cron header is missing', () => {
    const req = makeReq({ authorization: `Bearer ${VALID_SECRET}` });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('rejects on Vercel when x-vercel-cron header is empty', () => {
    const req = makeReq({
      authorization: `Bearer ${VALID_SECRET}`,
      vercelCron: '',
    });
    expect(isCronAuthorized(req)).toBe(false);
  });

  it('accepts on Vercel when x-vercel-cron + correct bearer are present', () => {
    const req = makeReq({
      authorization: `Bearer ${VALID_SECRET}`,
      vercelCron: '1',
    });
    expect(isCronAuthorized(req)).toBe(true);
  });

  it('rejects on Vercel when x-vercel-cron is present but bearer is wrong', () => {
    const req = makeReq({
      authorization: 'Bearer wrong',
      vercelCron: '1',
    });
    expect(isCronAuthorized(req)).toBe(false);
  });
});

describe('denyCron', () => {
  it('writes a 401 with an opaque UNAUTHORIZED code (no failure-cause leakage)', () => {
    const res = makeRes();
    denyCron(res as unknown as VercelResponse);
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toEqual({ error: { code: 'UNAUTHORIZED' } });
  });
});
