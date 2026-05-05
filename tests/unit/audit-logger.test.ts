/**
 * Audit-logger unit tests.
 *
 * Covers B-09 (audit guarantee) — see `30-RISK-REGISTER.md`. The strict
 * variant `recordAuditStrict` MUST throw `AuditWriteError` when the
 * persistence layer rejects the insert; the surrounding endpoint relies on
 * that throw to abort the request with `AUDIT_WRITE_FAILED` rather than
 * silently mutate state.
 *
 * What we explicitly test:
 *   - `recordAudit` (best-effort) does not throw on DB error
 *   - `recordAuditStrict` throws AuditWriteError on PostgREST error
 *   - `recordAuditStrict` throws AuditWriteError on driver throw
 *   - The thrown error carries the original cause via Error.cause
 *   - The thrown error carries action + resourceType for log correlation
 *   - sanitizeMetadata strips PHI-shaped values and respects allowlist
 *   - recordFailedLogin captures only the email domain (data minimisation)
 *
 * Mocking approach:
 *   We replace `supabaseAdmin` at the module boundary using vi.mock so that
 *   `from('audit_events').insert(...)` returns a configurable result/error.
 *   The mock is mutated per-test via the exported handle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Mutable handle the mock factory closes over. The mock chooses behaviour
 * lazily at call time (no top-level `Promise.reject` — we don't want an
 * unhandled-rejection log line at module load, which Node would emit even
 * if the test eventually catches it).
 *
 * Mode semantics:
 *   - 'ok'        → `{ error: null }`
 *   - 'rowError'  → `{ error: { message, code? } }`
 *   - 'driverThrow' → the mocked insert THROWS at await time
 */
type InsertMode =
  | { kind: 'ok' }
  | { kind: 'rowError'; error: { message: string; code?: string } }
  | { kind: 'driverThrow'; error: Error };

const insertHandle: { mode: InsertMode } = { mode: { kind: 'ok' } };

vi.mock('../../backend/src/config/supabase', () => {
  const insert = vi.fn(async () => {
    const m = insertHandle.mode;
    if (m.kind === 'driverThrow') {
      throw m.error;
    }
    if (m.kind === 'rowError') {
      return { error: m.error };
    }
    return { error: null };
  });
  const fromSpy = vi.fn(() => ({ insert }));
  return {
    supabaseAdmin: { from: fromSpy },
  };
});

import {
  recordAudit,
  recordAuditStrict,
  recordFailedLogin,
  AuditWriteError,
} from '../../backend/src/audit/audit-logger.js';
import type { AuthContext } from '../../backend/src/middleware/auth-middleware.js';

const AUTH: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'clinician',
  email: 'c@example.com',
  ipHash: 'sha256-of-ip',
  userAgent: 'Vitest/UA',
} as unknown as AuthContext;

beforeEach(() => {
  insertHandle.mode = { kind: 'ok' };
  vi.clearAllMocks();
});

describe('recordAudit (best-effort variant)', () => {
  it('does NOT throw when Supabase returns a row error', async () => {
    insertHandle.mode = {
      kind: 'rowError',
      error: { message: 'duplicate key', code: '23505' },
    };
    await expect(
      recordAudit(AUTH, {
        action: 'patient.read',
        resourceType: 'patient',
        resourceId: 'pat-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('does NOT throw when the driver itself throws', async () => {
    insertHandle.mode = {
      kind: 'driverThrow',
      error: new Error('socket closed'),
    };
    await expect(
      recordAudit(AUTH, {
        action: 'patient.read',
        resourceType: 'patient',
        resourceId: 'pat-1',
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * Lock the canonical AUDIT_WRITE_FAILED log shape (L-04). The
 * detection dashboards in production parse these JSON fields by name —
 * any change to the contract requires a paired update to
 * `docs/27-INCIDENT-RESPONSE.md §11.1`.
 */
describe('AUDIT_WRITE_FAILED structured log contract', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('strict-variant DB error emits one canonical AUDIT_WRITE_FAILED line', async () => {
    insertHandle.mode = {
      kind: 'rowError',
      error: { message: 'permission denied', code: '42501' },
    };
    await expect(
      recordAuditStrict(AUTH, {
        action: 'consent.revoke',
        resourceType: 'consent',
        resourceId: 'consent-1',
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const raw = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw);
    expect(parsed).toMatchObject({
      event: 'AUDIT_WRITE_FAILED',
      variant: 'strict',
      action: 'consent.revoke',
      resourceType: 'consent',
      resourceId: 'consent-1',
      dbErrorMessage: 'permission denied',
      dbErrorCode: '42501',
    });
  });

  it('best-effort DB error emits the same canonical event tag (variant=best_effort)', async () => {
    insertHandle.mode = {
      kind: 'rowError',
      error: { message: 'timeout', code: '57014' },
    };
    await recordAudit(AUTH, {
      action: 'patient.read',
      resourceType: 'patient',
      resourceId: 'pat-1',
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleErrorSpy.mock.calls[0]?.[0] as string);
    expect(parsed.event).toBe('AUDIT_WRITE_FAILED');
    expect(parsed.variant).toBe('best_effort');
    expect(parsed.dbErrorCode).toBe('57014');
  });

  it('driver throw also emits AUDIT_WRITE_FAILED with rawErrorTag', async () => {
    insertHandle.mode = {
      kind: 'driverThrow',
      error: new Error('socket closed'),
    };
    await expect(
      recordAuditStrict(AUTH, {
        action: 'patient.delete',
        resourceType: 'patient',
        resourceId: 'pat-1',
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleErrorSpy.mock.calls[0]?.[0] as string);
    expect(parsed.event).toBe('AUDIT_WRITE_FAILED');
  });

  it('payload never leaks the audit metadata (no PHI in alert pipeline)', async () => {
    insertHandle.mode = {
      kind: 'rowError',
      error: { message: 'fk violation', code: '23503' },
    };
    await expect(
      recordAuditStrict(AUTH, {
        action: 'consent.revoke',
        resourceType: 'consent',
        resourceId: 'consent-1',
        metadata: {
          // intentionally a string that would be PHI-shaped if leaked
          patientName: 'alice.cohen.diabetic.2026',
        },
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);

    const raw = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(raw).not.toMatch(/alice\.cohen/);
    expect(raw).not.toMatch(/patientName/);
  });
});

describe('recordAuditStrict (B-09 guarantee variant)', () => {
  it('resolves cleanly on a successful insert', async () => {
    insertHandle.mode = { kind: 'ok' };
    await expect(
      recordAuditStrict(AUTH, {
        action: 'consent.revoke',
        resourceType: 'consent',
        resourceId: 'consent-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws AuditWriteError when PostgREST returns an error', async () => {
    insertHandle.mode = {
      kind: 'rowError',
      error: {
        message: 'relation "audit_events" does not exist',
        code: '42P01',
      },
    };
    let caught: unknown;
    try {
      await recordAuditStrict(AUTH, {
        action: 'consent.revoke',
        resourceType: 'consent',
        resourceId: 'consent-1',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuditWriteError);
    const e = caught as AuditWriteError;
    expect(e.action).toBe('consent.revoke');
    expect(e.resourceType).toBe('consent');
    // ES2022 cause is preserved (super(msg, { cause })).
    expect((e as Error).cause).toBeDefined();
  });

  it('throws AuditWriteError when the driver throws', async () => {
    insertHandle.mode = {
      kind: 'driverThrow',
      error: new Error('socket closed'),
    };
    await expect(
      recordAuditStrict(AUTH, {
        action: 'patient.delete',
        resourceType: 'patient',
        resourceId: 'pat-1',
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);
  });

  it('AuditWriteError message names the action and resource (for log correlation)', async () => {
    insertHandle.mode = { kind: 'rowError', error: { message: 'x' } };
    try {
      await recordAuditStrict(AUTH, {
        action: 'dsr.fulfill',
        resourceType: 'data_subject_request',
        resourceId: 'dsr-1',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuditWriteError);
      expect((err as Error).message).toMatch(/dsr\.fulfill/);
      expect((err as Error).message).toMatch(/data_subject_request/);
    }
  });
});

describe('recordFailedLogin — data minimisation', () => {
  it('captures only the email domain, never the full address', async () => {
    insertHandle.mode = { kind: 'ok' };
    // Spy on insert to inspect what was written.
    const sb = await import('../../backend/src/config/supabase.js');
    const insertSpy = (sb.supabaseAdmin as unknown as {
      from: (t: string) => { insert: ReturnType<typeof vi.fn> };
    }).from('audit_events').insert;

    await recordFailedLogin(
      'patient.alice@hospital.example.org',
      'sha256-of-ip',
      'Mozilla/5.0',
      'invalid_password',
    );

    expect(insertSpy).toHaveBeenCalled();
    // The most recent call's metadata_json must NOT contain the local-part.
    const lastCall = (insertSpy as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1);
    const row = lastCall?.[0] as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    const meta = row?.metadata_json as Record<string, unknown> | null;
    expect(meta).not.toBeNull();
    expect(meta).toMatchObject({ email_domain: 'hospital.example.org' });
    // No full email anywhere on the row.
    const blob = JSON.stringify(row);
    expect(blob).not.toMatch(/patient\.alice/);
  });
});

describe('sanitizeMetadata behaviour (verified through recordAudit row shape)', () => {
  it('truncates long strings to 256 chars and drops nested objects', async () => {
    insertHandle.mode = { kind: 'ok' };
    const sb = await import('../../backend/src/config/supabase.js');
    const insertSpy = (sb.supabaseAdmin as unknown as {
      from: (t: string) => { insert: ReturnType<typeof vi.fn> };
    }).from('audit_events').insert;

    const longString = 'x'.repeat(1000);
    await recordAudit(AUTH, {
      action: 'patient.read',
      resourceType: 'patient',
      resourceId: 'pat-1',
      metadata: {
        long: longString,
        count: 42,
        flag: true,
        nested: { phi: 'should-be-dropped' },
        arr: Array.from({ length: 50 }, (_, i) => i),
      },
    });

    const lastCall = (insertSpy as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1);
    const row = lastCall?.[0] as Record<string, unknown> | undefined;
    const meta = row?.metadata_json as Record<string, unknown> | null;
    expect(meta).not.toBeNull();
    // String truncation at 256 chars
    expect(typeof meta?.long).toBe('string');
    expect((meta?.long as string).length).toBe(256);
    // Number + boolean preserved
    expect(meta?.count).toBe(42);
    expect(meta?.flag).toBe(true);
    // Nested object dropped
    expect(meta).not.toHaveProperty('nested');
    // Array truncated to 20
    expect(Array.isArray(meta?.arr)).toBe(true);
    expect((meta?.arr as unknown[]).length).toBe(20);
    // No nested PHI string anywhere on the row
    const blob = JSON.stringify(row);
    expect(blob).not.toMatch(/should-be-dropped/);
  });
});
