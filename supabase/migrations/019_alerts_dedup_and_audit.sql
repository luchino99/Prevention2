-- ============================================================================
-- Migration 019 — Alert engine: deduplication, audit symmetry, auto-close
-- ============================================================================
-- Sprint 4 task 4.2 — closes risk register entry F-014.
--
-- WHY ----------------------------------------------------------------------
--
-- Pre-019 every clinical assessment emitted the FULL alert set derived from
-- its scores and inserted them all unconditionally. A patient with persistent
-- FIB-4 ≥ 3.25 therefore got an "Advanced Liver Fibrosis" red-flag at every
-- assessment until the lab value dropped — flooding the alerts inbox with
-- copies of the same finding and eroding clinician attention. Migration 011
-- §9 had a defensive de-dupe in the deriver layer (same-batch dedup by
-- `type::title`) but NOTHING at the persistence layer. Across assessments
-- the inbox still drifted into noise.
--
-- WHAT (5 changes, all additive — zero impact on validated score logic) ----
--
-- 1. Add `dedup_key TEXT` to alerts (nullable for legacy rows). The deriver
--    (alert-deriver.ts) computes a deterministic key per finding signature
--    (e.g. `red_flag::advanced_liver_fibrosis`). Event-style alerts that
--    must always fire fresh (per-assessment risk transitions) keep
--    `dedup_key = NULL` and bypass the unique index.
--
-- 2. Add a partial UNIQUE INDEX on `(tenant_id, patient_id, dedup_key)`
--    WHERE `status IN ('open','acknowledged') AND dedup_key IS NOT NULL`.
--    This guarantees AT MOST ONE in-flight alert per finding signature per
--    patient — duplicates are handled by `INSERT … ON CONFLICT DO NOTHING`
--    in the atomic RPC below. Already-closed (resolved/dismissed) rows are
--    NOT covered by the index, so a finding can legitimately re-fire after
--    the previous one has been closed by the clinician.
--
-- 3. Add audit-symmetry columns: `dismissed_at`, `dismissed_by`,
--    `resolved_by`. The pre-019 schema only had `acknowledged_at`/
--    `acknowledged_by` + `resolved_at` — closing or dismissing an alert
--    left no provenance about WHO performed the action. Required for
--    NIS2 / IEC 62304 incident traceability and for the "explain the
--    inbox" GDPR Art.15 access flow.
--
-- 4. Patch `create_assessment_atomic` (canonical body from migration 013)
--    so the §9 alerts insert uses `ON CONFLICT (tenant_id, patient_id,
--    dedup_key) WHERE … DO NOTHING`. Behaviour for `dedup_key IS NULL`
--    rows is unchanged (always inserted — predicate excludes them).
--
-- 5. Create `fn_auto_close_stale_alerts(p_max_age_days INT DEFAULT 30)`,
--    a SECURITY DEFINER function that auto-resolves alerts which have
--    been `open` continuously for longer than the threshold. It writes
--    a structured marker into `metadata` so a downstream audit query can
--    distinguish auto-close from clinician-driven resolution. Idempotent
--    (re-running it is a no-op once stale rows are closed).
--
-- COMPATIBILITY ------------------------------------------------------------
--
-- * Existing rows: dedup_key is left NULL — they continue to behave as
--   before (no dedup). Only NEW rows written via the post-019 RPC get keys.
-- * The unique index is partial → it does NOT block historical data.
-- * resolved_by / dismissed_at / dismissed_by are nullable → any legacy
--   reader that did not project them keeps working.
-- * fn_auto_close_stale_alerts is opt-in (called by the cron handler).
--
-- ROLLBACK ----------------------------------------------------------------
--
-- Re-apply migration 013 (or its function definition) to revert the RPC,
-- then DROP INDEX idx_alerts_dedup_inflight, idx_alerts_open_age, and the
-- four added columns. No data loss because all changes are additive.
-- ============================================================================

BEGIN;

-- ── 1. Schema additions ─────────────────────────────────────────────────────

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolved_by  UUID REFERENCES users(id);

COMMENT ON COLUMN alerts.dedup_key IS
  'Deterministic finding signature (e.g. red_flag::advanced_liver_fibrosis). '
  'NULL for event-style alerts that must always fire fresh. Combined with '
  '(tenant_id, patient_id) it is unique while status IN (open, acknowledged) '
  'see idx_alerts_dedup_inflight.';

COMMENT ON COLUMN alerts.dismissed_at IS
  'Timestamp when an alert was DISMISSED (status=dismissed). NULL otherwise. '
  'Distinct from resolved_at which records clinically actioned closure.';

COMMENT ON COLUMN alerts.dismissed_by IS
  'User who dismissed the alert. Required by IEC 62304 §5.7 for change '
  'control on clinical-system state transitions.';

COMMENT ON COLUMN alerts.resolved_by IS
  'User who resolved the alert. Symmetric to acknowledged_by — pre-019 the '
  'schema asymmetrically tracked who acked but not who resolved.';

-- ── 2. Partial unique index for in-flight dedup ────────────────────────────
--
-- CONCURRENTLY is omitted because we are inside a transaction and the alerts
-- table is small in early production.

DROP INDEX IF EXISTS idx_alerts_dedup_inflight;

CREATE UNIQUE INDEX idx_alerts_dedup_inflight
  ON alerts (tenant_id, patient_id, dedup_key)
  WHERE dedup_key IS NOT NULL
    AND status IN ('open', 'acknowledged');

COMMENT ON INDEX idx_alerts_dedup_inflight IS
  'In-flight dedup: at most one open or acknowledged alert per (tenant, '
  'patient, dedup_key). Resolved/dismissed rows fall outside the predicate '
  'so a previously closed finding can re-fire on the next assessment.';

-- Helper index for the auto-close cron: scans open alerts older than N days.
DROP INDEX IF EXISTS idx_alerts_open_age;
CREATE INDEX idx_alerts_open_age
  ON alerts (created_at)
  WHERE status = 'open';

COMMENT ON INDEX idx_alerts_open_age IS
  'Used by fn_auto_close_stale_alerts() to scan open alerts by age. Partial '
  'so only the active inbox is indexed.';

-- ── 3. create_assessment_atomic — dedup-aware §9 alerts insert ─────────────
--
-- This re-defines the function with migration 013's canonical body verbatim,
-- patching ONLY the §9 alerts INSERT. Every other branch (assessments
-- header, measurements, score_results, risk_profiles, lifestyle snapshots,
-- followup_plans, due_items) is preserved EXACTLY to avoid regressions
-- in clinical write paths.

CREATE OR REPLACE FUNCTION create_assessment_atomic(payload JSONB)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id   UUID := _ca_uuid(payload, 'tenant_id');
  v_patient_id  UUID := _ca_uuid(payload, 'patient_id');
  v_assessed_by UUID := _ca_uuid(payload, 'assessed_by');
  v_engine_ver  TEXT := COALESCE(payload ->> 'engine_version', '1.0.0');
  v_snapshot    JSONB := payload -> 'clinical_input_snapshot';

  v_measurements  JSONB := payload -> 'measurements';
  v_risk_profile  JSONB := payload -> 'risk_profile';
  v_nutrition     JSONB := payload -> 'nutrition_snapshot';
  v_activity      JSONB := payload -> 'activity_snapshot';
  v_followup      JSONB := payload -> 'followup_plan';

  v_score_rows   JSONB := COALESCE(payload -> 'score_results', '[]'::jsonb);
  v_due_rows     JSONB := COALESCE(payload -> 'due_items',     '[]'::jsonb);
  v_alert_rows   JSONB := COALESCE(payload -> 'alerts',        '[]'::jsonb);
  v_due_codes    TEXT[];

  v_assessment_id  UUID;
  v_created_at     TIMESTAMPTZ;
  v_status         TEXT;
BEGIN
  -- ── Validate payload ──────────────────────────────────────────────
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'create_assessment_atomic: tenant_id required'
      USING ERRCODE = '22023';
  END IF;
  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'create_assessment_atomic: patient_id required'
      USING ERRCODE = '22023';
  END IF;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'create_assessment_atomic: clinical_input_snapshot required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM patients
    WHERE id = v_patient_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_assessment_atomic: patient % not in tenant %',
      v_patient_id, v_tenant_id
      USING ERRCODE = '23503';
  END IF;

  -- ── 1. assessments header (unchanged) ────────────────────────────
  INSERT INTO assessments (
    tenant_id,
    patient_id,
    assessed_by,
    status,
    completed_at,
    engine_version,
    clinical_input_snapshot
  )
  VALUES (
    v_tenant_id,
    v_patient_id,
    v_assessed_by,
    'completed'::assessment_status,
    NOW(),
    v_engine_ver,
    v_snapshot
  )
  RETURNING id, created_at, status::text
    INTO v_assessment_id, v_created_at, v_status;

  -- ── 2. assessment_measurements (unchanged) ───────────────────────
  IF v_measurements IS NOT NULL THEN
    INSERT INTO assessment_measurements
      SELECT * FROM jsonb_populate_record(
        NULL::assessment_measurements,
        jsonb_build_object(
          'id', uuid_generate_v4(),
          'created_at', NOW()
        )
        || v_measurements
        || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 3. score_results (unchanged) ─────────────────────────────────
  IF jsonb_typeof(v_score_rows) = 'array' AND jsonb_array_length(v_score_rows) > 0 THEN
    INSERT INTO score_results
      SELECT * FROM jsonb_populate_recordset(
        NULL::score_results,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', uuid_generate_v4(),
              'engine_version', '1.0.0',
              'created_at', NOW()
            )
            || elem
            || jsonb_build_object('assessment_id', v_assessment_id)
          )
          FROM jsonb_array_elements(v_score_rows) AS elem
        )
      );
  END IF;

  -- ── 4. risk_profiles (unchanged) ─────────────────────────────────
  IF v_risk_profile IS NOT NULL THEN
    INSERT INTO risk_profiles
      SELECT * FROM jsonb_populate_record(
        NULL::risk_profiles,
        jsonb_build_object(
          'id', uuid_generate_v4(),
          'created_at', NOW()
        )
        || v_risk_profile
        || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 5. nutrition_snapshots (unchanged) ───────────────────────────
  IF v_nutrition IS NOT NULL THEN
    INSERT INTO nutrition_snapshots
      SELECT * FROM jsonb_populate_record(
        NULL::nutrition_snapshots,
        jsonb_build_object(
          'id', uuid_generate_v4(),
          'created_at', NOW()
        )
        || v_nutrition
        || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 6. activity_snapshots (unchanged) ────────────────────────────
  IF v_activity IS NOT NULL THEN
    INSERT INTO activity_snapshots
      SELECT * FROM jsonb_populate_record(
        NULL::activity_snapshots,
        jsonb_build_object(
          'id', uuid_generate_v4(),
          'created_at', NOW()
        )
        || v_activity
        || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 7. followup_plans (unchanged) ────────────────────────────────
  IF v_followup IS NOT NULL THEN
    INSERT INTO followup_plans
      SELECT * FROM jsonb_populate_record(
        NULL::followup_plans,
        jsonb_build_object(
          'id', uuid_generate_v4(),
          'is_active', TRUE,
          'created_at', NOW(),
          'updated_at', NOW()
        )
        || v_followup
        || jsonb_build_object(
          'patient_id',    v_patient_id,
          'assessment_id', v_assessment_id
        )
      );
  END IF;

  -- ── 8. due_items: DELETE + INSERT atomic block (unchanged) ───────
  IF jsonb_typeof(v_due_rows) = 'array' AND jsonb_array_length(v_due_rows) > 0 THEN
    SELECT ARRAY(
      SELECT DISTINCT (elem ->> 'item_code')
      FROM jsonb_array_elements(v_due_rows) AS elem
      WHERE (elem ->> 'source_engine') IN ('followup', 'screening')
    )
    INTO v_due_codes;

    IF v_due_codes IS NOT NULL AND array_length(v_due_codes, 1) > 0 THEN
      DELETE FROM due_items
       WHERE patient_id = v_patient_id
         AND source_engine IN ('followup', 'screening')
         AND status IN ('open', 'acknowledged')
         AND item_code = ANY(v_due_codes);
    END IF;

    INSERT INTO due_items
      SELECT * FROM jsonb_populate_recordset(
        NULL::due_items,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', uuid_generate_v4(),
              'status', 'open',
              'created_at', NOW(),
              'updated_at', NOW()
            )
            || elem
            || jsonb_build_object(
              'tenant_id',     v_tenant_id,
              'patient_id',    v_patient_id,
              'assessment_id', v_assessment_id
            )
          )
          FROM jsonb_array_elements(v_due_rows) AS elem
        )
      );
  END IF;

  -- ── 9. alerts — DEDUP-AWARE INSERT (migration 019 patch) ─────────
  --
  -- Pre-019 this was a plain `INSERT … FROM jsonb_populate_recordset`.
  -- The new partial unique index `idx_alerts_dedup_inflight` covers the
  -- (tenant, patient, dedup_key) triple while status ∈ (open, acked) AND
  -- dedup_key IS NOT NULL. We therefore add `ON CONFLICT … DO NOTHING`
  -- so the persistence layer silently absorbs duplicate findings. Rows
  -- whose `dedup_key` is NULL fall outside the index predicate and are
  -- inserted unconditionally — preserving the pre-019 behaviour for
  -- event-style alerts (e.g. clinical_risk_up).
  --
  -- Defaults injected (verbatim from 013): id, severity='info',
  -- status='open', audience='clinician', created_at. Forced FKs:
  -- tenant_id, patient_id, assessment_id. (type and title are NOT NULL
  -- with no default — caller must supply.)
  IF jsonb_typeof(v_alert_rows) = 'array' AND jsonb_array_length(v_alert_rows) > 0 THEN
    INSERT INTO alerts
      SELECT * FROM jsonb_populate_recordset(
        NULL::alerts,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', uuid_generate_v4(),
              'severity', 'info',
              'status', 'open',
              'audience', 'clinician',
              'created_at', NOW()
            )
            || elem
            || jsonb_build_object(
              'tenant_id',     v_tenant_id,
              'patient_id',    v_patient_id,
              'assessment_id', v_assessment_id
            )
          )
          FROM jsonb_array_elements(v_alert_rows) AS elem
        )
      )
      ON CONFLICT (tenant_id, patient_id, dedup_key)
      WHERE dedup_key IS NOT NULL
        AND status IN ('open', 'acknowledged')
      DO NOTHING;
  END IF;

  -- ── 10. Return result envelope ───────────────────────────────────
  RETURN jsonb_build_object(
    'assessment_id', v_assessment_id,
    'created_at',    v_created_at,
    'status',        v_status
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION USING
      MESSAGE = 'create_assessment_atomic failed: ' || SQLERRM,
      ERRCODE = SQLSTATE;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION create_assessment_atomic(JSONB) IS
  'Atomic assessment write — see migrations 011 (B-03 atomicity), 013 '
  '(DEFAULT-bypass fix), and 019 (alerts dedup). Persists assessments + '
  '8 child tables in a single transaction. Caller (assessment-service.'
  'createAssessment) is responsible for computing each alert.dedup_key '
  '— see alert-deriver.ts.';

-- ── 4. Stale-alert auto-close ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_auto_close_stale_alerts(
  p_max_age_days INTEGER DEFAULT 30
) RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_cutoff        TIMESTAMPTZ;
  v_closed_count  INTEGER;
BEGIN
  IF p_max_age_days IS NULL OR p_max_age_days < 1 THEN
    RAISE EXCEPTION 'fn_auto_close_stale_alerts: p_max_age_days must be ≥ 1'
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := v_now - (p_max_age_days::TEXT || ' days')::INTERVAL;

  -- Auto-close strategy:
  --   * Only `status = 'open'` rows are touched. We deliberately do NOT
  --     auto-close `acknowledged` alerts: a clinician has already seen
  --     them and is presumed to be triaging on a longer cadence.
  --   * Closure is recorded as `status = 'resolved'` with an explicit
  --     `metadata.auto_closed = true` marker. We do NOT use the
  --     `dismissed` status because auto-close is not a clinician judgement
  --     ("not relevant"); it is a system-level housekeeping decision.
  --   * `resolved_by` is left NULL — there is no human actor to credit.
  --   * `acknowledged_at` / `acknowledged_by` are populated as a fallback
  --     so timeline queries that join on those columns don't show a gap.
  WITH stale AS (
    SELECT id
    FROM alerts
    WHERE status = 'open'
      AND created_at < v_cutoff
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE alerts a
    SET
      status        = 'resolved',
      resolved_at   = v_now,
      acknowledged_at = COALESCE(a.acknowledged_at, v_now),
      metadata      = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'auto_closed', true,
        'auto_closed_reason', 'stale_open_>' || p_max_age_days::TEXT || 'd',
        'auto_closed_at', v_now
      )
    FROM stale s
    WHERE a.id = s.id
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_closed_count FROM upd;

  RETURN jsonb_build_object(
    'closed_count',     v_closed_count,
    'cutoff_at',        v_cutoff,
    'max_age_days',     p_max_age_days,
    'finished_at',      NOW()
  );
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION fn_auto_close_stale_alerts(INTEGER) IS
  'Cron-driven stale-alert cleanup. Closes rows with status=open older '
  'than p_max_age_days as resolved with metadata.auto_closed=true. Idempotent.';

-- ── 5. Migration audit row ─────────────────────────────────────────────────

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
    'name', '019_alerts_dedup_and_audit',
    'migration_version', '019',
    'sprint', '4',
    'task', '4.2',
    'closes', ARRAY['F-014'],
    'changes', jsonb_build_object(
      'columns_added', ARRAY['dedup_key', 'dismissed_at', 'dismissed_by', 'resolved_by'],
      'indexes_added', ARRAY['idx_alerts_dedup_inflight', 'idx_alerts_open_age'],
      'functions_added', ARRAY['fn_auto_close_stale_alerts'],
      'functions_replaced', ARRAY['create_assessment_atomic']
    ),
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;

-- ============================================================================
-- POST-MIGRATION CHECKS (manual)
-- ============================================================================
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='alerts' AND column_name IN
--      ('dedup_key','dismissed_at','dismissed_by','resolved_by');
--
--   SELECT indexname FROM pg_indexes WHERE tablename='alerts';
--
--   SELECT proname  FROM pg_proc WHERE proname='fn_auto_close_stale_alerts';
--
--   -- Smoke test the auto-close (non-destructive on empty inbox):
--   SELECT fn_auto_close_stale_alerts(30);
-- ============================================================================
