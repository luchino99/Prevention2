-- ============================================================
-- MIGRATION 018: AUDIT EVENTS RETENTION PER CATEGORY (Sprint 3 task 3.3)
-- ============================================================
--
-- Closes external-audit finding F-012 (audit_events default retention
-- 3650d uniform may be over-retention for low-value categories) and
-- aligns with GDPR Art.5(1)(e) storage-limitation principle.
--
-- Context
-- -------
-- Migration 015 set a uniform 3650-day (10-year) retention for ALL
-- audit_events, with per-tenant override via tenants.retention_days_audit.
-- This is correct for clinical / consent / DSR / system events where
-- Italian medical-deontological law (cartella clinica ≥10 years) and
-- GDPR Art.30 records-of-processing both demand long retention.
--
-- However it is over-retention for `auth.*` events (login, logout,
-- failed_login). Those are security observability artifacts; the
-- regulatory benchmark is ~6 months (NIS2 Annex II §4 + ISO 27001
-- A.8.15 + most national CERT guidance). Storing 10 years of every
-- login is unjustified under Art.5(1)(e) and inflates audit_events
-- volume disproportionately to its forensic value.
--
-- What this migration does
-- ------------------------
-- Splits the audit_events retention into 2 categories inside
-- fn_retention_prune (no schema change, no data backfill):
--
--   Category         Action pattern        Default retention
--   ----------------------------------------------------------
--   security         action LIKE 'auth.%'  180 days
--   default (all     other                  3650 days (unchanged)
--   non-security)
--
-- Per-tenant override semantics
-- -----------------------------
--   * tenants.retention_days_audit (existing) continues to apply to
--     the DEFAULT category as before.
--   * For the SECURITY category, the effective retention is
--     LEAST(tenants.retention_days_audit, c_default_audit_security).
--     Rationale: an operator who tightens the audit window globally
--     (e.g. controller demands 6-month uniform retention) ALREADY
--     accepts a tighter security window. They do NOT want their tighter
--     setting to be widened by the default-180 floor.
--   * This avoids introducing a new tenants column today. If a future
--     controller asks for security-specific overrides, add
--     tenants.retention_days_audit_security in a follow-up migration.
--
-- Output shape (JSONB)
-- --------------------
-- Backwards compatible. `audit_deleted` continues to be the GRAND TOTAL
-- across categories. New `audit_security_*` keys are added under
-- `breakdown` so observability dashboards can disaggregate.
--
-- Idempotency
-- -----------
-- CREATE OR REPLACE FUNCTION — safe to re-run. No schema change.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_retention_prune()
RETURNS JSONB AS $$
DECLARE
  -- Platform defaults (days). NULL on tenants.* means "use these".
  c_default_audit          CONSTANT INTEGER := 3650;  -- 10y, medical-legal default
  c_default_audit_security CONSTANT INTEGER := 180;   -- 6m, security observability
  c_default_alerts         CONSTANT INTEGER := 365;   -- 1y after resolved
  c_default_notifications  CONSTANT INTEGER := 90;    -- 90d sent/failed
  c_default_reports        CONSTANT INTEGER := 730;   -- 2y, storage object retention

  v_audit_deleted          INTEGER := 0;
  v_audit_security_deleted INTEGER := 0;
  v_audit_null_tenant      INTEGER := 0;
  v_audit_security_null    INTEGER := 0;
  v_notif_deleted          INTEGER := 0;
  v_notif_null_tenant      INTEGER := 0;
  v_alerts_deleted         INTEGER := 0;
  v_alerts_null_tenant     INTEGER := 0;
  v_reports_expired        INTEGER := 0;
  v_reports_null_tenant    INTEGER := 0;
  v_tenant_count           INTEGER := 0;
BEGIN
  -- Snapshot per-tenant cutoffs into a temp table so each pruning
  -- statement uses the SAME cutoff (NOW() drift inside one transaction
  -- is bounded but we want byte-equivalence across the DELETEs for the
  -- run report). Dropped at COMMIT.
  CREATE TEMP TABLE _tenant_cutoffs ON COMMIT DROP AS
  SELECT
    t.id AS tenant_id,
    NOW() - (COALESCE(t.retention_days_audit, c_default_audit) || ' days')::INTERVAL AS audit_cutoff,
    -- SECURITY cutoff: take the tighter of (tenant override, security default).
    -- An operator who tightens the global audit window already accepts
    -- a tighter security window — we don't widen it.
    NOW() - (LEAST(
      COALESCE(t.retention_days_audit, c_default_audit),
      c_default_audit_security
    ) || ' days')::INTERVAL AS audit_security_cutoff,
    NOW() - (COALESCE(t.retention_days_alerts_resolved, c_default_alerts) || ' days')::INTERVAL AS alerts_cutoff,
    NOW() - (COALESCE(t.retention_days_notifications, c_default_notifications) || ' days')::INTERVAL AS notif_cutoff,
    NOW() - (c_default_reports || ' days')::INTERVAL AS reports_cutoff
  FROM tenants t;

  SELECT COUNT(*) INTO v_tenant_count FROM _tenant_cutoffs;

  -- ----------------------------------------------------------------
  -- (1a) audit_events — DEFAULT category (everything except auth.*)
  -- ----------------------------------------------------------------
  WITH del AS (
    DELETE FROM audit_events ae
     USING _tenant_cutoffs c
     WHERE ae.tenant_id IS NOT NULL
       AND ae.tenant_id = c.tenant_id
       AND ae.created_at < c.audit_cutoff
       AND (ae.action IS NULL OR ae.action NOT LIKE 'auth.%')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_deleted FROM del;

  -- (1b) audit_events — SECURITY category (auth.*)
  WITH del AS (
    DELETE FROM audit_events ae
     USING _tenant_cutoffs c
     WHERE ae.tenant_id IS NOT NULL
       AND ae.tenant_id = c.tenant_id
       AND ae.created_at < c.audit_security_cutoff
       AND ae.action LIKE 'auth.%'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_security_deleted FROM del;

  -- (1c) audit_events with NULL tenant_id — DEFAULT category.
  -- These are migration audit rows + some cron events; they never have
  -- a tenant override so use the platform default directly.
  WITH del AS (
    DELETE FROM audit_events
     WHERE tenant_id IS NULL
       AND created_at < NOW() - (c_default_audit || ' days')::INTERVAL
       AND (action IS NULL OR action NOT LIKE 'auth.%')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_null_tenant FROM del;

  -- (1d) audit_events NULL tenant — SECURITY category.
  WITH del AS (
    DELETE FROM audit_events
     WHERE tenant_id IS NULL
       AND created_at < NOW() - (c_default_audit_security || ' days')::INTERVAL
       AND action LIKE 'auth.%'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_security_null FROM del;

  -- ----------------------------------------------------------------
  -- (2) notification_jobs — unchanged from migration 015
  -- ----------------------------------------------------------------
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
  -- (3) alerts (resolved, beyond per-tenant window) — unchanged
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
  -- (4) report_exports — unchanged
  -- ----------------------------------------------------------------
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
  -- Run report (backwards-compatible shape + new security breakdown)
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    -- TOP-LEVEL TOTALS (unchanged keys for downstream compatibility)
    'audit_deleted',    v_audit_deleted    + v_audit_security_deleted
                      + v_audit_null_tenant + v_audit_security_null,
    'notif_deleted',    v_notif_deleted    + v_notif_null_tenant,
    'alerts_deleted',   v_alerts_deleted   + v_alerts_null_tenant,
    'reports_expired',  v_reports_expired  + v_reports_null_tenant,
    'tenant_count',     v_tenant_count,

    -- PLATFORM DEFAULTS (extended with security default)
    'platform_defaults', jsonb_build_object(
      'audit_days',          c_default_audit,
      'audit_security_days', c_default_audit_security,  -- NEW
      'alerts_resolved_days', c_default_alerts,
      'notifications_days',   c_default_notifications,
      'reports_days',         c_default_reports
    ),

    -- BREAKDOWN (extended with audit security counts)
    'breakdown', jsonb_build_object(
      'audit_default_per_tenant',    v_audit_deleted,           -- renamed from audit_per_tenant
      'audit_default_null_tenant',   v_audit_null_tenant,
      'audit_security_per_tenant',   v_audit_security_deleted,  -- NEW
      'audit_security_null_tenant',  v_audit_security_null,     -- NEW
      'notif_per_tenant',            v_notif_deleted,
      'notif_null_tenant',           v_notif_null_tenant,
      'alerts_per_tenant',           v_alerts_deleted,
      'alerts_null_tenant',          v_alerts_null_tenant,
      'reports_per_tenant',          v_reports_expired,
      'reports_null_tenant',         v_reports_null_tenant
    ),
    'run_at',           NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION fn_retention_prune() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_retention_prune() TO postgres;

COMMENT ON FUNCTION fn_retention_prune() IS
  'Retention cron worker (mig 018, Sprint 3 task 3.3). Per-category retention: '
  'auth.* events 180d (security), all other events 3650d (default). Per-tenant '
  'overrides via tenants.retention_days_audit apply to the DEFAULT category and '
  'tighten (never widen) the security category via LEAST(). Returns JSONB run '
  'report with totals + extended breakdown. Idempotent.';

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
    'name', '018_audit_retention_per_category',
    'migration_version', '018',
    'audit_findings', ARRAY['F-012-storage-limitation'],
    'closes', 'GDPR Art.5(1)(e) over-retention of auth.* events',
    'auth_retention_days_old', 3650,
    'auth_retention_days_new', 180,
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
