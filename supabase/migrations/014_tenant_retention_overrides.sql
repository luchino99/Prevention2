-- ============================================================
-- MIGRATION 014: TENANT-LEVEL RETENTION OVERRIDES (M-02)
-- ============================================================
--
-- Adds optional per-tenant retention windows on the `tenants` table so
-- a controller can shorten or lengthen the platform defaults. NULL on
-- a column means "use the platform default" — the application reads
-- COALESCE(tenant_value, platform_default) at every access site.
--
-- Why
-- ---
-- `21-PRIVACY-TECHNICAL.md §13` claimed these columns already existed.
-- They did not — the document was aspirational. This migration brings
-- the schema into line with the doc and unlocks the admin UI added by
-- Task #74 (M-02), where tenant_admin can edit the values directly.
--
-- Honoring the overrides
-- ----------------------
-- The cron-level retention worker (`fn_retention_prune` from 003) is
-- intentionally left platform-wide for now. A follow-up refactor
-- (Tier 4) will make it iterate per-tenant and use the values below.
-- Until that ships, the overrides are STORED but the cron applies
-- platform defaults. The risk register (M-02) and the UI both call
-- this out so admins are not misled.
--
-- Column semantics
-- ----------------
-- All columns are nullable INTEGER (days). Negative or zero values are
-- rejected by CHECK constraints. NULL means "platform default".
--
-- Idempotency / safety
-- --------------------
-- ADD COLUMN IF NOT EXISTS — safe to re-run.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Per-tenant retention columns
-- ============================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS retention_days_audit          INTEGER,
  ADD COLUMN IF NOT EXISTS retention_days_anonymize_grace INTEGER,
  ADD COLUMN IF NOT EXISTS retention_days_alerts_resolved INTEGER,
  ADD COLUMN IF NOT EXISTS retention_days_notifications  INTEGER;

-- ============================================================
-- 2. Reasonable bounds (CHECK)
-- ============================================================
-- Guards against typos / fat-finger edits in the admin UI. Bounds are
-- generous; controllers requiring tighter windows can negotiate with
-- the operator (typically through a future per-tenant DPA addendum).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_retention_days_audit_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_retention_days_audit_check
      CHECK (retention_days_audit IS NULL OR (retention_days_audit BETWEEN 30 AND 3650));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_retention_days_anonymize_grace_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_retention_days_anonymize_grace_check
      CHECK (retention_days_anonymize_grace IS NULL OR (retention_days_anonymize_grace BETWEEN 0 AND 365));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_retention_days_alerts_resolved_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_retention_days_alerts_resolved_check
      CHECK (retention_days_alerts_resolved IS NULL OR (retention_days_alerts_resolved BETWEEN 7 AND 1825));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_retention_days_notifications_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_retention_days_notifications_check
      CHECK (retention_days_notifications IS NULL OR (retention_days_notifications BETWEEN 7 AND 365));
  END IF;
END $$;

-- ============================================================
-- 3. Documentation
-- ============================================================

COMMENT ON COLUMN public.tenants.retention_days_audit IS
  'Per-tenant override for audit_events retention (days). NULL ⇒ platform default (~10y, see fn_retention_prune in migration 003). Range 30..3650.';
COMMENT ON COLUMN public.tenants.retention_days_anonymize_grace IS
  'Per-tenant grace period in days between soft-delete and anonymisation of a patient. NULL ⇒ platform default (30). Range 0..365.';
COMMENT ON COLUMN public.tenants.retention_days_alerts_resolved IS
  'Per-tenant retention of resolved alerts (days). NULL ⇒ platform default (~365). Range 7..1825.';
COMMENT ON COLUMN public.tenants.retention_days_notifications IS
  'Per-tenant retention of sent/failed notification rows (days). NULL ⇒ platform default (90). Range 7..365.';

-- ============================================================
-- 4. Migration audit row (canonical schema, see 010/011/012/013)
-- ============================================================
INSERT INTO audit_events (
  tenant_id, actor_user_id, action, entity_type, entity_id,
  metadata_json, ip_hash
) VALUES (
  NULL, NULL,
  'system.migration.applied',
  'migration', NULL,
  jsonb_build_object(
    'name', '014_tenant_retention_overrides',
    'migration_version', '014',
    'audit_findings', ARRAY['M-02-schema'],
    'columns_added', 4,
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
