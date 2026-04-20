/**
 * Unit tests for backend middleware behaviour (no network, no DB).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../../backend/src/middleware/rate-limit';
import { assertSameTenant } from '../../backend/src/middleware/rbac';

function mockReq(overrides: any = {}): any {
  return {
    headers: overrides.headers ?? {},
    socket: { remoteAddress: '10.0.0.1' },
    auth: overrides.auth,
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/api/v1/test',
    query: overrides.query ?? {},
    body: overrides.body,
  };
}

describe('rate-limit', () => {
  it('allows up to the configured limit, then denies', () => {
    const req = mockReq({ auth: { userId: 'u1' } });
    const cfg = { routeId: 'test.rl', max: 3, windowMs: 60000 };
    const r1 = checkRateLimit(req, cfg); expect(r1.allowed).toBe(true);
    const r2 = checkRateLimit(req, cfg); expect(r2.allowed).toBe(true);
    const r3 = checkRateLimit(req, cfg); expect(r3.allowed).toBe(true);
    const r4 = checkRateLimit(req, cfg); expect(r4.allowed).toBe(false);
  });

  it('isolates buckets per user and per route', () => {
    const userA = mockReq({ auth: { userId: 'a' } });
    const userB = mockReq({ auth: { userId: 'b' } });
    const cfg1 = { routeId: 'route.one', max: 1, windowMs: 60000 };
    const cfg2 = { routeId: 'route.two', max: 1, windowMs: 60000 };
    expect(checkRateLimit(userA, cfg1).allowed).toBe(true);
    expect(checkRateLimit(userB, cfg1).allowed).toBe(true);
    expect(checkRateLimit(userA, cfg2).allowed).toBe(true);
    expect(checkRateLimit(userA, cfg1).allowed).toBe(false);
  });
});

describe('rbac.assertSameTenant', () => {
  it('platform_admin always passes (cross-tenant by design)', () => {
    const req: any = { auth: { role: 'platform_admin', tenantId: 'tA' } };
    expect(assertSameTenant(req, { tenant_id: 'tB' })).toBe(true);
  });

  it('rejects when tenant does not match', () => {
    const req: any = { auth: { role: 'clinician', tenantId: 'tA' } };
    expect(assertSameTenant(req, { tenant_id: 'tB' })).toBe(false);
  });

  it('accepts when tenant matches', () => {
    const req: any = { auth: { role: 'clinician', tenantId: 'tA' } };
    expect(assertSameTenant(req, { tenant_id: 'tA' })).toBe(true);
  });

  it('rejects when caller has no tenant and is not platform_admin', () => {
    const req: any = { auth: { role: 'clinician', tenantId: null } };
    expect(assertSameTenant(req, { tenant_id: 'tA' })).toBe(false);
  });
});
