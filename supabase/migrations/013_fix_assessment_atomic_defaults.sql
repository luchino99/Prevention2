-- ============================================================
-- MIGRATION 013: FIX create_assessment_atomic DEFAULT BYPASS
-- ============================================================
--
-- Bug
-- ---
-- Migration 011 introduced `create_assessment_atomic(payload jsonb)` to
-- write the assessment header + 8 child tables in a single transaction.
-- The implementation does:
--
--   INSERT INTO <child_table>
--     SELECT * FROM jsonb_populate_record(NULL::<child_table>, <payload>);
--
-- `jsonb_populate_record` returns a row whose missing-key columns are
-- NULL. The downstream `INSERT … SELECT` then inserts those NULLs
-- *explicitly*, which BYPASSES every column DEFAULT in the schema.
-- For PRIMARY KEY columns (`id UUID … DEFAULT uuid_generate_v4()`) this
-- means a NOT NULL violation, which is what production reported on the
-- very first child write:
--
--   ERROR: null value in column "id" of relation "assessment_measurements"
--   violates not-null constraint
--
-- Per project rules the failure aborted the entire transaction, so no
-- partial assessment landed — the safety net worked. But the function
-- itself was unusable for creating any assessment.
--
-- Scope of this migration
-- -----------------------
-- Re-define `create_assessment_atomic` to inject *defaults* into the
-- JSONB BEFORE the caller payload, so the merge order becomes:
--
--   defaults  ||  caller_payload  ||  forced_fks
--
-- where `||` is right-biased (later keys overwrite earlier). That way:
--   - defaults seed every NOT NULL DEFAULT column the schema declares;
--   - caller can still override (e.g. backdate `created_at`);
--   - forced FK keys (`id` we generate, `assessment_id`, `tenant_id`,
--     `patient_id`) cannot be silently overridden by the caller.
--
-- The defaults injected per table mirror the canonical schema in
-- migration 001 (and 007 for due_items). Each is documented inline.
--
-- Per-table fix
-- -------------
-- Tables with NOT NULL columns that have a DEFAULT and were therefore
-- being NULLed out by jsonb_populate_record:
--
--   assessment_measurements : id, created_at
--   score_results            : id, engine_version, created_at
--   risk_profiles            : id, created_at
--   nutrition_snapshots      : id, created_at
--   activity_snapshots       : id, created_at
--   followup_plans           : id, is_active, created_at, updated_at
--   alerts                   : id, severity, status, audience, created_at
--   due_items                : id, status, created_at, updated_at
--
-- The header INSERT into `assessments` uses an explicit column list and
-- VALUES (not SELECT * FROM jsonb_populate_record) so DEFAULTs already
-- apply correctly there — left untouched.
--
-- Validation, cross-tenant check, and audit row insert behaviour are
-- preserved exactly.
--
-- Idempotency / rollback
-- ----------------------
-- CREATE OR REPLACE FUNCTION — safe to re-apply. To roll back, re-apply
-- migration 011 (or restore the previous function definition from the
-- 011 file). No schema change, no data change.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. create_assessment_atomic(payload jsonb) — corrected
-- ============================================================

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

  -- ── 1. assessments header (unchanged — uses explicit column list) ─
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

  -- ── 2. assessment_measurements ───────────────────────────────────
  -- Defaults: id, created_at. Forced FK: assessment_id.
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

  -- ── 3. score_results ─────────────────────────────────────────────
  -- Defaults: id, engine_version, created_at. Forced FK: assessment_id.
  -- One uuid_generate_v4() call per row → distinct ids (the function
  -- is VOLATILE so the planner does not cache the value).
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

  -- ── 4. risk_profiles ─────────────────────────────────────────────
  -- Defaults: id, created_at. Forced FK: assessment_id.
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

  -- ── 5. nutrition_snapshots ───────────────────────────────────────
  -- Defaults: id, created_at. Forced FK: assessment_id.
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

  -- ── 6. activity_snapshots ────────────────────────────────────────
  -- Defaults: id, created_at. Forced FK: assessment_id.
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

  -- ── 7. followup_plans ────────────────────────────────────────────
  -- Defaults: id, is_active=true, created_at, updated_at.
  -- Forced FKs: patient_id, assessment_id.
  -- (owner_user_id is NOT NULL with no default — caller must supply.)
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

  -- ── 8. due_items: DELETE + INSERT atomic block ───────────────────
  -- Same delete-open + insert pattern as in 011 (preserving completed
  -- and dismissed history). Defaults: id, status='open', created_at,
  -- updated_at. Forced FKs: tenant_id, patient_id, assessment_id.
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

  -- ── 9. alerts ────────────────────────────────────────────────────
  -- Defaults: id, severity='info', status='open', audience='clinician',
  -- created_at. Forced FKs: tenant_id, patient_id, assessment_id.
  -- (type and title are NOT NULL with no default — caller must supply.)
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
    RAISE EXCEPTION USING
      MESSAGE = 'create_assessment_atomic failed: ' || SQLERRM,
      ERRCODE = SQLSTATE;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION create_assessment_atomic(JSONB) IS
  'Atomic assessment write — see migrations 011 (B-03 atomicity) and '
  '013 (DEFAULT-bypass fix). Persists assessments + 8 child tables in a '
  'single transaction. Caller (assessment-service.createAssessment) is '
  'responsible for computing the engine outputs and passing the JSONB '
  'payload; defaults for id/created_at/etc. are injected at the SQL layer.';

-- ============================================================
-- 2. Migration audit row (canonical schema — see 010/011/012)
-- ============================================================
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
    'name', '013_fix_assessment_atomic_defaults',
    'migration_version', '013',
    'audit_findings', ARRAY['B-03-defaults-bypass'],
    'tables_fixed', 8,
    'applied_at', NOW()
  ),
  NULL
);

COMMIT;
