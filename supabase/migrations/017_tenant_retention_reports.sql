-- ============================================================
-- MIGRATION 017: TENANT-LEVEL RETENTION OVERRIDE FOR REPORT_EXPORTS (G-01 — Tier 5)
-- ============================================================
--
-- Closes audit AUD-2026-05-04 finding G-01: report_exports retention
-- was the only retention class still hard-coded platform-wide
-- (730 days) after migration 015 wired per-tenant overrides for the
-- other three classes (audit, alerts_resolved, notifications).
--
-- Adds:
--   * tenants.retention_days_reports (nullable INTEGER)
--   * fn_retention_prune updated to honour the new column via
--     COALESCE(tenant_value, platform_default)
--
-- Behaviour
-- ---------
-- NULL on the new column means "use the platform default" — same
-- semantics as the other three retention columns. Bound CHECK matches
-- typical document-retention windows (90 days … 10 years).
--
-- Idempotency
-- -----------
-- ADD COLUMN IF NOT EXISTS + DO blocks for the constraint.
-- CREATE OR REPLACE FUNCTION for the worker.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Per-tenant column
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS retention_days_reports INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_retention_days_reports_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_retention_days_reports_check
      CHECK (retention_days_reports IS NULL OR (retention_days_reports BETWEEN 90 AND 3650));
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.retention_days_reports IS
  'Per-tenant retention for report_exports storage objects (days). NULL ⇒ '
  'platform default (730d / 2y, see fn_retention_prune in migration 015). '
  'Range 90..3650. Once exceeded, fn_retention_prune nulls the storage_path '
  'and the next /api/v1/internal/retention cron sweeps the orphan blob.';

-- ============================================================
-- 2. Update fn_retention_prune to honour the new override
-- ============================================================
CREATE OR REPLACE FUNCTION fn_retention_prune()
RETURNS JSONB AS $$
DECLARE
  c_default_audit          CONSTANT INTEGER := 3650;
  c_default_alerts         CONSTANT INTEGER := 365;
  c_default_notifications  CONSTANT INTEGER := 90;
  c_default_reports        CONSTANT INTEGER := 730;

  v_audit_deleted    INTEGER := 0;
  v_audit_null_tenant INTEGER := 0;
  v_notif_deleted    INTEGER := 0;
  v_notif_null_tenant INTEGER := 0;
  v_alerts_deleted   INTEGER := 0;
  v_alerts_null_tenant INTEGER := 0;
  v_reports_expired  INTEGER := 0;
  v_reports_null_tenant INTEGER := 0;
  v_tenant_count     INTEGER := 0;
BEGIN
  CREATE TEMP TABLE _tenant_cutoffs ON COMMIT DROP AS
  SELECT
    t.id AS tenant_id,
    NOW() - (COALESCE(t.retention_days_audit,           c_default_audit)         || ' days')::INTERVAL AS audit_cutoff,
    NOW() - (COALESCE(t.retention_days_alerts_resolved, c_default_alerts)        || ' days')::INTERVAL AS alerts_cutoff,
    NOW() - (COALESCE(t.retention_days_notifications,   c_default_notifications) || ' days')::INTERVAL AS notif_cutoff,
    -- G-01 (Tier 5): per-tenant reports retention now honours
    -- tenants.retention_days_reports added by migration 017.
    NOW() - (COALESCE(t.retention_days_reports,         c_default_reports)       || ' days')::INTERVAL AS reports_cutoff
  FROM tenants t;

  SELECT COUNT(*) INTO v_tenant_count FROM _tenant_cutoffs;

  -- (1) audit_events
  WITH del AS (
    DELETE FROM audit_events ae
     USING _tenant_cutoffs c
     WHERE ae.tenant_id IS NOT NULL
       AND ae.tenant_id = c.tenant_id
       AND ae.created_at < c.audit_cutoff
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_deleted FROM del;

  WITH del AS (
    DELETE FROM audit_events
     WHERE tenant_id IS NULL
       AND created_at < NOW() - (c_default_audit || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_null_tenant FROM del;

  -- (2) notification_jobs
  WITH del AS (
    DELETE FROM notification_jobs nj
     USING _tenant_cutoffs c
     WHERE nj.tenant_id IS NOT NULL
       AND nj.tenant_id = c.tenant_id
       AND nj.created_at < c.notif_cutoff
       AND nj.status IN ('sent', 'failed')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_notif_deleted FROM del;

  WITH del AS (
    DELETE FROM notification_jobs
     WHERE tenant_id IS NULL
       AND created_at < NOW() - (c_default_notifications || ' days')::INTERVAL
       AND status IN ('sent', 'failed')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_notif_null_tenant FROM del;

  -- (3) alerts (resolved, beyond per-tenant window)
  WITH del AS (
    DELETE FROM alerts a
     USING _tenant_cutoffs c
     WHERE a.tenant_id IS NOT NULL
       AND a.tenant_id = c.tenant_id
       AND a.status = 'resolved'
       AND a.resolved_at IS NOT NULL
       AND a.resolved_at < c.alerts_cutoff
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_alerts_deleted FROM del;

  WITH del AS (
    DELETE FROM alerts
     WHERE tenant_id IS NULL
       AND status = 'resolved'
       AND resolved_at IS NOT NULL
       AND resolved_at < NOW() - (c_default_alerts || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_alerts_null_tenant FROM del;

  -- (4) report_exports — now per-tenant cutoff via _tenant_cutoffs.reports_cutoff
  WITH upd AS (
    UPDATE report_exports re
       SET storage_path = NULL
      FROM _tenant_cutoffs c
     WHERE re.tenant_id IS NOT NULL
       AND re.tenant_id = c.tenant_id
       AND re.created_at < c.reports_cutoff
       AND re.storage_path IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reports_expired FROM upd;

  WITH upd AS (
    UPDATE report_exports
       SET storage_path = NULL
     WHERE tenant_id IS NULL
       AND created_at < NOW() - (c_default_reports || ' days')::INTERVAL
       AND storage_path IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_reports_null_tenant FROM upd;

  RETURN jsonb_build_object(
    'audit_deleted',    v_audit_deleted    + v_audit_null_tenant,
    'notif_deleted',    v_notif_deleted    + v_notif_null_tenant,
    'alerts_deleted',   v_alerts_deleted   + v_alerts_null_tenant,
    'reports_expired',  v_reports_expired  + v_reports_null_tenant,
    'tenant_count',     v_tenant_count,
    'platform_defaults', jsonb_build_object(
      'audit_days',           c_default_audit,
      'alerts_resolved_days', c_default_alerts,
      'notifications_days',   c_default_notifications,
      'reports_days',         c_default_reports
    ),
    'breakdown', jsonb_build_object(
      'audit_per_tenant',    v_audit_deleted,
      'audit_null_tenant',   v_audit_null_tenant,
      'notif_per_tenant',    v_notif_deleted,
      'notif_null_tenant',   v_notif_null_tenant,
      'alerts_per_tenant',   v_alerts_deleted,
      'alerts_null_tenant',  v_alerts_null_tenant,
      'reports_per_tenant',  v_reports_expired,
      'reports_null_tenant', v_reports_null_tenant
    ),
    'run_at',           NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION fn_retention_prune() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_retention_prune() TO postgres;

COMMENT ON FUNCTION fn_retention_prune() IS
  'Retention cron worker. Per-tenant windows pulled from tenants.retention_days_* '
  'including reports (Tier 5 / migration 017). NULL ⇒ platform default. '
  'Returns a JSONB run report with totals + tenant breakdown.';

-- ============================================================
-- Migration audit row
-- ============================================================
INSERT INTO audit_events (
  tenant_id, actor_user_id, action, entity_type, entity_id,
  metadata_json, ip_hash
) VALUES (
  NULL, NULL,
  'system.migration.applied',
  'migration', NULL,
  jsonb_build_object(
    'name', '017_tenant_retention_reports',
    'migration_version', '017',
    'audit_findings', ARRAY['G-01'],
    'closes_caveat', 'G-01: report_exports retention now per-tenant',
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
