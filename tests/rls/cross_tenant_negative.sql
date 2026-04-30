-- ============================================================
-- tests/rls/cross_tenant_negative.sql
-- ============================================================
-- Postgres-side RLS regression test for B-01 / H-01 / M-12.
--
-- Closes the gap that the unit-test suite cannot close: vitest mocks
-- the Supabase client, so RLS is never actually evaluated. This test
-- runs as the `authenticated` role with a JWT-claim impersonation
-- against the REAL policy set, and asserts that:
--   1. Cross-tenant patient SELECT  → 0 rows (RLS denial)
--   2. Same-tenant + PPL-linked     → 1 row (sanity)
--   3. Same-tenant but NOT linked   → 0 rows (PPL gate, post 010)
--   4. Cross-tenant patient INSERT  → blocked by RLS WITH CHECK
--   5. tenant_admin sees ALL of own tenant
--   6. tenant_admin sees NONE of other tenant
--
-- Pre-conditions
-- --------------
--   - Migrations 001..013 applied to the target DB.
--   - Connection: a postgres / service-role connection (the test uses
--     SET LOCAL ROLE authenticated for the assertions then RESET ROLE
--     for teardown — only superuser / postgres can switch role).
--
-- How to run
-- ----------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/cross_tenant_negative.sql
--   # OR, via the runner (which auto-skips when DATABASE_URL is unset):
--   npm run test:rls
--
-- Idempotency / safety
-- --------------------
--   - The whole test runs inside BEGIN…ROLLBACK. No row ever survives.
--   - Sentinel UUIDs (`...aaaaaaaaa001`) collide with nothing real.
--   - `SET LOCAL session_replication_role = replica` disables FK
--     enforcement + triggers FOR THE TRANSACTION ONLY. This lets us
--     INSERT into public.users without a matching auth.users row
--     (auth.users is managed by Supabase/GoTrue and adding rows there
--     is fragile across versions). On ROLLBACK the setting is undone
--     along with everything else.
--   - Re-runnable forever. Re-running yields exactly the same trace.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------
-- 0. Disable FK enforcement and triggers for the test transaction.
--    Scoped to this transaction; ROLLBACK reverts it.
-- ----------------------------------------------------------------
SET LOCAL session_replication_role = replica;

-- ----------------------------------------------------------------
-- 1. Setup: 2 tenants, 2 clinicians, 1 admin, 3 patients, 1 PPL link
-- ----------------------------------------------------------------

-- Sentinel UUIDs — obviously fake, never collide with real data.
\set tenant_a_id           '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'''
\set tenant_b_id           '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001'''
\set user_a_id             '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1001'''
\set user_b_id             '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1001'''
\set admin_a_id            '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa2001'''
\set patient_a_id          '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa9001'''
\set patient_b_id          '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb9001'''
\set patient_a_unlinked_id '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa9002'''

-- Tenants
INSERT INTO tenants (id, name, slug, status, plan)
VALUES
  (:tenant_a_id, 'Test Tenant A — RLS test', 'rls-test-a', 'active', 'starter'),
  (:tenant_b_id, 'Test Tenant B — RLS test', 'rls-test-b', 'active', 'starter');

-- Users (full_name required, email unique).
-- session_replication_role=replica skips the FK to auth.users.
INSERT INTO users (id, tenant_id, role, full_name, email, status)
VALUES
  (:user_a_id,  :tenant_a_id, 'clinician',    'RLS Test Clinician A', 'rls.test.clinicianA@example.invalid', 'active'),
  (:user_b_id,  :tenant_b_id, 'clinician',    'RLS Test Clinician B', 'rls.test.clinicianB@example.invalid', 'active'),
  (:admin_a_id, :tenant_a_id, 'tenant_admin', 'RLS Test Admin A',     'rls.test.adminA@example.invalid',     'active');

-- Patients (display_name + created_by required).
INSERT INTO patients
  (id, tenant_id, created_by, display_name, first_name, last_name, sex, birth_date)
VALUES
  (:patient_a_id,          :tenant_a_id, :admin_a_id, 'PatientA Display',        'PatientA', 'TenantA', 'female', '1980-01-01'),
  (:patient_b_id,          :tenant_b_id, :user_b_id,  'PatientB Display',        'PatientB', 'TenantB', 'female', '1980-01-01'),
  (:patient_a_unlinked_id, :tenant_a_id, :admin_a_id, 'Unlinked Display TenantA','Unlinked', 'TenantA', 'female', '1980-01-01');

-- PPL link: clinician_a → patient_a (NOT to patient_a_unlinked).
INSERT INTO professional_patient_links
  (tenant_id, professional_user_id, patient_id, relationship_type, is_active, assigned_by)
VALUES
  (:tenant_a_id, :user_a_id, :patient_a_id, 'primary', TRUE, :admin_a_id);

-- Re-enable FK enforcement before running the assertions: the
-- assertions exercise live RLS policy behaviour, which is unrelated
-- to FK enforcement, but defensive hygiene says replicate prod
-- semantics from this point on.
SET LOCAL session_replication_role = origin;

-- ----------------------------------------------------------------
-- 2. Switch to the `authenticated` role + impersonate clinician_a JWT
-- ----------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :user_a_id, 'role', 'authenticated')::text,
  TRUE
);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  ----------------------------------------------------------------
  -- Assertion 1: cross-tenant SELECT must return 0 rows
  ----------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM patients
   WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb9001';
  ASSERT v_count = 0,
    format('FAIL[1] cross-tenant SELECT leaked %s row(s) of patient_b from clinician_a', v_count);

  ----------------------------------------------------------------
  -- Assertion 2: same-tenant + PPL-linked SELECT returns 1 row
  ----------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM patients
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa9001';
  ASSERT v_count = 1,
    format('FAIL[2] same-tenant linked SELECT returned %s rows (expected 1)', v_count);

  ----------------------------------------------------------------
  -- Assertion 3: same-tenant but NOT PPL-linked → 0 rows
  -- (post migration 010 — PPL gate enforced by RLS)
  ----------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM patients
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa9002';
  ASSERT v_count = 0,
    format('FAIL[3] PPL gate breached — clinician_a saw %s rows of unlinked patient', v_count);
END $$;

----------------------------------------------------------------
-- Assertion 4: cross-tenant INSERT must fail RLS WITH CHECK
----------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO patients (tenant_id, created_by, display_name, first_name, last_name, sex, birth_date)
    VALUES (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1001',
      'Smuggled', 'Smuggled', 'Patient', 'male', '1990-01-01'
    );
    -- If we reach here the policy did NOT fire — fail.
    RAISE EXCEPTION 'FAIL[4] cross-tenant INSERT should have been blocked by RLS WITH CHECK';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      -- Expected denial — pass.
      NULL;
  END;
END $$;

-- ----------------------------------------------------------------
-- 3. Switch to tenant_admin → must see ALL tenant_a patients
--    (sanity: the narrowing in 010 applies to clinician role only)
-- ----------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :admin_a_id, 'role', 'authenticated')::text,
  TRUE
);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Assertion 5: tenant_admin sees BOTH patients of own tenant
  SELECT count(*) INTO v_count FROM patients
   WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001';
  ASSERT v_count = 2,
    format('FAIL[5] tenant_admin saw %s patients of own tenant (expected 2)', v_count);

  -- Assertion 6: tenant_admin sees NONE of other tenant
  SELECT count(*) INTO v_count FROM patients
   WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001';
  ASSERT v_count = 0,
    format('FAIL[6] tenant_admin leaked %s row(s) of other tenant', v_count);
END $$;

-- ----------------------------------------------------------------
-- 4. Teardown: rollback strips every test row + every SET LOCAL.
-- ----------------------------------------------------------------
RESET ROLE;
ROLLBACK;

-- If we reached this line, every ASSERT passed.
\echo '✓ tests/rls/cross_tenant_negative.sql — 6 assertions passed'
