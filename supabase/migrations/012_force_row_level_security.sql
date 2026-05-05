-- ============================================================
-- MIGRATION 012: FORCE ROW LEVEL SECURITY ON ALL PHI TABLES
-- ============================================================
--
-- Audit finding addressed
-- -----------------------
-- B-01 follow-up / defence-in-depth.
--
-- Migration 010 narrowed the per-clinician policies (PPL-scoped reads)
-- but did NOT add `FORCE ROW LEVEL SECURITY` on any table. The doc pack
-- (`30-RISK-REGISTER.md` row B-01, `20-SECURITY.md §4`) promises
-- "FORCE ROW LEVEL SECURITY on every PHI table" — this migration
-- delivers that promise.
--
-- What FORCE actually does
-- ------------------------
-- Without FORCE, Postgres evaluates RLS policies for every role EXCEPT
-- the table owner. With FORCE, RLS evaluates for the table owner too.
--
-- In Supabase the runtime roles split as:
--   - `postgres`        : superuser → BYPASSES RLS regardless of FORCE
--                         (only used via the dashboard SQL editor)
--   - `service_role`    : has BYPASSRLS attribute → bypasses RLS by design
--                         (this is the role our Vercel handlers use)
--   - `authenticator`   : the connection role for PostgREST
--   - `authenticated`   : end-user role with JWT → SUBJECT to RLS
--   - `anon`            : anonymous role → SUBJECT to RLS
--
-- So in practice this migration does NOT change behaviour for:
--   - the API layer (uses `service_role` which has BYPASSRLS)
--   - dashboard `postgres` access (superuser)
--
-- It DOES catch:
--   - any accidental code path using an `authenticator` connection that
--     touches a public.* PHI table directly without going through PostgREST
--   - any future role that becomes the table owner of a PHI table
--   - documentation/audit posture: explicit declaration that RLS is
--     authoritative, not opt-in
--
-- This is a defence-in-depth measure. The actual per-tenant / per-clinician
-- isolation is enforced by the policies in migrations 002 + 010.
--
-- Safety
-- ------
-- - Additive only; no schema change, no data change.
-- - service_role bypasses regardless, so the Vercel API layer is
--   unaffected (verified by re-reading auth-middleware.ts: every
--   protected handler creates the supabase client via supabaseAdmin
--   which carries SUPABASE_SERVICE_ROLE_KEY).
-- - Per-table effect is idempotent: re-running this migration is a
--   no-op once FORCE is set.
--
-- Tables we do NOT touch
-- ----------------------
-- - `auth.*` (Supabase-managed)
-- - `storage.objects` (Supabase-managed; we already declared explicit
--   policies on the clinical-reports bucket in migration 010)
-- - `extensions.*`
--
-- Idempotency
-- -----------
-- ALTER TABLE … FORCE ROW LEVEL SECURITY is naturally idempotent. A DO
-- block also asserts that RLS is ENABLED on each table before FORCING
-- so we fail loudly if a future migration accidentally disables RLS on
-- a PHI table.
--
-- Rollback
-- --------
-- ALTER TABLE <name> NO FORCE ROW LEVEL SECURITY;
-- (per table). RLS itself remains enabled.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PHI / clinical tables (migrations 001 + 003 + 005 + 007)
-- ============================================================
-- The full list mirrors the RLS-enabled set in 002_rls_policies.sql
-- plus the tables added by later migrations (PPL, due_items, DSR).

DO $$
DECLARE
  t TEXT;
  phi_tables TEXT[] := ARRAY[
    -- Tenant + identity
    'tenants',
    'users',
    'professionals',
    -- Patient + clinical context
    'patients',
    'patient_clinical_profiles',
    -- Per-assessment data
    'assessments',
    'assessment_measurements',
    'score_results',
    'risk_profiles',
    'nutrition_snapshots',
    'activity_snapshots',
    -- Care planning + alerts
    'followup_plans',
    'alerts',
    -- Consent + audit
    'consent_records',
    'audit_events',
    -- Reports + notifications
    'report_exports',
    'notification_jobs',
    -- Added by later migrations
    'professional_patient_links',  -- migration 005
    'due_items',                   -- migration 007
    'data_subject_requests'        -- migration 003
  ];
  v_rls_enabled BOOLEAN;
BEGIN
  FOREACH t IN ARRAY phi_tables LOOP
    -- 1a. Defensive precondition: RLS must already be ENABLED on the
    --     table. If not, this migration is being applied in the wrong
    --     order (002 should have run first). Fail loudly.
    SELECT relrowsecurity INTO v_rls_enabled
      FROM pg_class
     WHERE oid = ('public.' || t)::regclass;

    IF v_rls_enabled IS NULL THEN
      RAISE EXCEPTION
        'migration 012: table public.% does not exist', t;
    END IF;

    IF NOT v_rls_enabled THEN
      RAISE EXCEPTION
        'migration 012: RLS is not ENABLED on public.% — apply 002 first', t;
    END IF;

    -- 1b. Idempotent FORCE. Safe to re-run.
    EXECUTE format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- 2. Verification (commented — copy/paste post-deploy)
-- ============================================================
-- Run this after migration 012 to confirm both ENABLE and FORCE are
-- set on every PHI table.
--
-- IMPORTANT: pg_tables exposes only `rowsecurity`. The FORCE flag
-- lives on pg_class.relforcerowsecurity, so we must join pg_class +
-- pg_namespace directly.
--
--   SELECT
--     c.relname              AS tablename,
--     c.relrowsecurity       AS rowsecurity,
--     c.relforcerowsecurity  AS forcerowsecurity
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname  = 'public'
--     AND c.relkind  = 'r'        -- ordinary tables only
--     AND c.relname IN (
--       'tenants','users','professionals','patients',
--       'patient_clinical_profiles','assessments',
--       'assessment_measurements','score_results','risk_profiles',
--       'nutrition_snapshots','activity_snapshots','followup_plans',
--       'alerts','consent_records','audit_events','report_exports',
--       'notification_jobs','professional_patient_links',
--       'due_items','data_subject_requests'
--     )
--   ORDER BY c.relname;
--
-- Expected: 20 rows, every row with rowsecurity = true AND forcerowsecurity = true.
-- ============================================================

-- ============================================================
-- 3. Migration audit row
-- ============================================================
-- Same pattern as the corrected 010 / 011: entity_id is UUID-typed in
-- audit_events (see 001 §15), so the migration version label lives in
-- metadata_json and entity_id stays NULL.

INSERT INTO audit_events (
  tenant_id,
  actor_user_id,
  action,
  entity_type,
  entity_id,
  metadata_json,
  ip_hash
) VALUES (
  NULL,
  NULL,
  'system.migration.applied',
  'migration',
  NULL,
  jsonb_build_object(
    'name', '012_force_row_level_security',
    'migration_version', '012',
    'audit_findings', ARRAY['B-01-defence-in-depth'],
    'tables_forced', 20,
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
