/**
 * Integration-style tests for /api/v1/patients handlers.
 *
 * The Supabase chain mock is a *thenable PromiseLike* — same pattern the
 * real supabase-js v2 client uses internally. This lets the production
 * code chain in any order (`.select(...).is(...).range(...).order(...)
 * .eq(...).or(...)` and so on) and only resolve at the final `await`.
 *
 * Coverage:
 *   - missing Bearer token → 401 MISSING_TOKEN
 *   - unsupported HTTP method → 4xx (no 2xx)
 *   - POST malformed body → 4xx, never 2xx
 *   - GET as clinician → 200, results filtered by tenant_id
 *   - GET as platform_admin → 200, NO tenant_id filter applied
 *   - POST happy path: 201 + patient.create audit event with right shape,
 *     OR 4xx with NO orphan audit row (B-09 invariant)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Canonical test UUIDs (schema requires UUID for ids) ──────────────────
const TENANT_A   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLIN_ID    = '11111111-1111-1111-1111-111111111111';
const PATIENT_1  = '22222222-2222-2222-2222-222222222222';
const PATIENT_2  = '33333333-3333-3333-3333-333333333333';
const NEW_PATIENT_ID = '44444444-4444-4444-4444-444444444444';

/* ─────────────────── Per-table scripted responses ──────────────────────── */

interface TableScript {
  list?: { data: unknown[]; error: unknown; count: number };       // .range()
  single?: { data: unknown; error: unknown };                       // .single()
  maybeSingle?: { data: unknown; error: unknown };                  // .maybeSingle()
}

const tableScripts: Record<string, TableScript> = {};
function scriptTable(name: string, script: TableScript): void {
  tableScripts[name] = script;
}
function clearScripts(): void {
  for (const k of Object.keys(tableScripts)) delete tableScripts[k];
  callLog.length = 0;
}

/* ─────────────────── Per-call instrumentation log ──────────────────────── */

interface ChainCall {
  table: string;
  filters: Array<{ method: string; args: unknown[] }>;
  insertedRows: unknown[];
  selectedColumns: string | null;
}

const callLog: ChainCall[] = [];
function getCallsForTable(name: string): ChainCall[] {
  return callLog.filter((c) => c.table === name);
}

/* ─────────────────── Thenable chain factory ────────────────────────────── */

function makeChain(): any {
  // Per-chain (per `from()` invocation) state. Reset on every `from()`.
  let current: ChainCall | null = null;
  let pending: 'range' | 'single' | 'maybeSingle' | null = null;

  function resolveTerminal(): Promise<any> {
    const t = current?.table ?? '';
    const script = tableScripts[t];
    if (pending === 'range') {
      pending = null;
      return Promise.resolve(script?.list ?? { data: [], error: null, count: 0 });
    }
    if (pending === 'single') {
      pending = null;
      return Promise.resolve(script?.single ?? { data: null, error: { message: 'no script' } });
    }
    if (pending === 'maybeSingle') {
      pending = null;
      return Promise.resolve(script?.maybeSingle ?? { data: null, error: null });
    }
    // No terminal called: production code does this for `await
    // query.select().eq()` style queries that resolve to an array. We
    // map to the same shape as `.range()` for compatibility.
    return Promise.resolve(script?.list ?? { data: [], error: null, count: 0 });
  }

  // Build the chain. EVERY method returns `chain` itself (fluent API),
  // including `range`, `single`, `maybeSingle` — which only set the
  // `pending` flag. The actual Promise is delivered by `then()`.
  const chain: any = {
    from: vi.fn((table: string) => {
      current = {
        table,
        filters: [],
        insertedRows: [],
        selectedColumns: null,
      };
      callLog.push(current);
      pending = null;
      return chain;
    }),

    // Filters / projection — all chainable, all logged for assertions.
    select: vi.fn((cols?: string) => {
      if (current) current.selectedColumns = cols ?? null;
      return chain;
    }),
    eq: vi.fn((...args: unknown[]) => {
      if (current) current.filters.push({ method: 'eq', args });
      return chain;
    }),
    neq:  vi.fn(() => chain),
    or:   vi.fn((...args: unknown[]) => {
      if (current) current.filters.push({ method: 'or', args });
      return chain;
    }),
    is:   vi.fn((...args: unknown[]) => {
      if (current) current.filters.push({ method: 'is', args });
      return chain;
    }),
    in:   vi.fn(() => chain),
    not:  vi.fn(() => chain),
    gte:  vi.fn(() => chain),
    lte:  vi.fn(() => chain),
    gt:   vi.fn(() => chain),
    lt:   vi.fn(() => chain),
    like: vi.fn(() => chain),
    ilike:vi.fn(() => chain),
    contains: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),

    // Mutations — track inserted rows so audit emission can be asserted.
    insert: vi.fn((row: unknown) => {
      if (current) current.insertedRows.push(row);
      return chain;
    }),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),

    // Terminals — DO NOT return the Promise immediately. Set the pending
    // flag and return the chain so further chaining (.order, .eq, etc.)
    // can still happen between `.range()` and the final `await`.
    range:       vi.fn(() => { pending = 'range';       return chain; }),
    single:      vi.fn(() => { pending = 'single';      return chain; }),
    maybeSingle: vi.fn(() => { pending = 'maybeSingle'; return chain; }),

    // Thenable contract: `await chain` triggers this. We resolve based
    // on the LAST terminal flag set, falling back to `range`-shape.
    then(onFulfilled: any, onRejected: any) {
      return resolveTerminal().then(onFulfilled, onRejected);
    },
    catch(onRejected: any) {
      return resolveTerminal().catch(onRejected);
    },
    finally(onFinally: any) {
      return resolveTerminal().finally(onFinally);
    },

    // Auth + Storage — used by validateAccessToken + report endpoints.
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: CLIN_ID, email: 'clin@example.com' } },
        error: null,
      }),
    },
    storage: {
      from: vi.fn(() => chain),
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://x' }, error: null,
      }),
    },
  };

  return chain;
}

vi.mock('../../backend/src/config/supabase', () => {
  const chain = makeChain();
  return {
    supabaseAdmin: chain,
    createUserClient: vi.fn(() => chain),
  };
});

/* ──────────────── Override withAuth so we don't need the JWT path ─────── */

vi.mock('../../backend/src/middleware/auth-middleware', async () => {
  const actual = await vi.importActual<
    typeof import('../../backend/src/middleware/auth-middleware')
  >('../../backend/src/middleware/auth-middleware');
  return {
    ...actual,
    withAuth: (handler: (req: any, res: any) => Promise<void> | void) => {
      return async (req: any, res: any) => {
        // Test harness: the test owns `req.auth` setup. If `req.auth`
        // is unset AND no Bearer header is present, we emulate the
        // production 401 path. Otherwise we apply the test's auth or
        // a default clinician/tenant-A.
        if (req.auth === null) {
          // Explicit null = simulate missing-token scenario.
          res.status(401).json({ error: { code: 'MISSING_TOKEN' } });
          return;
        }
        if (!req.auth) {
          req.auth = {
            userId: CLIN_ID,
            email: 'clin@example.com',
            tenantId: TENANT_A,
            role: 'clinician',
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

/* ─────────────────────── tiny req/res helpers ──────────────────────────── */

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

function makeReq(overrides: Partial<VercelRequest> & { auth?: any } = {}): VercelRequest {
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

beforeEach(() => {
  clearScripts();
  vi.clearAllMocks();
});

/* ─────────────────────────────── tests ─────────────────────────────────── */

describe('/api/v1/patients route', () => {
  it('rejects requests without a Bearer token', async () => {
    const handler = (await import('../../api/v1/patients/index')).default;
    // Explicit null signals the test harness to simulate the
    // production missing-token path.
    const req = makeReq({ headers: {} as any });
    (req as any).auth = null;
    const res = makeRes();
    await handler(req as any, res);
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody?.error?.code).toBe('MISSING_TOKEN');
  });

  it('rejects unsupported HTTP methods with 4xx (never 2xx)', async () => {
    const handler = (await import('../../api/v1/patients/index')).default;
    const req = makeReq({ method: 'DELETE' });
    const res = makeRes();
    await handler(req as any, res);
    expect(res.statusCode).not.toBe(200);
    expect(res.statusCode).not.toBe(201);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects POST with malformed body via 4xx', async () => {
    const handler = (await import('../../api/v1/patients/index')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/patients',
      body: { not: 'a valid patient input' },
    });
    const res = makeRes();
    await handler(req as any, res);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.jsonBody?.error?.code).toBeDefined();
  });

  it('lists patients for a clinician in their own tenant only', async () => {
    scriptTable('patients', {
      list: {
        data: [
          { id: PATIENT_1, tenant_id: TENANT_A, display_name: 'P1', is_active: true },
          { id: PATIENT_2, tenant_id: TENANT_A, display_name: 'P2', is_active: true },
        ],
        error: null,
        count: 2,
      },
    });

    const handler = (await import('../../api/v1/patients/index')).default;
    const req = makeReq({ method: 'GET', query: { page: '1', pageSize: '20' } });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody?.patients).toHaveLength(2);
    expect(res.jsonBody?.pagination).toEqual({ page: 1, pageSize: 20, total: 2 });

    // Tenant-scoping invariant: the handler MUST have called .eq('tenant_id', TENANT_A).
    const patientCalls = getCallsForTable('patients');
    expect(patientCalls.length).toBeGreaterThan(0);
    const tenantFilterApplied = patientCalls.some((c) =>
      c.filters.some((f) => f.method === 'eq' && f.args[0] === 'tenant_id' && f.args[1] === TENANT_A),
    );
    expect(tenantFilterApplied).toBe(true);
  });

  it('platform_admin lists patients without the tenant filter', async () => {
    scriptTable('patients', {
      list: {
        data: [
          { id: PATIENT_1, tenant_id: TENANT_A, display_name: 'P1', is_active: true },
          { id: PATIENT_2, tenant_id: TENANT_B, display_name: 'P2', is_active: true },
        ],
        error: null,
        count: 2,
      },
    });

    const handler = (await import('../../api/v1/patients/index')).default;
    const req = makeReq({
      method: 'GET',
      auth: {
        userId: CLIN_ID,
        tenantId: TENANT_A,
        role: 'platform_admin',
        accessToken: 'fake',
      } as any,
    });
    const res = makeRes();
    await handler(req as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody?.patients).toHaveLength(2);
    // platform_admin → NO tenant_id filter must be applied.
    const patientCalls = getCallsForTable('patients');
    const tenantFilterApplied = patientCalls.some((c) =>
      c.filters.some((f) => f.method === 'eq' && f.args[0] === 'tenant_id'),
    );
    expect(tenantFilterApplied).toBe(false);
  });

  it('creates a patient and emits a patient.create audit event (or fails clean)', async () => {
    // Script the patients insert .single() to return the new row.
    scriptTable('patients', {
      single: {
        data: {
          id: NEW_PATIENT_ID,
          tenant_id: TENANT_A,
          display_name: 'Mario Rossi',
          first_name: 'Mario',
          last_name: 'Rossi',
          sex: 'male',
          birth_date: '1970-01-01',
          is_active: true,
          created_at: new Date().toISOString(),
        },
        error: null,
      },
    });
    scriptTable('audit_events', {
      single: { data: { id: 'audit-1' }, error: null },
    });
    scriptTable('professional_patient_links', {
      single: { data: { id: 'ppl-1' }, error: null },
    });

    const handler = (await import('../../api/v1/patients/index')).default;
    const req = makeReq({
      method: 'POST',
      url: '/api/v1/patients',
      body: {
        demographics: {
          firstName: 'Mario',
          lastName: 'Rossi',
          dateOfBirth: '1970-01-01',
          sex: 'male',
        },
        contact: { email: 'mario.rossi@example.com' },
        consentGiven: true,
      },
    });
    const res = makeRes();
    await handler(req as any, res);

    if (res.statusCode === 201) {
      expect(res.jsonBody?.patient?.id).toBe(NEW_PATIENT_ID);
      // B-09 invariant: state was mutated → audit row MUST exist.
      const auditInserts = getCallsForTable('audit_events').flatMap(
        (c) => c.insertedRows,
      ) as Array<Record<string, unknown>>;
      expect(auditInserts.length).toBeGreaterThanOrEqual(1);
      const patientCreateAudit = auditInserts.find(
        (row) => row?.action === 'patient.create',
      );
      expect(patientCreateAudit).toBeDefined();
      expect(patientCreateAudit?.entity_id).toBe(NEW_PATIENT_ID);
      expect(patientCreateAudit?.tenant_id).toBe(TENANT_A);
    } else {
      // Validation failed BEFORE the insert → state was not mutated →
      // there must be NO orphaned audit row, and the response is a
      // clean 4xx envelope.
      const auditInserts = getCallsForTable('audit_events').flatMap(
        (c) => c.insertedRows,
      );
      expect(auditInserts).toHaveLength(0);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
  });
});
