-- ============================================================
-- Bootstrap 001 — First admin + default tenant
-- ============================================================
-- Purpose:
--   Provision the very first tenant of the platform and attach the
--   initial tenant_admin account (luca) to it, so that login can
--   complete past `validateAccessToken()` in auth-middleware.ts.
--
-- Context:
--   * Supabase Auth (auth.users) is populated by the sign-up flow.
--   * The application reads `public.users` to resolve role + tenant.
--   * Without a matching `public.users` row, login fails with
--     USER_PROFILE_NOT_FOUND (401).
--
-- What this script does (idempotently):
--   1) Creates the first tenant "Studio Imperio" (slug: 'studio-imperio').
--   2) Finds the auth.users row for lucaimperio49@gmail.com.
--   3) Upserts a public.users row with role='tenant_admin',
--      status='active', linked to that tenant.
--   4) Creates a matching public.professionals row.
--   5) Prints a final verification row.
--
-- Safety:
--   * Runs inside a single transaction — either fully applied or
--     fully rolled back.
--   * Uses ON CONFLICT / IF NOT EXISTS so it is safe to re-run.
--   * Never touches auth schema (we only READ auth.users).
--   * Never uses the service-role key client-side; this is meant to
--     be executed ONCE in the Supabase SQL Editor as postgres/owner.
--
-- HOW TO RUN:
--   1. Open Supabase Dashboard → SQL Editor → New query
--   2. Paste the entire content of this file
--   3. Click "Run"
--   4. Verify the final SELECT returns ONE row with role='tenant_admin'
--      and status='active'
--
-- If the final SELECT returns 0 rows, it means the auth.users entry for
-- the email does not exist yet — sign up via the app first, then re-run.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 0) Sanity: verify auth.users exists (abort with a clear error if not)
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_auth_uid UUID;
BEGIN
  SELECT id INTO v_auth_uid
    FROM auth.users
   WHERE lower(email) = lower('lucaimperio49@gmail.com')
   LIMIT 1;

  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION
      'Bootstrap aborted: no auth.users row for lucaimperio49@gmail.com. '
      'Sign up via the app first, then re-run this script.';
  END IF;
END
$$;

-- ----------------------------------------------------------------
-- 1) Create default tenant (idempotent via slug UNIQUE)
-- ----------------------------------------------------------------
INSERT INTO public.tenants (name, slug, plan, status, settings)
VALUES (
  'Studio Imperio',
  'studio-imperio',
  'professional'::tenant_plan,
  'active'::tenant_status,
  jsonb_build_object(
    'branding', jsonb_build_object('primary', '#0F766E'),
    'locale',   'it-IT'
  )
)
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------
-- 2) Upsert public.users row linked to auth.users, role tenant_admin
-- ----------------------------------------------------------------
WITH
  auth_row AS (
    SELECT id, email
      FROM auth.users
     WHERE lower(email) = lower('lucaimperio49@gmail.com')
     LIMIT 1
  ),
  tenant_row AS (
    SELECT id FROM public.tenants WHERE slug = 'studio-imperio' LIMIT 1
  )
INSERT INTO public.users (id, tenant_id, role, full_name, email, status)
SELECT
  a.id,
  t.id,
  'tenant_admin'::user_role,
  'Luca Imperio',
  a.email,
  'active'
FROM auth_row a
CROSS JOIN tenant_row t
ON CONFLICT (id) DO UPDATE
  SET tenant_id  = EXCLUDED.tenant_id,
      role       = EXCLUDED.role,
      status     = 'active',
      full_name  = COALESCE(public.users.full_name, EXCLUDED.full_name),
      updated_at = NOW();

-- ----------------------------------------------------------------
-- 3) Ensure a professionals row exists (1:1 with users for clinicians/admins)
-- ----------------------------------------------------------------
INSERT INTO public.professionals (user_id, tenant_id, specialty, clinic_name)
SELECT u.id, u.tenant_id, 'amministrazione', 'Studio Imperio'
  FROM public.users u
 WHERE lower(u.email) = lower('lucaimperio49@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

-- ----------------------------------------------------------------
-- 4) Audit the bootstrap itself (never silent)
-- ----------------------------------------------------------------
INSERT INTO public.audit_events
  (tenant_id, actor_user_id, actor_role, entity_type, entity_id,
   action, metadata_json, outcome)
SELECT
  u.tenant_id,
  u.id,
  u.role,
  'user',
  u.id,
  'admin.role_change',
  jsonb_build_object('reason', 'initial bootstrap', 'granted_role', u.role),
  'success'
FROM public.users u
WHERE lower(u.email) = lower('lucaimperio49@gmail.com');

COMMIT;

-- ----------------------------------------------------------------
-- 5) Verification — expect exactly ONE row
-- ----------------------------------------------------------------
SELECT
  u.id            AS user_id,
  u.email,
  u.role,
  u.status,
  t.slug          AS tenant_slug,
  t.status        AS tenant_status,
  p.specialty     AS professional_specialty
FROM public.users u
JOIN public.tenants       t ON t.id = u.tenant_id
LEFT JOIN public.professionals p ON p.user_id = u.id
WHERE lower(u.email) = lower('lucaimperio49@gmail.com');
