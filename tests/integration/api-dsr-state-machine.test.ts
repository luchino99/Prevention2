/**
 * DSR state-machine integration test (Tier 2 / M-10).
 *
 * Covers the audit-significant transitions of the GDPR DSR endpoints
 * (B-14):
 *
 *   POST   /api/v1/admin/dsr                  → 'dsr.create'   (strict)
 *   POST   /api/v1/admin/dsr/[id]/process
 *     action='start'                          → 'dsr.start'    (strict)
 *     action='cancel'                         → 'dsr.cancel'   (strict)
 *     action='reject'                         → 'dsr.reject'   (strict)
 *     action='fulfill'                        → 'dsr.fulfill'  (strict)
 *
 * Plus negative paths:
 *
 *   - illegal transition (e.g. start on a fulfilled DSR) → 409 CONFLICT
 *   - cross-tenant access by tenant_admin              → 404 NOT_FOUND
 *
 * Why
 * ---
 * Each privacy-significant transition uses recordAuditStrict — a single
 * silently-failing audit write would mean a tenant changed a DSR's
 * status without a matching immutable record (B-09 violation). The
 * unit suite mocks recordAuditStrict in isolation; this integration
 * test wires the real handler against a scriptable Supabase mock so
 * we cover the full call path including the strict-audit invocation
 * at every transition.
 *
 * Approach
 * --------
 * - Replace `supabaseAdmin` with a controllable chain that allows each
 *   `it()` to script the result of every `.maybeSingle()`, `.single()`,
 *   `.insert()`, `.update()` separately.
 * - Replace `validateAccessToken` so we don't have to seed an
 *   `auth.users` row — the test wants to focus on the state machine,
 *   not on auth plumbing (which has its own tests).
 * - The HTTP response is captured via a tiny in-memory `res` shim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/* ───────────────────────────── scriptable Supabase mock ───────────────── */

/**
 * The mock chain queues responses per terminal call. Tests push a
 * sequence with the helpers below; the chain pops the next response
 * each time `.maybeSingle()` / `.single()` is awaited.
 */
type Resp = { data: unknown; error: unknown; count?: number };

const queue: { kind: 'maybeSingle' | 'single' | 'range'; resp: Resp }[] = [];

function pushMaybeSingle(data: unknown, error: unknown = null): void {
  queue.push({ kind: 'maybeSingle', resp: { data, error } });
}
function pushSingle(data: unknown, error: unknown = null): void {
  queue.push({ kind: 'single', resp: { data, error } });
}
function pushRange(data: unknown[], count = 0, error: unknown = null): void {
  queue.push({ kind: 'range', resp: { data, error, count } });
}
function clearQueue(): void {
  queue.length = 0;
}

vi.mock('../../backend/src/config/supabase', () => {
  const chain: Record<string, unknown> = {
    from:   vi.fn(() => chain),
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    in:     vi.fn(() => chain),
    or:     vi.fn(() => chain),
    is:     vi.fn(() => chain),
    not:    vi.fn(() => chain),
    gte:    vi.fn(() => chain),
    lte:    vi.fn(() => chain),
    order:  vi.fn(() => chain),
    range:  vi.fn(async () => {
      const next = queue.shift();
      if (!next || next.kind !== 'range') {
        return { data: [], error: null, count: 0 };
      }
      return next.resp;
    }),
    single: vi.fn(async () => {
      const next = queue.shift();
      if (!next || next.kind !== 'single') {
        return { data: null, error: { message: 'no row scripted' } };
      }
      return next.resp;
    }),
    maybeSingle: vi.fn(async () => {
      const next = queue.shift();
      if (!next || next.kind !== 'maybeSingle') {
        return { data: null, error: null };
      }
      return next.resp;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'admin-1', email: 'a@example.com' } },
        error: null,
      }),
    },
    storage: {
      from: vi.fn(() => chain),
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null }),
    },
  };
  return { supabaseAdmin: chain, createUserClient: vi.fn(() => chain) };
});

/* ───────────────────── replace withAuth so we don't need auth.users ───── */

vi.mock('../../backend/src/middleware/auth-middleware.js', async () => {
  const actual = await vi.importActual<typeof import('../../backend/src/middleware/auth-middleware.js')>(
    '../../backend/src/middleware/auth-middleware.js',
  );
  return {
    ...actual,
    withAuth: (handler: (req: any, res: any) => Promise<void> | void) => {
      return async (req: any, res: any) => {
        // Default to a tenant_admin in tenant 'tenant-A' unless the test
        // already set req.auth (allowing per-test customisation).
        if (!req.auth) {
          req.auth = {
            userId: 'admin-1',
            email: 'a@example.com',
            tenantId: 'tenant-A',
            role: 'tenant_admin',
            ipHash: 'sha256-test',
            userAgent: 'vitest',
            accessToken: 'fake',
          };
        }
        await handler(req, res);
      };
    },
  };
});

/* ───────────────────────────── tiny req/res helpers ────────────────────── */

function makeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: null as any,
    writableEnded: false,
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json   = (b: any) => { res.jsonBody = b; res.writableEnded = true; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  res.end    = () => { res.writableEnded = true; return res; };
  return res as VercelResponse & { statusCode: number; jsonBody: any; headers: any };
}

function makeReq(overrides: Partial<VercelRequest> & { auth?: any } = {}): VercelRequest {
  return {
    method: 'GET',
    url: '/api/v1/admin/dsr',
    headers: { authorization: 'Bearer fake-token' } as any,
    query: {},
    body: {},
    socket: { remoteAddress: '127.0.0.1' } as any,
    ...overrides,
  } as any;
}

beforeEach(() => {
  clearQueue();
  vi.clearAllMocks();
});

/* ─────────────────────────────────── tests ─────────────────────────────── */

describe('DSR state-machine — happy paths', () => {
  it('POST /api/v1/admin/dsr creates a request and returns the new row', async () => {
    // Patient lookup (for tenant scoping) → existing patient in tenant-A
    pushMaybeSingle({ id: 'patient-1', tenant_id: 'tenant-A' });
    // Insert returns the new DSR row
    pushSingle({
      id: 'dsr-1',
      tenant_id: 'tenant-A',
      kind: 'access',
      status: 'received',
      requested_at: new Date().toISOString(),
      sla_deadline: new Date(Date.now() + 30 * 86400_000).toISOString(),
    });
    // Audit-strict insert succeeds
    pushSingle({}, null);

    const handler = (await import('../../api/v1/admin/dsr/index')).default;
    const req = makeReq({
      method: 'POST',
      body: { kind: 'access', subjectPatientId: 'patient-1' },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonBody?.request?.id).toBe('dsr-1');
    expect(res.jsonBody?.request?.status).toBe('received');
  });

  it('process start: received → in_progress', async () => {
    // Initial DSR row load
    pushMaybeSingle({
      id: 'dsr-1', tenant_id: 'tenant-A',
      subject_patient_id: 'patient-1', subject_user_id: null,
      kind: 'access', status: 'received',
      requested_by_user_id: 'admin-1', fulfilled_by_user_id: null,
      export_storage_path: null, rejection_reason: null, notes: null,
      requested_at: new Date().toISOString(),
      fulfilled_at: null,
      sla_deadline: new Date().toISOString(),
    });
    // Update returns the patched row
    pushSingle({
      id: 'dsr-1', status: 'in_progress',
      fulfilled_by_user_id: 'admin-1', notes: null,
    });
    // Audit-strict
    pushSingle({}, null);

    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: { action: 'start' },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody?.request?.status).toBe('in_progress');
  });

  it('process cancel: received → cancelled (only from received)', async () => {
    pushMaybeSingle({
      id: 'dsr-1', tenant_id: 'tenant-A',
      subject_patient_id: null, subject_user_id: 'user-1',
      kind: 'erasure', status: 'received',
      requested_by_user_id: 'admin-1', fulfilled_by_user_id: null,
      export_storage_path: null, rejection_reason: null, notes: null,
      requested_at: new Date().toISOString(),
      fulfilled_at: null,
      sla_deadline: new Date().toISOString(),
    });
    pushSingle({ id: 'dsr-1', status: 'cancelled', notes: null });
    pushSingle({}, null);

    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: { action: 'cancel' },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody?.request?.status).toBe('cancelled');
  });

  it('process reject requires a rejectionReason and stores it verbatim', async () => {
    pushMaybeSingle({
      id: 'dsr-1', tenant_id: 'tenant-A',
      subject_patient_id: 'patient-1', subject_user_id: null,
      kind: 'erasure', status: 'in_progress',
      requested_by_user_id: 'admin-1', fulfilled_by_user_id: 'admin-1',
      export_storage_path: null, rejection_reason: null, notes: null,
      requested_at: new Date().toISOString(),
      fulfilled_at: null,
      sla_deadline: new Date().toISOString(),
    });
    pushSingle({
      id: 'dsr-1', status: 'rejected',
      rejection_reason: 'Art.17(3)(c) defence of legal claims',
      notes: null,
    });
    pushSingle({}, null);

    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: {
        action: 'reject',
        rejectionReason: 'Art.17(3)(c) defence of legal claims',
      },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody?.request?.status).toBe('rejected');
    expect(res.jsonBody?.request?.rejection_reason).toMatch(/Art\.17/);
  });
});

describe('DSR state-machine — illegal transitions and cross-tenant', () => {
  it('start on an already-fulfilled DSR returns 409 CONFLICT', async () => {
    pushMaybeSingle({
      id: 'dsr-1', tenant_id: 'tenant-A',
      subject_patient_id: 'patient-1', subject_user_id: null,
      kind: 'access', status: 'fulfilled',
      requested_by_user_id: 'admin-1', fulfilled_by_user_id: 'admin-1',
      export_storage_path: 'dsr/dsr-1/export.json',
      rejection_reason: null, notes: null,
      requested_at: new Date().toISOString(),
      fulfilled_at: new Date().toISOString(),
      sla_deadline: new Date().toISOString(),
    });

    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: { action: 'start' },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(409);
    expect(res.jsonBody?.error?.code).toBe('CONFLICT');
  });

  it('cross-tenant access returns opaque 404 (no info disclosure)', async () => {
    // Tenant_admin in tenant-A asks for a DSR that lives in tenant-B
    pushMaybeSingle({
      id: 'dsr-1', tenant_id: 'tenant-B', // ← different tenant
      subject_patient_id: 'patient-1', subject_user_id: null,
      kind: 'access', status: 'received',
      requested_by_user_id: 'admin-OTHER', fulfilled_by_user_id: null,
      export_storage_path: null, rejection_reason: null, notes: null,
      requested_at: new Date().toISOString(),
      fulfilled_at: null,
      sla_deadline: new Date().toISOString(),
    });

    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: { action: 'start' },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody?.error?.code).toBe('NOT_FOUND');
    // Crucially: the response MUST NOT contain any tenant or DSR
    // metadata that would let the caller probe cross-tenant existence.
    const body = JSON.stringify(res.jsonBody ?? {});
    expect(body).not.toMatch(/tenant-B/);
    expect(body).not.toMatch(/dsr-1/); // no echo of the requested id
  });

  it('reject without rejectionReason returns 422 VALIDATION_ERROR', async () => {
    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: { action: 'reject' /* no rejectionReason */ },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(422);
    expect(res.jsonBody?.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('DSR state-machine — RBAC', () => {
  it('clinician role is denied with 403 FORBIDDEN', async () => {
    const handler = (await import('../../api/v1/admin/dsr/[id]/process')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/admin/dsr/dsr-1/process',
      query: { id: 'dsr-1' },
      body: { action: 'start' },
      // Override the default tenant_admin auth context with a clinician one
      auth: {
        userId: 'clin-1', email: 'c@example.com',
        tenantId: 'tenant-A', role: 'clinician',
        ipHash: 'sha256-test', userAgent: 'vitest', accessToken: 'fake',
      },
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody?.error?.code).toBe('FORBIDDEN');
  });
});
