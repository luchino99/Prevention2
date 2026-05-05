-- ============================================================
-- MIGRATION 016: AUDIT_EVENTS — BRIN INDEX ON created_at (Tier 4)
-- ============================================================
--
-- Why
-- ---
-- The retention cron (`fn_retention_prune`) performs a per-tenant
-- DELETE on `audit_events` whose `created_at < per_tenant_cutoff`.
-- audit_events is the largest write-mostly, append-only table on the
-- platform; on tenants with millions of rows the existing btree index
-- on (tenant_id, created_at) keeps the lookup fast but a BRIN index on
-- created_at alone is dramatically smaller (< 1 % of btree size on
-- append-only data) and is the right tool for range scans during
-- pruning. We add it as a defence-in-depth alongside the existing btree.
--
-- BRIN is ideal here because:
--   * audit_events is append-only (no UPDATEs to created_at)
--   * pruning is a range scan ("everything older than X")
--   * the table can grow into the millions for active tenants
--   * the index footprint is negligible vs btree
--
-- Partitioned-table cutover (deferred)
-- ------------------------------------
-- The fully partitioned variant of audit_events (PARTITION BY RANGE
-- (created_at) monthly) is documented in
-- `docs/26-DEPLOYMENT-RUNBOOK.md §AUDIT-PARTITIONING-SOP` as a
-- separate operational procedure to be executed when a tenant crosses
-- the 50M-row threshold. We deliberately do NOT switch the table
-- shape automatically: the cutover is non-trivial (rename + copy +
-- swap) and must be done on a maintenance window. This migration
-- ships the cheap, safe wins now and preserves the option for the
-- expensive one later.
--
-- Idempotency
-- -----------
-- IF NOT EXISTS guards on every CREATE INDEX. Safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- BRIN index on created_at for retention scans.
-- Default pages_per_range=128 is fine for our access pattern.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS audit_events_created_at_brin
  ON audit_events
  USING BRIN (created_at);

COMMENT ON INDEX audit_events_created_at_brin IS
  'BRIN range-scan accelerator for fn_retention_prune. Migration 016 (Tier 4). '
  'See docs/26-DEPLOYMENT-RUNBOOK.md AUDIT-PARTITIONING-SOP for the partitioned-table cutover plan.';

-- ------------------------------------------------------------
-- Helper: oldest safe cutoff for cross-tenant DROP PARTITION.
-- Returns the timestamp BEFORE which every tenant has agreed (via
-- their per-tenant retention window OR the platform default) that
-- the audit row is no longer needed. The partitioned-table SOP uses
-- this to decide which monthly partitions can be dropped without
-- violating any tenant's retention policy.
--
-- NULL means "no tenant exists" or "all tenants want to keep
-- everything forever" — in both cases the SOP must not drop.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_oldest_safe_cutoff()
RETURNS TIMESTAMPTZ AS $$
DECLARE
  c_default_audit CONSTANT INTEGER := 3650;
  v_max_days INTEGER;
BEGIN
  -- Pick the LONGEST retention window across all tenants (worst-case
  -- keep-everything tenant). We're conservative: only data older than
  -- THIS many days is safe to drop platform-wide.
  SELECT MAX(COALESCE(retention_days_audit, c_default_audit))
    INTO v_max_days
    FROM tenants;

  IF v_max_days IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN NOW() - (v_max_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION fn_audit_oldest_safe_cutoff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_audit_oldest_safe_cutoff() TO postgres;

COMMENT ON FUNCTION fn_audit_oldest_safe_cutoff() IS
  'Returns the oldest timestamp that is older than EVERY tenant''s '
  'audit retention window. Used by the partitioned-table cutover SOP to '
  'pick safe DROP PARTITION boundaries. Returns NULL when no tenants exist.';

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
    'name', '016_audit_events_brin_index',
    'migration_version', '016',
    'audit_findings', ARRAY['audit-retention-scaling'],
    'description', 'BRIN index on audit_events.created_at + fn_audit_oldest_safe_cutoff helper.',
    'partitioning_sop_ref', 'docs/26-DEPLOYMENT-RUNBOOK.md AUDIT-PARTITIONING-SOP',
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
