/**
 * MFA mandate matrix unit test (audit AUD-2026-05-04 P1).
 *
 * Verifies that `requiredMfaFlagForRole` returns the expected flag name
 * (or null) for every (role, env-flag-state) combination. The matrix:
 *
 *   role ∈ {platform_admin, tenant_admin, clinician, assistant_staff, patient}
 *   env-flag ∈ {MFA_ENFORCEMENT_ENABLED, MFA_ENFORCEMENT_CLINICIAN_ENABLED,
 *               MFA_ENFORCEMENT_STAFF_ENABLED}
 *
 * The function must:
 *   - return 'MFA_ENFORCEMENT_ENABLED' for {platform_admin, tenant_admin}
 *     when that flag is on; null otherwise.
 *   - return 'MFA_ENFORCEMENT_CLINICIAN_ENABLED' for clinician when on;
 *     null otherwise.
 *   - return 'MFA_ENFORCEMENT_STAFF_ENABLED' for assistant_staff when on;
 *     null otherwise.
 *   - always return null for patient (intentional product decision).
 *   - cross-flag: setting CLINICIAN_ENABLED must NOT gate admin roles
 *     (and vice versa) — independence of flags is the whole point of
 *     Tier 4 splitting them.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { requiredMfaFlagForRole, type UserRole } from '../../backend/src/middleware/auth-middleware';

const FLAGS = [
  'MFA_ENFORCEMENT_ENABLED',
  'MFA_ENFORCEMENT_CLINICIAN_ENABLED',
  'MFA_ENFORCEMENT_STAFF_ENABLED',
] as const;

function clearFlags(): void {
  for (const f of FLAGS) delete process.env[f];
}

describe('requiredMfaFlagForRole — Tier 4 MFA mandate matrix', () => {
  beforeEach(clearFlags);
  afterEach(clearFlags);

  // ─── default-off baseline ───
  it('returns null for every role when no flag is set', () => {
    const roles: UserRole[] = ['platform_admin', 'tenant_admin', 'clinician', 'assistant_staff', 'patient'];
    for (const role of roles) {
      expect(requiredMfaFlagForRole(role)).toBeNull();
    }
  });

  // ─── admin flag ───
  it('admin flag gates platform_admin and tenant_admin only', () => {
    process.env.MFA_ENFORCEMENT_ENABLED = 'true';
    expect(requiredMfaFlagForRole('platform_admin')).toBe('MFA_ENFORCEMENT_ENABLED');
    expect(requiredMfaFlagForRole('tenant_admin')).toBe('MFA_ENFORCEMENT_ENABLED');
    expect(requiredMfaFlagForRole('clinician')).toBeNull();
    expect(requiredMfaFlagForRole('assistant_staff')).toBeNull();
    expect(requiredMfaFlagForRole('patient')).toBeNull();
  });

  // ─── clinician flag (independent) ───
  it('clinician flag gates clinician only', () => {
    process.env.MFA_ENFORCEMENT_CLINICIAN_ENABLED = 'true';
    expect(requiredMfaFlagForRole('clinician')).toBe('MFA_ENFORCEMENT_CLINICIAN_ENABLED');
    expect(requiredMfaFlagForRole('platform_admin')).toBeNull();
    expect(requiredMfaFlagForRole('tenant_admin')).toBeNull();
    expect(requiredMfaFlagForRole('assistant_staff')).toBeNull();
    expect(requiredMfaFlagForRole('patient')).toBeNull();
  });

  // ─── staff flag (independent) ───
  it('staff flag gates assistant_staff only', () => {
    process.env.MFA_ENFORCEMENT_STAFF_ENABLED = 'true';
    expect(requiredMfaFlagForRole('assistant_staff')).toBe('MFA_ENFORCEMENT_STAFF_ENABLED');
    expect(requiredMfaFlagForRole('platform_admin')).toBeNull();
    expect(requiredMfaFlagForRole('tenant_admin')).toBeNull();
    expect(requiredMfaFlagForRole('clinician')).toBeNull();
    expect(requiredMfaFlagForRole('patient')).toBeNull();
  });

  // ─── all three flags simultaneously ───
  it('all three flags gate all non-patient roles independently', () => {
    process.env.MFA_ENFORCEMENT_ENABLED = 'true';
    process.env.MFA_ENFORCEMENT_CLINICIAN_ENABLED = 'true';
    process.env.MFA_ENFORCEMENT_STAFF_ENABLED = 'true';
    expect(requiredMfaFlagForRole('platform_admin')).toBe('MFA_ENFORCEMENT_ENABLED');
    expect(requiredMfaFlagForRole('tenant_admin')).toBe('MFA_ENFORCEMENT_ENABLED');
    expect(requiredMfaFlagForRole('clinician')).toBe('MFA_ENFORCEMENT_CLINICIAN_ENABLED');
    expect(requiredMfaFlagForRole('assistant_staff')).toBe('MFA_ENFORCEMENT_STAFF_ENABLED');
    expect(requiredMfaFlagForRole('patient')).toBeNull();
  });

  // ─── flag value parsing ───
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', false],
    ['off', false],
  ])('parses flag value %j → enabled=%s', (value, enabled) => {
    process.env.MFA_ENFORCEMENT_ENABLED = value;
    const expected = enabled ? 'MFA_ENFORCEMENT_ENABLED' : null;
    expect(requiredMfaFlagForRole('tenant_admin')).toBe(expected);
  });

  // ─── independence ───
  it('admin flag does NOT gate clinician/staff (cross-flag independence)', () => {
    process.env.MFA_ENFORCEMENT_ENABLED = 'true';
    expect(requiredMfaFlagForRole('clinician')).toBeNull();
    expect(requiredMfaFlagForRole('assistant_staff')).toBeNull();
  });

  it('clinician flag does NOT gate admin roles', () => {
    process.env.MFA_ENFORCEMENT_CLINICIAN_ENABLED = 'true';
    expect(requiredMfaFlagForRole('platform_admin')).toBeNull();
    expect(requiredMfaFlagForRole('tenant_admin')).toBeNull();
  });
});
