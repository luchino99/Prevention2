-- ============================================================
-- MIGRAZIONE 011: ATOMIC create_assessment (B-03)
-- ============================================================
--
-- Audit finding addressed
-- -----------------------
-- B-03  ASSESSMENT WRITE PIPELINE IS NOT ATOMIC
--       `assessment-service.createAssessment` performs 9 sequential
--       INSERT statements after the parent assessment row is committed.
--       Each child INSERT is wrapped in a `bestEffort(...)` helper that
--       SWALLOWS errors and logs them to the server console. If any
--       step fails (RLS denial, FK breakage, transient connectivity)
--       the database is left in a partially-populated state:
--
--         assessments               → present
--         assessment_measurements   → present
--         score_results             → MAYBE
--         risk_profiles             → MAYBE
--         nutrition_snapshots       → MAYBE
--         activity_snapshots        → MAYBE
--         followup_plans            → MAYBE
--         due_items                 → MAYBE
--         alerts                    → MAYBE
--
--       The patient detail page then renders an assessment with missing
--       composite risk, no alerts, no follow-up — a clinically
--       misleading state. Worse, downstream PDF generation reads
--       whichever subset survived, producing a report that disagrees
--       with the engine output the clinician saw.
--
-- Fix
-- ---
-- Move the entire 9-write block into a single PL/pgSQL function that
-- runs as one transaction. Either every row lands or none of them do.
-- The TS layer becomes a thin caller that:
--   1. runs the deterministic engine
--   2. assembles a single JSON payload
--   3. calls `create_assessment_atomic(payload)` once
--   4. on success → builds the in-memory AssessmentSnapshot
--   5. on failure → returns AssessmentServiceError (no partial state)
--
-- Audit logging stays in the TS layer because it is a separate
-- observability concern and intentionally a best-effort write — losing
-- an audit row should not block the clinical flow (the assessment
-- itself is fully recorded by then).
--
-- Idempotency / rollback
-- ----------------------
-- This migration only adds a new function. It does NOT modify the
-- existing TS write path; the application keeps the old `bestEffort`
-- writes in 011→012 transition until the TS refactor lands. Dropping
-- the function (or re-running this migration) is safe.
--
-- Determinism
-- -----------
-- The function does NOT recompute any clinical score. It only
-- persists the engine outputs supplied by the caller. The clinical
-- engine remains the single source of truth for score values; the SQL
-- never inspects them.
--
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Helper: extract a strongly-typed UUID from JSONB or NULL
-- ============================================================
-- Marked IMMUTABLE so the planner can treat it as a constant for the
-- duration of a row evaluation. Returns NULL for missing keys.

CREATE OR REPLACE FUNCTION _ca_uuid(payload JSONB, key TEXT)
RETURNS UUID AS $$
DECLARE
  raw TEXT;
BEGIN
  raw := payload ->> key;
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::UUID;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 2. create_assessment_atomic(payload jsonb)
-- ============================================================
-- Returns: jsonb { assessment_id, created_at, status }
--
-- Payload contract (validated below; failures abort the transaction):
--
--   {
--     "tenant_id":               UUID,
--     "patient_id":              UUID,
--     "assessed_by":             UUID | NULL,        -- nullable for service writes
--     "engine_version":          TEXT,
--     "clinical_input_snapshot": JSONB,              -- canonical snapshot
--     "measurements":            JSONB | NULL,       -- assessment_measurements row
--     "score_results":           JSONB[],            -- score_results rows (no FK cols)
--     "risk_profile":            JSONB | NULL,       -- risk_profiles row (no FK cols)
--     "nutrition_snapshot":      JSONB | NULL,       -- nutrition_snapshots row (no FK cols)
--     "activity_snapshot":       JSONB | NULL,       -- activity_snapshots row (no FK cols)
--     "followup_plan":           JSONB | NULL,       -- followup_plans row (no FK cols)
--     "due_items":               JSONB[],            -- due_items rows (no FK cols)
--     "alerts":                  JSONB[]             -- alerts rows (no FK cols)
--   }
--
-- Each child JSONB carries its OWN non-FK columns. The function injects
-- assessment_id/patient_id/tenant_id where appropriate, so the TS caller
-- does NOT need to know the new assessment_id before the RPC. This keeps
-- the TS layer authoritative on engine output shape, while the SQL
-- layer owns the foreign-key wiring and the transactional boundary.

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
      USING ERRCODE = '22023';   -- invalid_parameter_value
  END IF;
  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'create_assessment_atomic: patient_id required'
      USING ERRCODE = '22023';
  END IF;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'create_assessment_atomic: clinical_input_snapshot required'
      USING ERRCODE = '22023';
  END IF;

  -- Cross-check that the patient really belongs to the supplied tenant.
  -- This is defensive: the TS layer already calls assertCanWritePatient()
  -- but we want a single transactional invariant at the DB layer too.
  PERFORM 1
    FROM patients
    WHERE id = v_patient_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_assessment_atomic: patient % not in tenant %',
      v_patient_id, v_tenant_id
      USING ERRCODE = '23503';   -- foreign_key_violation
  END IF;

  -- ── 1. assessments header ────────────────────────────────────────
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

  -- ── 2. assessment_measurements ────────────────────────────────────
  IF v_measurements IS NOT NULL THEN
    INSERT INTO assessment_measurements
      SELECT * FROM jsonb_populate_record(
        NULL::assessment_measurements,
        v_measurements || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 3. score_results ──────────────────────────────────────────────
  IF jsonb_typeof(v_score_rows) = 'array' AND jsonb_array_length(v_score_rows) > 0 THEN
    INSERT INTO score_results
      SELECT * FROM jsonb_populate_recordset(
        NULL::score_results,
        (
          SELECT jsonb_agg(
            elem || jsonb_build_object('assessment_id', v_assessment_id)
          )
          FROM jsonb_array_elements(v_score_rows) AS elem
        )
      );
  END IF;

  -- ── 4. risk_profiles ──────────────────────────────────────────────
  IF v_risk_profile IS NOT NULL THEN
    INSERT INTO risk_profiles
      SELECT * FROM jsonb_populate_record(
        NULL::risk_profiles,
        v_risk_profile || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 5. nutrition_snapshots ────────────────────────────────────────
  IF v_nutrition IS NOT NULL THEN
    INSERT INTO nutrition_snapshots
      SELECT * FROM jsonb_populate_record(
        NULL::nutrition_snapshots,
        v_nutrition || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 6. activity_snapshots ─────────────────────────────────────────
  IF v_activity IS NOT NULL THEN
    INSERT INTO activity_snapshots
      SELECT * FROM jsonb_populate_record(
        NULL::activity_snapshots,
        v_activity || jsonb_build_object('assessment_id', v_assessment_id)
      );
  END IF;

  -- ── 7. followup_plans ─────────────────────────────────────────────
  IF v_followup IS NOT NULL THEN
    INSERT INTO followup_plans
      SELECT * FROM jsonb_populate_record(
        NULL::followup_plans,
        v_followup || jsonb_build_object(
          'patient_id',    v_patient_id,
          'assessment_id', v_assessment_id
        )
      );
  END IF;

  -- ── 8. due_items: DELETE + INSERT atomic block ───────────────────
  -- Migration 007 enforces uniqueness with a partial index on
  -- (patient_id, item_code) WHERE status IN ('open','acknowledged'),
  -- so we can't ON CONFLICT here. Instead we delete the engine-owned
  -- open/ack rows for the codes about to be re-inserted, preserving
  -- completed/dismissed history and any 'manual' rows.
  --
  -- FK columns (tenant_id, patient_id, assessment_id) are merged into
  -- every element so the TS caller does not need to know
  -- v_assessment_id before issuing the RPC. Symmetric to the alert and
  -- score_results merges below.
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
            elem || jsonb_build_object(
              'tenant_id',     v_tenant_id,
              'patient_id',    v_patient_id,
              'assessment_id', v_assessment_id
            )
          )
          FROM jsonb_array_elements(v_due_rows) AS elem
        )
      );
  END IF;

  -- ── 9. alerts ─────────────────────────────────────────────────────
  IF jsonb_typeof(v_alert_rows) = 'array' AND jsonb_array_length(v_alert_rows) > 0 THEN
    INSERT INTO alerts
      SELECT * FROM jsonb_populate_recordset(
        NULL::alerts,
        (
          SELECT jsonb_agg(
            elem || jsonb_build_object(
              'tenant_id',     v_tenant_id,
              'patient_id',    v_patient_id,
              'assessment_id', v_assessment_id
            )
          )
          FROM jsonb_array_elements(v_alert_rows) AS elem
        )
      );
  END IF;

  -- ── 10. Return result envelope ───────────────────────────────────
  RETURN jsonb_build_object(
    'assessment_id', v_assessment_id,
    'created_at',    v_created_at,
    'status',        v_status
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise with context. The whole BEGIN…END block is one
    -- transaction; PostgreSQL rolls back automatically on exception.
    RAISE EXCEPTION USING
      MESSAGE = 'create_assessment_atomic failed: ' || SQLERRM,
      ERRCODE = SQLSTATE;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION create_assessment_atomic(JSONB) IS
  'Atomic assessment write — see migration 011 (B-03). '
  'Persists assessments + 8 child tables in a single transaction. '
  'Caller (assessment-service.createAssessment) is responsible for '
  'computing the engine outputs and passing the JSONB payload.';

-- ============================================================
-- 3. Permissions
-- ============================================================
-- Only the service_role calls this function. The Vercel handlers use
-- the service-role key which bypasses RLS, so no policy plumbing is
-- needed; we revoke from PUBLIC just to be explicit.

REVOKE ALL ON FUNCTION create_assessment_atomic(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_assessment_atomic(JSONB) TO service_role;

-- ============================================================
-- 4. Migration audit row
-- ============================================================

-- NOTE: audit_events.entity_id is typed UUID (see 001_schema_foundation.sql).
-- Migration version labels are not entity UUIDs, so the version goes into
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
    'name', '011_atomic_assessment',
    'migration_version', '011',
    'audit_findings', ARRAY['B-03'],
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;

-- ============================================================
-- POST-DEPLOY VERIFICATION
-- ============================================================
--
-- 1. Smoke test (run as service role):
--      SELECT create_assessment_atomic(jsonb_build_object(
--        'tenant_id',  '<tenant>',
--        'patient_id', '<patient>',
--        'assessed_by','<user>',
--        'engine_version','1.0.0',
--        'clinical_input_snapshot','{}'::jsonb
--      ));
--      -- expected: { assessment_id, created_at, status } JSON
--      -- expected: a new assessments row with no children — that's fine
--
-- 2. Failure rollback:
--      SELECT create_assessment_atomic(jsonb_build_object(
--        'tenant_id',  '<tenant>',
--        'patient_id', '<patient_in_other_tenant>',
--        ...
--      ));
--      -- expected: ERROR; verify no orphan assessments row was created
--
-- 3. Verify TS layer cutover:
--      Once assessment-service.createAssessment is refactored to call
--      this function via supabase.rpc('create_assessment_atomic', ...),
--      run end-to-end create + read + delete to confirm no regression.
--
-- ============================================================
