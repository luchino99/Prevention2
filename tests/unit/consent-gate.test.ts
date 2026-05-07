/**
 * consent-gate.ts unit tests — Sprint 3 task 3.2.
 *
 * Asserts the four denial paths and the one grant path of
 * `assertConsentFor`, plus the best-effort wrapper `hasConsentFor`.
 *
 * Mocking approach
 * ----------------
 * Replace `supabaseAdmin` at the module boundary. The mocked
 * .from('consent_records').select(...).eq(...).eq(...).eq(...)
 *   .order(...).limit(...).maybeSingle()
 * chain returns a configurable `{ data, error }` shape via the
 * `queryHandle.result` mutable handle. Each test sets the desired
 * result before calling the assertion.
 *
 * `logStructured` is mocked to a no-op so test output stays clean
 * (the production code emits CONSENT_DENIED warnings on every denial).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type QueryResult = {
  data: { granted: boolean; revoked_at: string | null; policy_version?: string | null } | null;
  error: { message: string; code?: string } | null;
};

const queryHandle: { result: QueryResult } = {
  result: { data: null, error: null },
};

vi.mock('../../backend/src/config/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => queryHandle.result);
  return {
    supabaseAdmin: { from: vi.fn(() => chain) },
  };
});

vi.mock('../../backend/src/observability/structured-log', () => ({
  logStructured: vi.fn(),
}));

import {
  assertConsentFor,
  hasConsentFor,
  ConsentDeniedError,
  ENFORCEABLE_CONSENT_TYPES,
} from '../../backend/src/middleware/consent-gate.js';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

describe('consent-gate enforcement matrix', () => {
  beforeEach(() => {
    queryHandle.result = { data: null, error: null };
  });

  it('exports exactly the 4 enforceable consent types (defence-in-depth — health_data_processing must NOT be in this list)', () => {
    expect(ENFORCEABLE_CONSENT_TYPES).toEqual([
      'ai_processing',
      'notifications',
      'data_sharing_clinician',
      'marketing',
    ]);
    // Critical regression guard: clinical-care consent is NEVER enforced.
    expect(ENFORCEABLE_CONSENT_TYPES).not.toContain('health_data_processing');
  });

  describe('assertConsentFor', () => {
    it('does NOT throw when consent is granted and not revoked', async () => {
      queryHandle.result = {
        data: { granted: true, revoked_at: null, policy_version: '1.0.0' },
        error: null,
      };
      await expect(assertConsentFor(PATIENT_ID, 'notifications')).resolves.toBeUndefined();
    });

    it('throws ConsentDeniedError reason=no_record when no row exists', async () => {
      queryHandle.result = { data: null, error: null };
      await expect(assertConsentFor(PATIENT_ID, 'notifications')).rejects.toMatchObject({
        name: 'ConsentDeniedError',
        code: 'CONSENT_REQUIRED',
        status: 403,
        reason: 'no_record',
        patientId: PATIENT_ID,
        consentType: 'notifications',
      });
    });

    it('throws ConsentDeniedError reason=not_granted when latest row has granted=false', async () => {
      queryHandle.result = {
        data: { granted: false, revoked_at: null, policy_version: '1.0.0' },
        error: null,
      };
      await expect(assertConsentFor(PATIENT_ID, 'marketing')).rejects.toMatchObject({
        name: 'ConsentDeniedError',
        reason: 'not_granted',
        consentType: 'marketing',
      });
    });

    it('throws ConsentDeniedError reason=revoked when revoked_at is set', async () => {
      queryHandle.result = {
        data: { granted: true, revoked_at: '2026-01-01T00:00:00Z', policy_version: '1.0.0' },
        error: null,
      };
      await expect(
        assertConsentFor(PATIENT_ID, 'data_sharing_clinician'),
      ).rejects.toMatchObject({
        name: 'ConsentDeniedError',
        reason: 'revoked',
        consentType: 'data_sharing_clinician',
      });
    });

    it('throws ConsentDeniedError reason=not_granted on query error (fail-closed)', async () => {
      queryHandle.result = { data: null, error: { message: 'connection refused', code: '08001' } };
      await expect(assertConsentFor(PATIENT_ID, 'ai_processing')).rejects.toMatchObject({
        name: 'ConsentDeniedError',
        reason: 'not_granted',
        consentType: 'ai_processing',
      });
    });

    it('ConsentDeniedError carries status=403 and code=CONSENT_REQUIRED for HTTP mapping', async () => {
      queryHandle.result = { data: null, error: null };
      try {
        await assertConsentFor(PATIENT_ID, 'notifications');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConsentDeniedError);
        const err = e as ConsentDeniedError;
        expect(err.status).toBe(403);
        expect(err.code).toBe('CONSENT_REQUIRED');
      }
    });
  });

  describe('hasConsentFor (best-effort wrapper)', () => {
    it('returns true when consent is granted', async () => {
      queryHandle.result = {
        data: { granted: true, revoked_at: null, policy_version: '1.0.0' },
        error: null,
      };
      expect(await hasConsentFor(PATIENT_ID, 'notifications')).toBe(true);
    });

    it('returns false when no record (does NOT throw)', async () => {
      queryHandle.result = { data: null, error: null };
      expect(await hasConsentFor(PATIENT_ID, 'marketing')).toBe(false);
    });

    it('returns false when revoked (does NOT throw)', async () => {
      queryHandle.result = {
        data: { granted: true, revoked_at: '2026-01-01T00:00:00Z', policy_version: '1.0.0' },
        error: null,
      };
      expect(await hasConsentFor(PATIENT_ID, 'ai_processing')).toBe(false);
    });

    it('returns false when query errors (fail-closed, does NOT throw)', async () => {
      queryHandle.result = { data: null, error: { message: 'oops' } };
      expect(await hasConsentFor(PATIENT_ID, 'data_sharing_clinician')).toBe(false);
    });
  });
});
