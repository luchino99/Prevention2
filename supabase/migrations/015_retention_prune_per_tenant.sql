-- ============================================================
-- MIGRATION 015: PER-TENANT RETENTION PRUNE (M-02 Tier 4)
-- ============================================================
--
-- Closes the M-02 caveat introduced by 014: the per-tenant retention
-- columns on `tenants` (added by 014) are now READ by the cron worker
-- `fn_retention_prune` instead of being shadowed by hardcoded
-- platform-wide constants.
--
-- Behaviour
-- ---------
--   * For each row in audit_events / alerts / notification_jobs / report_exports
--     the retention window is COALESCE(tenant_value, platform_default).
--   * Rows whose tenant_id IS NULL (system rows: migration audit, cron
--     audit) use the platform default unchanged.
--   * The function preserves the original signature (no parameters,
--     RETURNS JSONB) so the existing cron handler at
--     /api/v1/internal/retention.ts keeps working without changes.
--
-- Output shape (JSONB)
-- --------------------
--   {
--     "audit_deleted":   <total>,
--     "notif_deleted":   <total>,
--     "alerts_deleted":  <total>,
--     "reports_expired": <total>,
--     "tenant_count":    <tenants iterated, including the NULL bucket>,
--     "platform_defaults": { audit, alerts_resolved, notifications, reports },
--     "run_at":          NOW()
--   }
--
-- Performance
-- -----------
-- Each table is pruned with a single set-based DELETE that joins
-- against `tenants` via a tenant_id-keyed CTE. There is no per-tenant
-- loop in plpgsql, so the cost is one index scan per table regardless
-- of tenant count. The existing index on audit_events(tenant_id,
-- created_at) and alerts(tenant_id, status, resolved_at) keeps this
-- O(rows-deleted) instead of O(rows-total).
--
-- Idempotency
-- -----------
-- CREATE OR REPLACE FUNCTION — safe to re-run.
-- The migration does not alter the schema; it only swaps the function body.
-- ============================================================

BEGIN;

-- ============================================================
-- Platform defaults (single source of truth)
-- ============================================================
--
-- These mirror the legal/operational windows from blueprint §11.4 and
-- replace the hardcoded INTERVAL literals in the previous body. They
-- are intentionally also documented in `21-PRIVACY-TECHNICAL.md §13`
-- and surfaced to tenant_admins via the GET /api/v1/admin/tenant
-- endpoint (the UI shows them as the "Platform default" column when
-- the tenant override is NULL).

CREATE OR REPLACE FUNCTION fn_retention_prune()
RETURNS JSONB AS $$
DECLARE
  -- Platform defaults (days). NULL on tenants.* means "use these".
  c_default_audit          CONSTANT INTEGER := 3650;  -- 10y, medical-legal
  c_default_alerts         CONSTANT INTEGER := 365;   -- 1y after resolved
  c_default_notifications  CONSTANT INTEGER := 90;    -- 90d sent/failed
  c_default_reports        CONSTANT INTEGER := 730;   -- 2y, storage object retention

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
  -- Snapshot the per-tenant cutoffs into a temp table so each pruning
  -- statement uses the SAME cutoff (NOW() drift inside one
  -- transaction is bounded but we want byte-equivalence across the 4
  -- DELETEs for the run report). The temp table is dropped at COMMIT.
  CREATE TEMP TABLE _tenant_cutoffs ON COMMIT DROP AS
  SELECT
    t.id AS tenant_id,
    NOW() - (COALESCE(t.retention_days_audit,          c_default_audit)         || ' days')::INTERVAL AS audit_cutoff,
    NOW() - (COALESCE(t.retention_days_alerts_resolved, c_default_alerts)       || ' days')::INTERVAL AS alerts_cutoff,
    NOW() - (COALESCE(t.retention_days_notifications,   c_default_notifications) || ' days')::INTERVAL AS notif_cutoff,
    -- report_exports retention is fixed at platform-default for now
    -- (no per-tenant override column yet; tracked as a future
    -- extension if a controller asks for it).
    NOW() - (c_default_reports || ' days')::INTERVAL AS reports_cutoff
  FROM tenants t;

  SELECT COUNT(*) INTO v_tenant_count FROM _tenant_cutoffs;

  -- ----------------------------------------------------------------
  -- (1) audit_events
  -- ----------------------------------------------------------------
  WITH del AS (
    DELETE FROM audit_events ae
     USING _tenant_cutoffs c
     WHERE ae.tenant_id IS NOT NULL
       AND ae.tenant_id = c.tenant_id
       AND ae.created_at < c.audit_cutoff
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_deleted FROM del;

  -- audit_events with NULL tenant_id (migration audit, system cron) →
  -- platform default. These never have a tenant override by design.
  WITH del AS (
    DELETE FROM audit_events
     WHERE tenant_id IS NULL
       AND created_at < NOW() - (c_default_audit || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_null_tenant FROM del;

  -- ----------------------------------------------------------------
  -- (2) notification_jobs
  -- ----------------------------------------------------------------
  -- Only sent / failed rows are eligible — a stuck queued row should
  -- be investigated, not silently dropped by the prune cron.
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

  -- ----------------------------------------------------------------
  -- (3) alerts (resolved, beyond per-tenant window)
  -- ----------------------------------------------------------------
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

  -- ----------------------------------------------------------------
  -- (4) report_exports — mark storage_path NULL after expiry
  -- ----------------------------------------------------------------
  -- We keep the row for clinical-trail traceability but the storage
  -- object is reaped by the backend cron (api/v1/internal/retention.ts)
  -- that calls Supabase Storage Admin to remove the file. Setting
  -- storage_path to NULL is the signal to the worker.
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

  -- ----------------------------------------------------------------
  -- Run report
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    'audit_deleted',    v_audit_deleted    + v_audit_null_tenant,
    'notif_deleted',    v_notif_deleted    + v_notif_null_tenant,
    'alerts_deleted',   v_alerts_deleted   + v_alerts_null_tenant,
    'reports_expired',  v_reports_expired  + v_reports_null_tenant,
    'tenant_count',     v_tenant_count,
    'platform_defaults', jsonb_build_object(
      'audit_days',          c_default_audit,
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
  '(NULL ⇒ platform default). Returns a JSONB run report with totals and a '
  'tenant breakdown. Safe to re-run; idempotent. See migration 015 (M-02 Tier 4).';

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
    'name', '015_retention_prune_per_tenant',
    'migration_version', '015',
    'audit_findings', ARRAY['M-02-cron'],
    'closes_caveat', 'M-02 (Tier 4) — fn_retention_prune now reads tenants.retention_days_*',
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
