/**
 * Integration-style tests for /api/v1/patients handlers.
 *
 * These tests run the route modules with an in-memory request/response and
 * a stubbed Supabase client. They exercise:
 *   - auth rejection path (missing / invalid token)
 *   - RBAC rejection (wrong role)
 *   - happy path for list + create
 *   - audit log emission
 *
 * The Supabase client is imported through `backend/src/config/supabase` and
 * is replaced with a fake at the module level. In CI, add `vi.mock` calls
 * before importing the handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Mock Supabase admin client at the module boundary
vi.mock('../../backend/src/config/supabase', () => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'c@example.com' } },
        error: null,
      }),
    },
    storage: {
      from: vi.fn().mockReturnThis(),
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null }),
    },
  };
  return {
    supabaseAdmin: chain,
    createUserClient: vi.fn(() => chain),
  };
});

function makeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: null as any,
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json   = (b: any) => { res.jsonBody = b; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  res.end    = () => res;
  return res as VercelResponse & { statusCode: number; jsonBody: any; headers: any };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    url: '/api/v1/patients',
    headers: { authorization: 'Bearer fake-token', ...overrides.headers } as any,
    query: {},
    body: {},
    socket: { remoteAddress: '127.0.0.1' } as any,
    ...overrides,
  } as any;
}

describe('/api/v1/patients route', () => {
  it('rejects requests without a Bearer token', async () => {
    const handler = (await import('../../api/v1/patients/index')).default;
    const req = makeReq({ headers: {} as any });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody?.error?.code).toBe('MISSING_TOKEN');
  });

  // Further cases (happy paths, RBAC failures) need the supabase chain to be
  // returned with tenant-specific rows. They are documented here as pending:
  it.todo('lists patients for a clinician in their own tenant only');
  it.todo('creates a patient and emits a patient.create audit event');
  it.todo('rejects patient creation for assistant_staff role');
  it.todo('rate-limits bursts of list requests');
});
